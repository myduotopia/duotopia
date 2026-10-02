"""
Classroom-School Relationship API Routes

Manages the linking of classrooms to schools within the organization hierarchy.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel
from typing import List
from datetime import datetime
import uuid

from database import get_db
from models import (
    Teacher,
    School,
    Classroom,
    ClassroomSchool,
    ClassroomStudent,
    Assignment,
    Program,
)
from models.base import ProgramLevel
from auth import verify_token
from utils.permissions import has_school_materials_permission, check_classroom_in_school
from schemas import ProgramResponse
from routers.schemas.classroom import (
    SchoolClassroomCreate,
    SchoolClassroomUpdate,
    AssignTeacherRequest,
    BatchClassroomGradeRequest,
)
from utils.classroom_grade import grade_to_storage, parse_grade


router = APIRouter(tags=["classroom-schools"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/teacher/login")


# ============ Dependencies ============


async def get_current_teacher(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> Teacher:
    """Get current authenticated teacher"""
    payload = verify_token(token)
    if not payload:
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


# ============ Request/Response Models ============


class LinkClassroomRequest(BaseModel):
    """Request to link classroom to school"""

    school_id: str


class ClassroomSchoolResponse(BaseModel):
    """Response for classroom-school link"""

    id: int
    classroom_id: int
    school_id: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True

    @classmethod
    def from_orm(cls, link: ClassroomSchool):
        return cls(
            id=link.id,
            classroom_id=link.classroom_id,
            school_id=str(link.school_id),
            is_active=link.is_active,
            created_at=link.created_at,
        )


class SchoolInfo(BaseModel):
    """School information"""

    id: str
    organization_id: str
    name: str
    display_name: str | None
    description: str | None
    is_active: bool

    class Config:
        from_attributes = True

    @classmethod
    def from_orm(cls, school: School):
        return cls(
            id=str(school.id),
            organization_id=str(school.organization_id),
            name=school.name,
            display_name=school.display_name,
            description=school.description,
            is_active=school.is_active,
        )


class ClassroomInfo(BaseModel):
    """Classroom information"""

    id: str
    name: str
    program_level: str
    grade: int | None = None  # 年級 1–12；未設定或歷史雜值為 None（#1097）
    is_active: bool
    created_at: datetime
    teacher_name: str | None = None
    teacher_email: str | None = None
    student_count: int = 0
    assignment_count: int = 0

    class Config:
        from_attributes = True

    @classmethod
    def from_orm_with_counts(
        cls,
        classroom: Classroom,
        student_count: int,
        assignment_count: int,
        program_count: int = 0,
    ):
        return cls(
            id=str(classroom.id),
            name=classroom.name,
            program_level=classroom.level.value if classroom.level else "A1",
            grade=parse_grade(classroom.grade),
            is_active=classroom.is_active,
            created_at=classroom.created_at,
            teacher_name=classroom.teacher.name if classroom.teacher else None,
            teacher_email=classroom.teacher.email if classroom.teacher else None,
            student_count=student_count,
            assignment_count=assignment_count,
            program_count=program_count,
        )


# ============ API Endpoints ============


@router.post(
    "/api/classrooms/{classroom_id}/school",
    status_code=status.HTTP_201_CREATED,
    response_model=ClassroomSchoolResponse,
)
async def link_classroom_to_school(
    classroom_id: int,
    request: LinkClassroomRequest,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Link a classroom to a school.
    Classroom owner must be the requesting teacher.
    One classroom can only be linked to one school at a time.
    """
    # Verify classroom exists and belongs to teacher
    classroom = (
        db.query(Classroom)
        .filter(
            Classroom.id == classroom_id,
            Classroom.teacher_id == teacher.id,
        )
        .first()
    )

    if not classroom:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Classroom not found or you don't have permission",
        )

    # Verify school exists
    try:
        school_uuid = uuid.UUID(request.school_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid school ID format"
        )

    school = db.query(School).filter(School.id == school_uuid).first()
    if not school:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="School not found"
        )

    # Check if classroom is already linked to a school
    existing_link = (
        db.query(ClassroomSchool)
        .filter(
            ClassroomSchool.classroom_id == classroom_id,
            ClassroomSchool.is_active.is_(True),
        )
        .first()
    )

    if existing_link:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Classroom is already linked to a school",
        )

    # Create link
    link = ClassroomSchool(
        classroom_id=classroom_id,
        school_id=school_uuid,
        is_active=True,
    )
    db.add(link)
    db.commit()
    db.refresh(link)

    return ClassroomSchoolResponse.from_orm(link)


