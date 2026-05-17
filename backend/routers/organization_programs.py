"""
Organization Programs Router

Manages organization-level materials (templates) with deep copy functionality.

Endpoints:
1. GET /{org_id}/programs - List organization materials
2. GET /{org_id}/programs/{program_id} - Get material details with hierarchy
3. POST /{org_id}/programs - Create organization material
4. PUT /{org_id}/programs/{program_id} - Update organization material
5. DELETE /{org_id}/programs/{program_id} - Soft delete material
6. POST /{org_id}/programs/{program_id}/copy-to-classroom - Deep copy to classroom
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel, Field, computed_field, field_serializer, model_validator
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import logging

from database import get_db
from models import (
    Teacher,
    Organization,
    TeacherOrganization,
    Program,
    Lesson,
    Content,
    ContentItem,
    Classroom,
    School,
    ClassroomSchool,
)
from models.program import ProgramCopyLog
from routers.teachers import get_current_teacher
from utils.permissions import (
    has_read_org_materials_permission,
    has_manage_materials_permission,
)

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/api/organizations", tags=["organization-programs"])


# ============ Request/Response Models ============


class ProgramCreateRequest(BaseModel):
    """Request model for creating organization material"""

    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None


class ProgramUpdateRequest(BaseModel):
    """Request model for updating organization material"""

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
    image_url: Optional[str] = None

    class Config:
        from_attributes = True


class ContentResponse(BaseModel):
    """Response model for content"""

    id: int
    lesson_id: int
    type: str
    title: str
    order_index: int
    is_active: bool
    items: List[ContentItemResponse] = []

    @computed_field
    @property
    def items_count(self) -> int:
        return len(self.items)

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
    organization_id: Optional[str]  # UUID as string
    visibility: Optional[str] = "private"
    source_metadata: Optional[dict]
    lessons: List[LessonResponse] = []

    @model_validator(mode="before")
    @classmethod
    def convert_uuid_fields(cls, data):
        """Convert UUID fields to strings before validation"""
        if hasattr(data, "organization_id") and data.organization_id is not None:
            # Handle SQLAlchemy model
            if not isinstance(data.organization_id, str):
                object.__setattr__(data, "organization_id", str(data.organization_id))
        elif isinstance(data, dict) and "organization_id" in data:
            # Handle dict
            if data["organization_id"] is not None and not isinstance(
                data["organization_id"], str
            ):
                data["organization_id"] = str(data["organization_id"])
        return data

    class Config:
        from_attributes = True


# ============ Helper Functions ============


def get_organization_programs(
    org_id: uuid.UUID, db: Session, include_inactive: bool = False
) -> List[Program]:
    """
    Get all programs belonging to organization.

    Programs are identified by organization_id column (NOT source_metadata).
    """
    query = db.query(Program).filter(
        Program.organization_id == org_id,
        Program.is_template.is_(True),
    )

    if not include_inactive:
        query = query.filter(Program.is_active.is_(True))

    return query.all()


def deep_copy_program(
    source_program: Program,
    target_classroom_id: int,
    target_teacher_id: int,
    organization: Organization,
    db: Session,
) -> Program:
    """
    Deep copy program with lessons, contents, and items.

    Uses the canonical _copy_content_with_items from program_service to ensure
    all fields (including Phase 2 vocabulary fields) are copied correctly.
    Sets source_metadata to track origin.

    IMPORTANT: This function calls db.flush() but does NOT commit.
    Caller must wrap in try/except with db.rollback() on failure.
    """
    from services.program_service import _copy_content_with_items

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
            "organization_id": str(organization.id),
            "organization_name": organization.display_name or organization.name,
            "program_id": source_program.id,
            "program_name": source_program.name,
            "source_type": "org_template",
        },
    )
    db.add(new_program)
    db.flush()  # Get new_program.id

    # Deep copy lessons
    for lesson in source_program.lessons:
        if not lesson.is_active:
            continue

        new_lesson = Lesson(
            program_id=new_program.id,
            name=lesson.name,
            description=lesson.description,
            order_index=lesson.order_index,
            estimated_minutes=lesson.estimated_minutes,
            is_active=lesson.is_active,
        )
        db.add(new_lesson)
        db.flush()  # Get new_lesson.id

        # Deep copy contents using canonical helper (includes all Phase 2 fields)
        for content in lesson.contents:
            if hasattr(content, "is_active") and not content.is_active:
                continue
            _copy_content_with_items(content, new_lesson.id, db)

    db.flush()
    return new_program


# ============ Endpoints ============


@router.get("/{org_id}/programs", response_model=List[ProgramResponse])
async def list_organization_materials(
    org_id: uuid.UUID,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    List all active organization materials (templates).

    Permission: any active organization member

    Performance: Uses organization_id column (NOT source_metadata JSON)
    for efficient SQL filtering instead of loading all programs.
    """
    # Check permission
    if not has_read_org_materials_permission(current_teacher.id, org_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this organization",
        )

    # Query organization materials using SQL filter (NOT Python filter)
    # Uses organization_id column for organization-owned materials
    # (source_metadata is for classroom copies tracking origin)
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
            Program.organization_id == org_id,  # Direct column filter
        )
        .offset(skip)
        .limit(limit)
        .all()
    )

    # Convert to response models
    result = []
    for program in programs:
        program_data = ProgramResponse.model_validate(program)

        # Build lessons hierarchy (filter inactive)
        program_data.lessons = []
        for lesson in program.lessons:
            if hasattr(lesson, "is_active") and not lesson.is_active:
                continue
            lesson_data = LessonResponse.model_validate(lesson)

            # Build contents hierarchy (filter inactive)
            lesson_data.contents = []
            for content in lesson.contents:
                if hasattr(content, "is_active") and not content.is_active:
                    continue
                content_data = ContentResponse.model_validate(content)

                # Build items
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


