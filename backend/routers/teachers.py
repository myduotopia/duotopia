import random
import logging
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    status,
    UploadFile,
    File,
    Form,
)
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session, selectinload, joinedload, contains_eager
from sqlalchemy import func, text
from pydantic import BaseModel, Field, field_validator
from database import get_db
from schemas import ProgramUpdate
from models import (
    Teacher,
    Classroom,
    Student,
    Program,
    ClassroomStudent,
    Lesson,
    Content,
    ContentItem,
    ContentType,
    Assignment,
    AssignmentContent,
    StudentContentProgress,
    StudentItemProgress,
    ProgramLevel,
    TeacherOrganization,
    TeacherSchool,
    Organization,
    School,
)
from auth import (
    verify_token,
    get_password_hash,
    verify_password,
    validate_password_strength,
)
from typing import List, Optional, Dict, Any  # noqa: F401
from datetime import date, datetime, timedelta, timezone  # noqa: F401
from services.translation import translation_service
from services.quota_analytics_service import QuotaAnalyticsService
from services.quota_service import QuotaService
from services.preview_service import get_sentence_fields

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/teachers", tags=["teachers"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/teacher/login")


# ============ Dependency to get current teacher ============
async def get_current_teacher(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
):
    """取得當前登入的教師"""
    import logging

    logger = logging.getLogger(__name__)

    # 🔍 診斷 logging
    logger.info("🔍 get_current_teacher called")

    payload = verify_token(token)
    logger.info(f"🔍 Token verification result: {bool(payload)}")

    if not payload:
        logger.error("❌ Token verification failed")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )

    teacher_id = payload.get("sub")
    teacher_type = payload.get("type")

    if teacher_type != "teacher":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not a teacher"
        )

    teacher = db.query(Teacher).filter(Teacher.id == teacher_id).first()
    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found"
        )

    return teacher


# ============ Response Models ============
class TeacherProfile(BaseModel):
    id: int
    email: str
    name: str
    phone: Optional[str]
    is_demo: bool
    is_active: bool
    is_admin: bool = False

    class Config:
        from_attributes = True