@router.get("/api/classrooms/{classroom_id}/school", response_model=SchoolInfo)
async def get_classroom_school(
    classroom_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Get the school that a classroom is linked to.
    """
    # Verify classroom exists and belongs to teacher
    classroom = (
        db.query(Classroom)
        .filter(
            Classroom.id == classroom_id,
            Classroom.teacher_id == teacher.id,
        )
        .first()
    )

    if not classroom:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Classroom not found or you don't have permission",
        )

    # Get active link
    link = (
        db.query(ClassroomSchool)
        .filter(
            ClassroomSchool.classroom_id == classroom_id,
            ClassroomSchool.is_active.is_(True),
        )
        .first()
    )

    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Classroom is not linked to any school",
        )

    # Get school
    school = db.query(School).filter(School.id == link.school_id).first()
    if not school:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="School not found"
        )

    return SchoolInfo.from_orm(school)


@router.delete("/api/classrooms/{classroom_id}/school")
async def unlink_classroom_from_school(
    classroom_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Unlink a classroom from its school (soft delete).
    """
    # Verify classroom exists and belongs to teacher
    classroom = (
        db.query(Classroom)
        .filter(
            Classroom.id == classroom_id,
            Classroom.teacher_id == teacher.id,
        )
        .first()
    )

    if not classroom:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Classroom not found or you don't have permission",
        )

    # Find active link
    link = (
        db.query(ClassroomSchool)
        .filter(
            ClassroomSchool.classroom_id == classroom_id,
            ClassroomSchool.is_active.is_(True),
        )
        .first()
    )

    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Classroom is not linked to any school",
        )

    # Soft delete
    link.is_active = False
    db.commit()

    return {"message": "Classroom unlinked from school successfully"}


@router.get("/api/schools/{school_id}/classrooms", response_model=List[ClassroomInfo])
async def list_school_classrooms(
    school_id: uuid.UUID,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    List all classrooms in a school with student and assignment counts.
    Optimized to avoid N+1 queries.
    """
    # Verify school exists
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="School not found"
        )

    # Get all active classroom IDs for this school
    classroom_ids_subq = (
        db.query(ClassroomSchool.classroom_id)
        .filter(
            ClassroomSchool.school_id == school_id,
            ClassroomSchool.is_active.is_(True),
        )
        .subquery()
    )

    classroom_ids = db.query(classroom_ids_subq.c.classroom_id).scalar_subquery()

    # Create subqueries for counts - optimized to avoid N+1
    # Only count active student enrollments
    student_counts = (
        db.query(
            ClassroomStudent.classroom_id,
            func.count(ClassroomStudent.student_id).label("count"),
        )
        .filter(
            ClassroomStudent.classroom_id.in_(classroom_ids),
            ClassroomStudent.is_active.is_(True),
        )
        .group_by(ClassroomStudent.classroom_id)
        .subquery()
    )

    # Only count active assignments
    assignment_counts = (
        db.query(Assignment.classroom_id, func.count(Assignment.id).label("count"))
        .filter(
            Assignment.classroom_id.in_(classroom_ids),
            Assignment.is_active.is_(True),
        )
        .group_by(Assignment.classroom_id)
        .subquery()
    )

    # Count programs for classrooms
    program_counts = (
        db.query(Program.classroom_id, func.count(Program.id).label("count"))
        .filter(
            Program.classroom_id.in_(classroom_ids),
            Program.is_active.is_(True),
            Program.deleted_at.is_(None),
        )
        .group_by(Program.classroom_id)
        .subquery()
    )

    # Get classrooms with teacher preloaded and counts in a single query
    classrooms_query = (
        db.query(
            Classroom,
            func.coalesce(student_counts.c.count, 0).label("student_count"),
            func.coalesce(assignment_counts.c.count, 0).label("assignment_count"),
            func.coalesce(program_counts.c.count, 0).label("program_count"),
        )
        .options(joinedload(Classroom.teacher))
        .outerjoin(student_counts, Classroom.id == student_counts.c.classroom_id)
        .outerjoin(assignment_counts, Classroom.id == assignment_counts.c.classroom_id)
        .outerjoin(program_counts, Classroom.id == program_counts.c.classroom_id)
        .filter(Classroom.id.in_(classroom_ids), Classroom.is_active.is_(True))
        .all()
    )

    # Build result
    result = []
    for classroom, student_count, assignment_count, program_count in classrooms_query:
        result.append(
            ClassroomInfo.from_orm_with_counts(
                classroom, student_count, assignment_count, program_count
            )
        )

    return result


@router.post(
    "/api/schools/{school_id}/classrooms",
    status_code=status.HTTP_201_CREATED,
    response_model=ClassroomInfo,
)
async def create_school_classroom(
    school_id: uuid.UUID,
    classroom_data: SchoolClassroomCreate,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Create a new classroom in school.
    Requires school_admin role or org-level manage_materials permission.
    """
    # Check permission
    if not has_school_materials_permission(teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions to create classroom in this school",
        )

    # Verify school exists
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="School not found"
        )

    # Verify teacher exists if provided
    if classroom_data.teacher_id:
        assigned_teacher = (
            db.query(Teacher)
            .filter(
                Teacher.id == classroom_data.teacher_id, Teacher.is_active.is_(True)
            )
            .first()
        )
        if not assigned_teacher:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Assigned teacher not found",
            )

    # Convert level string to ProgramLevel enum
    # Map API level strings to enum values (PREA -> PRE_A, etc.)
    level_upper = classroom_data.level.upper()
    level_map = {
        "PREA": ProgramLevel.PRE_A,
        "PRE_A": ProgramLevel.PRE_A,
        "A1": ProgramLevel.A1,
        "A2": ProgramLevel.A2,
        "B1": ProgramLevel.B1,
        "B2": ProgramLevel.B2,
        "C1": ProgramLevel.C1,
        "C2": ProgramLevel.C2,
    }
    program_level = level_map.get(level_upper, ProgramLevel.A1)

    # Create classroom
    classroom = Classroom(
        name=classroom_data.name,
        description=classroom_data.description,
        level=program_level,
        grade=grade_to_storage(classroom_data.grade),
        teacher_id=classroom_data.teacher_id,
        is_active=True,
    )
    db.add(classroom)
    db.flush()  # Get classroom ID without committing

    # Link to school
    link = ClassroomSchool(
        classroom_id=classroom.id, school_id=school_id, is_active=True
    )
    db.add(link)
    db.commit()
    db.refresh(classroom)

    # Return with counts (0 for new classroom)
    return ClassroomInfo.from_orm_with_counts(classroom, 0, 0, 0)


