"""
Program Service Layer

Unified business logic for Program/Lesson/Content operations
Supporting both teacher-scoped and organization-scoped materials.

Service Architecture:
- Permission checking abstracted from routers
- Automatic scope detection (teacher vs organization)
- Reusable CRUD operations
"""

from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy import func
from typing import List, Optional, Dict, Any
import uuid
import logging
from datetime import datetime, timezone
from copy import deepcopy

from models import (
    Program,
    Lesson,
    Content,
    ContentItem,
    Teacher,
    Organization,
    Classroom,
)
from utils.permissions import (
    has_manage_materials_permission,
    has_read_org_materials_permission,
    has_school_materials_permission,
    has_program_permission,
    has_lesson_permission,
    has_content_permission,
)

logger = logging.getLogger(__name__)


def _copy_content_with_items(
    content: Content, new_lesson_id: int, db: Session
) -> Content:
    """Deep copy a content record with its content items."""
    new_content = Content(
        lesson_id=new_lesson_id,
        title=content.title,
        type=content.type,
        level=content.level if hasattr(content, "level") else "A1",
        tags=content.tags.copy() if hasattr(content, "tags") and content.tags else [],
        is_public=content.is_public if hasattr(content, "is_public") else False,
        target_wpm=content.target_wpm if hasattr(content, "target_wpm") else None,
        target_accuracy=content.target_accuracy
        if hasattr(content, "target_accuracy")
        else None,
        time_limit_seconds=content.time_limit_seconds
        if hasattr(content, "time_limit_seconds")
        else None,
        order_index=content.order_index if hasattr(content, "order_index") else 0,
        is_active=content.is_active,
    )
    db.add(new_content)
    db.flush()

    for original_item in content.content_items:
        item_copy = ContentItem(
            content_id=new_content.id,
            order_index=original_item.order_index,
            text=original_item.text,
            translation=original_item.translation
            if hasattr(original_item, "translation")
            else None,
            audio_url=original_item.audio_url
            if hasattr(original_item, "audio_url")
            else None,
            # Example sentence fields
            example_sentence=original_item.example_sentence
            if hasattr(original_item, "example_sentence")
            else None,
            example_sentence_translation=original_item.example_sentence_translation
            if hasattr(original_item, "example_sentence_translation")
            else None,
            example_sentence_definition=original_item.example_sentence_definition
            if hasattr(original_item, "example_sentence_definition")
            else None,
            # Sentence assembly fields
            word_count=original_item.word_count
            if hasattr(original_item, "word_count")
            else None,
            max_errors=original_item.max_errors
            if hasattr(original_item, "max_errors")
            else None,
            # Vocabulary set fields
            image_url=original_item.image_url
            if hasattr(original_item, "image_url")
            else None,
            part_of_speech=original_item.part_of_speech
            if hasattr(original_item, "part_of_speech")
            else None,
            distractors=deepcopy(original_item.distractors)
            if hasattr(original_item, "distractors") and original_item.distractors
            else None,
            item_metadata=deepcopy(original_item.item_metadata)
            if hasattr(original_item, "item_metadata") and original_item.item_metadata
            else {},
        )
        db.add(item_copy)

    return new_content


def copy_program_tree(
    source_program: Program,
    target_classroom: Classroom,
    target_teacher_id: int,
    db: Session,
    source_type: str,
    source_metadata: Dict[str, Any],
    name: Optional[str] = None,
) -> Program:
    """Deep copy program tree (Program → Lesson → Content → Item) to classroom."""
    new_program = Program(
        name=name or source_program.name,
        description=source_program.description,
        level=source_program.level,
        is_template=False,
        classroom_id=target_classroom.id,
        teacher_id=target_teacher_id,
        estimated_hours=source_program.estimated_hours,
        order_index=source_program.order_index,
        tags=source_program.tags,
        source_type=source_type,
        source_metadata=source_metadata,
        is_active=True,
    )
    db.add(new_program)
    db.flush()

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
        db.flush()

        for content in lesson.contents:
            if hasattr(content, "is_active") and not content.is_active:
                continue

            if hasattr(content, "is_assignment_copy") and content.is_assignment_copy:
                continue

            _copy_content_with_items(content, new_lesson.id, db)

    db.flush()
    return new_program


