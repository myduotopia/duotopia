"""
Assignment Ops operations for teachers.
"""
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
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any

from database import get_db
from models import Teacher, Classroom, Student, Program, Lesson, Content, ContentItem
from models import ClassroomStudent, Assignment, AssignmentContent, ContentType
from models import (
    ProgramLevel,
    TeacherOrganization,
    TeacherSchool,
    Organization,
    School,
)
from .dependencies import get_current_teacher
from .validators import *
from .utils import TEST_SUBSCRIPTION_WHITELIST, parse_birthdate
from services.preview_service import (
    build_assignment_preview,
    assess_speech_preview,
    get_vocabulary_activities,
    get_word_selection_start,
    check_word_selection_answer,
    get_rearrangement_questions,
    check_rearrangement_answer,
    handle_rearrangement_retry,
    handle_rearrangement_complete,
    WordSelectionAnswerRequest,
    RearrangementAnswerRequest,
    RearrangementCompleteRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# Helper: verify teacher owns the assignment
# ============================================================================


def _get_teacher_assignment(
    assignment_id: int, teacher: Teacher, db: Session
) -> Assignment:
    """Return Assignment owned by *teacher*, or raise 404."""
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == teacher.id,
        )
        .first()
    )
    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assignment not found or access denied",
        )
    return assignment


# ============================================================================
# Preview Endpoints — thin wrappers around preview_service
# ============================================================================


@router.get("/assignments/{assignment_id}/preview")
async def get_assignment_preview(
    assignment_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """取得作業的預覽內容（供老師示範用）"""
    assignment = _get_teacher_assignment(assignment_id, current_teacher, db)
    return build_assignment_preview(assignment, db)


@router.post("/assignments/preview/assess-speech")
async def preview_assess_speech(
    audio_file: UploadFile = File(...),
    reference_text: str = Form(...),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """預覽模式專用：評估發音但不存入資料庫"""
    return await assess_speech_preview(audio_file, reference_text)


@router.get("/assignments/{assignment_id}/preview/vocabulary/activities")
async def preview_vocabulary_activities(
    assignment_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Preview mode: Get vocabulary word reading practice data."""
    assignment = _get_teacher_assignment(assignment_id, current_teacher, db)
    return get_vocabulary_activities(assignment, db)


@router.get("/assignments/{assignment_id}/preview/word-selection-start")
async def preview_word_selection_start(
    assignment_id: int,
    exclude_ids: str = Query(
        default="", description="Already-practiced content_item_ids, comma-separated"
    ),
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Preview mode: Get word selection practice data."""
    assignment = _get_teacher_assignment(assignment_id, current_teacher, db)
    return get_word_selection_start(assignment, db, exclude_ids)


@router.post("/assignments/{assignment_id}/preview/word-selection-answer")
async def preview_word_selection_answer(
    assignment_id: int,
    data: WordSelectionAnswerRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Preview mode: Submit word selection answer (not saved)."""
    assignment = _get_teacher_assignment(assignment_id, current_teacher, db)
    return check_word_selection_answer(
        data.content_item_id,
        data.selected_answer,
        assignment,
        db,
    )


@router.get("/assignments/{assignment_id}/preview/rearrangement-questions")
async def preview_rearrangement_questions(
    assignment_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Preview mode: Get rearrangement questions."""
    assignment = _get_teacher_assignment(assignment_id, current_teacher, db)
    return get_rearrangement_questions(assignment, db)


@router.post("/assignments/{assignment_id}/preview/rearrangement-answer")
async def preview_rearrangement_answer(
    assignment_id: int,
    data: RearrangementAnswerRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Preview mode: Submit rearrangement answer (not saved)."""
    _get_teacher_assignment(assignment_id, current_teacher, db)
    return check_rearrangement_answer(
        data.content_item_id,
        data.selected_word,
        data.current_position,
        db,
    )


@router.post("/assignments/{assignment_id}/preview/rearrangement-retry")
async def preview_rearrangement_retry(
    assignment_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Preview mode: Retry rearrangement question (simulated)."""
    _get_teacher_assignment(assignment_id, current_teacher, db)
    return handle_rearrangement_retry()


@router.post("/assignments/{assignment_id}/preview/rearrangement-complete")
async def preview_rearrangement_complete(
    assignment_id: int,
    data: RearrangementCompleteRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Preview mode: Complete rearrangement question (simulated)."""
    _get_teacher_assignment(assignment_id, current_teacher, db)
    return handle_rearrangement_complete(
        expected_score=data.expected_score,
        timeout=data.timeout,
    )