@router.post("/api/schools/{school_id}/classrooms/batch-grade")
async def batch_set_school_classroom_grades(
    school_id: uuid.UUID,
    payload: BatchClassroomGradeRequest,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Batch set grade for classrooms in a school (#1097).
    All-or-nothing: any classroom not (actively) in this school → 404.
    Requires school_admin role or org-level manage_materials permission.
    """
    if not has_school_materials_permission(teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions to update classroom",
        )

    classroom_ids = [item.classroom_id for item in payload.items]

    classrooms = (
        db.query(Classroom)
        .join(ClassroomSchool, ClassroomSchool.classroom_id == Classroom.id)
        .filter(
            ClassroomSchool.school_id == school_id,
            ClassroomSchool.is_active.is_(True),
            Classroom.id.in_(classroom_ids),
            Classroom.is_active.is_(True),
        )
        .all()
    )
    classroom_map = {c.id: c for c in classrooms}
    if len(classroom_map) != len(classroom_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Classroom not found in this school",
        )

    for item in payload.items:
        classroom_map[item.classroom_id].grade = grade_to_storage(item.grade)
    db.commit()

    return {
        "updated": [
            {"id": item.classroom_id, "grade": item.grade} for item in payload.items
        ],
        "count": len(payload.items),
    }


@router.put("/api/classrooms/{classroom_id}/teacher", response_model=ClassroomInfo)
async def assign_teacher_to_classroom(
    classroom_id: int,
    request: AssignTeacherRequest,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Assign or reassign teacher to classroom.
    Classroom must belong to a school.
    Requires school_admin or org-level permissions.
    """
    # Get classroom and verify it belongs to a school
    link = (
        db.query(ClassroomSchool)
        .filter(
            ClassroomSchool.classroom_id == classroom_id,
            ClassroomSchool.is_active.is_(True),
        )
        .first()
    )

    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Classroom not found in any school",
        )

    # Check permission
    if not has_school_materials_permission(teacher.id, link.school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions to assign teacher",
        )

    classroom = db.query(Classroom).filter(Classroom.id == classroom_id).first()
    if not classroom:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Classroom not found"
        )

    # Verify new teacher exists if provided
    if request.teacher_id:
        new_teacher = (
            db.query(Teacher)
            .filter(Teacher.id == request.teacher_id, Teacher.is_active.is_(True))
            .first()
        )
        if not new_teacher:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found"
            )

    # Update assignment
    classroom.teacher_id = request.teacher_id
    db.commit()
    db.refresh(classroom)

    # Get counts
    student_count = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.is_active.is_(True),
        )
        .count()
    )
    assignment_count = (
        db.query(Assignment)
        .filter(
            Assignment.classroom_id == classroom_id,
            Assignment.is_active.is_(True),
        )
        .count()
    )
    program_count = (
        db.query(Program)
        .filter(
            Program.classroom_id == classroom_id,
            Program.is_active.is_(True),
            Program.deleted_at.is_(None),
        )
        .count()
    )

    return ClassroomInfo.from_orm_with_counts(
        classroom, student_count, assignment_count, program_count
    )


