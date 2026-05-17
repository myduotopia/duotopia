"""
Assignment Ops operations for teachers.
"""
import logging
from datetime import datetime, timezone

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
from sqlalchemy.orm import Session, selectinload
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
    StudentAssignment,
    StudentItemProgress,
    StudentContentProgress,
    AssignmentStatus,
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
    get_word_spelling_start,
    get_word_cloze_start,
    ensure_example_sentence_audio,
    ensure_word_audio,
    _VOCABULARY_CONTENT_TYPES,
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


def _get_instant_practice_student_assignment(
    assignment: Assignment, db: Session
) -> Optional[StudentAssignment]:
    """Get the teacher's StudentAssignment for an instant practice assignment."""
    if not assignment.is_instant_practice:
        return None
    return (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.assignment_id == assignment.id,
            StudentAssignment.teacher_id == assignment.teacher_id,
            StudentAssignment.is_active.is_(True),
        )
        .first()
    )


def _get_item_progress(
    student_assignment_id: int, content_item_id: int, db: Session
) -> Optional[StudentItemProgress]:
    """Get StudentItemProgress for a specific item."""
    return (
        db.query(StudentItemProgress)
        .filter(
            StudentItemProgress.student_assignment_id == student_assignment_id,
            StudentItemProgress.content_item_id == content_item_id,
        )
        .first()
    )


# ============================================================================
# Preview Endpoints — thin wrappers around preview_service
# For instant practice assignments, also saves progress to DB
# ============================================================================


@router.get("/assignments/{assignment_id}/preview")
async def get_assignment_preview(
    assignment_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """取得作業的預覽內容（供老師示範用）"""
    assignment = _get_teacher_assignment(assignment_id, current_teacher, db)

    # Lazy TTS pre-pass：對齊 students/assignments.get_assignment_activities，
    # 依 practice_mode 補生缺少的音檔。沒做的話 reading 模式會聽到單字音檔
    # 而不是例句音檔（example_sentence_audio_url 在 staging 上常常是 ""）。
    # build_assignment_preview 是 sync 的，沒辦法在裡面 await TTS，所以放外面
    # 先行 pre-load 並更新 ContentItem.example_sentence_audio_url（DB 與 in-memory）。
    _practice_mode = assignment.practice_mode or ""
    needs_sentence_audio = _practice_mode in ("reading", "rearrangement", "word_cloze")
    needs_word_audio = _practice_mode in ("word_reading", "word_spelling")
    if needs_sentence_audio or needs_word_audio:
        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment.id)
            .all()
        )
        content_ids = [ac.content_id for ac in assignment_contents]
        contents = (
            db.query(Content)
            .filter(Content.id.in_(content_ids))
            .options(selectinload(Content.content_items))
            .all()
        )
        vocab_items = [
            ci
            for content in contents
            if content.type in _VOCABULARY_CONTENT_TYPES
            for ci in content.content_items
        ]
        if vocab_items:
            if needs_sentence_audio:
                await ensure_example_sentence_audio(vocab_items, db)
            elif needs_word_audio:
                await ensure_word_audio(vocab_items, db)

    result = build_assignment_preview(assignment, db)

    # 即刻練習：加入 student_assignment_id 供前端使用
    if assignment.is_instant_practice:
        sa = _get_instant_practice_student_assignment(assignment, db)
        if sa:
            result["student_assignment_id"] = sa.id
            result["is_instant_practice"] = True

    return result


