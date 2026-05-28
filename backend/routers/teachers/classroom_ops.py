"""
Classroom Ops operations for teachers.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload, joinedload
from sqlalchemy import func
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
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
from .utils import TEST_SUBSCRIPTION_WHITELIST, parse_birthdate

router = APIRouter()


@router.get("/classrooms")
async def get_teacher_classrooms(
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
    """取得教師的所有班級"""

    # Get classrooms with students AND school/organization relationships (only active classrooms)
    classrooms = (
        db.query(Classroom)
        .filter(
            Classroom.teacher_id == current_teacher.id,
            Classroom.is_active.is_(True),  # Only show active classrooms
        )
        .options(
            selectinload(Classroom.students).selectinload(ClassroomStudent.student),
            selectinload(Classroom.classroom_schools)
            .selectinload(ClassroomSchool.school)
            .selectinload(School.organization),
        )
        .all()
    )

    # Server-side filtering based on mode (security enhancement)
    if mode == "personal":
        # Only show classrooms without school link
        classrooms = [c for c in classrooms if not c.classroom_schools]

    elif mode == "school" and school_id:
        # Authorization check: verify teacher has access to this school
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

        # Filter classrooms belonging to this school
        classrooms = [
            c
            for c in classrooms
            if any(
                cs.school_id == UUID(school_id) and cs.is_active
                for cs in c.classroom_schools
            )
        ]

    elif mode == "organization" and organization_id:
        # Authorization check: verify teacher has access to this organization
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

        # Filter classrooms in schools under this organization
        classrooms = [
            c
            for c in classrooms
            if any(
                cs.school
                and cs.school.organization_id == UUID(organization_id)
                and cs.is_active
                for cs in c.classroom_schools
            )
        ]

    # If no mode specified, return all classrooms (backward compatibility)

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

    # Build response with school/organization info
    result = []
    for classroom in classrooms:
        # Get school_id and organization_id from classroom_schools relationship
        school_id = None
        school_name = None
        organization_id = None

        if classroom.classroom_schools:
            # Get the first active classroom_school record
            active_cs = next(
                (cs for cs in classroom.classroom_schools if cs.is_active), None
            )
            if active_cs and active_cs.school:
                school_id = str(active_cs.school.id)
                school_name = active_cs.school.display_name or active_cs.school.name
                if active_cs.school.organization:
                    organization_id = str(active_cs.school.organization.id)

        result.append(
            {
                "id": classroom.id,
                "name": classroom.name,
                "description": classroom.description,
                "level": classroom.level.value if classroom.level else "A1",
                "student_count": len(
                    [
                        cs
                        for cs in classroom.students
                        if cs.is_active and cs.student.is_active
                    ]
                ),
                "program_count": program_count_map.get(
                    classroom.id, 0
                ),  # Efficient lookup
                "created_at": (
                    classroom.created_at.isoformat() if classroom.created_at else None
                ),
                "school_id": school_id,
                "school_name": school_name,
                "organization_id": organization_id,
                # 1Campus sync metadata (#635). NULL for manually-created classrooms.
                "one_campus_class_id": classroom.one_campus_class_id,
                "last_synced_at": (
                    classroom.last_synced_at.isoformat()
                    if classroom.last_synced_at
                    else None
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
                        "created_at": (
                            cs.student.created_at.isoformat()
                            if cs.student.created_at
                            else None
                        ),
                    }
                    for cs in classroom.students
                    if cs.is_active and cs.student.is_active
                ],
            }
        )

    return result


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


@router.get("/classrooms/{classroom_id}/students")
async def get_classroom_students(
    classroom_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """取得班級的學生列表"""
    classroom = (
        db.query(Classroom)
        .filter(
            Classroom.id == classroom_id,
            Classroom.teacher_id == current_teacher.id,
            Classroom.is_active.is_(True),
        )
        .options(
            selectinload(Classroom.students).selectinload(ClassroomStudent.student)
        )
        .first()
    )

    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    return [
        {
            "id": cs.student.id,
            "name": cs.student.name,
            "email": cs.student.email,
            "student_number": cs.student.student_number,
            "birthdate": (
                cs.student.birthdate.isoformat() if cs.student.birthdate else None
            ),
            "password_changed": cs.student.password_changed,
            "last_login": (
                cs.student.last_login.isoformat() if cs.student.last_login else None
            ),
            "phone": getattr(cs.student, "phone", "") or "",
            "status": "active" if cs.student.is_active else "inactive",
            "created_at": (
                cs.student.created_at.isoformat() if cs.student.created_at else None
            ),
        }
        for cs in classroom.students
        if cs.is_active and cs.student.is_active
    ]


@router.put("/classrooms/{classroom_id}")
async def update_classroom(
    classroom_id: int,
    update_data: ClassroomUpdate,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """更新班級資料"""
    from utils.permissions import check_classroom_is_personal

    classroom = (
        db.query(Classroom)
        .filter(
            Classroom.id == classroom_id, Classroom.teacher_id == current_teacher.id
        )
        .first()
    )

    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    # Check if classroom belongs to school (should not be allowed)
    if not check_classroom_is_personal(classroom.id, db):
        raise HTTPException(status_code=403, detail="此班級屬於學校，請通過學校後台編輯")

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
    from utils.permissions import check_classroom_is_personal

    classroom = (
        db.query(Classroom)
        .filter(
            Classroom.id == classroom_id, Classroom.teacher_id == current_teacher.id
        )
        .first()
    )

    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    # Check if classroom belongs to school (should not be allowed)
    if not check_classroom_is_personal(classroom.id, db):
        raise HTTPException(status_code=403, detail="此班級屬於學校，請通過學校後台刪除")

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
    student_number: Optional[str] = None
    phone: Optional[str] = None  # 新增 phone 欄位


class StudentUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None  # 可更新為真實 email
    student_number: Optional[str] = None
    birthdate: Optional[str] = None
    phone: Optional[str] = None
    status: Optional[str] = None
    target_wpm: Optional[int] = None
    target_accuracy: Optional[float] = None
    classroom_id: Optional[int] = None  # 新增班級分配功能


class BatchStudentCreate(BaseModel):
    students: List[Dict[str, Any]]