def copy_program_tree_to_template(
    source_program: Program,
    target_teacher_id: int,
    db: Session,
    source_type: str,
    source_metadata: Dict[str, Any],
    name: Optional[str] = None,
    target_school_id: Optional[uuid.UUID] = None,
    target_organization_id: Optional[uuid.UUID] = None,
) -> Program:
    """Deep copy program tree into a template (teacher, school, or organization owned)."""
    new_program = Program(
        name=name or source_program.name,
        description=source_program.description,
        level=source_program.level,
        is_template=True,
        classroom_id=None,
        teacher_id=target_teacher_id,
        organization_id=target_organization_id,
        school_id=target_school_id,
        estimated_hours=source_program.estimated_hours,
        order_index=source_program.order_index,
        tags=source_program.tags,
        source_type=source_type,
        source_metadata=source_metadata,
        is_active=True,
    )
    db.add(new_program)
    db.flush()

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
        db.flush()

        for content in lesson.contents:
            if hasattr(content, "is_active") and not content.is_active:
                continue

            if hasattr(content, "is_assignment_copy") and content.is_assignment_copy:
                continue

            _copy_content_with_items(content, new_lesson.id, db)

    db.flush()
    return new_program


# ============================================================================
# Program CRUD
# ============================================================================


def get_programs_by_scope(
    scope: str,
    teacher_id: int,
    db: Session,
    organization_id: Optional[uuid.UUID] = None,
    school_id: Optional[uuid.UUID] = None,
    include_inactive: bool = False,
) -> List[Program]:
    """
    Get programs based on scope (teacher, organization, or school).

    Args:
        scope: 'teacher', 'organization', or 'school'
        teacher_id: Current teacher ID
        db: Database session
        organization_id: Required if scope='organization'
        school_id: Required if scope='school'
        include_inactive: Include soft-deleted programs

    Returns:
        List of programs with full hierarchy
    """
    # Filter lessons and contents by is_active
    lessons_filter = Lesson.is_active.is_(True) if not include_inactive else True
    contents_filter = Content.is_active.is_(True) if not include_inactive else True

    query = db.query(Program).options(
        joinedload(Program.lessons.and_(lessons_filter))
        .joinedload(Lesson.contents.and_(contents_filter))
        .joinedload(Content.content_items)
    )

    if scope == "teacher":
        # Teacher-owned programs (personal materials)
        query = query.filter(
            Program.teacher_id == teacher_id,
            Program.organization_id.is_(None),
            Program.is_template.is_(True),
        )
    elif scope == "organization":
        if not organization_id:
            raise ValueError("organization_id required for organization scope")

        # Check permission first (read-only: any active member can access)
        if not has_read_org_materials_permission(teacher_id, organization_id, db):
            raise PermissionError("No permission to access organization materials")

        # Organization-owned programs
        query = query.filter(
            Program.organization_id == organization_id,
            Program.is_template.is_(True),
        )
    elif scope == "school":
        if not school_id:
            raise ValueError("school_id required for school scope")

        # Check permission using centralized helper
        if not has_school_materials_permission(teacher_id, school_id, db):
            raise PermissionError("No permission to access school materials")

        # School-owned programs
        query = query.filter(
            Program.school_id == school_id,
            Program.is_template.is_(True),
        )
    else:
        raise ValueError(
            f"Invalid scope: {scope}. Must be 'teacher', 'organization', or 'school'"
        )

    if not include_inactive:
        query = query.filter(Program.is_active.is_(True))

    return query.all()