class UpdateTeacherProfileRequest(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None


class UpdatePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class ClassroomSummary(BaseModel):
    id: int
    name: str
    description: Optional[str]
    student_count: int
    school_id: Optional[str] = None
    school_name: Optional[str] = None
    organization_id: Optional[str] = None


class StudentSummary(BaseModel):
    id: int
    name: str
    email: Optional[str] = None  # Allow None for students without email
    classroom_name: str
    school_id: Optional[str] = None
    school_name: Optional[str] = None
    organization_id: Optional[str] = None


class OrganizationInfo(BaseModel):
    """機構資訊"""

    id: str
    name: str
    type: str  # personal, school_group, etc.


class SchoolInfo(BaseModel):
    """學校資訊"""

    id: str
    name: str


class TeacherDashboard(BaseModel):
    teacher: TeacherProfile
    classroom_count: int
    student_count: int
    program_count: int
    classrooms: List[ClassroomSummary]
    recent_students: List[StudentSummary]
    # Subscription information
    subscription_status: str
    subscription_end_date: Optional[str]
    days_remaining: int
    can_assign_homework: bool
    can_use_ai_grading: bool = True  # 教師/機構是否有 AI 分析額度
    is_test_account: bool  # 是否為測試帳號（白名單）
    # Organization and roles information
    organization: Optional[OrganizationInfo] = None
    schools: List[SchoolInfo] = []
    roles: List[str] = []  # All unique roles from TeacherSchool and TeacherOrganization


class OrganizationRole(BaseModel):
    """機構角色"""

    organization_id: str
    organization_name: str
    role: str  # org_owner, org_admin


class SchoolRole(BaseModel):
    """學校角色"""

    school_id: str
    school_name: str
    organization_id: str
    organization_name: str
    roles: List[str]  # school_admin, teacher


class TeacherRolesResponse(BaseModel):
    """教師角色回應"""

    teacher_id: int
    organization_roles: List[OrganizationRole]
    school_roles: List[SchoolRole]
    all_roles: List[str]  # Flattened unique list of all roles


# ============ Teacher Endpoints ============
@router.get("/me", response_model=TeacherProfile)
async def get_teacher_profile(current_teacher: Teacher = Depends(get_current_teacher)):
    """取得教師個人資料"""
    return current_teacher


@router.get("/me/roles", response_model=TeacherRolesResponse)
async def get_teacher_roles(
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    取得教師在所有機構和學校的角色

    Returns:
        - organization_roles: 機構層級的角色 (org_owner, org_admin)
        - school_roles: 學校層級的角色 (school_admin, teacher)
        - all_roles: 所有角色的扁平化列表
    """

    organization_roles = []
    school_roles = []
    all_roles_set = set()

    # 查詢機構角色
    teacher_orgs = (
        db.query(TeacherOrganization)
        .filter(
            TeacherOrganization.teacher_id == current_teacher.id,
            TeacherOrganization.is_active.is_(True),
        )
        .all()
    )

    for to in teacher_orgs:
        org = (
            db.query(Organization).filter(Organization.id == to.organization_id).first()
        )
        if org and org.is_active:
            organization_roles.append(
                OrganizationRole(
                    organization_id=str(to.organization_id),
                    organization_name=org.display_name or org.name,
                    role=to.role,
                )
            )
            all_roles_set.add(to.role)

    # 查詢學校角色
    teacher_schools = (
        db.query(TeacherSchool)
        .filter(
            TeacherSchool.teacher_id == current_teacher.id,
            TeacherSchool.is_active.is_(True),
        )
        .all()
    )

    for ts in teacher_schools:
        school = db.query(School).filter(School.id == ts.school_id).first()
        if school and school.is_active:
            org = (
                db.query(Organization)
                .filter(Organization.id == school.organization_id)
                .first()
            )
            if org:
                school_roles.append(
                    SchoolRole(
                        school_id=str(ts.school_id),
                        school_name=school.display_name or school.name,
                        organization_id=str(school.organization_id),
                        organization_name=org.display_name or org.name,
                        roles=ts.roles if ts.roles else [],
                    )
                )
                # 將學校角色加入 all_roles
                if ts.roles:
                    all_roles_set.update(ts.roles)

    return TeacherRolesResponse(
        teacher_id=current_teacher.id,
        organization_roles=organization_roles,
        school_roles=school_roles,
        all_roles=sorted(list(all_roles_set)),
    )


@router.put("/me", response_model=TeacherProfile)
async def update_teacher_profile(
    request: UpdateTeacherProfileRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """更新教師個人資料"""
    if request.name is not None:
        current_teacher.name = request.name
    if request.phone is not None:
        current_teacher.phone = request.phone

    db.commit()
    db.refresh(current_teacher)
    return current_teacher


@router.put("/me/password")
async def update_teacher_password(
    request: UpdatePasswordRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """更新教師密碼"""
    # Verify current password
    if not verify_password(request.current_password, current_teacher.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    # Check if new password is same as current password
    if verify_password(request.new_password, current_teacher.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from current password",
        )

    # Validate new password strength (same as registration)
    is_valid, error_msg = validate_password_strength(request.new_password)
    if not is_valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)

    # Update password
    current_teacher.password_hash = get_password_hash(request.new_password)
    db.commit()

    return {"message": "Password updated successfully"}


@router.get("/dashboard", response_model=TeacherDashboard)
async def get_teacher_dashboard(
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """取得教師儀表板資料"""

    # Query teacher's organization via TeacherOrganization (with eager loading)
    teacher_org = (
        db.query(TeacherOrganization)
        .filter(
            TeacherOrganization.teacher_id == current_teacher.id,
            TeacherOrganization.is_active.is_(True),
        )
        .options(joinedload(TeacherOrganization.organization))
        .first()
    )

    organization_info = None
    if teacher_org and teacher_org.organization and teacher_org.organization.is_active:
        org = teacher_org.organization
        organization_info = OrganizationInfo(
            id=str(org.id),
            name=org.display_name or org.name,
            type="organization",
        )

    # Query teacher's schools via TeacherSchool (with eager loading)
    teacher_schools = (
        db.query(TeacherSchool)
        .filter(
            TeacherSchool.teacher_id == current_teacher.id,
            TeacherSchool.is_active.is_(True),
        )
        .options(joinedload(TeacherSchool.school))
        .all()
    )

    schools_info = []
    all_roles_set = set()

    # Add organization role if exists
    if teacher_org:
        all_roles_set.add(teacher_org.role)

    # Process schools and collect roles
    for ts in teacher_schools:
        if ts.school and ts.school.is_active:
            schools_info.append(
                SchoolInfo(
                    id=str(ts.school.id),
                    name=ts.school.display_name or ts.school.name,
                )
            )
            # Add school roles
            if ts.roles:
                all_roles_set.update(ts.roles)

    # Get classrooms with student count (only active classrooms)
    classrooms = (
        db.query(Classroom)
        .filter(
            Classroom.teacher_id == current_teacher.id,
            Classroom.is_active.is_(True),  # Filter out soft-deleted classrooms
        )
        .options(
            selectinload(Classroom.students).selectinload(ClassroomStudent.student),
            selectinload(Classroom.classroom_schools),
        )
        .all()
    )

    # Get school information for classrooms
    classroom_school_dict = {}
    for classroom in classrooms:
        active_links = [cs for cs in classroom.classroom_schools if cs.is_active]
        if active_links:
            link = active_links[0]
            school = db.query(School).filter(School.id == link.school_id).first()
            if school:
                classroom_school_dict[classroom.id] = {
                    "school_id": str(school.id),
                    "school_name": school.name,
                    "organization_id": str(school.organization_id),
                }

    classroom_summaries = []
    total_students = 0
    recent_students = []

    for classroom in classrooms:
        # Only count active students in active enrollments
        # Also check that student exists (not None) to avoid null reference errors
        active_students = [
            cs
            for cs in classroom.students
            if cs.is_active and cs.student and cs.student.is_active
        ]
        student_count = len(active_students)
        total_students += student_count

        school_info = classroom_school_dict.get(classroom.id)
        classroom_summaries.append(
            ClassroomSummary(
                id=classroom.id,
                name=classroom.name,
                description=classroom.description,
                student_count=student_count,
                school_id=school_info.get("school_id") if school_info else None,
                school_name=school_info.get("school_name") if school_info else None,
                organization_id=(
                    school_info.get("organization_id") if school_info else None
                ),
            )
        )

        # Add recent students (first 3 active students from each classroom)
        for classroom_student in active_students[:3]:
            if (
                len(recent_students) < 10 and classroom_student.student
            ):  # Limit to 10 recent students
                recent_students.append(
                    StudentSummary(
                        id=classroom_student.student.id,
                        name=classroom_student.student.name,
                        email=classroom_student.student.email,  # Can be None now
                        classroom_name=classroom.name,
                        school_id=school_info.get("school_id") if school_info else None,
                        school_name=(
                            school_info.get("school_name") if school_info else None
                        ),
                        organization_id=(
                            school_info.get("organization_id") if school_info else None
                        ),
                    )
                )

    # Get program count (programs created by this teacher)
    program_count = (
        db.query(Program)
        .filter(Program.teacher_id == current_teacher.id, Program.is_active.is_(True))
        .count()
    )

    # 測試訂閱白名單（與 routers/subscription.py 保持一致）
    TEST_SUBSCRIPTION_WHITELIST = [
        "demo@duotopia.com",
        "expired@duotopia.com",
        "trial@duotopia.com",
        "purpleice9765@msn.com",
        "kaddyeunice@apps.ntpc.edu.tw",
        "ceeks.edu@gmail.com",
    ]
    is_test_account = current_teacher.email in TEST_SUBSCRIPTION_WHITELIST

    # 暫時停用 can_assign_homework 計算（保留邏輯以便日後恢復）
    if False:  # pragma: no cover
        can_assign_homework = current_teacher.can_assign_homework
    else:
        can_assign_homework = True

    # 檢查教師/機構是否有 AI 分析額度
    can_use_ai_grading = QuotaService.check_ai_analysis_availability(
        current_teacher.id, db
    )

    return TeacherDashboard(
        teacher=TeacherProfile.from_orm(current_teacher),
        classroom_count=len(classrooms),
        student_count=total_students,
        program_count=program_count,
        classrooms=classroom_summaries,
        recent_students=recent_students,
        # Subscription information
        subscription_status=current_teacher.subscription_status,
        subscription_end_date=current_teacher.subscription_end_date.isoformat()
        if current_teacher.subscription_end_date
        else None,
        days_remaining=current_teacher.days_remaining,
        can_assign_homework=can_assign_homework,
        can_use_ai_grading=can_use_ai_grading,
        is_test_account=is_test_account,
        # Organization and roles information
        organization=organization_info,
        schools=schools_info,
        roles=sorted(list(all_roles_set)),
    )


@router.get("/subscription")
async def get_teacher_subscription(
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """取得教師訂閱資訊（用於顯示配額）"""
    current_period = current_teacher.current_period

    if not current_period:
        return {
            "subscription_period": None,
            "message": "No active subscription",
        }

    return {
        "subscription_period": {
            "quota_total": current_period.quota_total,
            "quota_used": current_period.quota_used,
            "plan_name": current_period.plan_name,
            "status": current_period.status,
            "end_date": current_period.end_date.isoformat(),
        }
    }


@router.get("/classrooms")
async def get_teacher_classrooms(
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """取得教師的所有班級（包含學校和組織資訊）"""

    # Get classrooms with students (only active classrooms)
    classrooms = (
        db.query(Classroom)
        .filter(
            Classroom.teacher_id == current_teacher.id,
            Classroom.is_active.is_(True),  # Only show active classrooms
        )
        .options(
            selectinload(Classroom.students).selectinload(ClassroomStudent.student),
            selectinload(Classroom.classroom_schools),
        )
        .all()
    )

    # Get program counts in a single query for all classrooms
    program_counts = (
        db.query(Program.classroom_id, func.count(Program.id).label("count"))
        .filter(
            Program.classroom_id.in_([c.id for c in classrooms]),
            Program.is_active.is_(True),
        )
        .group_by(Program.classroom_id)
        .all()
    )

    # Convert to dict for easy lookup
    program_count_map = {pc.classroom_id: pc.count for pc in program_counts}

    # Get school and organization info for classrooms
    classroom_school_map = {}
    for classroom in classrooms:
        active_links = [cs for cs in classroom.classroom_schools if cs.is_active]
        if active_links:
            # Get the first active link (a classroom should only have one active school)
            link = active_links[0]
            school = db.query(School).filter(School.id == link.school_id).first()
            if school:
                classroom_school_map[classroom.id] = {
                    "school_id": str(school.id),
                    "school_name": school.name,
                    "organization_id": str(school.organization_id),
                }

    return [
        {
            "id": classroom.id,
            "name": classroom.name,
            "description": classroom.description,
            "level": classroom.level.value if classroom.level else "A1",
            "student_count": len([s for s in classroom.students if s.is_active]),
            "program_count": program_count_map.get(classroom.id, 0),  # Efficient lookup
            "created_at": (
                classroom.created_at.isoformat() if classroom.created_at else None
            ),
            # Add school and organization info
            "school_id": classroom_school_map.get(classroom.id, {}).get("school_id"),
            "school_name": classroom_school_map.get(classroom.id, {}).get(
                "school_name"
            ),
            "organization_id": classroom_school_map.get(classroom.id, {}).get(
                "organization_id"
            ),
            "students": [
                {
                    "id": cs.student.id,
                    "name": cs.student.name,
                    "email": cs.student.email,
                    "student_number": cs.student.student_number,
                    "birthdate": (
                        cs.student.birthdate.isoformat()
                        if cs.student.birthdate
                        else None
                    ),
                    "password_changed": cs.student.password_changed,
                    "last_login": (
                        cs.student.last_login.isoformat()
                        if cs.student.last_login
                        else None
                    ),
                    "phone": "",  # Privacy: don't expose phone numbers in list
                    "status": "active" if cs.student.is_active else "inactive",
                }
                for cs in classroom.students
                if cs.is_active
            ],
        }
        for classroom in classrooms
    ]


@router.get("/programs")
async def get_teacher_programs(
    is_template: Optional[bool] = None,
    classroom_id: Optional[int] = None,
    school_id: Optional[str] = None,
    organization_id: Optional[str] = None,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """取得教師的所有課程（支援過濾公版/班級課程/學校/組織）"""
    query = (
        db.query(Program)
        .filter(Program.teacher_id == current_teacher.id, Program.is_active.is_(True))
        .options(
            selectinload(Program.classroom),
            selectinload(Program.lessons)
            .selectinload(Lesson.contents)
            .selectinload(Content.content_items),
        )
    )

    # 過濾公版/班級課程
    if is_template is not None:
        query = query.filter(Program.is_template == is_template)

    # 過濾特定班級
    if classroom_id is not None:
        query = query.filter(Program.classroom_id == classroom_id)

    # 過濾 workspace context (school/organization) with authorization
    if school_id:
        # Verify teacher belongs to this school
        teacher_school = (
            db.query(TeacherSchool)
            .filter(
                TeacherSchool.teacher_id == current_teacher.id,
                TeacherSchool.school_id == school_id,
                TeacherSchool.is_active.is_(True),
            )
            .first()
        )

        if not teacher_school:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Teacher does not have access to this school",
            )

        query = query.filter(Program.school_id == school_id)

    elif organization_id:
        # Verify teacher belongs to this organization
        teacher_org = (
            db.query(TeacherOrganization)
            .filter(
                TeacherOrganization.teacher_id == current_teacher.id,
                TeacherOrganization.organization_id == organization_id,
                TeacherOrganization.is_active.is_(True),
            )
            .first()
        )

        if not teacher_org:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Teacher does not have access to this organization",
            )

        query = query.filter(Program.organization_id == organization_id)

    elif not classroom_id:
        # Personal mode: 只顯示個人課程（沒有 school_id 和 organization_id）
        # 但如果已指定 classroom_id，則不套用此過濾（班級課程可能有 school_id）
        query = query.filter(
            Program.school_id.is_(None), Program.organization_id.is_(None)
        )

    programs = query.order_by(Program.order_index).all()

    # 🔥 Batch-load student counts for all classrooms (avoid N+1)
    classroom_ids = [p.classroom_id for p in programs if p.classroom_id]

    student_counts = (
        db.query(
            ClassroomStudent.classroom_id,
            func.count(ClassroomStudent.id).label("count"),
        )
        .filter(ClassroomStudent.classroom_id.in_(classroom_ids))
        .group_by(ClassroomStudent.classroom_id)
        .all()
    )
    student_count_map = {row.classroom_id: row.count for row in student_counts}

    result = []
    for program in programs:
        # 🔥 Get student count from preloaded map (no query)
        student_count = student_count_map.get(program.classroom_id, 0)

        # 處理 lessons 和 contents
        lessons_data = []
        for lesson in sorted(program.lessons, key=lambda x: x.order_index):
            if lesson.is_active:
                contents_data = []
                if lesson.contents:
                    for content in sorted(lesson.contents, key=lambda x: x.order_index):
                        if (
                            content.is_active and not content.is_assignment_copy
                        ):  # 🔥 只顯示模板內容
                            # 將 content_items 轉換成舊格式 items
                            items_data = []
                            if content.content_items:
                                for item in sorted(
                                    content.content_items, key=lambda x: x.order_index
                                ):
                                    items_data.append(
                                        {
                                            "id": item.id,
                                            "text": item.text,
                                            "translation": item.translation,
                                            "audio_url": item.audio_url,
                                            "example_sentence": item.example_sentence,
                                            "example_sentence_translation": item.example_sentence_translation,
                                            "order_index": item.order_index,
                                        }
                                    )

                            contents_data.append(
                                {
                                    "id": content.id,
                                    "title": content.title,
                                    "type": content.type,
                                    "items": items_data,
                                    "items_count": len(items_data),
                                    "order_index": content.order_index,
                                    "level": content.level,
                                    "tags": content.tags or [],
                                }
                            )

                lessons_data.append(
                    {
                        "id": lesson.id,
                        "name": lesson.name,
                        "description": lesson.description,
                        "estimated_minutes": lesson.estimated_minutes,
                        "order_index": lesson.order_index,
                        "contents": contents_data,
                    }
                )

        result.append(
            {
                "id": program.id,
                "name": program.name,
                "description": program.description,
                "level": program.level.value if program.level else None,
                "classroom_id": program.classroom_id,
                "classroom_name": program.classroom.name if program.classroom else None,
                "estimated_hours": program.estimated_hours,
                "is_active": program.is_active,
                "is_template": program.is_template,
                "created_at": (
                    program.created_at.isoformat() if program.created_at else None
                ),
                "lesson_count": len(lessons_data),
                "student_count": student_count,
                "status": ("active" if program.is_active else "archived"),
                "order_index": (
                    program.order_index if hasattr(program, "order_index") else 1
                ),
                "tags": program.tags or [],
                "visibility": program.visibility,
                "lessons": lessons_data,
            }
        )

    return result


# ============ CRUD Endpoints ============


# ------------ Classroom CRUD ------------
class ClassroomCreate(BaseModel):
    name: str
    description: Optional[str] = None
    level: str = "A1"


class ClassroomUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    level: Optional[str] = None


@router.post("/classrooms")
async def create_classroom(
    classroom_data: ClassroomCreate,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """創建新班級"""
    classroom = Classroom(
        name=classroom_data.name,
        description=classroom_data.description,
        level=getattr(
            ProgramLevel,
            classroom_data.level.upper().replace("-", "_"),
            ProgramLevel.A1,
        ),
        teacher_id=current_teacher.id,
        is_active=True,
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)

    return {
        "id": classroom.id,
        "name": classroom.name,
        "description": classroom.description,
        "level": classroom.level.value,
        "teacher_id": classroom.teacher_id,
    }


@router.get("/classrooms/{classroom_id}")
async def get_classroom(
    classroom_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """取得單一班級資料"""
    classroom = (
        db.query(Classroom)
        .filter(
            Classroom.id == classroom_id, Classroom.teacher_id == current_teacher.id
        )
        .first()
    )

    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    return {
        "id": classroom.id,
        "name": classroom.name,
        "description": classroom.description,
        "level": classroom.level.value if classroom.level else "A1",
        "teacher_id": classroom.teacher_id,
    }


@router.put("/classrooms/{classroom_id}")
async def update_classroom(
    classroom_id: int,
    update_data: ClassroomUpdate,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """更新班級資料"""
    classroom = (
        db.query(Classroom)
        .filter(
            Classroom.id == classroom_id, Classroom.teacher_id == current_teacher.id
        )
        .first()
    )

    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    if update_data.name is not None:
        classroom.name = update_data.name
    if update_data.description is not None:
        classroom.description = update_data.description
    if update_data.level is not None:
        classroom.level = getattr(
            ProgramLevel, update_data.level.upper().replace("-", "_"), ProgramLevel.A1
        )

    db.commit()
    db.refresh(classroom)

    return {
        "id": classroom.id,
        "name": classroom.name,
        "description": classroom.description,
        "level": classroom.level.value,
    }


@router.delete("/classrooms/{classroom_id}")
async def delete_classroom(
    classroom_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """刪除班級"""
    classroom = (
        db.query(Classroom)
        .filter(
            Classroom.id == classroom_id, Classroom.teacher_id == current_teacher.id
        )
        .first()
    )

    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    # Soft delete by setting is_active = False
    classroom.is_active = False
    db.commit()

    return {"message": "Classroom deleted successfully"}


# ------------ Student CRUD ------------
class StudentCreate(BaseModel):
    name: str
    email: Optional[str] = None  # Email（選填，可以是真實 email）
    birthdate: str  # YYYY-MM-DD format
    classroom_id: Optional[int] = None  # 班級改為選填，可以之後再分配
    student_number: Optional[str] = Field(None, max_length=50)
    phone: Optional[str] = None  # 新增 phone 欄位

    @field_validator("student_number")
    @classmethod
    def validate_student_number(cls, v: Optional[str]) -> Optional[str]:
        """Validate student_number to prevent SQL injection and ensure safe format"""
        if v is None:
            return v

        # Strip whitespace
        v = v.strip()

        # Convert empty string to None
        if not v:
            return None

        # Max length check (already enforced by Field, but double-check)
        if len(v) > 50:
            raise ValueError("學號長度不能超過 50 個字符")

        # Only allow alphanumeric, hyphen, and underscore (prevent SQL injection)
        import re

        if not re.match(r"^[a-zA-Z0-9_-]+$", v):
            raise ValueError("學號只能包含字母、數字、連字號和底線")

        return v

    @field_validator("email", "phone")
    @classmethod
    def normalize_empty_strings(cls, v: Optional[str]) -> Optional[str]:
        """Convert empty strings to None for optional fields"""
        if v is None:
            return v

        # Strip whitespace
        v = v.strip()

        # Convert empty string to None
        if not v:
            return None

        return v


class StudentUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None  # 可更新為真實 email
    student_number: Optional[str] = Field(None, max_length=50)
    birthdate: Optional[str] = None
    phone: Optional[str] = None
    status: Optional[str] = None
    target_wpm: Optional[int] = None
    target_accuracy: Optional[float] = None
    classroom_id: Optional[int] = None  # 新增班級分配功能

    @field_validator("student_number")
    @classmethod
    def validate_student_number(cls, v: Optional[str]) -> Optional[str]:
        """Validate student_number to prevent SQL injection and ensure safe format"""
        if v is None:
            return v

        # Strip whitespace
        v = v.strip()

        # Convert empty string to None
        if not v:
            return None

        # Max length check (already enforced by Field, but double-check)
        if len(v) > 50:
            raise ValueError("學號長度不能超過 50 個字符")

        # Only allow alphanumeric, hyphen, and underscore (prevent SQL injection)
        import re

        if not re.match(r"^[a-zA-Z0-9_-]+$", v):
            raise ValueError("學號只能包含字母、數字、連字號和底線")

        return v

    @field_validator("email", "phone")
    @classmethod
    def normalize_empty_strings(cls, v: Optional[str]) -> Optional[str]:
        """Convert empty strings to None for optional fields"""
        if v is None:
            return v

        # Strip whitespace
        v = v.strip()

        # Convert empty string to None
        if not v:
            return None

        return v


class BatchStudentCreate(BaseModel):
    students: List[Dict[str, Any]]


@router.get("/students")
async def get_all_students(
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """取得教師的所有學生（包含班級學生及24小時內建立的未分配學生）"""
    # Shows:
    # 1. All students in teacher's classrooms
    # 2. Unassigned students created in last 24 hours (for assignment purposes)

    # Get students in teacher's classrooms
    students_in_classrooms = (
        db.query(Student)
        .join(ClassroomStudent, Student.id == ClassroomStudent.student_id)
        .join(Classroom, ClassroomStudent.classroom_id == Classroom.id)
        .filter(
            Classroom.teacher_id == current_teacher.id,
            Student.is_active.is_(True),  # Only show active students
            ClassroomStudent.is_active.is_(True),  # Only active enrollments
        )
        .all()
    )

    # IMPORTANT: Also get recently created unassigned students (last 24 hours)
    # This allows teachers to see and assign students they just created

    twenty_four_hours_ago = datetime.utcnow() - timedelta(hours=24)

    recent_unassigned_students = (
        db.query(Student)
        .outerjoin(ClassroomStudent, Student.id == ClassroomStudent.student_id)
        .filter(
            ClassroomStudent.id.is_(None),  # No classroom assignment
            Student.is_active.is_(True),
            Student.created_at >= twenty_four_hours_ago,  # Created in last 24 hours
        )
        .all()
    )

    # Combine and deduplicate
    all_students = list(
        {s.id: s for s in students_in_classrooms + recent_unassigned_students}.values()
    )

    # 優化：批次查詢教室學生關係，避免 N+1 問題
    student_ids = [s.id for s in all_students]
    classroom_students_list = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.student_id.in_(student_ids),
            ClassroomStudent.is_active.is_(True),
        )
        .join(Classroom)
        .filter(Classroom.teacher_id == current_teacher.id)
        .all()
    )
    classroom_students_dict = {cs.student_id: cs for cs in classroom_students_list}

    # 批次查詢教室資訊
    classroom_ids = [cs.classroom_id for cs in classroom_students_list]
    classrooms_dict = {}
    classroom_school_dict = {}
    if classroom_ids:
        classrooms_list = (
            db.query(Classroom)
            .filter(Classroom.id.in_(classroom_ids))
            .options(selectinload(Classroom.classroom_schools))
            .all()
        )
        classrooms_dict = {c.id: c for c in classrooms_list}

        # Get school information for classrooms
        for classroom in classrooms_list:
            active_links = [cs for cs in classroom.classroom_schools if cs.is_active]
            if active_links:
                link = active_links[0]
                school = db.query(School).filter(School.id == link.school_id).first()
                if school:
                    classroom_school_dict[classroom.id] = {
                        "school_id": str(school.id),
                        "school_name": school.name,
                        "organization_id": str(school.organization_id),
                    }

    # Build response with classroom and school info
    result = []
    for student in all_students:
        # 使用字典查找，避免重複查詢
        classroom_student = classroom_students_dict.get(student.id)

        classroom_info = None
        school_info = None
        if classroom_student:
            classroom = classrooms_dict.get(classroom_student.classroom_id)
            if classroom:
                classroom_info = {"id": classroom.id, "name": classroom.name}
                school_info = classroom_school_dict.get(classroom.id)

        result.append(
            {
                "id": student.id,
                "name": student.name,
                "email": student.email,
                "student_number": student.student_number,
                "birthdate": (
                    student.birthdate.isoformat() if student.birthdate else None
                ),
                "phone": getattr(student, "phone", ""),
                "password_changed": student.password_changed,
                "last_login": (
                    student.last_login.isoformat() if student.last_login else None
                ),
                "status": "active" if student.is_active else "inactive",
                "classroom_id": classroom_info["id"] if classroom_info else None,
                "classroom_name": (classroom_info["name"] if classroom_info else "未分配"),
                # Add school and organization info
                "school_id": school_info.get("school_id") if school_info else None,
                "school_name": school_info.get("school_name") if school_info else None,
                "organization_id": (
                    school_info.get("organization_id") if school_info else None
                ),
                "email_verified": student.email_verified,
                "email_verified_at": (
                    student.email_verified_at.isoformat()
                    if student.email_verified_at
                    else None
                ),
            }
        )

    return result


@router.post("/students")
async def create_student(
    student_data: StudentCreate,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """創建新學生"""
    # Verify classroom belongs to teacher (only if classroom_id is provided)
    if student_data.classroom_id:
        classroom = (
            db.query(Classroom)
            .filter(
                Classroom.id == student_data.classroom_id,
                Classroom.teacher_id == current_teacher.id,
            )
            .first()
        )

        if not classroom:
            raise HTTPException(status_code=404, detail="Classroom not found")

    # Parse birthdate with error handling
    try:
        # Try to parse the birthdate
        birthdate = date.fromisoformat(student_data.birthdate)
    except ValueError:
        # If format is wrong, try to handle common formats
        try:
            # Try format with slashes

            birthdate = datetime.strptime(student_data.birthdate, "%Y/%m/%d").date()
        except ValueError:
            raise HTTPException(
                status_code=422,
                detail="Invalid birthdate format. Please use YYYY-MM-DD format",
            )

    default_password = birthdate.strftime("%Y%m%d")

    # Email is optional now - can be NULL or shared between students
    email = student_data.email if student_data.email else None

    # 🔥 Issue #31: Validate student_number uniqueness within classroom
    if student_data.student_number and student_data.classroom_id:
        existing_student_with_number = (
            db.query(Student)
            .join(ClassroomStudent)
            .filter(
                ClassroomStudent.classroom_id == student_data.classroom_id,
                ClassroomStudent.is_active.is_(True),
                Student.student_number == student_data.student_number,
                Student.is_active.is_(True),
            )
            .first()
        )

        if existing_student_with_number:
            raise HTTPException(
                status_code=409,
                detail=f"學號 '{student_data.student_number}' 已存在於此班級中",
            )

    # Create student
    student = Student(
        name=student_data.name,
        email=email,
        birthdate=birthdate,
        password_hash=get_password_hash(default_password),
        password_changed=False,
        student_number=student_data.student_number,
        target_wpm=80,
        target_accuracy=0.8,
        is_active=True,
    )

    try:
        db.add(student)
        db.commit()
        db.refresh(student)
    except Exception as e:
        db.rollback()
        # Check if it's a unique constraint violation
        if "duplicate key" in str(e):
            raise HTTPException(
                status_code=422, detail="Email or student ID already exists"
            )
        raise HTTPException(status_code=500, detail=str(e))

    # Add student to classroom (only if classroom_id is provided)
    if student_data.classroom_id:
        enrollment = ClassroomStudent(
            classroom_id=student_data.classroom_id,
            student_id=student.id,
            is_active=True,
        )
        db.add(enrollment)
        db.commit()

    response = {
        "id": student.id,
        "name": student.name,
        "email": student.email,
        "birthdate": student.birthdate.isoformat(),
        "default_password": default_password,
        "password_changed": False,
        "classroom_id": student_data.classroom_id,
        "student_number": student.student_number,
        "phone": student_data.phone,
        "email_verified": False,  # 新建立的學生 email 未驗證
    }

    # Add warning if no classroom assigned
    if not student_data.classroom_id:
        response["warning"] = "學生已建立但未分配到任何班級。該學生將在「我的學生」列表中顯示24小時，請儘快分配班級。"

    return response


@router.get("/students/{student_id}")
async def get_student(
    student_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """取得單一學生資料"""
    # First check if student exists and is active
    student = (
        db.query(Student)
        .filter(Student.id == student_id, Student.is_active.is_(True))
        .first()
    )

    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # Check if student belongs to teacher's classroom (if assigned to any)
    classroom_student = (
        db.query(ClassroomStudent)
        .filter(ClassroomStudent.student_id == student_id)
        .first()
    )

    if classroom_student:
        # If student is in a classroom, verify it belongs to this teacher
        classroom = (
            db.query(Classroom)
            .filter(
                Classroom.id == classroom_student.classroom_id,
                Classroom.teacher_id == current_teacher.id,
            )
            .first()
        )

        if not classroom:
            raise HTTPException(
                status_code=403,
                detail="You don't have permission to access this student",
            )

    # If student has no classroom, we assume the teacher can access them

    return {
        "id": student.id,
        "name": student.name,
        "email": student.email,
        "birthdate": student.birthdate.isoformat(),
        "password_changed": student.password_changed,
        "student_number": student.student_number,
    }


@router.put("/students/{student_id}")
async def update_student(
    student_id: int,
    update_data: StudentUpdate,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """更新學生資料"""
    # First check if student exists and is active
    student = (
        db.query(Student)
        .filter(Student.id == student_id, Student.is_active.is_(True))
        .first()
    )

    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # Check if student belongs to teacher's classroom (if assigned to any)
    classroom_student = (
        db.query(ClassroomStudent)
        .filter(ClassroomStudent.student_id == student_id)
        .first()
    )

    if classroom_student:
        # If student is in a classroom, verify it belongs to this teacher
        classroom = (
            db.query(Classroom)
            .filter(
                Classroom.id == classroom_student.classroom_id,
                Classroom.teacher_id == current_teacher.id,
            )
            .first()
        )

        if not classroom:
            raise HTTPException(
                status_code=403,
                detail="You don't have permission to update this student",
            )

    # Check if birthdate is being changed and student is using default password
    if update_data.birthdate is not None and not student.password_changed:
        # Parse new birthdate
        new_birthdate = datetime.strptime(update_data.birthdate, "%Y-%m-%d").date()
        student.birthdate = new_birthdate

        # Update password to new birthdate (YYYYMMDD format)
        new_default_password = new_birthdate.strftime("%Y%m%d")
        student.password_hash = get_password_hash(new_default_password)

    # Update other fields
    if update_data.name is not None:
        student.name = update_data.name
    if update_data.email is not None:
        old_email = student.email
        student.email = update_data.email
        # 建立/關聯 Identity（非系統 email 才處理）
        if (
            update_data.email != old_email
            and "@duotopia.local" not in update_data.email
        ):
            from services.identity_service import identity_service

            student.email_verified = False
            student.email_verified_at = None
            identity_service.ensure_identity_on_email_bind(
                db, student, update_data.email
            )

    # 🔥 Issue #31: Validate student_number uniqueness within classroom when updating
    if update_data.student_number is not None:
        # Get student's current classroom
        current_classroom = (
            db.query(ClassroomStudent)
            .filter(
                ClassroomStudent.student_id == student_id,
                ClassroomStudent.is_active.is_(True),
            )
            .first()
        )

        # If student has a classroom and student_number is changing, check for duplicates
        if current_classroom and update_data.student_number != student.student_number:
            existing_student_with_number = (
                db.query(Student)
                .join(ClassroomStudent)
                .filter(
                    ClassroomStudent.classroom_id == current_classroom.classroom_id,
                    ClassroomStudent.is_active.is_(True),
                    Student.student_number == update_data.student_number,
                    Student.is_active.is_(True),
                    Student.id != student_id,  # Exclude current student
                )
                .first()
            )

            if existing_student_with_number:
                raise HTTPException(
                    status_code=409,
                    detail=f"學號 '{update_data.student_number}' 已存在於此班級中",
                )

        student.student_number = update_data.student_number

    if update_data.phone is not None:
        student.phone = update_data.phone
    if update_data.status is not None:
        student.status = update_data.status
    if update_data.target_wpm is not None:
        student.target_wpm = update_data.target_wpm
    if update_data.target_accuracy is not None:
        student.target_accuracy = update_data.target_accuracy

    # 如果更新 email 且是真實 email（非系統生成），重置驗證狀態
    if update_data.email is not None and "@duotopia.local" not in update_data.email:
        if student.email != update_data.email:
            student.email_verified = False
            student.email_verified_at = None
            student.email_verification_token = None

    # Handle classroom assignment
    if update_data.classroom_id is not None:
        # First, remove student from current classroom (if any)
        existing_enrollment = (
            db.query(ClassroomStudent)
            .filter(
                ClassroomStudent.student_id == student_id,
                ClassroomStudent.is_active.is_(True),
            )
            .first()
        )

        if existing_enrollment:
            existing_enrollment.is_active = False

        # If classroom_id is provided (not 0 or empty), assign to new classroom
        if update_data.classroom_id > 0:
            # Verify classroom belongs to teacher
            classroom = (
                db.query(Classroom)
                .filter(
                    Classroom.id == update_data.classroom_id,
                    Classroom.teacher_id == current_teacher.id,
                    Classroom.is_active.is_(True),
                )
                .first()
            )

            if not classroom:
                raise HTTPException(status_code=404, detail="Classroom not found")

            # 🔥 Issue #31: Check if student_number already exists in target classroom
            if student.student_number:
                existing_student_with_number = (
                    db.query(Student)
                    .join(ClassroomStudent)
                    .filter(
                        ClassroomStudent.classroom_id == update_data.classroom_id,
                        ClassroomStudent.is_active.is_(True),
                        Student.student_number == student.student_number,
                        Student.is_active.is_(True),
                        Student.id != student_id,  # Exclude current student
                    )
                    .first()
                )

                if existing_student_with_number:
                    raise HTTPException(
                        status_code=409,
                        detail=f"學號 '{student.student_number}' 已存在於目標班級中",
                    )

            # Create new enrollment
            new_enrollment = ClassroomStudent(
                classroom_id=update_data.classroom_id,
                student_id=student_id,
                is_active=True,
            )
            db.add(new_enrollment)

    db.commit()
    db.refresh(student)

    return {
        "id": student.id,
        "name": student.name,
        "email": student.email,
        "student_number": student.student_number,
    }


@router.delete("/students/{student_id}")
async def delete_student(
    student_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """刪除學生"""
    # First check if student exists and is active
    student = (
        db.query(Student)
        .filter(Student.id == student_id, Student.is_active.is_(True))
        .first()
    )

    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # Check if student belongs to teacher's classroom (if assigned to any)
    classroom_student = (
        db.query(ClassroomStudent)
        .filter(ClassroomStudent.student_id == student_id)
        .first()
    )

    if classroom_student:
        # If student is in a classroom, verify it belongs to this teacher
        classroom = (
            db.query(Classroom)
            .filter(
                Classroom.id == classroom_student.classroom_id,
                Classroom.teacher_id == current_teacher.id,
            )
            .first()
        )

        if not classroom:
            raise HTTPException(
                status_code=403,
                detail="You don't have permission to delete this student",
            )

    # If student has no classroom, we assume the teacher can delete them
    # (since they likely created them)

    # Soft delete
    student.is_active = False
    db.commit()

    return {"message": "Student deleted successfully"}


@router.post("/students/{student_id}/reset-password")
async def reset_student_password(
    student_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """重設學生密碼為預設值（生日）"""
    # Get student and verify it belongs to teacher's classroom
    student = (
        db.query(Student)
        .filter(
            Student.id == student_id,
            Student.classroom_enrollments.any(
                ClassroomStudent.classroom.has(
                    Classroom.teacher_id == current_teacher.id
                )
            ),
        )
        .first()
    )

    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    if not student.birthdate:
        raise HTTPException(status_code=400, detail="Student birthdate not set")

    # Reset password to birthdate (YYYYMMDD format)

    default_password = student.birthdate.strftime("%Y%m%d")
    student.password_hash = get_password_hash(default_password)
    student.password_changed = False

    db.commit()

    return {
        "message": "Password reset successfully",
        "default_password": default_password,
    }


@router.post("/classrooms/{classroom_id}/students/batch")
async def batch_create_students(
    classroom_id: int,
    batch_data: BatchStudentCreate,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """批次創建學生"""
    # Verify classroom belongs to teacher
    classroom = (
        db.query(Classroom)
        .filter(
            Classroom.id == classroom_id, Classroom.teacher_id == current_teacher.id
        )
        .first()
    )

    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    created_students = []
    for student_data in batch_data.students:
        birthdate = date.fromisoformat(student_data["birthdate"])
        default_password = birthdate.strftime("%Y%m%d")

        student = Student(
            name=student_data["name"],
            email=student_data["email"],
            birthdate=birthdate,
            password_hash=get_password_hash(default_password),
            password_changed=False,
            student_id=student_data.get("student_id"),
            target_wpm=80,
            target_accuracy=0.8,
            is_active=True,
        )
        db.add(student)
        db.flush()  # Get the ID

        # Add to classroom
        enrollment = ClassroomStudent(
            classroom_id=classroom_id, student_id=student.id, is_active=True
        )
        db.add(enrollment)
        created_students.append(student)

    db.commit()

    return {
        "created_count": len(created_students),
        "students": [
            {
                "id": s.id,
                "name": s.name,
                "email": s.email,
                "default_password": s.birthdate.strftime("%Y%m%d"),
            }
            for s in created_students
        ],
    }


class BatchImportStudent(BaseModel):
    name: str
    classroom_name: str
    birthdate: Any  # Can be string, int (Excel serial), etc.


class BatchImportRequest(BaseModel):
    students: List[BatchImportStudent]
    duplicate_action: Optional[str] = "skip"  # "skip", "update", or "add_suffix"


def parse_birthdate(birthdate_value: Any) -> Optional[date]:
    """Parse various date formats into a date object"""
    import re

    if birthdate_value is None:
        return None

    # Convert to string for processing
    date_str = str(birthdate_value).strip()

    # Handle Excel serial date numbers (days since 1900-01-01)
    if date_str.isdigit() and len(date_str) == 5:
        try:
            excel_serial = int(date_str)
            # Excel uses 1900-01-01 as day 1, but has a bug counting 1900 as leap year
            # So we use 1899-12-30 as base
            base_date = datetime(1899, 12, 30)
            result_date = base_date + timedelta(days=excel_serial)
            return result_date.date()
        except Exception:
            pass

    # Handle YYYYMMDD format
    if re.match(r"^\d{8}$", date_str):
        try:
            return datetime.strptime(date_str, "%Y%m%d").date()
        except Exception:
            pass

    # Handle YYYY-MM-DD format
    if re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        try:
            return datetime.strptime(date_str, "%Y-%m-%d").date()
        except Exception:
            pass

    # Handle YYYY/MM/DD format
    if re.match(r"^\d{4}/\d{2}/\d{2}$", date_str):
        try:
            return datetime.strptime(date_str, "%Y/%m/%d").date()
        except Exception:
            pass

    # Handle MM/DD/YYYY format
    if re.match(r"^\d{2}/\d{2}/\d{4}$", date_str):
        try:
            return datetime.strptime(date_str, "%m/%d/%Y").date()
        except Exception:
            pass

    # Handle Chinese format YYYY年MM月DD日
    chinese_match = re.match(r"^(\d{4})年(\d{1,2})月(\d{1,2})日$", date_str)
    if chinese_match:
        try:
            year, month, day = chinese_match.groups()
            return date(int(year), int(month), int(day))
        except Exception:
            pass

    return None


@router.post("/students/batch-import")
async def batch_import_students(
    import_data: BatchImportRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """批次匯入學生（支持班級名稱而非ID）"""
    if not import_data.students:
        raise HTTPException(status_code=400, detail="沒有提供學生資料")

    # Get all teacher's classrooms
    teacher_classrooms = (
        db.query(Classroom)
        .filter(
            Classroom.teacher_id == current_teacher.id, Classroom.is_active.is_(True)
        )
        .all()
    )
    classroom_map = {c.name: c for c in teacher_classrooms}

    # 🔥 Preload all existing enrollments to avoid N+1 queries
    classroom_ids = [c.id for c in teacher_classrooms]
    existing_enrollments = (
        db.query(ClassroomStudent)
        .join(Student)
        .filter(
            ClassroomStudent.classroom_id.in_(classroom_ids),
            ClassroomStudent.is_active.is_(True),
        )
        .options(selectinload(ClassroomStudent.student))
        .all()
    )
    # Build map: (student_name, classroom_id) -> enrollment
    enrollment_map = {
        (cs.student.name, cs.classroom_id): cs
        for cs in existing_enrollments
        if cs.student
    }

    success_count = 0
    error_count = 0
    errors = []
    created_students = []

    for idx, student_data in enumerate(import_data.students):
        try:
            # Validate required fields
            if not student_data.name or not student_data.name.strip():
                errors.append(
                    {"row": idx + 1, "name": student_data.name, "error": "缺少必要欄位：學生姓名"}
                )
                error_count += 1
                continue

            if (
                not student_data.classroom_name
                or not student_data.classroom_name.strip()
            ):
                errors.append(
                    {"row": idx + 1, "name": student_data.name, "error": "缺少必要欄位：班級"}
                )
                error_count += 1
                continue

            if not student_data.birthdate:
                errors.append(
                    {"row": idx + 1, "name": student_data.name, "error": "缺少必要欄位：生日"}
                )
                error_count += 1
                continue

            # Clean data
            student_name = student_data.name.strip()
            classroom_name = student_data.classroom_name.strip()

            # Parse birthdate
            birthdate = parse_birthdate(student_data.birthdate)
            if not birthdate:
                errors.append(
                    {
                        "row": idx + 1,
                        "name": student_name,
                        "error": f"無效的日期格式：{student_data.birthdate}",
                    }
                )
                error_count += 1
                continue

            # Check if birthdate is in the future
            if birthdate > datetime.now().date():
                errors.append(
                    {"row": idx + 1, "name": student_name, "error": "生日不能是未來日期"}
                )
                error_count += 1
                continue

            # Check if classroom exists
            classroom = classroom_map.get(classroom_name)
            if not classroom:
                errors.append(
                    {
                        "row": idx + 1,
                        "name": student_name,
                        "error": f"班級「{classroom_name}」不存在",
                    }
                )
                error_count += 1
                continue

            # 🔥 Check enrollment from preloaded map (no query)
            existing_enrollment = enrollment_map.get((student_name, classroom.id))

            if existing_enrollment:
                duplicate_action = import_data.duplicate_action or "skip"

                if duplicate_action == "skip":
                    # Skip duplicate student
                    errors.append(
                        {
                            "row": idx + 1,
                            "name": student_name,
                            "error": f"學生「{student_name}」已存在於班級「{classroom_name}」（已跳過）",
                        }
                    )
                    error_count += 1
                    continue

                elif duplicate_action == "update":
                    # 🔥 Use student from existing_enrollment (already loaded)
                    existing_student = existing_enrollment.student

                    if existing_student:
                        existing_student.birthdate = birthdate
                        # Update password if it hasn't been changed
                        if not existing_student.password_changed:
                            existing_student.password_hash = get_password_hash(
                                birthdate.strftime("%Y%m%d")
                            )
                        db.flush()

                        created_students.append(
                            {
                                "id": existing_student.id,
                                "name": existing_student.name,
                                "email": existing_student.email,
                                "classroom_name": classroom_name,
                                "default_password": birthdate.strftime("%Y%m%d")
                                if not existing_student.password_changed
                                else None,
                                "action": "updated",
                            }
                        )
                        success_count += 1
                        continue

                elif duplicate_action == "add_suffix":
                    # 🔥 Find next available suffix using preloaded enrollment_map (avoid N+1)
                    suffix_num = 2
                    new_name = f"{student_name}-{suffix_num}"

                    # Find next available suffix (check in memory)
                    while (new_name, classroom.id) in enrollment_map:
                        suffix_num += 1
                        new_name = f"{student_name}-{suffix_num}"

                    student_name = new_name  # Use the new name with suffix

            # Don't generate fake email - let students bind their own email later
            # email = None allows students to decide whether to bind email themselves

            # Create student
            default_password = birthdate.strftime("%Y%m%d")
            student = Student(
                name=student_name,
                email=None,  # Let students bind email themselves
                birthdate=birthdate,
                password_hash=get_password_hash(default_password),
                password_changed=False,
                target_wpm=80,
                target_accuracy=0.8,
                is_active=True,
            )
            db.add(student)
            db.flush()  # Get the ID

            # Add to classroom
            enrollment = ClassroomStudent(
                classroom_id=classroom.id, student_id=student.id, is_active=True
            )
            db.add(enrollment)

            created_students.append(
                {
                    "id": student.id,
                    "name": student.name,
                    "email": student.email,
                    "classroom_name": classroom_name,
                    "default_password": default_password,
                }
            )

            success_count += 1

        except Exception as e:
            errors.append(
                {
                    "row": idx + 1,
                    "name": student_data.name
                    if hasattr(student_data, "name")
                    else "Unknown",
                    "error": str(e),
                }
            )
            error_count += 1

    # Commit all successful imports
    if success_count > 0:
        db.commit()

    return {
        "success_count": success_count,
        "error_count": error_count,
        "errors": errors,
        "created_students": created_students,
    }


# ------------ Program CRUD ------------
class ProgramCreate(BaseModel):
    name: str
    description: Optional[str] = None
    level: str = "A1"
    classroom_id: Optional[int] = None
    estimated_hours: Optional[int] = None
    is_template: Optional[bool] = False
    tags: Optional[List[str]] = []


class LessonCreate(BaseModel):
    name: str
    description: Optional[str] = None
    order_index: int = 0
    estimated_minutes: Optional[int] = None


@router.post("/programs")
async def create_program(
    program_data: ProgramCreate,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """創建新課程"""
    # For template programs, classroom_id is optional
    if not program_data.is_template:
        # Verify classroom belongs to teacher (only for non-template programs)
        if not program_data.classroom_id:
            raise HTTPException(
                status_code=400,
                detail="classroom_id is required for non-template programs",
            )

        classroom = (
            db.query(Classroom)
            .filter(
                Classroom.id == program_data.classroom_id,
                Classroom.teacher_id == current_teacher.id,
            )
            .first()
        )

        if not classroom:
            raise HTTPException(status_code=404, detail="Classroom not found")

    # Get the max order_index
    if program_data.is_template:
        # For template programs, get max order across all template programs
        max_order = (
            db.query(func.max(Program.order_index))
            .filter(
                Program.is_template.is_(True), Program.teacher_id == current_teacher.id
            )
            .scalar()
            or 0
        )
    else:
        # For classroom programs, get max order within the classroom
        max_order = (
            db.query(func.max(Program.order_index))
            .filter(Program.classroom_id == program_data.classroom_id)
            .scalar()
            or 0
        )

    program = Program(
        name=program_data.name,
        description=program_data.description,
        level=getattr(
            ProgramLevel, program_data.level.upper().replace("-", "_"), ProgramLevel.A1
        ),
        classroom_id=program_data.classroom_id,
        teacher_id=current_teacher.id,
        estimated_hours=program_data.estimated_hours,
        is_template=program_data.is_template or False,
        is_active=True,
        order_index=max_order + 1,
        tags=program_data.tags or [],
    )
    db.add(program)
    db.commit()
    db.refresh(program)

    return {
        "id": program.id,
        "name": program.name,
        "description": program.description,
        "level": program.level.value,
        "classroom_id": program.classroom_id,
        "estimated_hours": program.estimated_hours,
        "is_template": program.is_template,
        "order_index": program.order_index,
        "tags": program.tags or [],
        "lessons": [],  # New programs have no lessons yet
    }


@router.put("/programs/reorder")
async def reorder_programs(
    order_data: List[Dict[str, int]],  # [{"id": 1, "order_index": 1}, ...]
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """重新排序課程"""
    # 優化：批次查詢課程，避免 N+1 問題
    program_ids = [item["id"] for item in order_data]
    programs_list = (
        db.query(Program)
        .filter(Program.id.in_(program_ids), Program.teacher_id == current_teacher.id)
        .all()
    )
    programs_dict = {p.id: p for p in programs_list}

    for item in order_data:
        program = programs_dict.get(item["id"])
        if program:
            program.order_index = item["order_index"]

    db.commit()
    return {"message": "Programs reordered successfully"}


@router.put("/programs/{program_id}/lessons/reorder")
async def reorder_lessons(
    program_id: int,
    order_data: List[Dict[str, int]],  # [{"id": 1, "order_index": 1}, ...]
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """重新排序單元"""
    # 驗證 program 屬於當前教師
    program = (
        db.query(Program)
        .filter(Program.id == program_id, Program.teacher_id == current_teacher.id)
        .first()
    )

    if not program:
        raise HTTPException(status_code=404, detail="Program not found")

    # 優化：批次查詢課程單元，避免 N+1 問題
    lesson_ids = [item["id"] for item in order_data]
    lessons_list = (
        db.query(Lesson)
        .filter(Lesson.id.in_(lesson_ids), Lesson.program_id == program_id)
        .all()
    )
    lessons_dict = {lesson.id: lesson for lesson in lessons_list}

    for item in order_data:
        lesson = lessons_dict.get(item["id"])
        if lesson:
            lesson.order_index = item["order_index"]

    db.commit()
    return {"message": "Lessons reordered successfully"}


@router.put("/lessons/{lesson_id}/contents/reorder")
async def reorder_contents(
    lesson_id: int,
    order_data: List[Dict[str, int]],  # [{"id": 1, "order_index": 1}, ...]
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """重新排序內容"""
    # 驗證 lesson 屬於當前教師的 program
    lesson = (
        db.query(Lesson)
        .join(Program)
        .filter(Lesson.id == lesson_id, Program.teacher_id == current_teacher.id)
        .first()
    )

    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")

    # 優化：批次查詢內容，避免 N+1 問題
    content_ids = [item["id"] for item in order_data]
    contents_list = (
        db.query(Content)
        .filter(Content.id.in_(content_ids), Content.lesson_id == lesson_id)
        .all()
    )
    contents_dict = {content.id: content for content in contents_list}

    for item in order_data:
        content = contents_dict.get(item["id"])
        if content:
            content.order_index = item["order_index"]

    db.commit()
    return {"message": "Contents reordered successfully"}


@router.get("/programs/{program_id}")
async def get_program(
    program_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """取得單一課程資料"""
    program = (
        db.query(Program)
        .filter(
            Program.id == program_id,
            Program.teacher_id == current_teacher.id,
            Program.is_active.is_(True),
        )
        .options(
            selectinload(Program.lessons)
            .selectinload(Lesson.contents)
            .selectinload(Content.content_items)
        )
        .first()
    )

    if not program:
        raise HTTPException(status_code=404, detail="Program not found")

    return {
        "id": program.id,
        "name": program.name,
        "description": program.description,
        "level": program.level.value if program.level else "A1",
        "classroom_id": program.classroom_id,
        "estimated_hours": program.estimated_hours,
        "order_index": program.order_index if hasattr(program, "order_index") else 1,
        "lessons": [
            {
                "id": lesson.id,
                "name": lesson.name,
                "description": lesson.description,
                "order_index": lesson.order_index,
                "estimated_minutes": lesson.estimated_minutes,
                "contents": [
                    {
                        "id": content.id,
                        "type": (
                            content.type.value if content.type else "reading_assessment"
                        ),
                        "title": content.title,
                        "items": [item for item in content.content_items]
                        if hasattr(content, "content_items")
                        else [],  # Use content_items relationship
                        "items_count": len(content.content_items)
                        if hasattr(content, "content_items")
                        else 0,
                        "estimated_time": "10 分鐘",  # Can be calculated based on items
                    }
                    for content in sorted(
                        lesson.contents or [], key=lambda x: x.order_index
                    )
                    if content.is_active
                    and not content.is_assignment_copy  # 🔥 Filter by is_active and not assignment copy
                ],
            }
            for lesson in sorted(program.lessons or [], key=lambda x: x.order_index)
            if lesson.is_active  # Filter by is_active
        ],
    }


@router.put("/programs/{program_id}")
async def update_program(
    program_id: int,
    update_data: ProgramUpdate,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """更新課程資料"""
    program = (
        db.query(Program)
        .filter(
            Program.id == program_id,
            Program.teacher_id == current_teacher.id,
            Program.is_active.is_(True),
        )
        .first()
    )

    if not program:
        raise HTTPException(status_code=404, detail="Program not found")

    # 使用 model_dump 來獲取所有提交的欄位（包含 None 值的）
    update_dict = update_data.model_dump(exclude_unset=True)

    if "name" in update_dict:
        program.name = update_dict["name"]
    if "description" in update_dict:
        program.description = update_dict["description"]
    if "estimated_hours" in update_dict:
        program.estimated_hours = update_dict["estimated_hours"]
    if "level" in update_dict:
        # 將字串轉換為 ProgramLevel enum
        program.level = ProgramLevel(update_dict["level"])
    if "tags" in update_dict:
        program.tags = update_dict["tags"]

    db.commit()
    db.refresh(program)

    return {
        "id": program.id,
        "name": program.name,
        "description": program.description,
        "estimated_hours": program.estimated_hours,
        "level": program.level.value if program.level else "A1",
        "tags": program.tags or [],
    }


@router.delete("/programs/{program_id}")
async def delete_program(
    program_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """刪除課程 - 使用軟刪除保護資料完整性"""

    program = (
        db.query(Program)
        .filter(
            Program.id == program_id,
            Program.teacher_id == current_teacher.id,
            Program.is_active.is_(True),
        )
        .first()
    )

    if not program:
        raise HTTPException(status_code=404, detail="Program not found")

    # 檢查相關資料
    lesson_count = db.query(Lesson).filter(Lesson.program_id == program_id).count()

    # 先取得所有相關 lesson 的 ID
    lesson_ids = [
        lesson.id
        for lesson in db.query(Lesson.id).filter(Lesson.program_id == program_id).all()
    ]

    content_count = 0
    assignment_count = 0

    if lesson_ids:
        # 計算 content 數量
        content_count = (
            db.query(Content).filter(Content.lesson_id.in_(lesson_ids)).count()
        )

        # 取得所有相關 content 的 ID
        content_ids = [
            c.id
            for c in db.query(Content.id)
            .filter(Content.lesson_id.in_(lesson_ids))
            .all()
        ]

        if content_ids:
            # 計算 assignment 數量（透過 StudentContentProgress）
            assignment_count = (
                db.query(
                    func.count(
                        func.distinct(StudentContentProgress.student_assignment_id)
                    )
                )
                .filter(StudentContentProgress.content_id.in_(content_ids))
                .scalar()
            ) or 0

    # 軟刪除 - 保留資料以供日後參考
    program.is_active = False
    db.commit()

    return {
        "message": "Program successfully deactivated (soft delete)",
        "details": {
            "program_id": program_id,
            "program_name": program.name,
            "deactivated": True,
            "related_data": {
                "lessons": lesson_count,
                "contents": content_count,
                "assignments": assignment_count,
            },
            "note": "課程已停用但資料保留，可聯繫管理員恢復",
        },
    }


@router.post("/programs/{program_id}/lessons")
async def add_lesson(
    program_id: int,
    lesson_data: LessonCreate,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """新增課程單元"""
    program = (
        db.query(Program)
        .filter(
            Program.id == program_id,
            Program.teacher_id == current_teacher.id,
            Program.is_active.is_(True),
        )
        .first()
    )

    if not program:
        raise HTTPException(status_code=404, detail="Program not found")

    lesson = Lesson(
        program_id=program_id,
        name=lesson_data.name,
        description=lesson_data.description,
        order_index=lesson_data.order_index,
        estimated_minutes=lesson_data.estimated_minutes,
    )
    db.add(lesson)
    db.commit()
    db.refresh(lesson)

    return {
        "id": lesson.id,
        "name": lesson.name,
        "description": lesson.description,
        "order_index": lesson.order_index,
        "estimated_minutes": lesson.estimated_minutes,
    }


@router.put("/lessons/{lesson_id}")
async def update_lesson(
    lesson_id: int,
    lesson_data: LessonCreate,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """更新課程單元（支援 teacher 和 organization programs）"""
    from utils.permissions import check_lesson_access

    # Unified permission check (supports teacher & org programs)
    program, lesson = check_lesson_access(
        db, lesson_id, current_teacher, require_owner=True
    )

    # 更新資料
    lesson.name = lesson_data.name
    lesson.description = lesson_data.description
    lesson.order_index = lesson_data.order_index
    lesson.estimated_minutes = lesson_data.estimated_minutes

    db.commit()
    db.refresh(lesson)

    return {
        "id": lesson.id,
        "name": lesson.name,
        "description": lesson.description,
        "order_index": lesson.order_index,
        "estimated_minutes": lesson.estimated_minutes,
    }


@router.delete("/lessons/{lesson_id}")
async def delete_lesson(
    lesson_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """刪除課程單元（支援 teacher 和 organization programs）- 使用軟刪除保護資料完整性"""
    from utils.permissions import check_lesson_access

    # Unified permission check (supports teacher & org programs)
    program, lesson = check_lesson_access(
        db, lesson_id, current_teacher, require_owner=True
    )

    # 檢查相關資料
    content_count = (
        db.query(Content)
        .filter(Content.lesson_id == lesson_id, Content.is_active.is_(True))
        .count()
    )

    # 先查詢這個 lesson 相關的所有 content IDs
    content_ids = [
        c.id for c in db.query(Content.id).filter(Content.lesson_id == lesson_id).all()
    ]

    # 使用 content IDs 來計算作業數量（透過 StudentContentProgress）
    assignment_count = 0
    if content_ids:
        assignment_count = (
            db.query(
                func.count(func.distinct(StudentContentProgress.student_assignment_id))
            )
            .filter(StudentContentProgress.content_id.in_(content_ids))
            .scalar()
        ) or 0

    # 軟刪除 lesson
    lesson.is_active = False

    # 同時軟刪除相關的 contents
    db.query(Content).filter(Content.lesson_id == lesson_id).update(
        {"is_active": False}
    )

    db.commit()

    return {
        "message": "Lesson successfully deactivated (soft delete)",
        "details": {
            "lesson_id": lesson_id,
            "lesson_name": lesson.name,
            "deactivated": True,
            "related_data": {
                "contents": content_count,
                "assignments": assignment_count,
            },
            "note": "單元已停用但資料保留，可聯繫管理員恢復",
        },
    }


# ------------ Content CRUD ------------


class ContentCreate(BaseModel):
    type: str = "example_sentences"  # 預設改為新的類型
    title: str
    items: List[Dict[str, Any]]  # [{"text": "...", "translation": "..."}, ...]
    target_wpm: Optional[int] = 60
    target_accuracy: Optional[float] = 0.8
    time_limit_seconds: Optional[int] = None
    order_index: Optional[int] = None  # None = 自動計算為最後一個位置
    level: Optional[str] = "A1"
    tags: Optional[List[str]] = []
    is_public: Optional[bool] = False


def normalize_content_type(content_type: str) -> str:
    """將舊的 ContentType 值轉換為新值（向後相容）"""
    mapping = {
        "READING_ASSESSMENT": "EXAMPLE_SENTENCES",
        "reading_assessment": "EXAMPLE_SENTENCES",
        "SENTENCE_MAKING": "VOCABULARY_SET",
        "sentence_making": "VOCABULARY_SET",
    }
    return mapping.get(content_type, content_type.upper())


def count_words(text: str) -> int:
    """計算英文單字數量（以空格分隔）"""
    if not text:
        return 0
    # 移除多餘空格後以空格分割
    return len(text.strip().split())


def calculate_max_errors(word_count: int) -> int:
    """根據單字數量計算允許的錯誤次數"""
    if word_count <= 10:
        return 3
    return 5


def validate_sentence_length(text: str) -> tuple:
    """驗證句子長度是否符合規則（2-25 個單字）"""
    word_count = count_words(text)
    if word_count < 2:
        return False, f"句子至少需要 2 個單字，目前 {word_count} 個", word_count
    if word_count > 25:
        return False, f"句子最多 25 個單字，目前 {word_count} 個", word_count
    return True, f"符合規則（{word_count} 個單字）", word_count


class ContentUpdate(BaseModel):
    title: Optional[str] = None
    items: Optional[List[Dict[str, Any]]] = None
    target_wpm: Optional[int] = None
    target_accuracy: Optional[float] = None
    time_limit_seconds: Optional[int] = None
    order_index: Optional[int] = None
    level: Optional[str] = None
    tags: Optional[List[str]] = None
    is_public: Optional[bool] = None


@router.get("/lessons/{lesson_id}/contents")
async def get_lesson_contents(
    lesson_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """取得單元的內容列表"""
    # Verify the lesson belongs to the teacher
    lesson = (
        db.query(Lesson)
        .join(Program)
        .filter(Lesson.id == lesson_id, Program.teacher_id == current_teacher.id)
        .first()
    )

    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")

    contents = (
        db.query(Content)
        .filter(
            Content.lesson_id == lesson_id,
            Content.is_active.is_(True),
            Content.is_assignment_copy.is_(False),  # 🔥 只返回模板內容
        )
        .options(selectinload(Content.content_items))  # 🔥 Eager load items
        .order_by(Content.order_index)
        .all()
    )

    result = []
    for content in contents:
        # 🔥 Use preloaded content_items (no query)
        content_items = sorted(content.content_items, key=lambda x: x.order_index)

        items_data = [
            {
                "id": item.id,
                "text": item.text,
                "translation": item.translation,
                "audio_url": item.audio_url,
                "example_sentence": item.example_sentence,
                "example_sentence_translation": item.example_sentence_translation,
            }
            for item in content_items
        ]

        result.append(
            {
                "id": content.id,
                "type": content.type.value if content.type else "reading_assessment",
                "title": content.title,
                "items": items_data,
                "target_wpm": content.target_wpm,
                "target_accuracy": content.target_accuracy,
                "order_index": content.order_index,
            }
        )

    return result


@router.post("/lessons/{lesson_id}/contents")
async def create_content(
    lesson_id: int,
    content_data: ContentCreate,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """建立新內容"""
    # Verify the lesson belongs to the teacher or is a template program
    lesson = (
        db.query(Lesson)
        .join(Program)
        .filter(
            Lesson.id == lesson_id,
            Lesson.is_active.is_(True),
            Program.is_active.is_(True),
        )
        .filter(
            # Either: lesson belongs to teacher's program
            # Or: lesson belongs to a template program (公版課程)
            (Program.teacher_id == current_teacher.id)
            | (Program.is_template.is_(True))
        )
        .first()
    )

    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")

    # 如果沒有提供 order_index，自動設為最後一個位置
    if content_data.order_index is None:
        max_order = (
            db.query(func.max(Content.order_index))
            .filter(Content.lesson_id == lesson_id, Content.is_active.is_(True))
            .scalar()
        )
        order_index = (max_order or 0) + 1
    else:
        order_index = content_data.order_index

    # 建立 Content（不再使用 items 欄位）
    # 根據 content_data.type 設定正確的類型（支援舊值相容）
    normalized_type = normalize_content_type(content_data.type)
    try:
        content_type = ContentType(normalized_type)
    except ValueError:
        # 如果類型不存在，預設使用 EXAMPLE_SENTENCES
        content_type = ContentType.EXAMPLE_SENTENCES

    # 驗證句子長度（僅對 EXAMPLE_SENTENCES 類型）
    if content_type == ContentType.EXAMPLE_SENTENCES:
        invalid_items = []
        validation_details = []
        for idx, item_data in enumerate(content_data.items):
            item_text = item_data.get("text", "")
            if item_text:  # 只驗證非空的文字
                is_valid, message, word_count = validate_sentence_length(item_text)
                if not is_valid:
                    invalid_items.append(idx + 1)
                    validation_details.append(f"第 {idx + 1} 題：{message}")

        if invalid_items:
            items_str = ", ".join(str(i) for i in invalid_items)
            raise HTTPException(
                status_code=400,
                detail={
                    "message": f"第 {items_str} 題句子長度不符合規定（需為 2-25 個單字）",
                    "errors": validation_details,
                },
            )

    content = Content(
        lesson_id=lesson_id,
        type=content_type,
        title=content_data.title,
        # items=content_data.items,  # REMOVED - 使用 ContentItem 表
        target_wpm=content_data.target_wpm,
        target_accuracy=content_data.target_accuracy,
        time_limit_seconds=content_data.time_limit_seconds,
        order_index=order_index,
        level=content_data.level,
        tags=content_data.tags or [],
    )
    db.add(content)
    db.commit()
    db.refresh(content)

    # 建立 ContentItem 記錄
    items_created = []
    if content_data.items:
        for idx, item_data in enumerate(content_data.items):
            item_text = item_data.get("text", "")
            word_count = count_words(item_text)
            max_errors = calculate_max_errors(word_count)

            # 準備 item_metadata（只儲存附加資訊，不重複儲存翻譯文字）
            # - translation 欄位是翻譯的唯一來源
            # - metadata 只存語言資訊和詞性等附加欄位
            metadata = {}
            if "parts_of_speech" in item_data:
                metadata["parts_of_speech"] = item_data["parts_of_speech"]
            if "vocabulary_translation_lang" in item_data:
                metadata["vocabulary_translation_lang"] = item_data[
                    "vocabulary_translation_lang"
                ]
            if "example_sentence_translation_lang" in item_data:
                metadata["example_sentence_translation_lang"] = item_data[
                    "example_sentence_translation_lang"
                ]
            # 英文釋義（雙語支援：當主翻譯是中文時，額外儲存英文釋義）
            if "english_definition" in item_data and item_data["english_definition"]:
                metadata["english_definition"] = item_data["english_definition"]

            # 取得翻譯值（優先使用 definition，向後相容 translation）
            translation_value = item_data.get("definition") or item_data.get(
                "translation", ""
            )

            content_item = ContentItem(
                content_id=content.id,
                order_index=idx,
                text=item_text,
                translation=translation_value,
                audio_url=item_data.get("audio_url"),
                image_url=item_data.get("image_url"),
                example_sentence=item_data.get("example_sentence"),
                example_sentence_translation=item_data.get(
                    "example_sentence_translation"
                ),
                word_count=word_count,
                max_errors=max_errors,
                item_metadata=metadata,
            )
            db.add(content_item)
            items_created.append(
                {
                    "text": content_item.text,
                    "translation": content_item.translation,
                    "example_sentence": content_item.example_sentence,
                    "example_sentence_translation": content_item.example_sentence_translation,
                    "word_count": word_count,
                    "max_errors": max_errors,
                }
            )

    # 🔥 Phase 2: 單字集建立時預先生成干擾選項
    if content_type == ContentType.VOCABULARY_SET and content_data.items:
        # Flush to ensure content items have IDs
        db.flush()

        # Fetch all content items with translations
        items_for_distractors = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == content.id)
            .filter(ContentItem.translation.isnot(None))
            .filter(ContentItem.translation != "")
            .order_by(ContentItem.order_index)
            .all()
        )

        if items_for_distractors:
            # Prepare words data for batch generation
            words_data = [
                {"word": item.text, "translation": item.translation}
                for item in items_for_distractors
            ]

            try:
                # Generate distractors in batch using OpenAI (2個AI生成，1個從同作業其他單字取)
                all_distractors = await translation_service.batch_generate_distractors(
                    words_data, count=2
                )

                # Update each content item with its distractors
                for i, item in enumerate(items_for_distractors):
                    if i < len(all_distractors):
                        item.distractors = all_distractors[i]

                logger.info(
                    f"Generated distractors for {len(items_for_distractors)} vocabulary items "
                    f"in new content {content.id}"
                )
            except Exception as e:
                logger.error(
                    f"Failed to generate distractors for new content {content.id}: {e}"
                )
                # Continue without distractors - students.py will fallback to runtime generation

    db.commit()

    return {
        "id": content.id,
        "type": content.type.value,
        "title": content.title,
        "items": items_created,  # 返回建立的 items
        "items_count": len(items_created),  # 前端顯示用
        "target_wpm": content.target_wpm,
        "target_accuracy": content.target_accuracy,
        "order_index": content.order_index,
        "level": content.level if hasattr(content, "level") else "A1",
        "tags": content.tags if hasattr(content, "tags") else [],
    }


@router.get("/contents/{content_id}")
async def get_content_detail(
    content_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """獲取內容詳情"""
    from utils.permissions import check_content_access

    # check_content_access handles personal, org, template, and assignment copy access
    _program, _lesson, content = check_content_access(
        db, content_id, current_teacher, require_owner=False
    )

    # Eager load content_items to avoid N+1
    db.refresh(content, ["content_items"])

    # 檢查每個 ContentItem 是否有學生進度
    item_ids = (
        [item.id for item in content.content_items]
        if hasattr(content, "content_items")
        else []
    )
    items_with_progress = set()

    if item_ids:
        # 查詢哪些 item 有學生實際數據
        progresses = (
            db.query(StudentItemProgress)
            .filter(StudentItemProgress.content_item_id.in_(item_ids))
            .all()
        )

        for progress in progresses:
            # 使用與 update_content 相同的檢查邏輯
            has_data = (
                progress.recording_url
                or progress.answer_text
                or progress.transcription
                or progress.submitted_at
                or progress.accuracy_score is not None
                or progress.fluency_score is not None
                or progress.pronunciation_score is not None
                or progress.ai_feedback
                or progress.ai_assessed_at
                or progress.teacher_review_score is not None
                or progress.teacher_feedback
                or progress.teacher_passed is not None
                or progress.teacher_reviewed_at
                or progress.status != "NOT_STARTED"
            )
            if has_data:
                items_with_progress.add(progress.content_item_id)

    return {
        "id": content.id,
        "type": content.type.value if content.type else "reading_assessment",
        "title": content.title,
        "items": [
            {
                "id": item.id,
                "text": item.text,
                "translation": item.translation,  # 主要翻譯欄位（通常是中文）
                "definition": item.item_metadata.get("chinese_translation")
                or item.translation
                if item.item_metadata
                else item.translation,  # 中文翻譯
                "english_definition": item.item_metadata.get("english_definition", "")
                if item.item_metadata
                else "",  # 英文釋義
                "selectedLanguage": item.item_metadata.get(
                    "selected_language", "chinese"
                )
                if item.item_metadata
                else "chinese",  # 選擇的語言
                # 新的統一翻譯欄位
                "vocabulary_translation": item.item_metadata.get(
                    "vocabulary_translation", ""
                )
                if item.item_metadata
                else "",
                "vocabulary_translation_lang": item.item_metadata.get(
                    "vocabulary_translation_lang", "chinese"
                )
                if item.item_metadata
                else "chinese",
                "example_sentence_translation_lang": item.item_metadata.get(
                    "example_sentence_translation_lang", "chinese"
                )
                if item.item_metadata
                else "chinese",
                "audio_url": item.audio_url,
                "image_url": item.image_url,
                "example_sentence": item.example_sentence,
                "example_sentence_translation": item.example_sentence_translation,
                "created_at": item.created_at.isoformat() if item.created_at else None,
                "updated_at": item.updated_at.isoformat() if item.updated_at else None,
                "content_id": item.content_id,
                "order_index": item.order_index,
                "item_metadata": item.item_metadata or {},
                "parts_of_speech": item.item_metadata.get("parts_of_speech", [])
                if item.item_metadata
                else [],
                "has_student_progress": item.id in items_with_progress,  # 🔥 新增：是否有學生進度
            }
            for item in content.content_items
        ]
        if hasattr(content, "content_items")
        else [],
        "target_wpm": content.target_wpm,
        "target_accuracy": content.target_accuracy,
        "time_limit_seconds": content.time_limit_seconds,
        "order_index": content.order_index,
        "level": content.level if hasattr(content, "level") else "A1",
        "tags": content.tags if hasattr(content, "tags") else ["public"],
    }


@router.put("/contents/{content_id}")
async def update_content(
    content_id: int,
    update_data: ContentUpdate,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """更新內容（支援 teacher、organization programs 和 assignment copies）"""
    from utils.permissions import check_content_access

    # Unified permission check (supports teacher & org programs + assignment copies)
    program, lesson, content = check_content_access(
        db, content_id, current_teacher, require_owner=True, allow_assignment_copy=True
    )

    # 驗證句子長度（僅對 EXAMPLE_SENTENCES 類型）
    if update_data.items is not None and content.type == ContentType.EXAMPLE_SENTENCES:
        invalid_items = []
        validation_details = []
        for idx, item_data in enumerate(update_data.items):
            if isinstance(item_data, dict):
                item_text = item_data.get("text", "")
                if item_text:  # 只驗證非空的文字
                    is_valid, message, word_count = validate_sentence_length(item_text)
                    if not is_valid:
                        invalid_items.append(idx + 1)
                        validation_details.append(f"第 {idx + 1} 題：{message}")

        if invalid_items:
            items_str = ", ".join(str(i) for i in invalid_items)
            raise HTTPException(
                status_code=400,
                detail={
                    "message": f"第 {items_str} 題句子長度不符合規定（需為 2-25 個單字）",
                    "errors": validation_details,
                },
            )

    # 引入音檔管理器
    from services.audio_manager import get_audio_manager

    audio_manager = get_audio_manager()

    if update_data.title is not None:
        content.title = update_data.title
    if update_data.items is not None:
        # 處理 ContentItem 更新
        # 先取得現有的 ContentItem
        existing_items = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == content.id)
            .order_by(ContentItem.order_index)
            .all()
        )

        # 檢查是否是作業副本且有學生進度
        is_assignment_copy = content.is_assignment_copy
        has_student_progress = False
        if is_assignment_copy:
            # 檢查是否有學生進度記錄
            existing_item_ids = [item.id for item in existing_items]
            if existing_item_ids:
                has_student_progress = (
                    db.query(StudentItemProgress)
                    .filter(StudentItemProgress.content_item_id.in_(existing_item_ids))
                    .filter(
                        # 檢查是否有實際數據（不是只有 NOT_STARTED 狀態）
                        (
                            (StudentItemProgress.recording_url.isnot(None))
                            | (StudentItemProgress.answer_text.isnot(None))
                            | (StudentItemProgress.transcription.isnot(None))
                            | (StudentItemProgress.submitted_at.isnot(None))
                            | (StudentItemProgress.accuracy_score.isnot(None))
                            | (StudentItemProgress.fluency_score.isnot(None))
                            | (StudentItemProgress.pronunciation_score.isnot(None))
                            | (StudentItemProgress.ai_feedback.isnot(None))
                            | (StudentItemProgress.ai_assessed_at.isnot(None))
                            | (StudentItemProgress.teacher_review_score.isnot(None))
                            | (StudentItemProgress.teacher_feedback.isnot(None))
                            | (StudentItemProgress.teacher_passed.isnot(None))
                            | (StudentItemProgress.teacher_reviewed_at.isnot(None))
                            | (StudentItemProgress.status != "NOT_STARTED")
                        )
                    )
                    .first()
                    is not None
                )

        # 建立新音檔 URL 的集合
        new_audio_urls = set()
        for item in update_data.items:
            if isinstance(item, dict) and "audio_url" in item and item["audio_url"]:
                new_audio_urls.add(item["audio_url"])

        # 刪除不再使用的舊音檔
        for existing_item in existing_items:
            if hasattr(existing_item, "audio_url") and existing_item.audio_url:
                if existing_item.audio_url not in new_audio_urls:
                    audio_manager.delete_old_audio(existing_item.audio_url)

        # 🔥 智能更新邏輯：如果有學生進度，使用智能更新；否則使用刪除重建
        if has_student_progress:
            # ========== 智能更新邏輯 ==========
            # 1. 建立舊 ContentItem 的映射（用於匹配）
            matched_items = set()  # 已匹配的舊 item ID
            items_to_delete = []  # 需要刪除的 item

            # 2. 處理新的 items（匹配、更新、創建）
            for new_idx, item_data in enumerate(update_data.items):
                if not isinstance(item_data, dict):
                    continue

                # 準備 metadata（只儲存附加資訊，不重複儲存翻譯文字）
                # - translation 欄位是翻譯的唯一來源
                # - metadata 只存語言資訊、詞性、選項等附加欄位
                metadata = {}
                if "options" in item_data:
                    metadata["options"] = item_data["options"]
                if "correct_answer" in item_data:
                    metadata["correct_answer"] = item_data["correct_answer"]
                if "question_type" in item_data:
                    metadata["question_type"] = item_data["question_type"]
                if "parts_of_speech" in item_data:
                    metadata["parts_of_speech"] = item_data["parts_of_speech"]
                if "vocabulary_translation_lang" in item_data:
                    metadata["vocabulary_translation_lang"] = item_data[
                        "vocabulary_translation_lang"
                    ]
                if "example_sentence_translation_lang" in item_data:
                    metadata["example_sentence_translation_lang"] = item_data[
                        "example_sentence_translation_lang"
                    ]
                # 英文釋義（雙語支援：當主翻譯是中文時，額外儲存英文釋義）
                if (
                    "english_definition" in item_data
                    and item_data["english_definition"]
                ):
                    metadata["english_definition"] = item_data["english_definition"]

                translation_value = item_data.get("definition") or item_data.get(
                    "translation", ""
                )
                new_text = item_data.get("text", "")
                new_audio_url = item_data.get("audio_url")

                # 嘗試匹配現有的 ContentItem
                matched_item = None

                # 策略1：通過 text 和 audio_url 匹配
                for old_item in existing_items:
                    if old_item.id in matched_items:
                        continue  # 已經被匹配過了

                    # 匹配條件：text 相同 或 audio_url 相同
                    text_matches = old_item.text == new_text
                    audio_matches = (
                        old_item.audio_url
                        and new_audio_url
                        and old_item.audio_url == new_audio_url
                    )

                    if text_matches or audio_matches:
                        matched_item = old_item
                        matched_items.add(old_item.id)
                        break

                # 策略2：如果無法匹配，且數量相同，通過 order_index 匹配（假設只是修改內容）
                if not matched_item and len(existing_items) == len(update_data.items):
                    if new_idx < len(existing_items):
                        old_item = existing_items[new_idx]
                        if old_item.id not in matched_items:
                            matched_item = old_item
                            matched_items.add(old_item.id)

                if matched_item:
                    # 更新現有的 ContentItem（ID 不變！）
                    matched_item.order_index = new_idx
                    matched_item.text = new_text
                    matched_item.translation = translation_value
                    matched_item.audio_url = new_audio_url
                    matched_item.image_url = item_data.get("image_url")
                    matched_item.example_sentence = item_data.get("example_sentence")
                    matched_item.example_sentence_translation = item_data.get(
                        "example_sentence_translation"
                    )
                    matched_item.item_metadata = metadata
                else:
                    # 無法匹配，創建新的 ContentItem
                    new_item = ContentItem(
                        content_id=content.id,
                        order_index=new_idx,
                        text=new_text,
                        translation=translation_value,
                        audio_url=new_audio_url,
                        image_url=item_data.get("image_url"),
                        example_sentence=item_data.get("example_sentence"),
                        example_sentence_translation=item_data.get(
                            "example_sentence_translation"
                        ),
                        item_metadata=metadata,
                    )
                    db.add(new_item)

            # 3. 找出未匹配的舊 item（需要刪除）
            for old_item in existing_items:
                if old_item.id not in matched_items:
                    items_to_delete.append(old_item)

            # 4. 檢查是否可以安全刪除
            if items_to_delete:
                deleted_item_ids = [item.id for item in items_to_delete]
                # 批量查詢所有相關的 StudentItemProgress
                all_progresses = (
                    db.query(StudentItemProgress)
                    .filter(StudentItemProgress.content_item_id.in_(deleted_item_ids))
                    .all()
                )

                # 檢查每個要刪除的 item 是否有學生數據
                unsafe_to_delete = []
                for deleted_item in items_to_delete:
                    # 檢查是否有實際數據
                    has_data = any(
                        (
                            p.recording_url
                            or p.answer_text
                            or p.transcription
                            or p.submitted_at
                            or p.accuracy_score is not None
                            or p.fluency_score is not None
                            or p.pronunciation_score is not None
                            or p.ai_feedback
                            or p.ai_assessed_at
                            or p.teacher_review_score is not None
                            or p.teacher_feedback
                            or p.teacher_passed is not None
                            or p.teacher_reviewed_at
                            or p.status != "NOT_STARTED"
                        )
                        for p in all_progresses
                        if p.content_item_id == deleted_item.id
                    )

                    if has_data:
                        unsafe_to_delete.append(deleted_item)

                if unsafe_to_delete:
                    # 有學生記錄的 item 不能刪除
                    unsafe_texts = [
                        item.text[:30] + "..." if len(item.text) > 30 else item.text
                        for item in unsafe_to_delete
                    ]
                    raise HTTPException(
                        status_code=400,
                        detail=f"無法刪除以下題目，因為學生已有進度：{', '.join(unsafe_texts)}",
                    )

                # 安全刪除未使用的 item（CASCADE 會自動處理 StudentItemProgress）
                for item in items_to_delete:
                    db.delete(item)

        else:
            # ========== 原來的邏輯：刪除重建（用於模板或沒有學生進度的情況）==========
            db.execute(
                text("DELETE FROM content_items WHERE content_id = :content_id"),
                {"content_id": content.id},
            )
            db.flush()

            # 創建新的 ContentItem
            for idx, item_data in enumerate(update_data.items):
                if isinstance(item_data, dict):
                    # 準備 metadata（只儲存附加資訊，不重複儲存翻譯文字）
                    metadata = {}
                    if "options" in item_data:
                        metadata["options"] = item_data["options"]
                    if "correct_answer" in item_data:
                        metadata["correct_answer"] = item_data["correct_answer"]
                    if "question_type" in item_data:
                        metadata["question_type"] = item_data["question_type"]
                    if "parts_of_speech" in item_data:
                        metadata["parts_of_speech"] = item_data["parts_of_speech"]
                    if "vocabulary_translation_lang" in item_data:
                        metadata["vocabulary_translation_lang"] = item_data[
                            "vocabulary_translation_lang"
                        ]
                    if "example_sentence_translation_lang" in item_data:
                        metadata["example_sentence_translation_lang"] = item_data[
                            "example_sentence_translation_lang"
                        ]
                    # 英文釋義（雙語支援）
                    if (
                        "english_definition" in item_data
                        and item_data["english_definition"]
                    ):
                        metadata["english_definition"] = item_data["english_definition"]

                    translation_value = item_data.get("definition") or item_data.get(
                        "translation", ""
                    )

                    content_item = ContentItem(
                        content_id=content.id,
                        order_index=idx,
                        text=item_data.get("text", ""),
                        translation=translation_value,
                        audio_url=item_data.get("audio_url"),
                        image_url=item_data.get("image_url"),
                        example_sentence=item_data.get("example_sentence"),
                        example_sentence_translation=item_data.get(
                            "example_sentence_translation"
                        ),
                        item_metadata=metadata,
                    )
                    db.add(content_item)
    if update_data.target_wpm is not None:
        content.target_wpm = update_data.target_wpm
    if update_data.target_accuracy is not None:
        content.target_accuracy = update_data.target_accuracy
    if update_data.time_limit_seconds is not None:
        content.time_limit_seconds = update_data.time_limit_seconds
    if update_data.order_index is not None:
        content.order_index = update_data.order_index
    if update_data.level is not None:
        content.level = update_data.level
    if update_data.tags is not None:
        content.tags = update_data.tags

    # 🔥 Phase 2: 單字集儲存時預先生成干擾選項
    # 這樣學生作答時就不需要等待 OpenAI API (2-8 秒)
    if content.type == ContentType.VOCABULARY_SET and update_data.items is not None:
        # Flush to ensure content items have IDs
        db.flush()

        # Fetch all content items with translations
        items_for_distractors = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == content.id)
            .filter(ContentItem.translation.isnot(None))
            .filter(ContentItem.translation != "")
            .order_by(ContentItem.order_index)
            .all()
        )

        if items_for_distractors:
            # Prepare words data for batch generation
            words_data = [
                {"word": item.text, "translation": item.translation}
                for item in items_for_distractors
            ]

            try:
                # Generate distractors in batch using OpenAI (2個AI生成，1個從同作業其他單字取)
                all_distractors = await translation_service.batch_generate_distractors(
                    words_data, count=2
                )

                # Update each content item with its distractors
                for i, item in enumerate(items_for_distractors):
                    if i < len(all_distractors):
                        item.distractors = all_distractors[i]

                logger.info(
                    f"Generated distractors for {len(items_for_distractors)} vocabulary items "
                    f"in content {content.id}"
                )
            except Exception as e:
                logger.error(
                    f"Failed to generate distractors for content {content.id}: {e}"
                )
                # Continue without distractors - students.py will fallback to runtime generation

    db.commit()
    db.refresh(content)

    return {
        "id": content.id,
        "type": content.type.value,
        "title": content.title,
        "items": [
            {
                "id": item.id,
                "text": item.text,
                "translation": item.translation,  # 主要翻譯欄位（通常是中文）
                "definition": item.item_metadata.get("chinese_translation")
                or item.translation
                if item.item_metadata
                else item.translation,  # 中文翻譯
                "english_definition": item.item_metadata.get("english_definition", "")
                if item.item_metadata
                else "",  # 英文釋義
                "selectedLanguage": item.item_metadata.get(
                    "selected_language", "chinese"
                )
                if item.item_metadata
                else "chinese",  # 選擇的語言
                # 新的統一翻譯欄位
                "vocabulary_translation": item.item_metadata.get(
                    "vocabulary_translation", ""
                )
                if item.item_metadata
                else "",
                "vocabulary_translation_lang": item.item_metadata.get(
                    "vocabulary_translation_lang", "chinese"
                )
                if item.item_metadata
                else "chinese",
                "example_sentence_translation_lang": item.item_metadata.get(
                    "example_sentence_translation_lang", "chinese"
                )
                if item.item_metadata
                else "chinese",
                "audio_url": item.audio_url,
                "image_url": item.image_url,
                "example_sentence": item.example_sentence,
                "example_sentence_translation": item.example_sentence_translation,
                "options": item.item_metadata.get("options", [])
                if item.item_metadata
                else [],
                "correct_answer": item.item_metadata.get("correct_answer")
                if item.item_metadata
                else None,
                "question_type": item.item_metadata.get("question_type", "text")
                if item.item_metadata
                else "text",
                "parts_of_speech": item.item_metadata.get("parts_of_speech", [])
                if item.item_metadata
                else [],
            }
            for item in content.content_items
        ]
        if hasattr(content, "content_items")
        else [],
        "target_wpm": content.target_wpm,
        "target_accuracy": content.target_accuracy,
        "order_index": content.order_index,
        "level": content.level if hasattr(content, "level") else "A1",
        "tags": content.tags if hasattr(content, "tags") else [],
    }


@router.delete("/contents/{content_id}")
async def delete_content(
    content_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """刪除內容（支援 teacher 和 organization programs）- 軟刪除"""
    from utils.permissions import check_content_access

    # Unified permission check (supports teacher & org programs, not assignment copies)
    program, lesson, content = check_content_access(
        db, content_id, current_teacher, require_owner=True, allow_assignment_copy=False
    )

    # 檢查是否有相關的作業

    assignment_count = (
        db.query(AssignmentContent)
        .filter(AssignmentContent.content_id == content_id)
        .count()
    )

    # 軟刪除
    content.is_active = False
    db.commit()

    return {
        "message": "Content deactivated successfully",
        "details": {
            "content_title": content.title,
            "deactivated": True,
            "related_data": {"assignments": assignment_count},
            "reason": "soft_delete",
            "note": "內容已停用但資料保留，相關作業仍可查看",
        },
    }


# ------------ Translation API ------------


class TranslateRequest(BaseModel):
    text: str
    target_lang: str = "zh-TW"


class BatchTranslateRequest(BaseModel):
    texts: List[str]
    target_lang: str = "zh-TW"


@router.post("/translate")
async def translate_text(
    request: TranslateRequest, current_teacher: Teacher = Depends(get_current_teacher)
):
    """翻譯單一文本"""
    try:
        translation = await translation_service.translate_text(
            request.text, request.target_lang
        )
        return {"original": request.text, "translation": translation}
    except Exception as e:
        logger.error("Translation error: %s", e)
        raise HTTPException(status_code=500, detail="Translation service error")


@router.post("/translate-with-pos")
async def translate_with_pos(
    request: TranslateRequest, current_teacher: Teacher = Depends(get_current_teacher)
):
    """翻譯單字並辨識詞性"""
    try:
        result = await translation_service.translate_with_pos(
            request.text, request.target_lang
        )
        return {
            "original": request.text,
            "translation": result["translation"],
            "parts_of_speech": result["parts_of_speech"],
        }
    except Exception as e:
        logger.error("Translate with POS error: %s", e)
        raise HTTPException(status_code=500, detail="Translation service error")


@router.post("/translate/batch")
async def batch_translate(
    request: BatchTranslateRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """批次翻譯多個文本"""
    try:
        translations = await translation_service.batch_translate(
            request.texts, request.target_lang
        )
        return {"originals": request.texts, "translations": translations}
    except Exception as e:
        logger.error("Batch translation error: %s", e)
        raise HTTPException(status_code=500, detail="Translation service error")


@router.post("/translate-with-pos/batch")
async def batch_translate_with_pos(
    request: BatchTranslateRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """批次翻譯多個單字並辨識詞性"""
    try:
        results = await translation_service.batch_translate_with_pos(
            request.texts, request.target_lang
        )
        return {"originals": request.texts, "results": results}
    except Exception as e:
        logger.error("Batch translate with POS error: %s", e)
        raise HTTPException(status_code=500, detail="Translation service error")


# ============ AI Generate Sentences ============
class GenerateSentencesRequest(BaseModel):
    words: List[str]
    level: Optional[str] = "A1"
    prompt: Optional[str] = None
    translate_to: Optional[str] = None  # zh-TW, ja, ko
    parts_of_speech: Optional[List[List[str]]] = None


@router.post("/generate-sentences")
async def generate_sentences(
    request: GenerateSentencesRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """AI 生成例句"""
    try:
        sentences = await translation_service.generate_sentences(
            words=request.words,
            level=request.level,
            prompt=request.prompt,
            translate_to=request.translate_to,
            parts_of_speech=request.parts_of_speech,
        )
        return {"sentences": sentences}
    except Exception as e:
        logger.error("Generate sentences error: %s", e)
        raise HTTPException(status_code=500, detail="Generate sentences failed")


# ============ TTS Endpoints ============
class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = "en-US-JennyNeural"
    rate: Optional[str] = "+0%"
    volume: Optional[str] = "+0%"


class BatchTTSRequest(BaseModel):
    texts: List[str]
    voice: Optional[str] = "en-US-JennyNeural"
    rate: Optional[str] = "+0%"
    volume: Optional[str] = "+0%"


@router.post("/tts")
async def generate_tts(
    request: TTSRequest, current_teacher: Teacher = Depends(get_current_teacher)
):
    """生成單一 TTS 音檔"""
    try:
        from services.tts import get_tts_service

        tts_service = get_tts_service()

        # 直接使用 await，因為 FastAPI 已經在異步環境中
        audio_url = await tts_service.generate_tts(
            text=request.text,
            voice=request.voice,
            rate=request.rate,
            volume=request.volume,
        )

        return {"audio_url": audio_url}
    except Exception as e:
        logger.error("TTS error: %s", e)
        raise HTTPException(status_code=500, detail="TTS generation failed")


@router.post("/tts/batch")
async def batch_generate_tts(
    request: BatchTTSRequest, current_teacher: Teacher = Depends(get_current_teacher)
):
    """批次生成 TTS 音檔"""
    try:
        from services.tts import get_tts_service
        import traceback

        tts_service = get_tts_service()

        # 直接使用 await，因為 FastAPI 已經在異步環境中
        audio_urls = await tts_service.batch_generate_tts(
            texts=request.texts,
            voice=request.voice,
            rate=request.rate,
            volume=request.volume,
        )

        return {"audio_urls": audio_urls}
    except Exception as e:
        import traceback

        error_trace = traceback.format_exc()
        logger.error("Batch TTS error: %s", e)
        logger.error("Traceback: %s", error_trace)
        # 返回更詳細的錯誤訊息（僅在開發環境）
        import os

        error_detail = (
            str(e)
            if os.getenv("ENVIRONMENT") in ["development", "staging"]
            else "Batch TTS generation failed"
        )
        raise HTTPException(status_code=500, detail=error_detail)


@router.get("/tts/voices")
async def get_tts_voices(
    language: str = "en", current_teacher: Teacher = Depends(get_current_teacher)
):
    """取得可用的 TTS 語音列表"""
    try:
        from services.tts import get_tts_service

        tts_service = get_tts_service()

        # 直接使用 await，因為 FastAPI 已經在異步環境中
        voices = await tts_service.get_available_voices(language)

        return {"voices": voices}
    except Exception as e:
        logger.error("Get voices error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to get voices")


# ============ Audio Upload Endpoints ============
@router.post("/upload/audio")
async def upload_audio(
    file: UploadFile = File(...),
    duration: int = Form(30),
    content_id: Optional[int] = Form(None),
    item_index: Optional[int] = Form(None),
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """上傳錄音檔案

    Args:
        file: 音檔檔案
        duration: 錄音長度（秒）
        content_id: 內容 ID（用於識別要替換的音檔）
        item_index: 項目索引（用於識別是哪個項目的音檔）
    """
    try:
        from services.audio_upload import get_audio_upload_service
        from services.audio_manager import get_audio_manager

        audio_service = get_audio_upload_service()
        audio_manager = get_audio_manager()

        # 如果提供了 content_id 和 item_index，先刪除舊音檔
        if content_id and item_index is not None:
            content = (
                db.query(Content)
                .filter(
                    Content.id == content_id,
                    Content.lesson.has(
                        Lesson.program.has(Program.teacher_id == current_teacher.id)
                    ),
                )
                .first()
            )

            if content:
                # 查找對應的 ContentItem

                content_items = (
                    db.query(ContentItem)
                    .filter(ContentItem.content_id == content_id)
                    .order_by(ContentItem.order_index)
                    .all()
                )

                if content_items and item_index < len(content_items):
                    old_audio_url = content_items[item_index].audio_url
                    if old_audio_url:
                        # 刪除舊音檔
                        audio_manager.delete_old_audio(old_audio_url)

        # 上傳新音檔（包含 content_id 和 item_index 在檔名中）
        audio_url = await audio_service.upload_audio(
            file, duration, content_id=content_id, item_index=item_index
        )

        return {"audio_url": audio_url}
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error("Audio upload error: %s", e)
        raise HTTPException(status_code=500, detail="Audio upload failed")


# ============ Image Upload Endpoints ============
@router.post("/upload/image")
async def upload_image(
    file: UploadFile = File(...),
    content_id: Optional[int] = Form(None),
    item_index: Optional[int] = Form(None),
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Upload image file for vocabulary set items

    Args:
        file: Image file (jpg, png, gif, webp)
        content_id: Content ID (for tracking which vocabulary set)
        item_index: Item index (for tracking which word)
    """
    try:
        from services.image_upload import get_image_upload_service

        image_service = get_image_upload_service()

        # If content_id is provided, verify teacher owns this content
        if content_id:
            content = (
                db.query(Content)
                .filter(
                    Content.id == content_id,
                    Content.lesson.has(
                        Lesson.program.has(Program.teacher_id == current_teacher.id)
                    ),
                )
                .first()
            )

            if not content:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Content not found or access denied",
                )

            # If updating existing item, delete old image
            if item_index is not None:
                content_items = (
                    db.query(ContentItem)
                    .filter(ContentItem.content_id == content_id)
                    .order_by(ContentItem.order_index)
                    .all()
                )

                if content_items and item_index < len(content_items):
                    old_image_url = content_items[item_index].image_url
                    if old_image_url:
                        image_service.delete_image(old_image_url)

        # Upload new image
        image_url = await image_service.upload_image(
            file, content_id=content_id, item_index=item_index
        )

        return {"image_url": image_url}
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error("Image upload error: %s", e)
        raise HTTPException(status_code=500, detail="Image upload failed")


# ============ Teacher Assignment Preview API ============
@router.get("/assignments/{assignment_id}/preview")
async def get_assignment_preview(
    assignment_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    取得作業的預覽內容（供老師示範用）

    返回與學生 API 相同格式的資料，讓老師可以預覽完整的作業內容
    """
    # 查詢作業（確認老師有權限 — 支援 classroom_id 為 null 的即刻練習）
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
        )
        .first()
    )

    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assignment not found or access denied",
        )

    # 獲取作業的所有 content
    assignment_contents = (
        db.query(AssignmentContent)
        .filter(AssignmentContent.assignment_id == assignment_id)
        .order_by(AssignmentContent.order_index)
        .all()
    )

    # 🔥 Batch-load all contents with items (avoid N+1)
    content_ids = [ac.content_id for ac in assignment_contents]
    contents = (
        db.query(Content)
        .filter(Content.id.in_(content_ids))
        .options(selectinload(Content.content_items))  # Eager load items
        .all()
    )
    content_dict = {content.id: content for content in contents}

    activities = []

    for idx, ac in enumerate(assignment_contents):
        content = content_dict.get(ac.content_id)

        if content:
            # 構建活動資料（與學生 API 格式相同）
            activity_data = {
                "id": idx + 1,  # 臨時 ID（預覽模式不需要實際進度 ID）
                "content_id": content.id,
                "order": idx + 1,
                "type": content.type.value if content.type else "reading_assessment",
                "title": content.title,
                "duration": (
                    assignment.time_limit_per_question
                    if assignment.time_limit_per_question is not None
                    else 30
                ),
                "points": 100 // len(assignment_contents)
                if len(assignment_contents) > 0
                else 100,
                "status": "NOT_STARTED",  # 預覽模式始終是未開始
                "score": None,
                "completed_at": None,
            }

            # 🔥 Use preloaded content_items (no query)
            content_items = sorted(content.content_items, key=lambda x: x.order_index)

            # 構建 items 資料（使用 get_sentence_fields 確保朗讀模式下回傳例句欄位）
            _practice_mode = assignment.practice_mode or ""
            items_data = []
            for item in content_items:
                fields = get_sentence_fields(item, content.type, _practice_mode)
                if fields is None:
                    continue  # 單字集朗讀模式下沒有例句的 item 跳過
                q_text, q_translation, q_audio = fields

                item_data = {
                    "id": item.id,
                    "text": q_text,
                    "translation": q_translation,
                    "audio_url": q_audio,
                    "image_url": item.image_url,
                    "part_of_speech": item.part_of_speech,
                    "order_index": item.order_index,
                    "example_sentence": item.example_sentence,
                    "example_sentence_translation": item.example_sentence_translation,
                    "recording_url": None,  # 預覽模式沒有學生錄音
                }
                items_data.append(item_data)

            activity_data["items"] = items_data
            activity_data["item_count"] = len(items_data)

            # 額外欄位（根據 content type）
            if content.type == ContentType.EXAMPLE_SENTENCES:
                activity_data["target_wpm"] = content.target_wpm
                activity_data["target_accuracy"] = content.target_accuracy
                if items_data:
                    first = items_data[0]
                    activity_data["example_audio_url"] = first["audio_url"]
                    activity_data["content"] = first["translation"] or ""
                    activity_data["target_text"] = first["text"] or ""

            activities.append(activity_data)

    return {
        "assignment_id": assignment.id,
        "title": assignment.title,
        "status": "preview",  # 特殊標記表示這是預覽模式
        "practice_mode": assignment.practice_mode,  # 例句重組/朗讀模式
        "score_category": assignment.score_category,  # 計分類別
        "show_answer": assignment.show_answer or False,  # 答題結束後是否顯示正確答案
        "total_activities": len(activities),
        "activities": activities,
    }


@router.get("/assignments/{assignment_id}/preview/rearrangement-questions")
async def preview_rearrangement_questions(
    assignment_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    預覽模式專用：取得例句重組題目列表

    - 供老師預覽示範用
    - 不需要 StudentAssignment，直接從 Assignment 讀取
    """

    class RearrangementQuestionResponse(BaseModel):
        content_item_id: int
        shuffled_words: List[str]
        word_count: int
        max_errors: int
        time_limit: int
        play_audio: bool
        audio_url: Optional[str] = None
        translation: Optional[str] = None
        original_text: Optional[str] = None  # 正確答案（用於顯示答案功能）

    # 取得作業（確認老師有權限 — 支援 classroom_id 為 null 的即刻練習）
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
        )
        .first()
    )

    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # 確認是例句重組模式
    if assignment.practice_mode != "rearrangement":
        raise HTTPException(
            status_code=400, detail="This assignment is not in rearrangement mode"
        )

    # 取得所有內容項目（含 Content 以取得 type）
    content_items = (
        db.query(ContentItem)
        .join(Content)
        .join(AssignmentContent)
        .filter(AssignmentContent.assignment_id == assignment.id)
        .options(contains_eager(ContentItem.content))
        .order_by(ContentItem.order_index)
        .all()
    )

    # 如果需要打亂順序
    if assignment.shuffle_questions:
        random.shuffle(content_items)

    questions = []
    for item in content_items:
        # 根據練習模式切換欄位（單字集 → 使用例句欄位）
        fields = get_sentence_fields(
            item, item.content.type if item.content else None, "rearrangement"
        )
        if fields is None:
            continue  # 單字集無例句的 item 跳過
        q_text, q_translation, q_audio = fields

        # 打亂單字順序
        words = q_text.strip().split()
        shuffled_words = words.copy()
        random.shuffle(shuffled_words)

        questions.append(
            RearrangementQuestionResponse(
                content_item_id=item.id,
                shuffled_words=shuffled_words,
                word_count=item.word_count or len(words),
                max_errors=item.max_errors or (3 if len(words) <= 10 else 5),
                time_limit=(
                    assignment.time_limit_per_question
                    if assignment.time_limit_per_question is not None
                    else 30
                ),
                play_audio=assignment.play_audio or False,
                audio_url=q_audio,
                translation=q_translation,
                original_text=q_text.strip(),  # 正確答案
            )
        )

    return {
        "student_assignment_id": assignment_id,
        "practice_mode": "rearrangement",
        "score_category": assignment.score_category,
        "questions": questions,
        "total_questions": len(questions),
    }


