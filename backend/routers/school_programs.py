"""
School Programs Router

Manages school-level materials (templates) with deep copy functionality.

Endpoints:
1. GET /{school_id}/programs - List school materials
2. GET /{school_id}/programs/{program_id} - Get material details with hierarchy
3. POST /{school_id}/programs - Create school material
4. PUT /{school_id}/programs/{program_id} - Update school material
5. DELETE /{school_id}/programs/{program_id} - Soft delete material
6. POST /{school_id}/programs/{program_id}/copy-to-classroom - Deep copy to classroom
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel, Field, model_validator
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import logging

from database import get_db
from models import (
    Teacher,
    School,
    TeacherSchool,
    TeacherOrganization,
    Program,
    Lesson,
    Content,
    ContentItem,
    Classroom,
)
from schemas import LessonCreate
from auth import verify_token
from services.casbin_service import get_casbin_service

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/api/schools", tags=["school-programs"])
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


class ProgramCreateRequest(BaseModel):
    """Request model for creating school material"""

    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None


class ProgramUpdateRequest(BaseModel):
    """Request model for updating school material"""

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None


class CopyToClassroomRequest(BaseModel):
    """Request model for copying material to classroom"""

    classroom_id: int


class ContentItemResponse(BaseModel):
    """Response model for content item"""

    id: int
    content_id: int
    order_index: int
    text: str
    translation: Optional[str]
    audio_url: Optional[str]

    class Config:
        from_attributes = True


class ContentResponse(BaseModel):
    """Response model for content"""

    id: int
    # Issue #587: lesson_id may be None for program-direct content
    lesson_id: Optional[int] = None
    program_id: Optional[int] = None
    type: str
    title: str
    order_index: int
    is_active: bool
    items: List[ContentItemResponse] = []

    class Config:
        from_attributes = True


class LessonResponse(BaseModel):
    """Response model for lesson"""

    id: int
    program_id: int
    name: str
    description: Optional[str]
    order_index: int
    is_active: bool
    contents: List[ContentResponse] = []

    class Config:
        from_attributes = True


class ProgramResponse(BaseModel):
    """Response model for program"""

    id: int
    name: str
    description: Optional[str]
    is_template: bool
    is_active: bool
    classroom_id: Optional[int]
    teacher_id: int
    school_id: Optional[str]  # UUID as string
    source_metadata: Optional[dict]
    lessons: List[LessonResponse] = []

    @model_validator(mode="before")
    @classmethod
    def convert_uuid_fields(cls, data):
        """Convert UUID fields to strings before validation"""
        if hasattr(data, "school_id") and data.school_id is not None:
            if not isinstance(data.school_id, str):
                object.__setattr__(data, "school_id", str(data.school_id))
        elif isinstance(data, dict) and "school_id" in data:
            if data["school_id"] is not None and not isinstance(data["school_id"], str):
                data["school_id"] = str(data["school_id"])
        return data

    class Config:
        from_attributes = True


# ============ Helper Functions ============


def check_school_access(teacher_id: int, school_id: uuid.UUID, db: Session) -> bool:
    """
    Check if teacher can access school materials.

    Access granted if:
    - Teacher is a member of the school (TeacherSchool)
    - Teacher is org_owner/org_admin of the school's organization (TeacherOrganization)
    """
    # Check school membership
    membership = (
        db.query(TeacherSchool)
        .filter(
            TeacherSchool.teacher_id == teacher_id,
            TeacherSchool.school_id == school_id,
            TeacherSchool.is_active.is_(True),
        )
        .first()
    )

    if membership:
        return True

    # Check organization-level access
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        return False

    org_membership = (
        db.query(TeacherOrganization)
        .filter(
            TeacherOrganization.teacher_id == teacher_id,
            TeacherOrganization.organization_id == school.organization_id,
            TeacherOrganization.is_active.is_(True),
        )
        .first()
    )

    if org_membership and org_membership.role in ["org_owner", "org_admin"]:
        return True

    return False


def check_manage_materials_permission(
    teacher_id: int, school_id: uuid.UUID, db: Session
) -> bool:
    """
    Check if teacher has manage_materials permission in school.

    Permission hierarchy:
    - org_owner/org_admin: Always has permission
    - school_admin: Always has permission
    - school_director: Always has permission
    - teacher: No permission (only view)
    """
    # Check organization-level access first (org_owner/org_admin)
    school = db.query(School).filter(School.id == school_id).first()
    if school:
        org_membership = (
            db.query(TeacherOrganization)
            .filter(
                TeacherOrganization.teacher_id == teacher_id,
                TeacherOrganization.organization_id == school.organization_id,
                TeacherOrganization.is_active.is_(True),
            )
            .first()
        )

        if org_membership and org_membership.role in ["org_owner", "org_admin"]:
            return True

    # Check if teacher is member of school
    membership = (
        db.query(TeacherSchool)
        .filter(
            TeacherSchool.teacher_id == teacher_id,
            TeacherSchool.school_id == school_id,
            TeacherSchool.is_active.is_(True),
        )
        .first()
    )

    if not membership:
        return False

    # school_admin and school_director have permission
    if membership.roles and any(
        r in ["school_admin", "school_director"] for r in membership.roles
    ):
        return True

    # For others, check Casbin permission
    casbin = get_casbin_service()
    has_permission = casbin.check_permission(
        teacher_id=teacher_id,
        domain=f"school-{school_id}",
        resource="manage_materials",
        action="write",
    )

    return has_permission


def deep_copy_program(
    source_program: Program,
    target_classroom_id: int,
    target_teacher_id: int,
    school: School,
    db: Session,
) -> Program:
    """
    Deep copy program with lessons, contents, and items.

    Sets source_metadata to track origin.
    """
    # Create new program
    new_program = Program(
        name=source_program.name,
        description=source_program.description,
        level=source_program.level,
        is_template=False,  # Classroom programs are not templates
        classroom_id=target_classroom_id,
        teacher_id=target_teacher_id,
        estimated_hours=source_program.estimated_hours,
        order_index=source_program.order_index,
        tags=source_program.tags,
        is_active=True,
        source_metadata={
            "school_id": str(school.id),
            "school_name": school.name,
            "program_id": source_program.id,
            "program_name": source_program.name,
            "source_type": "school_template",
        },
    )
    db.add(new_program)
    db.flush()

    # Deep copy lessons
    for lesson in source_program.lessons:
        new_lesson = Lesson(
            program_id=new_program.id,
            name=lesson.name,
            description=lesson.description,
            order_index=lesson.order_index,
            estimated_minutes=lesson.estimated_minutes,
            is_active=lesson.is_active,
        )
        db.add(new_lesson)
        db.flush()

        # Deep copy contents
        for content in lesson.contents:
            new_content = Content(
                lesson_id=new_lesson.id,
                type=content.type,
                title=content.title,
                order_index=content.order_index,
                is_active=content.is_active,
                target_wpm=content.target_wpm,
                target_accuracy=content.target_accuracy,
                time_limit_seconds=content.time_limit_seconds,
                level=content.level,
                tags=content.tags,
                is_public=content.is_public,
            )
            db.add(new_content)
            db.flush()

            # Deep copy content items
            for item in content.content_items:
                new_item = ContentItem(
                    content_id=new_content.id,
                    order_index=item.order_index,
                    text=item.text,
                    translation=item.translation,
                    audio_url=item.audio_url,
                    item_metadata=item.item_metadata,
                )
                db.add(new_item)

    db.flush()
    return new_program


# ============ Endpoints ============


@router.get("/{school_id}/programs", response_model=List[ProgramResponse])
async def list_school_materials(
    school_id: uuid.UUID,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    List all active school materials (templates).

    Permission: school member OR org_owner/org_admin of the school's organization
    """
    # Check access permission
    if not check_school_access(current_teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this school",
        )

    # Query school materials
    programs = (
        db.query(Program)
        .options(
            joinedload(Program.lessons)
            .joinedload(Lesson.contents)
            .joinedload(Content.content_items)
        )
        .filter(
            Program.is_template.is_(True),
            Program.is_active.is_(True),
            Program.school_id == school_id,
        )
        .offset(skip)
        .limit(limit)
        .all()
    )

    # Convert to response models
    result = []
    for program in programs:
        program_data = ProgramResponse.model_validate(program)
        program_data.lessons = []

        for lesson in sorted(program.lessons, key=lambda x: x.order_index):
            lesson_data = LessonResponse.model_validate(lesson)
            lesson_data.contents = []

            for content in sorted(lesson.contents, key=lambda x: x.order_index):
                content_data = ContentResponse.model_validate(content)
                content_data.items = [
                    ContentItemResponse.model_validate(item)
                    for item in sorted(
                        content.content_items, key=lambda x: x.order_index
                    )
                ]
                lesson_data.contents.append(content_data)

            program_data.lessons.append(lesson_data)

        result.append(program_data)

    return result


