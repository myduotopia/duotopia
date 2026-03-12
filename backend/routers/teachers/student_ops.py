"""
Student Ops operations for teachers.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, selectinload, joinedload
from sqlalchemy import func
from typing import List, Optional, Dict, Any
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from uuid import UUID

from database import get_db
from models import Teacher, Classroom, Student, Program, Lesson, Content, ContentItem
from models import ClassroomStudent, Assignment, AssignmentContent
from models import (
    ProgramLevel,
    TeacherOrganization,
    TeacherSchool,
    Organization,
    School,
    ClassroomSchool,
)
from .dependencies import get_current_teacher
from .validators import *
from .utils import TEST_SUBSCRIPTION_WHITELIST  # parse_birthdate is defined locally
from auth import get_password_hash

router = APIRouter()


@router.get("/students")
async def get_all_students(
    mode: Optional[str] = Query(
        None, description="Filter mode: personal|school|organization"
    ),
    school_id: Optional[str] = Query(
        None, description="School UUID (requires mode=school)"
    ),
    organization_id: Optional[str] = Query(None, description="Organization UUID"),
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """取得教師的所有學生（包含班級學生及24小時內建立的未分配學生）"""
    # Shows:
    # 1. All students in teacher's classrooms
    # 2. Unassigned students created in last 24 hours (for assignment purposes)

    # Authorization checks (if mode specified)
    if mode == "school" and school_id:
        # Verify teacher has access to this school
        has_access = (
            db.query(TeacherSchool)
            .filter(
                TeacherSchool.teacher_id == current_teacher.id,
                TeacherSchool.school_id == school_id,
                TeacherSchool.is_active.is_(True),
            )
            .first()
        )
        if not has_access:
            raise HTTPException(403, detail="Access denied to this school")

    elif mode == "organization" and organization_id:
        # Verify teacher has access to this organization
        has_access = (
            db.query(TeacherOrganization)
            .filter(
                TeacherOrganization.teacher_id == current_teacher.id,
                TeacherOrganization.organization_id == organization_id,
                TeacherOrganization.is_active.is_(True),
            )
            .first()
        )
        if not has_access:
            raise HTTPException(403, detail="Access denied to this organization")

    # Get students in teacher's classrooms with school/organization relationships
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

    # 批次查詢教室資訊 (with school/organization relationships)
    classroom_ids = [cs.classroom_id for cs in classroom_students_list]
    classrooms_dict = {}
    if classroom_ids:
        classrooms_list = (
            db.query(Classroom)
            .filter(Classroom.id.in_(classroom_ids))
            .options(
                selectinload(Classroom.classroom_schools)
                .selectinload(ClassroomSchool.school)
                .selectinload(School.organization)
            )
            .all()
        )
        classrooms_dict = {c.id: c for c in classrooms_list}

    # Server-side filtering based on mode
    if mode == "personal":
        # Only show students in classrooms without school link OR unassigned students
        filtered_student_ids = set()
        for student in all_students:
            cs = classroom_students_dict.get(student.id)
            if cs:
                classroom = classrooms_dict.get(cs.classroom_id)
                if classroom and not classroom.classroom_schools:
                    filtered_student_ids.add(student.id)
            else:
                # Unassigned students are considered personal
                filtered_student_ids.add(student.id)
        all_students = [s for s in all_students if s.id in filtered_student_ids]

    elif mode == "school" and school_id:
        # Only show students in classrooms belonging to this school
        filtered_student_ids = set()
        for student in all_students:
            cs = classroom_students_dict.get(student.id)
            if cs:
                classroom = classrooms_dict.get(cs.classroom_id)
                if classroom and any(
                    ccs.school_id == UUID(school_id) and ccs.is_active
                    for ccs in classroom.classroom_schools
                ):
                    filtered_student_ids.add(student.id)
        all_students = [s for s in all_students if s.id in filtered_student_ids]

    elif mode == "organization" and organization_id:
        # Only show students in classrooms in schools under this organization
        filtered_student_ids = set()
        for student in all_students:
            cs = classroom_students_dict.get(student.id)
            if cs:
                classroom = classrooms_dict.get(cs.classroom_id)
                if classroom and any(
                    ccs.school
                    and ccs.school.organization_id == UUID(organization_id)
                    and ccs.is_active
                    for ccs in classroom.classroom_schools
                ):
                    filtered_student_ids.add(student.id)
        all_students = [s for s in all_students if s.id in filtered_student_ids]

    # Build response with classroom info and school/organization IDs
    result = []
    for student in all_students:
        # 使用字典查找，避免重複查詢
        classroom_student = classroom_students_dict.get(student.id)

        classroom_info = None
        school_id = None
        organization_id = None

        if classroom_student:
            classroom = classrooms_dict.get(classroom_student.classroom_id)
            if classroom:
                classroom_info = {"id": classroom.id, "name": classroom.name}

                # Extract school_id and organization_id from classroom_schools
                if classroom.classroom_schools:
                    active_cs = next(
                        (cs for cs in classroom.classroom_schools if cs.is_active), None
                    )
                    if active_cs and active_cs.school:
                        school_id = str(active_cs.school.id)
                        if active_cs.school.organization:
                            organization_id = str(active_cs.school.organization.id)

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
                "school_id": school_id,
                "organization_id": organization_id,
                "created_at": (
                    student.created_at.isoformat() if student.created_at else None
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
        from utils.permissions import check_classroom_is_personal
        from models import ClassroomSchool

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

        # Check if classroom belongs to school (should not be allowed)
        if not check_classroom_is_personal(classroom.id, db):
            raise HTTPException(status_code=403, detail="此班級屬於學校，請通過學校管理頁面創建學生")

    # Parse birthdate (optional)
    birthdate = None
    if student_data.birthdate:
        try:
            birthdate = date.fromisoformat(student_data.birthdate)
        except ValueError:
            try:
                birthdate = datetime.strptime(student_data.birthdate, "%Y/%m/%d").date()
            except ValueError:
                raise HTTPException(
                    status_code=422,
                    detail="Invalid birthdate format. Please use YYYY-MM-DD format",
                )

    default_password = datetime.now(ZoneInfo("Asia/Taipei")).strftime("%Y%m%d")

    # Email is optional now - can be NULL or shared between students
    email = student_data.email if student_data.email else None

    # 檢查同 email 是否已有驗證過的學生，若有則繼承驗證狀態與 identity_id
    existing_verified = None
    if email:
        existing_verified = (
            db.query(Student)
            .filter(
                Student.email == email,
                Student.email_verified.is_(True),
                Student.is_active.is_(True),
            )
            .first()
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
        email_verified=True if existing_verified else False,
        identity_id=existing_verified.identity_id if existing_verified else None,
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
        "birthdate": student.birthdate.isoformat() if student.birthdate else None,
        "default_password": default_password,
        "password_changed": False,
        "classroom_id": student_data.classroom_id,
        "student_id": student.student_number,
        "phone": student_data.phone,
        "email_verified": bool(existing_verified),
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
        "birthdate": student.birthdate.isoformat() if student.birthdate else None,
        "password_changed": student.password_changed,
        "student_id": student.student_number,
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

    # Update birthdate (no longer syncs password since default password is join date)
    if update_data.birthdate is not None:
        new_birthdate = datetime.strptime(update_data.birthdate, "%Y-%m-%d").date()
        student.birthdate = new_birthdate

    # Update other fields
    if update_data.name is not None:
        student.name = update_data.name
    if update_data.email is not None:
        student.email = update_data.email
    if update_data.student_number is not None:
        student.student_number = update_data.student_number
    if update_data.phone is not None:
        student.phone = update_data.phone
    if update_data.status is not None:
        student.status = update_data.status
    if update_data.target_wpm is not None:
        student.target_wpm = update_data.target_wpm
    if update_data.target_accuracy is not None:
        student.target_accuracy = update_data.target_accuracy

    # 如果更新 email 且是真實 email（非系統生成），重置驗證狀態並建立 Identity
    if update_data.email is not None and "@duotopia.local" not in update_data.email:
        if student.email != update_data.email:
            from services.identity_service import identity_service

            student.email_verified = False
            student.email_verified_at = None
            student.email_verification_token = None
            identity_service.ensure_identity_on_email_bind(
                db, student, update_data.email
            )

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
        "student_id": student.student_number,
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
    """重設學生密碼為預設值（建立日期）"""
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

    if not student.created_at:
        raise HTTPException(
            status_code=400, detail="Student creation date not available"
        )

    # Reset password to creation date in Taiwan timezone (YYYYMMDD format)
    taipei_tz = ZoneInfo("Asia/Taipei")
    created_at_tw = (
        student.created_at.astimezone(taipei_tz)
        if student.created_at.tzinfo
        else student.created_at.replace(tzinfo=ZoneInfo("UTC")).astimezone(taipei_tz)
    )
    default_password = created_at_tw.strftime("%Y%m%d")
    student.password_hash = get_password_hash(default_password)
    student.password_changed = False

    db.commit()

    return {
        "message": "Password reset successfully",
        "default_password": default_password,
    }


@router.get("/classrooms/{classroom_id}/students")
async def get_classroom_students(
    classroom_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """取得班級的學生列表"""
    # 驗證班級存在且屬於當前教師
    classroom = (
        db.query(Classroom)
        .filter(
            Classroom.id == classroom_id,
            Classroom.teacher_id == current_teacher.id,
            Classroom.is_active.is_(True),
        )
        .first()
    )

    if not classroom:
        raise HTTPException(
            status_code=404, detail="Classroom not found or you don't have permission"
        )

    # 取得班級學生
    students = (
        db.query(Student)
        .join(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            Student.is_active.is_(True),
            ClassroomStudent.is_active.is_(True),
        )
        .all()
    )

    return [
        {
            "id": s.id,
            "name": s.name,
            "email": s.email,
            "student_number": s.student_number,
            "birthdate": s.birthdate.isoformat() if s.birthdate else None,
            "phone": getattr(s, "phone", ""),
            "password_changed": s.password_changed,
            "last_login": (s.last_login.isoformat() if s.last_login else None),
            "status": "active" if s.is_active else "inactive",
            "created_at": (s.created_at.isoformat() if s.created_at else None),
        }
        for s in students
    ]


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
    today_password = datetime.now(ZoneInfo("Asia/Taipei")).strftime("%Y%m%d")
    for student_data in batch_data.students:
        birthdate = (
            date.fromisoformat(student_data["birthdate"])
            if student_data.get("birthdate")
            else None
        )
        default_password = today_password

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
                "default_password": today_password,
            }
            for s in created_students
        ],
    }


class BatchImportStudent(BaseModel):
    name: str
    classroom_name: str
    birthdate: Any = None  # Can be string, int (Excel serial), etc. (optional)


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

            # Clean data
            student_name = student_data.name.strip()
            classroom_name = student_data.classroom_name.strip()

            # Parse birthdate (optional)
            birthdate = None
            if student_data.birthdate:
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
            if birthdate and birthdate > datetime.now().date():
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
                        if birthdate:
                            existing_student.birthdate = birthdate
                        db.flush()

                        created_students.append(
                            {
                                "id": existing_student.id,
                                "name": existing_student.name,
                                "email": existing_student.email,
                                "classroom_name": classroom_name,
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

            # Create student - default password is today's date
            default_password = datetime.now(ZoneInfo("Asia/Taipei")).strftime("%Y%m%d")
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