@router.post("/assignments/{assignment_id}/preview/rearrangement-answer")
async def preview_rearrangement_answer(
    assignment_id: int,
    request: dict,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    預覽模式專用：驗證例句重組答案（不存儲）

    - 只做答案驗證，不存入資料庫
    - 供老師預覽示範用
    """
    import math

    # 取得作業（確認老師有權限 — 支援 classroom_id 為 null 的即刻練習）
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
        )
        .first()
    )

    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # 取得內容項目
    content_item = (
        db.query(ContentItem)
        .filter(ContentItem.id == request.get("content_item_id"))
        .first()
    )

    if not content_item:
        raise HTTPException(status_code=404, detail="Content item not found")

    # 解析正確答案
    correct_words = content_item.text.strip().split()
    word_count = len(correct_words)
    max_errors = content_item.max_errors or (3 if word_count <= 10 else 5)
    points_per_word = math.floor(100 / word_count)

    # 檢查答案是否正確
    current_position = request.get("current_position", 0)
    if current_position >= word_count:
        raise HTTPException(status_code=400, detail="Invalid position")

    correct_word = correct_words[current_position]
    selected_word = request.get("selected_word", "")
    is_correct = selected_word.strip() == correct_word.strip()

    # 預覽模式：計算預期分數（不存儲）
    # 假設這是第一次作答，所以 error_count 從請求中取得（前端追蹤）
    error_count = request.get("error_count", 0)
    if not is_correct:
        error_count += 1

    expected_score = max(0, 100 - (error_count * points_per_word))
    correct_word_count = current_position + 1 if is_correct else current_position

    # 檢查是否達到錯誤上限
    challenge_failed = error_count >= max_errors

    # 檢查是否完成
    completed = correct_word_count >= word_count

    return {
        "is_correct": is_correct,
        "correct_word": correct_word if not is_correct else None,
        "error_count": error_count,
        "max_errors": max_errors,
        "expected_score": expected_score,
        "correct_word_count": correct_word_count,
        "total_word_count": word_count,
        "challenge_failed": challenge_failed,
        "completed": completed,
    }


@router.post("/assignments/{assignment_id}/preview/rearrangement-complete")
async def preview_rearrangement_complete(
    assignment_id: int,
    request: dict,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    預覽模式專用：完成題目（不存儲）

    - 不存入資料庫
    - 供老師預覽示範用
    """
    # 取得作業（確認老師有權限 — 支援 classroom_id 為 null 的即刻練習）
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
        )
        .first()
    )

    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # 預覽模式直接返回成功
    return {
        "success": True,
        "final_score": request.get("expected_score", 0),
        "timeout": request.get("timeout", False),
        "completed_at": datetime.now().isoformat(),
    }