@router.get("/{school_id}/programs/{program_id}", response_model=ProgramResponse)
async def get_school_material_details(
    school_id: uuid.UUID,
    program_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    Get school material details with full hierarchy.

    Permission: school member OR org_owner/org_admin
    """
    # Check access permission
    if not check_school_access(current_teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this school",
        )

    # Get program with hierarchy
    program = (
        db.query(Program)
        .options(
            joinedload(Program.lessons)
            .joinedload(Lesson.contents)
            .joinedload(Content.content_items)
        )
        .filter(Program.id == program_id)
        .first()
    )

    if not program:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material not found",
        )

    if program.school_id != school_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material not found or doesn't belong to school",
        )

    # Build response
    program_data = ProgramResponse.model_validate(program)
    program_data.lessons = []

    for lesson in sorted(program.lessons, key=lambda x: x.order_index):
        lesson_data = LessonResponse.model_validate(lesson)
        lesson_data.contents = []

        for content in sorted(lesson.contents, key=lambda x: x.order_index):
            content_data = ContentResponse.model_validate(content)
            content_data.items = [
                ContentItemResponse.model_validate(item)
                for item in sorted(content.content_items, key=lambda x: x.order_index)
            ]
            lesson_data.contents.append(content_data)

        program_data.lessons.append(lesson_data)

    return program_data


@router.post("/{school_id}/programs", response_model=ProgramResponse, status_code=201)
async def create_school_material(
    school_id: uuid.UUID,
    payload: ProgramCreateRequest,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    Create school material (template).

    Permission: school_admin or school_director
    """
    # Check permission
    if not check_manage_materials_permission(current_teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No permission to create school materials",
        )

    # Verify school exists
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="School not found"
        )

    # Create program
    program = Program(
        name=payload.name,
        description=payload.description,
        is_template=True,
        classroom_id=None,
        teacher_id=current_teacher.id,
        school_id=school_id,
        is_active=True,
        source_metadata={
            "created_by": current_teacher.id,
        },
    )

    db.add(program)
    db.commit()
    db.refresh(program)

    return ProgramResponse.model_validate(program)