def create_program(
    scope: str,
    teacher_id: int,
    data: Dict[str, Any],
    db: Session,
    organization_id: Optional[uuid.UUID] = None,
    school_id: Optional[uuid.UUID] = None,
) -> Program:
    """
    Create a new program.

    Args:
        scope: 'teacher', 'organization', or 'school'
        teacher_id: Creator teacher ID
        data: Program data (name, description, etc.)
        db: Database session
        organization_id: Required if scope='organization'
        school_id: Required if scope='school'

    Returns:
        Created program
    """
    if scope == "organization":
        if not organization_id:
            raise ValueError("organization_id required for organization scope")

        # Check permission
        if not has_manage_materials_permission(teacher_id, organization_id, db):
            raise PermissionError("No permission to create organization materials")

        # Verify organization exists
        org = db.query(Organization).filter(Organization.id == organization_id).first()
        if not org:
            raise ValueError("Organization not found")

        # Calculate next order_index (put at end)
        max_order = (
            db.query(func.max(Program.order_index))
            .filter(
                Program.organization_id == organization_id,
                Program.is_template.is_(True),
                Program.is_active.is_(True),
            )
            .scalar()
            or 0
        )

        program = Program(
            name=data["name"],
            description=data.get("description"),
            level=data.get("level"),
            estimated_hours=data.get("estimated_hours"),
            tags=data.get("tags"),
            is_template=True,
            teacher_id=teacher_id,
            organization_id=organization_id,
            classroom_id=None,
            is_active=True,
            order_index=max_order + 1,
            source_metadata={"created_by": teacher_id},
        )
    elif scope == "school":
        if not school_id:
            raise ValueError("school_id required for school scope")

        # Check permission using centralized helper
        if not has_school_materials_permission(teacher_id, school_id, db):
            raise PermissionError("No permission to create school materials")

        # Get school to set organization_id
        from models import School

        school = db.query(School).filter(School.id == school_id).first()
        if not school:
            raise ValueError("School not found")

        # Calculate next order_index (put at end)
        max_order = (
            db.query(func.max(Program.order_index))
            .filter(
                Program.school_id == school_id,
                Program.is_template.is_(True),
                Program.is_active.is_(True),
            )
            .scalar()
            or 0
        )

        program = Program(
            name=data["name"],
            description=data.get("description"),
            level=data.get("level"),
            estimated_hours=data.get("estimated_hours"),
            tags=data.get("tags"),
            is_template=True,
            teacher_id=teacher_id,
            school_id=school_id,
            organization_id=school.organization_id,
            classroom_id=None,
            is_active=True,
            order_index=max_order + 1,
            source_metadata={"created_by": teacher_id},
        )
    elif scope == "teacher":
        # Calculate next order_index (put at end)
        max_order = (
            db.query(func.max(Program.order_index))
            .filter(
                Program.teacher_id == teacher_id,
                Program.is_template.is_(True),
                Program.is_active.is_(True),
                Program.organization_id.is_(None),
            )
            .scalar()
            or 0
        )

        program = Program(
            name=data["name"],
            description=data.get("description"),
            level=data.get("level"),
            estimated_hours=data.get("estimated_hours"),
            tags=data.get("tags"),
            is_template=True,
            teacher_id=teacher_id,
            organization_id=None,
            classroom_id=None,
            is_active=True,
            order_index=max_order + 1,
        )
    else:
        raise ValueError(f"Invalid scope: {scope}")

    db.add(program)
    db.commit()
    db.refresh(program)

    return program


def update_program(
    program_id: int, teacher_id: int, data: Dict[str, Any], db: Session
) -> Program:
    """
    Update program.

    Automatically checks permission based on program scope.
    """
    program = db.query(Program).filter(Program.id == program_id).first()
    if not program:
        raise ValueError("Program not found")

    # Check permission
    if not has_program_permission(db, program_id, teacher_id, "write"):
        raise PermissionError("No permission to update this program")

    # Update fields
    if "name" in data:
        program.name = data["name"]
    if "description" in data:
        program.description = data["description"]

    db.commit()
    db.refresh(program)

    return program


def delete_program(program_id: int, teacher_id: int, db: Session) -> Dict[str, Any]:
    """
    Soft delete program.

    Automatically checks permission based on program scope.
    """
    program = db.query(Program).filter(Program.id == program_id).first()
    if not program:
        raise ValueError("Program not found")

    # Check permission
    if not has_program_permission(db, program_id, teacher_id, "write"):
        raise PermissionError("No permission to delete this program")

    # Soft delete
    program.is_active = False
    program.deleted_at = datetime.now(timezone.utc)

    db.commit()

    return {"message": "Program soft deleted successfully", "program_id": program_id}


# ============================================================================
# Lesson CRUD
# ============================================================================