@router.get("/{org_id}/programs/{program_id}", response_model=ProgramResponse)
async def get_organization_material_details(
    org_id: uuid.UUID,
    program_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    Get organization material details with full hierarchy.

    Permission: any active organization member
    Returns: Program with lessons → contents → items
    """
    # Check permission
    if not has_read_org_materials_permission(current_teacher.id, org_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this organization",
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

    # Verify program belongs to organization (using column, not JSON)
    if program.organization_id != org_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material not found or doesn't belong to organization",
        )

    # Build response with hierarchy
    program_data = ProgramResponse.model_validate(program)
    program_data.lessons = []

    for lesson in program.lessons:
        if hasattr(lesson, "is_active") and not lesson.is_active:
            continue
        lesson_data = LessonResponse.model_validate(lesson)
        lesson_data.contents = []

        for content in lesson.contents:
            if hasattr(content, "is_active") and not content.is_active:
                continue
            content_data = ContentResponse.model_validate(content)
            content_data.items = [
                ContentItemResponse.model_validate(item)
                for item in sorted(content.content_items, key=lambda x: x.order_index)
            ]
            lesson_data.contents.append(content_data)

        program_data.lessons.append(lesson_data)

    return program_data


@router.post("/{org_id}/programs", response_model=ProgramResponse, status_code=201)
async def create_organization_material(
    org_id: uuid.UUID,
    payload: ProgramCreateRequest,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    Create organization material (template).

    Permission: org_owner or org_admin with manage_materials
    Auto-set:
    - is_template = True
    - organization_id in source_metadata
    - classroom_id = None
    """
    # Check permission
    if not has_read_org_materials_permission(current_teacher.id, org_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this organization",
        )

    # Verify organization exists and is active
    organization = (
        db.query(Organization)
        .filter(Organization.id == org_id, Organization.is_active.is_(True))
        .first()
    )
    if not organization:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found"
        )

    # Create program
    program = Program(
        name=payload.name,
        description=payload.description,
        is_template=True,  # Force to True for organization materials
        classroom_id=None,  # Organization materials are not classroom-specific
        teacher_id=current_teacher.id,
        organization_id=org_id,  # Use column for organization ownership
        is_active=True,
        source_metadata={
            "created_by": current_teacher.id,
        },
    )

    db.add(program)
    db.commit()
    db.refresh(program)

    return ProgramResponse.model_validate(program)