@router.put("/{school_id}/programs/{program_id}", response_model=ProgramResponse)
async def update_school_material(
    school_id: uuid.UUID,
    program_id: int,
    payload: ProgramUpdateRequest,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    Update school material.

    Permission: school_admin or school_director
    """
    # Check permission
    if not check_manage_materials_permission(current_teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No permission to update school materials",
        )

    # Get program
    program = db.query(Program).filter(Program.id == program_id).first()

    if not program:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material not found",
        )

    if program.school_id != school_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material not found or doesn't belong to school",
        )

    # Update fields
    if payload.name is not None:
        program.name = payload.name

    if payload.description is not None:
        program.description = payload.description

    db.commit()
    db.refresh(program)

    return ProgramResponse.model_validate(program)


@router.delete("/{school_id}/programs/{program_id}")
async def soft_delete_school_material(
    school_id: uuid.UUID,
    program_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    Soft delete school material.

    Permission: school_admin or school_director
    """
    # Check permission
    if not check_manage_materials_permission(current_teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No permission to delete school materials",
        )

    # Get program
    program = db.query(Program).filter(Program.id == program_id).first()

    if not program:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material not found",
        )

    if program.school_id != school_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material not found or doesn't belong to school",
        )

    # Soft delete
    program.is_active = False
    program.deleted_at = datetime.now(timezone.utc)

    db.commit()

    return {"message": "Material soft deleted successfully", "program_id": program_id}


# ============ Lesson CRUD ============