@router.get("/assignments/{assignment_id}/preview/practice-words")
async def preview_practice_words(
    assignment_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    預覽模式專用：取得造句練習題目（艾賓浩斯記憶曲線系統的單字）

    - 供老師預覽示範用，不建立 PracticeSession
    - 不需要 StudentAssignment，直接從 Assignment 讀取
    - 順序回傳前 10 個單字（沒有學生作答歷史可以排序）
    - 回傳格式對齊 students 端 GET /assignments/{id}/practice-words，
      但 session_id=None 表示預覽模式
    """
    assignment = _get_teacher_assignment(assignment_id, current_teacher, db)

    # answer_mode 對齊學生端：dict / Enum / None 都要 normalise 成字串
    answer_mode_value = assignment.answer_mode or "listening"
    if not isinstance(answer_mode_value, str):
        answer_mode_value = (
            answer_mode_value.value
            if hasattr(answer_mode_value, "value")
            else "listening"
        )

    # 取得作業內所有 vocab ContentItem（混合作業要把 reading passage items 過濾掉）
    content_items = (
        db.query(ContentItem)
        .join(Content)
        .join(AssignmentContent)
        .filter(
            AssignmentContent.assignment_id == assignment.id,
            Content.type.in_(_VOCABULARY_CONTENT_TYPES),
        )
        .order_by(ContentItem.order_index)
        .limit(10)
        .all()
    )

    # Lazy TTS：若 audio_url 是 NULL 或 ''，幫老師預覽生成單字 TTS。
    # 跟 get_assignment_preview 同樣自我修復行為，避免回傳空 audio_url。
    if content_items:
        await ensure_word_audio(content_items, db)

    words = [
        {
            "content_item_id": item.id,
            "text": item.text or "",
            "translation": item.translation or "",
            "example_sentence": item.example_sentence or "",
            "example_sentence_translation": item.example_sentence_translation or "",
            "audio_url": item.audio_url or "",
            "memory_strength": 0.0,
            "priority_score": 0.0,
        }
        for item in content_items
    ]

    return {
        "session_id": None,  # 預覽模式不建立 session
        "answer_mode": answer_mode_value,
        "words": words,
    }


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
    return await get_word_selection_start(assignment, db, exclude_ids)


@router.get("/assignments/{assignment_id}/preview/word-spelling-start")
async def preview_word_spelling_start(
    assignment_id: int,
    exclude_ids: str = Query(
        default="", description="Already-practiced content_item_ids, comma-separated"
    ),
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Preview mode: Get word spelling practice data."""
    assignment = _get_teacher_assignment(assignment_id, current_teacher, db)
    return await get_word_spelling_start(assignment, db, exclude_ids)


@router.get("/assignments/{assignment_id}/preview/word-cloze-start")
async def preview_word_cloze_start(
    assignment_id: int,
    exclude_ids: str = Query(
        default="", description="Already-practiced content_item_ids, comma-separated"
    ),
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Preview mode: Get word cloze practice data."""
    assignment = _get_teacher_assignment(assignment_id, current_teacher, db)
    return await get_word_cloze_start(assignment, db, exclude_ids)


@router.post("/assignments/{assignment_id}/preview/word-selection-answer")
async def preview_word_selection_answer(
    assignment_id: int,
    data: WordSelectionAnswerRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Preview mode: Submit word selection answer.
    For instant practice: also saves progress to StudentItemProgress.
    """
    assignment = _get_teacher_assignment(assignment_id, current_teacher, db)
    result = check_word_selection_answer(
        data.content_item_id,
        data.selected_answer,
        assignment,
        db,
    )

    # 即刻練習：儲存答題進度
    if assignment.is_instant_practice:
        sa = _get_instant_practice_student_assignment(assignment, db)
        if sa:
            item_progress = _get_item_progress(sa.id, data.content_item_id, db)
            if item_progress:
                now = datetime.now(timezone.utc)
                item_progress.status = "COMPLETED"
                item_progress.submitted_at = now
                item_progress.attempts = (item_progress.attempts or 0) + 1

                # 累計答題紀錄到 word_selection_data
                history = item_progress.word_selection_data or {}
                answers = history.get("answers", [])
                answers.append(
                    {
                        "selected": data.selected_answer,
                        "is_correct": result["is_correct"],
                        "answered_at": now.isoformat(),
                    }
                )
                history["answers"] = answers
                history["last_correct"] = result["is_correct"]
                item_progress.word_selection_data = history

                # 更新 StudentAssignment 狀態
                if sa.status == AssignmentStatus.NOT_STARTED:
                    sa.status = AssignmentStatus.IN_PROGRESS
                    sa.started_at = now

                db.commit()

    return result


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
    """Preview mode: Submit rearrangement answer.
    For instant practice: also saves progress to StudentItemProgress.
    """
    assignment = _get_teacher_assignment(assignment_id, current_teacher, db)
    result = check_rearrangement_answer(
        data.content_item_id,
        data.selected_word,
        data.current_position,
        db,
    )

    # 即刻練習：儲存答題進度
    if assignment.is_instant_practice:
        sa = _get_instant_practice_student_assignment(assignment, db)
        if sa:
            item_progress = _get_item_progress(sa.id, data.content_item_id, db)
            if item_progress:
                now = datetime.now(timezone.utc)
                if not result["is_correct"]:
                    item_progress.error_count = (item_progress.error_count or 0) + 1
                item_progress.correct_word_count = result["correct_word_count"]
                item_progress.expected_score = result["expected_score"]
                item_progress.status = "IN_PROGRESS"

                if result.get("completed"):
                    item_progress.status = "COMPLETED"
                    item_progress.submitted_at = now

                # 更新 StudentAssignment 狀態
                if sa.status == AssignmentStatus.NOT_STARTED:
                    sa.status = AssignmentStatus.IN_PROGRESS
                    sa.started_at = now

                db.commit()

    return result


@router.post("/assignments/{assignment_id}/preview/rearrangement-retry")
async def preview_rearrangement_retry(
    assignment_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Preview mode: Retry rearrangement question."""
    assignment = _get_teacher_assignment(assignment_id, current_teacher, db)

    # 即刻練習：記錄重試
    if assignment.is_instant_practice:
        sa = _get_instant_practice_student_assignment(assignment, db)
        if sa:
            # Increment retry count on all in-progress items
            db.query(StudentItemProgress).filter(
                StudentItemProgress.student_assignment_id == sa.id,
                StudentItemProgress.status == "IN_PROGRESS",
            ).update(
                {"retry_count": StudentItemProgress.retry_count + 1},
                synchronize_session=False,
            )
            db.commit()

    return handle_rearrangement_retry()


@router.post("/assignments/{assignment_id}/preview/rearrangement-complete")
async def preview_rearrangement_complete(
    assignment_id: int,
    data: RearrangementCompleteRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Preview mode: Complete rearrangement question.
    For instant practice: updates StudentAssignment status to SUBMITTED.
    """
    assignment = _get_teacher_assignment(assignment_id, current_teacher, db)

    # 即刻練習：標記完成
    if assignment.is_instant_practice:
        sa = _get_instant_practice_student_assignment(assignment, db)
        if sa:
            now = datetime.now(timezone.utc)
            sa.status = AssignmentStatus.SUBMITTED
            sa.submitted_at = now

            # 更新 StudentContentProgress
            db.query(StudentContentProgress).filter(
                StudentContentProgress.student_assignment_id == sa.id,
            ).update(
                {
                    "status": AssignmentStatus.SUBMITTED,
                    "completed_at": now,
                },
                synchronize_session=False,
            )
            db.commit()

    return handle_rearrangement_complete(
        expected_score=data.expected_score,
        timeout=data.timeout,
    )