@router.put("/{org_id}/programs/{program_id}", response_model=ProgramResponse)
async def update_organization_material(
    org_id: uuid.UUID,
    program_id: int,
    payload: ProgramUpdateRequest,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    Update organization material.

    Permission: org_owner or org_admin with manage_materials
    Note: Cannot change organization_id
    """
    # Check permission
    if not has_read_org_materials_permission(current_teacher.id, org_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this organization",
        )

    # Get program
    program = db.query(Program).filter(Program.id == program_id).first()

    if not program:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material not found",
        )

    # Verify program belongs to organization (using column, not JSON)
    if program.organization_id != org_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material not found or doesn't belong to organization",
        )

    # Update fields
    if payload.name is not None:
        program.name = payload.name

    if payload.description is not None:
        program.description = payload.description

    # Ensure organization_id cannot be changed via update
    # (It should remain the same as org_id from URL)
    program.organization_id = org_id

    db.commit()
    db.refresh(program)

    return ProgramResponse.model_validate(program)


@router.delete("/{org_id}/programs/{program_id}")
async def soft_delete_organization_material(
    org_id: uuid.UUID,
    program_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    Soft delete organization material.

    Permission: org_owner or org_admin with manage_materials
    Action: Set is_active = False (NOT hard delete)
    """
    # Check permission
    if not has_read_org_materials_permission(current_teacher.id, org_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this organization",
        )

    # Get program
    program = db.query(Program).filter(Program.id == program_id).first()

    if not program:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material not found",
        )

    # Verify program belongs to organization (using column, not JSON)
    if program.organization_id != org_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material not found or doesn't belong to organization",
        )

    # Soft delete
    program.is_active = False
    program.deleted_at = datetime.now(timezone.utc)

    db.commit()

    return {"message": "Material soft deleted successfully", "program_id": program_id}


@router.post(
    "/{org_id}/programs/{program_id}/copy-to-classroom",
    response_model=ProgramResponse,
    status_code=201,
)
async def copy_material_to_classroom(
    org_id: uuid.UUID,
    program_id: int,
    payload: CopyToClassroomRequest,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    Deep copy organization material to classroom.

    Permission: Teacher must be member of both classroom and organization
    Deep copy: Program → Lessons → Contents → Items
    Sets source_metadata to track origin
    """
    # Verify organization exists
    organization = (
        db.query(Organization)
        .filter(Organization.id == org_id, Organization.is_active.is_(True))
        .first()
    )

    if not organization:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found"
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

    # Verify program belongs to organization
    if source_program.organization_id != org_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source material not found or doesn't belong to organization",
        )

    # Verify classroom exists
    classroom = db.query(Classroom).filter(Classroom.id == payload.classroom_id).first()

    if not classroom:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Classroom not found"
        )

    # Verify classroom belongs to a school under this organization
    classroom_in_org = (
        db.query(ClassroomSchool)
        .join(School, ClassroomSchool.school_id == School.id)
        .filter(
            ClassroomSchool.classroom_id == payload.classroom_id,
            ClassroomSchool.is_active.is_(True),
            School.organization_id == org_id,
            School.is_active.is_(True),
        )
        .first()
    )
    if not classroom_in_org:
        # Also allow if teacher directly owns the classroom (individual teacher context)
        if classroom.teacher_id != current_teacher.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Classroom does not belong to this organization",
            )

    # Verify teacher is member of organization
    if not has_read_org_materials_permission(current_teacher.id, org_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this organization",
        )

    # Verify teacher can access classroom (owns it or has org manage_materials permission)
    if classroom.teacher_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Classroom has no assigned teacher",
        )
    if classroom.teacher_id != current_teacher.id:
        if not has_manage_materials_permission(current_teacher.id, org_id, db):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not the teacher of this classroom and do not have materials management permission",
            )

    # Check daily copy limit per organization
    from services.resource_materials_service import check_copy_limit

    if not check_copy_limit(db, program_id, "organization", str(org_id)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Daily copy limit reached for this material. Please try again tomorrow.",
        )

    # Deep copy program with error handling and rollback
    try:
        new_program = deep_copy_program(
            source_program=source_program,
            target_classroom_id=payload.classroom_id,
            target_teacher_id=current_teacher.id,
            organization=organization,
            db=db,
        )

        # Record copy log for audit/rate-limiting
        copy_log = ProgramCopyLog(
            source_program_id=source_program.id,
            copied_by_type="organization",
            copied_by_id=str(org_id),
            copied_program_id=new_program.id,
        )
        db.add(copy_log)

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
            detail="Failed to copy material. Please try again later.",
        )

    # Build response
    program_data = ProgramResponse.model_validate(new_program)
    program_data.lessons = []

    for lesson in new_program.lessons:
        if hasattr(lesson, "is_active") and not lesson.is_active:
            continue
        lesson_data = LessonResponse.model_validate(lesson)
        lesson_data.contents = []

        for content in lesson.contents:
            if hasattr(content, "is_active") and not content.is_active:
                continue
            content_data = ContentResponse.model_validate(content)
            content_data.items = [
                ContentItemResponse.model_validate(item)
                for item in sorted(content.content_items, key=lambda x: x.order_index)
            ]
            lesson_data.contents.append(content_data)

        program_data.lessons.append(lesson_data)

    return program_data