@router.post("/{school_id}/programs/{program_id}/lessons")
async def create_school_lesson(
    school_id: uuid.UUID,
    program_id: int,
    lesson_data: LessonCreate,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """Create a new lesson in a school program."""
    # Check access
    if not check_school_access(current_teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this school",
        )

    # Check permission
    if not check_manage_materials_permission(current_teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to manage materials",
        )

    # Verify program exists and belongs to school
    program = (
        db.query(Program)
        .filter(
            Program.id == program_id,
            Program.school_id == school_id,
            Program.is_active.is_(True),
        )
        .first()
    )

    if not program:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Program not found",
        )

    lesson = Lesson(
        program_id=program_id,
        name=lesson_data.name,
        description=lesson_data.description,
        order_index=lesson_data.order_index or 1,
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


@router.put("/{school_id}/programs/lessons/{lesson_id}")
async def update_school_lesson(
    school_id: uuid.UUID,
    lesson_id: int,
    lesson_data: LessonCreate,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """Update a lesson in a school program."""
    # Check access
    if not check_school_access(current_teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this school",
        )

    # Check permission
    if not check_manage_materials_permission(current_teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to manage materials",
        )

    # Verify lesson exists and belongs to a program in this school
    lesson = (
        db.query(Lesson)
        .join(Program)
        .filter(
            Lesson.id == lesson_id,
            Program.school_id == school_id,
            Program.is_active.is_(True),
        )
        .first()
    )

    if not lesson:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lesson not found",
        )

    lesson.name = lesson_data.name
    lesson.description = lesson_data.description
    if lesson_data.order_index:
        lesson.order_index = lesson_data.order_index
    if lesson_data.estimated_minutes:
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


@router.delete("/{school_id}/programs/lessons/{lesson_id}")
async def delete_school_lesson(
    school_id: uuid.UUID,
    lesson_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """Delete a lesson from a school program."""
    # Check access
    if not check_school_access(current_teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this school",
        )

    # Check permission
    if not check_manage_materials_permission(current_teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to manage materials",
        )

    # Verify lesson exists and belongs to a program in this school
    lesson = (
        db.query(Lesson)
        .join(Program)
        .filter(
            Lesson.id == lesson_id,
            Program.school_id == school_id,
            Program.is_active.is_(True),
        )
        .first()
    )

    if not lesson:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lesson not found",
        )

    db.delete(lesson)
    db.commit()

    return {"message": "Lesson deleted successfully", "lesson_id": lesson_id}


# ============ Content CRUD ============


@router.delete("/{school_id}/programs/contents/{content_id}")
async def delete_school_content(
    school_id: uuid.UUID,
    content_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """Delete a content from a school program."""
    # Check permission
    if not check_manage_materials_permission(current_teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No permission to manage materials",
        )

    # Find content and verify it belongs to this school
    content = (
        db.query(Content)
        .join(Lesson)
        .join(Program)
        .filter(
            Content.id == content_id,
            Program.school_id == school_id,
            Program.is_active.is_(True),
        )
        .first()
    )

    if not content:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Content not found",
        )

    db.delete(content)
    db.commit()

    return {"message": "Content deleted successfully", "content_id": content_id}


@router.post(
    "/{school_id}/programs/{program_id}/copy-to-classroom",
    response_model=ProgramResponse,
    status_code=201,
)
async def copy_material_to_classroom(
    school_id: uuid.UUID,
    program_id: int,
    payload: CopyToClassroomRequest,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    Deep copy school material to classroom.

    Permission: Teacher must be member of school and own the classroom
    """
    # Verify school exists
    school = (
        db.query(School)
        .filter(School.id == school_id, School.is_active.is_(True))
        .first()
    )

    if not school:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="School not found"
        )

    # Verify teacher is member of school
    membership = (
        db.query(TeacherSchool)
        .filter(
            TeacherSchool.teacher_id == current_teacher.id,
            TeacherSchool.school_id == school_id,
            TeacherSchool.is_active.is_(True),
        )
        .first()
    )

    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this school",
        )

    # Verify source program exists
    source_program = (
        db.query(Program)
        .options(
            joinedload(Program.lessons)
            .joinedload(Lesson.contents)
            .joinedload(Content.content_items)
        )
        .filter(Program.id == program_id, Program.is_template.is_(True))
        .first()
    )

    if not source_program:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source material not found",
        )

    if source_program.school_id != school_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source material not found or doesn't belong to school",
        )

    # Verify classroom exists and belongs to school
    from utils.permissions import check_classroom_in_school
    from models import ClassroomSchool

    classroom = db.query(Classroom).filter(Classroom.id == payload.classroom_id).first()

    if not classroom:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Classroom not found"
        )

    # Verify classroom belongs to school
    if not check_classroom_in_school(payload.classroom_id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Classroom not found in this school",
        )

    if classroom.teacher_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Classroom has no assigned teacher",
        )

    # Allow if teacher owns classroom OR has school management permission
    from utils.permissions import has_school_materials_permission

    if classroom.teacher_id != current_teacher.id:
        # Check if teacher has school management permission
        if not has_school_materials_permission(current_teacher.id, school_id, db):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not the teacher of this classroom and do not have school management permission",
            )

    # Deep copy
    try:
        new_program = deep_copy_program(
            source_program=source_program,
            target_classroom_id=payload.classroom_id,
            target_teacher_id=current_teacher.id,
            school=school,
            db=db,
        )

        db.commit()
        db.refresh(new_program)

        # Load full hierarchy for response
        new_program = (
            db.query(Program)
            .options(
                joinedload(Program.lessons)
                .joinedload(Lesson.contents)
                .joinedload(Content.content_items)
            )
            .filter(Program.id == new_program.id)
            .first()
        )

    except Exception as e:
        db.rollback()
        logger.error(
            f"Failed to copy material {program_id} to classroom {payload.classroom_id}: {str(e)}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to copy material: {str(e)}",
        )

    # Build response
    program_data = ProgramResponse.model_validate(new_program)
    program_data.lessons = []

    for lesson in sorted(new_program.lessons, key=lambda x: x.order_index):
        lesson_data = LessonResponse.model_validate(lesson)
        lesson_data.contents = []

        for content in sorted(lesson.contents, key=lambda x: x.order_index):
            content_data = ContentResponse.model_validate(content)
            content_data.items = [
                ContentItemResponse.model_validate(item)
                for item in sorted(content.content_items, key=lambda x: x.order_index)
            ]
            lesson_data.contents.append(content_data)

        program_data.lessons.append(lesson_data)

    return program_data