@router.post("/assignments/{assignment_id}/preview/rearrangement-retry")
async def preview_rearrangement_retry(
    assignment_id: int,
    request: dict,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    預覽模式專用：重新挑戰題目（不存儲）

    - 不存入資料庫
    - 供老師預覽示範用
    """
    # 取得作業（確認老師有權限 — 支援 classroom_id 為 null 的即刻練習）
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
        )
        .first()
    )

    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # 預覽模式直接返回成功（前端會自行重置狀態）
    return {
        "success": True,
        "retry_count": 1,
        "message": "Progress reset. You can start again.",
    }


@router.post("/assignments/preview/assess-speech")
async def preview_assess_speech(
    audio_file: UploadFile = File(...),
    reference_text: str = Form(...),
    current_teacher: Teacher = Depends(get_current_teacher),  # noqa: F811
):
    """
    預覽模式專用：評估發音但不存入資料庫

    - 只做 AI 評估，不需要 progress_id
    - 不更新資料庫
    - 供老師預覽示範用
    """
    import logging

    logger = logging.getLogger(__name__)

    # 使用與學生相同的 AI 評估邏輯（確保一致性）
    from routers.speech_assessment import convert_audio_to_wav, assess_pronunciation

    # 檢查檔案格式
    ALLOWED_AUDIO_FORMATS = [
        "audio/wav",
        "audio/webm",
        "audio/webm;codecs=opus",
        "audio/mp3",
        "audio/mpeg",
        "audio/mp4",  # macOS Safari 使用 MP4 格式
        "video/mp4",  # 某些瀏覽器可能用 video/mp4
        "application/octet-stream",
    ]

    if audio_file.content_type not in ALLOWED_AUDIO_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"不支援的音檔格式。允許的格式: {', '.join(ALLOWED_AUDIO_FORMATS)}",
        )

    # 檢查檔案大小
    MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
    audio_data = await audio_file.read()
    if len(audio_data) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"檔案太大。最大大小: {MAX_FILE_SIZE / 1024 / 1024}MB",
        )

    try:
        # 轉換音檔格式為 WAV（與學生 API 相同的邏輯）
        wav_audio_data = convert_audio_to_wav(audio_data, audio_file.content_type)

        # 進行發音評估（與學生 API 相同的邏輯，但不儲存到資料庫）
        assessment_result = assess_pronunciation(wav_audio_data, reference_text)

        # 直接返回評估結果，不存入資料庫
        return {
            "success": True,
            "preview_mode": True,
            "assessment": assessment_result,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Preview assessment failed: {e}")
        raise HTTPException(status_code=503, detail="AI 評估失敗，請稍後再試")


# ============ 訂閱管理 ============
@router.post("/subscription/cancel")
async def cancel_subscription(
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    取消自動續訂

    - 訂閱繼續有效直到到期日
    - 到期後不會自動續訂
    - 可以隨時重新啟用自動續訂
    """
    import logging

    logger = logging.getLogger(__name__)

    try:
        logger.info(f"Cancel subscription request for teacher: {current_teacher.email}")
        logger.info(f"  subscription_end_date: {current_teacher.subscription_end_date}")
        logger.info(
            f"  subscription_auto_renew: {current_teacher.subscription_auto_renew}"
        )

        # 檢查是否有有效訂閱
        if not current_teacher.subscription_end_date:
            logger.warning(
                f"Teacher {current_teacher.email} has no subscription_end_date"
            )
            raise HTTPException(status_code=400, detail="您目前沒有有效的訂閱")

        # 處理 timezone-aware 和 naive datetime 比較
        now = datetime.now(timezone.utc)
        end_date = current_teacher.subscription_end_date
        if end_date.tzinfo is None:
            end_date = end_date.replace(tzinfo=timezone.utc)

        if end_date < now:
            logger.warning(
                f"Teacher {current_teacher.email} subscription expired: {end_date} < {now}"
            )
            raise HTTPException(status_code=400, detail="您的訂閱已過期")

        # 檢查是否已經取消過（必須明確是 False，None 代表未設定要當作 True）
        if current_teacher.subscription_auto_renew is False:
            return {
                "success": True,
                "message": "您已經取消過續訂",
                "subscription_end_date": current_teacher.subscription_end_date.isoformat(),
                "auto_renew": False,
            }

        # 如果是 None，先設定為 True（向後相容舊訂閱）
        if current_teacher.subscription_auto_renew is None:
            logger.info(
                f"Teacher {current_teacher.email} subscription_auto_renew was None, "
                "setting to True for backwards compatibility"
            )
            current_teacher.subscription_auto_renew = True

        # 更新自動續訂狀態
        current_teacher.subscription_auto_renew = False
        current_teacher.subscription_cancelled_at = datetime.now(timezone.utc)
        current_teacher.updated_at = datetime.now(timezone.utc)

        db.commit()
        db.refresh(current_teacher)

        logger.info(
            f"Teacher {current_teacher.email} cancelled auto-renewal. "
            f"Subscription valid until {current_teacher.subscription_end_date}"
        )

        return {
            "success": True,
            "message": "已成功取消自動續訂",
            "subscription_end_date": current_teacher.subscription_end_date.isoformat(),
            "auto_renew": False,
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to cancel subscription: {e}")
        raise HTTPException(status_code=500, detail="取消訂閱失敗，請稍後再試")


@router.post("/subscription/reactivate")
async def reactivate_subscription(
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    重新啟用自動續訂
    """
    import logging

    logger = logging.getLogger(__name__)

    try:
        # 檢查是否有有效訂閱
        if not current_teacher.subscription_end_date:
            raise HTTPException(status_code=400, detail="您目前沒有有效的訂閱")

        # 🔴 PRD 規則：必須先綁卡才能啟用自動續訂
        if not current_teacher.card_key or not current_teacher.card_token:
            raise HTTPException(status_code=400, detail="無法啟用自動續訂：尚未綁定信用卡")

        # 檢查是否已經啟用
        if current_teacher.subscription_auto_renew:
            raise HTTPException(status_code=400, detail="自動續訂已經是啟用狀態")

        # 重新啟用自動續訂
        current_teacher.subscription_auto_renew = True
        current_teacher.subscription_cancelled_at = None
        current_teacher.updated_at = datetime.now(timezone.utc)

        db.commit()

        logger.info(f"Teacher {current_teacher.email} reactivated auto-renewal")

        return {
            "success": True,
            "message": "已重新啟用自動續訂",
            "auto_renew": True,
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to reactivate subscription: {e}")
        raise HTTPException(status_code=500, detail="重新啟用失敗，請稍後再試")


@router.get("/quota-usage")
async def get_quota_usage_analytics(
    start_date: str = None,
    end_date: str = None,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    取得配額使用統計分析

    提供：
    - 配額使用摘要
    - 每日使用趨勢
    - 學生使用排行
    - 作業使用排行
    - 功能使用分佈
    """
    # 解析日期（如果提供）
    start_dt = None
    end_dt = None

    if start_date:
        try:
            start_dt = datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(
                status_code=400, detail="Invalid start_date format (use ISO format)"
            )

    if end_date:
        try:
            end_dt = datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(
                status_code=400, detail="Invalid end_date format (use ISO format)"
            )

    # 取得統計資料
    analytics = QuotaAnalyticsService.get_usage_summary(
        current_teacher, start_date=start_dt, end_date=end_dt
    )

    return analytics


# ============ Word Reading Preview API ============


@router.get("/assignments/{assignment_id}/preview/vocabulary/activities")
async def preview_vocabulary_activities(
    assignment_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    預覽模式專用：取得單字朗讀練習資料

    - 供老師預覽示範用
    - 不需要 StudentAssignment，直接從 Assignment 讀取
    - 返回格式與學生端 API 相同
    """
    # 取得作業（確認老師有權限 — 支援 classroom_id 為 null 的即刻練習）
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
        )
        .first()
    )

    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # 確認是單字朗讀模式
    if assignment.practice_mode != "word_reading":
        raise HTTPException(
            status_code=400, detail="This assignment is not in word_reading mode"
        )

    # 取得所有內容項目
    content_items = (
        db.query(ContentItem)
        .join(Content)
        .join(AssignmentContent)
        .filter(AssignmentContent.assignment_id == assignment.id)
        .order_by(ContentItem.order_index)
        .all()
    )

    # 構建 items 資料（預覽模式沒有學生進度）
    items = []
    for item in content_items:
        item_data = {
            "id": item.id,
            "text": item.text,
            "translation": item.translation,
            "audio_url": item.audio_url,
            "image_url": item.image_url,
            "part_of_speech": item.part_of_speech,
            "order_index": item.order_index,
            "recording_url": None,  # 預覽模式沒有學生錄音
        }
        items.append(item_data)

    return {
        "assignment_id": assignment_id,
        "title": assignment.title,
        "status": "preview",
        "practice_mode": "word_reading",
        "show_translation": assignment.show_translation
        if assignment.show_translation is not None
        else True,
        "show_image": assignment.show_image
        if assignment.show_image is not None
        else True,
        "time_limit_per_question": assignment.time_limit_per_question or 0,
        "total_items": len(items),
        "items": items,
    }


# ============ Word Selection Preview API ============


@router.get("/assignments/{assignment_id}/preview/word-selection-start")
async def preview_word_selection_start(
    assignment_id: int,
    exclude_ids: str = Query(default="", description="已練過的 content_item_id，逗號分隔"),
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    預覽模式專用：取得單字選擇練習資料

    - 供老師預覽示範用
    - 不需要 StudentAssignment，直接從 Assignment 讀取
    - 使用預生成的干擾選項（如果有的話）
    - exclude_ids: 已練過的單字 ID，避免每輪重複 (#379)
    """
    # from services.translation import translation_service  # disabled (#303)

    # 取得作業（確認老師有權限 — 支援 classroom_id 為 null 的即刻練習）
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
        )
        .first()
    )

    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # 確認是單字選擇模式（tug_of_war 共用同一資料格式）
    if assignment.practice_mode not in ("word_selection", "tug_of_war"):
        raise HTTPException(
            status_code=400, detail="This assignment is not in word_selection mode"
        )

    # 取得所有內容項目
    content_items = (
        db.query(ContentItem)
        .join(Content)
        .join(AssignmentContent)
        .filter(AssignmentContent.assignment_id == assignment.id)
        .order_by(ContentItem.order_index)
        .all()
    )

    if not content_items:
        raise HTTPException(
            status_code=404, detail="No vocabulary items found for this assignment"
        )

    # 記錄作業總單字數（在限制之前）
    total_words_in_assignment = len(content_items)

    # (#379) 排除已練過的單字，確保每輪不重複（per-token 解析避免單一無效值丟失全部）
    exclude_id_set = set()
    if exclude_ids:
        for x in exclude_ids.split(","):
            x = x.strip()
            if x:
                try:
                    exclude_id_set.add(int(x))
                except ValueError:
                    pass  # 跳過個別無效的 ID

    remaining_items = [item for item in content_items if item.id not in exclude_id_set]

    # 如果剩餘不夠一輪（< 10），重新從全部單字開始
    if len(remaining_items) < 10:
        remaining_items = list(content_items)

    # 如果需要打亂順序
    if assignment.shuffle_questions:
        random.shuffle(remaining_items)

    # 限制為 10 個單字（與學生端一致）
    content_items = remaining_items[:10]

    # NOTE: AI distractor generation is temporarily disabled (#303).
    # All distractors now come from other words in the assignment.
    #
    # --- AI distractor generation (disabled) ---
    # items_needing_generation = [item for item in content_items if not item.distractors]
    # if items_needing_generation:
    #     words_for_distractors = [
    #         {"word": item.text, "translation": item.translation or ""}
    #         for item in items_needing_generation
    #     ]
    #     try:
    #         generated = await translation_service.batch_generate_distractors(
    #             words_for_distractors, count=2
    #         )
    #         for i, item in enumerate(items_needing_generation):
    #             if i < len(generated):
    #                 item._generated_distractors = generated[i]
    #     except Exception as e:
    #         logger.error(f"Failed to generate distractors for preview: {e}")
    #         for item in items_needing_generation:
    #             item._generated_distractors = ["選項A", "選項B", "選項C"]
    # --- end AI distractor generation ---

    # 建立回應資料 — Issue #631: options 升級為 list[{text, image_url}]
    words_with_options = []

    for item in content_items:
        correct_answer = item.translation or ""

        # 從同集內其他單字隨機挑 3 個（同時帶 image_url）作為錯誤選項 (#303)
        target = correct_answer.lower().strip()
        pool = [
            {"text": other.translation, "image_url": other.image_url}
            for other in content_items
            if other.translation and other.translation.lower().strip() != target
        ]
        random.shuffle(pool)
        final_distractors = pool[:3]

        # Fallback for small word sets
        num_needed = 3 - len(final_distractors)
        for i in range(num_needed):
            final_distractors.append({"text": f"選項{chr(65 + i)}", "image_url": None})

        # 建立選項陣列並打亂
        correct_option = {"text": correct_answer, "image_url": item.image_url}
        options = [correct_option] + final_distractors
        random.shuffle(options)

        words_with_options.append(
            {
                "content_item_id": item.id,
                "text": item.text,
                "translation": correct_answer,
                "audio_url": item.audio_url,
                "image_url": item.image_url,
                "memory_strength": 0,
                "options": options,
            }
        )

    return {
        "session_id": None,  # 預覽模式不建立 session
        "words": words_with_options,
        "total_words": total_words_in_assignment,  # 作業總單字數，非當次練習數
        "current_proficiency": 0,
        "target_proficiency": assignment.target_proficiency or 80,
        "show_word": assignment.show_word if assignment.show_word is not None else True,
        "show_image": (
            assignment.show_image if assignment.show_image is not None else True
        ),
        "show_option_images": bool(getattr(assignment, "show_option_images", False)),
        "play_audio": assignment.play_audio or False,
        "time_limit_per_question": assignment.time_limit_per_question,
    }


@router.post("/assignments/{assignment_id}/preview/word-selection-answer")
async def preview_word_selection_answer(
    assignment_id: int,
    request: dict,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    預覽模式專用：提交單字選擇答案（不儲存）

    - 只驗證答案是否正確
    - 不更新任何資料庫記錄
    - 回傳模擬的結果
    """
    # 取得作業（確認老師有權限 — 支援 classroom_id 為 null 的即刻練習）
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
        )
        .first()
    )

    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    content_item_id = request.get("content_item_id")
    selected_answer = request.get("selected_answer")

    # 取得 content item 驗證答案
    content_item = (
        db.query(ContentItem).filter(ContentItem.id == content_item_id).first()
    )

    if not content_item:
        raise HTTPException(status_code=404, detail="Content item not found")

    is_correct = selected_answer == content_item.translation

    # 回傳模擬結果（預覽模式不更新 memory_strength）
    return {
        "is_correct": is_correct,
        "correct_answer": content_item.translation,
        "new_memory_strength": 0.5 if is_correct else 0,  # 模擬值
        "current_mastery": 50.0,  # 模擬值
        "target_mastery": assignment.target_proficiency or 80,
        "achieved": False,
    }