def create_lesson(
    program_id: int, teacher_id: int, data: Dict[str, Any], db: Session
) -> Lesson:
    """
    Create lesson in program.

    Automatically checks program permission.
    """
    logger.info(
        f"[SERVICE_CREATE_LESSON] Called with program_id={program_id}, teacher_id={teacher_id}, data={data}"
    )

    # Check program permission
    if not has_program_permission(db, program_id, teacher_id, "write"):
        logger.error(
            f"[SERVICE_CREATE_LESSON] Permission denied for teacher_id={teacher_id}, program_id={program_id}"
        )
        raise PermissionError("No permission to create lessons in this program")

    logger.info(
        f"[SERVICE_CREATE_LESSON] Permission check passed. Creating lesson object..."
    )

    # Calculate next order_index (put at end)
    max_order = (
        db.query(func.max(Lesson.order_index))
        .filter(Lesson.program_id == program_id, Lesson.is_active.is_(True))
        .scalar()
        or 0
    )

    lesson = Lesson(
        program_id=program_id,
        name=data["name"],
        description=data.get("description"),
        order_index=max_order + 1,
        estimated_minutes=data.get("estimated_minutes"),
        is_active=True,
    )

    logger.info(
        f"[SERVICE_CREATE_LESSON] Lesson object created (not yet added to DB): name={lesson.name}"
    )

    db.add(lesson)
    logger.info(f"[SERVICE_CREATE_LESSON] db.add() called")

    db.commit()
    logger.info(f"[SERVICE_CREATE_LESSON] db.commit() called")

    db.refresh(lesson)
    logger.info(
        f"[SERVICE_CREATE_LESSON] db.refresh() called. Final lesson_id={lesson.id}, name={lesson.name}"
    )

    # Post-commit verification
    duplicate_count = (
        db.query(Lesson)
        .filter(
            Lesson.program_id == program_id,
            Lesson.name == lesson.name,
            Lesson.is_active.is_(True),
        )
        .count()
    )
    logger.info(
        f"[SERVICE_CREATE_LESSON] Post-commit check: Found {duplicate_count} lessons "
        f"with name '{lesson.name}' in program {program_id}"
    )

    if duplicate_count > 1:
        logger.error(
            f"[SERVICE_CREATE_LESSON] !!!! DUPLICATE DETECTED !!!! {duplicate_count} lessons found"
        )

    return lesson


def update_lesson(
    lesson_id: int, teacher_id: int, data: Dict[str, Any], db: Session
) -> Lesson:
    """
    Update lesson.

    Automatically checks lesson->program permission chain.
    """
    lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if not lesson:
        raise ValueError("Lesson not found")

    # Check permission via program
    if not has_lesson_permission(db, lesson_id, teacher_id, "write"):
        raise PermissionError("No permission to update this lesson")

    # Update fields
    if "name" in data:
        lesson.name = data["name"]
    if "description" in data:
        lesson.description = data["description"]
    if "order_index" in data:
        lesson.order_index = data["order_index"]

    db.commit()
    db.refresh(lesson)

    return lesson


def delete_lesson(lesson_id: int, teacher_id: int, db: Session) -> Dict[str, Any]:
    """
    Soft delete lesson.

    Automatically checks lesson->program permission chain.
    """
    lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if not lesson:
        raise ValueError("Lesson not found")

    # Check permission via program
    if not has_lesson_permission(db, lesson_id, teacher_id, "write"):
        raise PermissionError("No permission to delete this lesson")

    # Soft delete
    lesson.is_active = False

    db.commit()

    return {"message": "Lesson soft deleted successfully", "lesson_id": lesson_id}


# ============================================================================
# Content CRUD
# ============================================================================


def create_content(
    lesson_id: int, teacher_id: int, data: Dict[str, Any], db: Session
) -> Content:
    """
    Create content in lesson.

    Automatically checks lesson->program permission chain.
    """
    # Check permission via lesson->program chain
    if not has_lesson_permission(db, lesson_id, teacher_id, "write"):
        raise PermissionError("No permission to create contents in this lesson")

    # Calculate next order_index (put at end)
    max_order = (
        db.query(func.max(Content.order_index))
        .filter(Content.lesson_id == lesson_id, Content.is_active.is_(True))
        .scalar()
        or 0
    )

    content = Content(
        lesson_id=lesson_id,
        type=data["type"],
        title=data["title"],
        order_index=max_order + 1,
        is_active=True,
    )

    db.add(content)
    db.commit()
    db.refresh(content)

    return content


def delete_content(content_id: int, teacher_id: int, db: Session) -> Dict[str, Any]:
    """
    Soft delete content.

    Automatically checks content->lesson->program permission chain.
    """
    content = db.query(Content).filter(Content.id == content_id).first()
    if not content:
        raise ValueError("Content not found")

    # Check permission via content->lesson->program chain
    if not has_content_permission(db, content_id, teacher_id, "write"):
        raise PermissionError("No permission to delete this content")

    # Soft delete
    content.is_active = False

    db.commit()

    return {"message": "Content soft deleted successfully", "content_id": content_id}