@router.put("/api/classrooms/{classroom_id}", response_model=ClassroomInfo)
async def update_classroom(
    classroom_id: int,
    update_data: SchoolClassroomUpdate,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Update classroom details.
    Classroom must belong to a school.
    Requires school_admin or org-level permissions.
    """
    # Get classroom and verify it belongs to a school
    link = (
        db.query(ClassroomSchool)
        .filter(
            ClassroomSchool.classroom_id == classroom_id,
            ClassroomSchool.is_active.is_(True),
        )
        .first()
    )

    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Classroom not found in any school",
        )

    # Check permission
    if not has_school_materials_permission(teacher.id, link.school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions to update classroom",
        )

    classroom = db.query(Classroom).filter(Classroom.id == classroom_id).first()
    if not classroom:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Classroom not found"
        )

    # Update fields
    if update_data.name is not None:
        classroom.name = update_data.name
    if update_data.description is not None:
        classroom.description = update_data.description
    if update_data.level is not None:
        # Convert level string to ProgramLevel enum
        level_upper = update_data.level.upper()
        level_map = {
            "PREA": ProgramLevel.PRE_A,
            "PRE_A": ProgramLevel.PRE_A,
            "A1": ProgramLevel.A1,
            "A2": ProgramLevel.A2,
            "B1": ProgramLevel.B1,
            "B2": ProgramLevel.B2,
            "C1": ProgramLevel.C1,
            "C2": ProgramLevel.C2,
        }
        classroom.level = level_map.get(level_upper, classroom.level)
    if update_data.grade is not None:
        classroom.grade = grade_to_storage(update_data.grade)
    if update_data.is_active is not None:
        classroom.is_active = update_data.is_active

    db.commit()
    db.refresh(classroom)

    # Get counts
    student_count = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.is_active.is_(True),
        )
        .count()
    )
    assignment_count = (
        db.query(Assignment)
        .filter(
            Assignment.classroom_id == classroom_id,
            Assignment.is_active.is_(True),
        )
        .count()
    )
    program_count = (
        db.query(Program)
        .filter(
            Program.classroom_id == classroom_id,
            Program.is_active.is_(True),
            Program.deleted_at.is_(None),
        )
        .count()
    )

    return ClassroomInfo.from_orm_with_counts(
        classroom, student_count, assignment_count, program_count
    )


@router.get(
    "/api/schools/{school_id}/classrooms/{classroom_id}/programs",
    response_model=List[ProgramResponse],
)
async def get_school_classroom_programs(
    school_id: uuid.UUID,
    classroom_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Get all programs for a classroom in a school.

    Permission: Must have access to the school and classroom must belong to the school.
    """
    from datetime import datetime

    # Verify school exists and teacher has access
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="School not found"
        )

    if not has_school_materials_permission(teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions to access this school",
        )

    # Verify classroom belongs to school
    if not check_classroom_in_school(classroom_id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Classroom not found in this school",
        )

    # Query programs for the classroom
    programs = (
        db.query(Program)
        .filter(
            Program.classroom_id == classroom_id,
            Program.is_active.is_(True),
            Program.deleted_at.is_(None),
        )
        .order_by(Program.order_index, Program.created_at)
        .all()
    )

    # Convert to response models
    result = []
    for program in programs:
        result.append(
            ProgramResponse(
                id=program.id,
                name=program.name,
                description=program.description,
                level=program.level,
                estimated_hours=program.estimated_hours,
                tags=program.tags,
                is_template=program.is_template,
                classroom_id=program.classroom_id,
                teacher_id=program.teacher_id,
                organization_id=str(program.organization_id)
                if program.organization_id
                else None,
                school_id=str(program.school_id) if program.school_id else None,
                source_type=program.source_type,
                source_metadata=program.source_metadata,
                is_active=program.is_active,
                created_at=program.created_at or datetime.now(),
                updated_at=program.updated_at,
                classroom_name=getattr(program, "classroom_name", None),
                teacher_name=getattr(program, "teacher_name", None),
                lesson_count=len(program.lessons) if program.lessons else 0,
                is_duplicate=getattr(program, "is_duplicate", None),
                lessons=[],
            )
        )

    return result
