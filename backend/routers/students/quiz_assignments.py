"""Quiz-mode (小考) endpoints for vocabulary practice.

Issue #828: introduces ``word_selection_quiz`` / ``word_spelling_quiz`` /
``word_cloze_quiz`` variants. Behaviour vs Ebbinghaus:
    - Returns ALL items in ``order_index`` order (optional shuffle), with
      ``question_number`` 1..N. No memory_strength selection, no 10-item cap.
    - Submission is one-shot: ``complete`` sets status=SUBMITTED and blocks
      further ``start`` calls until teacher returns.
    - Does NOT touch ``StudentItemProgress.memory_strength`` — quiz attempts
      are isolated from the Ebbinghaus signal so the two modes can coexist
      on the same vocabulary set without polluting each other's data.
    - Quiz answers live in ``practice_answers.answer_data.type =
      "word_*_quiz"``; the same row is UPDATEd when a student revisits a
      question before submitting (跳題 / 改答案 supported).
"""
import random
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from models import (
    Assignment,
    AssignmentContent,
    AssignmentStatus,
    ContentItem,
    PracticeAnswer,
    PracticeSession,
    StudentAssignment,
)
from utils.distractors import normalize_distractors, text_field_for_show_image

from .dependencies import get_current_student

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------


class _QuizAnswerBase(BaseModel):
    content_item_id: int
    time_spent_seconds: int = 0
    session_id: Optional[int] = None


class WordSelectionQuizAnswerRequest(_QuizAnswerBase):
    selected_answer: str = Field(max_length=200)
    is_correct: bool


class WordSpellingQuizAnswerRequest(_QuizAnswerBase):
    typed_answer: str = Field(max_length=200)


class WordClozeQuizAnswerRequest(_QuizAnswerBase):
    typed_answer: str = Field(max_length=200)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _get_student_assignment_or_404(
    db: Session, assignment_id: int, student_id: int
) -> StudentAssignment:
    sa = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.id == assignment_id,
            StudentAssignment.student_id == student_id,
            StudentAssignment.is_active.is_(True),
        )
        .first()
    )
    if not sa:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assignment not found or not assigned to you",
        )
    return sa


def _get_assignment_or_400(
    db: Session, student_assignment: StudentAssignment, expected_mode: str
) -> Assignment:
    assignment = (
        db.query(Assignment)
        .filter(Assignment.id == student_assignment.assignment_id)
        .first()
        if student_assignment.assignment_id
        else None
    )
    if not assignment or assignment.practice_mode != expected_mode:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"This is not a {expected_mode} assignment",
        )
    return assignment


def _block_if_submitted(student_assignment: StudentAssignment) -> None:
    """Quiz mode is one-shot — once SUBMITTED/GRADED, students may not restart.

    Teachers returning the assignment via the existing 退回 flow drops status
    back to IN_PROGRESS, which is when students can re-enter to fix wrong
    answers (Phase 3).
    """
    if student_assignment.status in (
        AssignmentStatus.SUBMITTED,
        AssignmentStatus.GRADED,
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "QUIZ_ALREADY_SUBMITTED",
                "status": student_assignment.status.value,
            },
        )


def _load_quiz_items(
    db: Session, assignment: Assignment, shuffle: bool
) -> List[ContentItem]:
    """Load ALL ContentItems for the assignment, ordered for quiz delivery."""
    content_ids = [
        ac.content_id
        for ac in db.query(AssignmentContent)
        .filter(AssignmentContent.assignment_id == assignment.id)
        .all()
    ]
    items = (
        db.query(ContentItem)
        .filter(ContentItem.content_id.in_(content_ids))
        .order_by(ContentItem.order_index.asc(), ContentItem.id.asc())
        .all()
    )
    if not items:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No vocabulary items found for this assignment",
        )
    if shuffle:
        items = list(items)
        random.shuffle(items)
    return items


def _start_quiz_session(
    db: Session,
    student_id: int,
    student_assignment: StudentAssignment,
    practice_mode: str,
) -> PracticeSession:
    """Create a new PracticeSession for the quiz attempt and bump status."""
    if student_assignment.status == AssignmentStatus.NOT_STARTED:
        student_assignment.status = AssignmentStatus.IN_PROGRESS
        student_assignment.started_at = datetime.now(timezone.utc)
    session = PracticeSession(
        student_id=student_id,
        student_assignment_id=student_assignment.id,
        practice_mode=practice_mode,
        words_practiced=0,
        correct_count=0,
        started_at=datetime.now(timezone.utc),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def _existing_answers_for_session(
    db: Session, session_id: int
) -> Dict[int, PracticeAnswer]:
    """Return {content_item_id -> PracticeAnswer} for a quiz session.

    Quiz answers UPDATE in place when a student revisits a question, so we
    keep at most one PracticeAnswer per (session, content_item).
    """
    rows = (
        db.query(PracticeAnswer)
        .filter(PracticeAnswer.practice_session_id == session_id)
        .all()
    )
    return {row.content_item_id: row for row in rows}


def _upsert_quiz_answer(
    db: Session,
    session: PracticeSession,
    content_item_id: int,
    is_correct: bool,
    time_spent_seconds: int,
    answer_data: Dict[str, Any],
) -> PracticeAnswer:
    """UPDATE the existing PracticeAnswer for this (session, item) or INSERT."""
    existing = (
        db.query(PracticeAnswer)
        .filter(
            PracticeAnswer.practice_session_id == session.id,
            PracticeAnswer.content_item_id == content_item_id,
        )
        .first()
    )
    if existing:
        previous_correct = existing.is_correct
        existing.is_correct = is_correct
        existing.time_spent_seconds = time_spent_seconds
        existing.answer_data = answer_data
        # Adjust session counter when correctness flips
        if previous_correct is not None and previous_correct != is_correct:
            if is_correct:
                session.correct_count = (session.correct_count or 0) + 1
            else:
                session.correct_count = max(0, (session.correct_count or 0) - 1)
        return existing

    answer = PracticeAnswer(
        practice_session_id=session.id,
        content_item_id=content_item_id,
        is_correct=is_correct,
        time_spent_seconds=time_spent_seconds,
        answer_data=answer_data,
    )
    db.add(answer)
    session.words_practiced = (session.words_practiced or 0) + 1
    if is_correct:
        session.correct_count = (session.correct_count or 0) + 1
    return answer


def _get_quiz_session(
    db: Session,
    session_id: int,
    student_id: int,
    student_assignment_id: int,
) -> PracticeSession:
    session = (
        db.query(PracticeSession)
        .filter(
            PracticeSession.id == session_id,
            PracticeSession.student_id == student_id,
            PracticeSession.student_assignment_id == student_assignment_id,
        )
        .first()
    )
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz session not found",
        )
    return session


def _common_settings(assignment: Assignment) -> Dict[str, Any]:
    return {
        "shuffle_questions": bool(assignment.shuffle_questions),
        "show_translation": (
            assignment.show_translation
            if assignment.show_translation is not None
            else True
        ),
        "show_word": (
            assignment.show_word if assignment.show_word is not None else True
        ),
        "show_image": (
            assignment.show_image if assignment.show_image is not None else True
        ),
        "play_audio": bool(assignment.play_audio),
        "show_answer": bool(assignment.show_answer),
        "time_limit_per_question": assignment.time_limit_per_question,
    }


def _attach_question_numbers(items: List[ContentItem], builder) -> List[Dict[str, Any]]:
    out = []
    for idx, item in enumerate(items, start=1):
        record = builder(item)
        record["question_number"] = idx
        out.append(record)
    return out


# ---------------------------------------------------------------------------
# word_selection_quiz
# ---------------------------------------------------------------------------


def _build_selection_options(
    items: List[ContentItem], assignment: Assignment
) -> Dict[int, List[Dict[str, Any]]]:
    """Build option lists per item, mirroring selection/start's distractor rules."""
    show_image = assignment.show_image if assignment.show_image is not None else True
    answer_key = text_field_for_show_image(show_image)

    pool = [
        {
            "text": getattr(it, answer_key) or "",
            "image_url": it.image_url,
        }
        for it in items
    ]

    options_by_item: Dict[int, List[Dict[str, Any]]] = {}
    for item in items:
        correct_text = getattr(item, answer_key) or ""
        stored = normalize_distractors(item.distractors)
        if len(stored) >= 3:
            distractors = list(stored[:3])
        else:
            target = correct_text.lower().strip()
            others = [
                p for p in pool if p["text"] and p["text"].lower().strip() != target
            ]
            random.shuffle(others)
            distractors = others[:3]

        while len(distractors) < 3:
            distractors.append(
                {"text": f"選項{chr(65 + len(distractors))}", "image_url": None}
            )

        correct_option = {"text": correct_text, "image_url": item.image_url}
        opts = [correct_option] + distractors
        random.shuffle(opts)
        options_by_item[item.id] = opts
    return options_by_item


@router.get("/assignments/{assignment_id}/vocabulary/selection_quiz/start")
async def start_word_selection_quiz(
    assignment_id: int,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    student_id = int(current_student.get("sub"))
    sa = _get_student_assignment_or_404(db, assignment_id, student_id)
    assignment = _get_assignment_or_400(db, sa, "word_selection_quiz")
    _block_if_submitted(sa)

    items = _load_quiz_items(db, assignment, assignment.shuffle_questions)
    session = _start_quiz_session(db, student_id, sa, "word_selection_quiz")
    options_by_item = _build_selection_options(items, assignment)

    show_image = assignment.show_image if assignment.show_image is not None else True
    answer_key = text_field_for_show_image(show_image)

    existing = _existing_answers_for_session(db, session.id)

    def builder(item: ContentItem) -> Dict[str, Any]:
        correct = getattr(item, answer_key) or ""
        prior = existing.get(item.id)
        return {
            "content_item_id": item.id,
            "text": item.text,
            "translation": item.translation or "",
            "correct_text": correct,
            "audio_url": item.audio_url,
            "image_url": item.image_url,
            "options": options_by_item[item.id],
            "prior_answer": (
                prior.answer_data.get("selected_answer")
                if prior and prior.answer_data
                else None
            ),
            "prior_is_correct": prior.is_correct if prior else None,
        }

    words = _attach_question_numbers(items, builder)

    return {
        "session_id": session.id,
        "practice_mode": "word_selection_quiz",
        "words": words,
        "total_questions": len(words),
        **_common_settings(assignment),
        "show_option_images": bool(assignment.show_option_images),
    }


@router.post("/assignments/{assignment_id}/vocabulary/selection_quiz/answer")
async def submit_word_selection_quiz_answer(
    assignment_id: int,
    request: WordSelectionQuizAnswerRequest,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    student_id = int(current_student.get("sub"))
    sa = _get_student_assignment_or_404(db, assignment_id, student_id)
    _get_assignment_or_400(db, sa, "word_selection_quiz")
    _block_if_submitted(sa)

    if request.session_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="session_id is required for quiz answers",
        )
    session = _get_quiz_session(db, request.session_id, student_id, assignment_id)

    item = (
        db.query(ContentItem).filter(ContentItem.id == request.content_item_id).first()
    )
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Content item not found"
        )

    _upsert_quiz_answer(
        db,
        session,
        content_item_id=item.id,
        is_correct=bool(request.is_correct),
        time_spent_seconds=request.time_spent_seconds,
        answer_data={
            "type": "word_selection_quiz",
            "selected_answer": request.selected_answer,
            "correct_text": item.text,
        },
    )
    db.commit()
    return {"success": True, "is_correct": bool(request.is_correct)}


# ---------------------------------------------------------------------------
# word_spelling_quiz
# ---------------------------------------------------------------------------


@router.get("/assignments/{assignment_id}/vocabulary/spelling_quiz/start")
async def start_word_spelling_quiz(
    assignment_id: int,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    student_id = int(current_student.get("sub"))
    sa = _get_student_assignment_or_404(db, assignment_id, student_id)
    assignment = _get_assignment_or_400(db, sa, "word_spelling_quiz")
    _block_if_submitted(sa)

    items = _load_quiz_items(db, assignment, assignment.shuffle_questions)
    session = _start_quiz_session(db, student_id, sa, "word_spelling_quiz")
    existing = _existing_answers_for_session(db, session.id)

    def builder(item: ContentItem) -> Dict[str, Any]:
        prior = existing.get(item.id)
        return {
            "content_item_id": item.id,
            "text": item.text,
            "translation": item.translation or "",
            "audio_url": item.audio_url,
            "image_url": item.image_url,
            "part_of_speech": item.part_of_speech,
            "example_sentence": item.example_sentence,
            "example_sentence_translation": item.example_sentence_translation,
            "example_sentence_audio_url": item.example_sentence_audio_url,
            "prior_answer": (
                prior.answer_data.get("typed_answer")
                if prior and prior.answer_data
                else None
            ),
            "prior_is_correct": prior.is_correct if prior else None,
        }

    words = _attach_question_numbers(items, builder)

    return {
        "session_id": session.id,
        "practice_mode": "word_spelling_quiz",
        "words": words,
        "total_questions": len(words),
        **_common_settings(assignment),
    }


@router.post("/assignments/{assignment_id}/vocabulary/spelling_quiz/answer")
async def submit_word_spelling_quiz_answer(
    assignment_id: int,
    request: WordSpellingQuizAnswerRequest,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    student_id = int(current_student.get("sub"))
    sa = _get_student_assignment_or_404(db, assignment_id, student_id)
    _get_assignment_or_400(db, sa, "word_spelling_quiz")
    _block_if_submitted(sa)

    if request.session_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="session_id is required for quiz answers",
        )
    session = _get_quiz_session(db, request.session_id, student_id, assignment_id)

    item = (
        db.query(ContentItem).filter(ContentItem.id == request.content_item_id).first()
    )
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Content item not found"
        )

    correct_answer = item.text or ""
    is_correct = request.typed_answer.strip() == correct_answer.strip()

    _upsert_quiz_answer(
        db,
        session,
        content_item_id=item.id,
        is_correct=is_correct,
        time_spent_seconds=request.time_spent_seconds,
        answer_data={
            "type": "word_spelling_quiz",
            "typed_answer": request.typed_answer,
            "correct_answer": correct_answer,
        },
    )
    db.commit()
    return {"success": True, "is_correct": is_correct, "correct_answer": correct_answer}


# ---------------------------------------------------------------------------
# word_cloze_quiz
# ---------------------------------------------------------------------------


def _resolve_cloze_answer(item: ContentItem) -> str:
    """Mirror the existing cloze logic: prefer stored cloze_answer, fall back
    to the first content word in the example sentence. Phase 1's dispatch
    validation already guarantees stored values for new dispatches; the
    fallback covers legacy data."""
    answer = (item.cloze_answer or "").strip()
    if answer:
        return answer
    sentence = (item.example_sentence or "").strip()
    word = (item.text or "").strip()
    if word and word in sentence:
        return word
    return word or sentence


@router.get("/assignments/{assignment_id}/vocabulary/cloze_quiz/start")
async def start_word_cloze_quiz(
    assignment_id: int,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    student_id = int(current_student.get("sub"))
    sa = _get_student_assignment_or_404(db, assignment_id, student_id)
    assignment = _get_assignment_or_400(db, sa, "word_cloze_quiz")
    _block_if_submitted(sa)

    items = _load_quiz_items(db, assignment, assignment.shuffle_questions)
    session = _start_quiz_session(db, student_id, sa, "word_cloze_quiz")
    existing = _existing_answers_for_session(db, session.id)

    def builder(item: ContentItem) -> Dict[str, Any]:
        prior = existing.get(item.id)
        cloze_answer = _resolve_cloze_answer(item)
        return {
            "content_item_id": item.id,
            "text": item.text,
            "translation": item.translation or "",
            "example_sentence": item.example_sentence or "",
            "example_sentence_translation": item.example_sentence_translation or "",
            "example_sentence_audio_url": item.example_sentence_audio_url,
            "cloze_answer": cloze_answer,
            "image_url": item.image_url,
            "audio_url": item.audio_url,
            "prior_answer": (
                prior.answer_data.get("typed_answer")
                if prior and prior.answer_data
                else None
            ),
            "prior_is_correct": prior.is_correct if prior else None,
        }

    words = _attach_question_numbers(items, builder)

    return {
        "session_id": session.id,
        "practice_mode": "word_cloze_quiz",
        "words": words,
        "total_questions": len(words),
        **_common_settings(assignment),
    }


@router.post("/assignments/{assignment_id}/vocabulary/cloze_quiz/answer")
async def submit_word_cloze_quiz_answer(
    assignment_id: int,
    request: WordClozeQuizAnswerRequest,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    student_id = int(current_student.get("sub"))
    sa = _get_student_assignment_or_404(db, assignment_id, student_id)
    _get_assignment_or_400(db, sa, "word_cloze_quiz")
    _block_if_submitted(sa)

    if request.session_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="session_id is required for quiz answers",
        )
    session = _get_quiz_session(db, request.session_id, student_id, assignment_id)

    item = (
        db.query(ContentItem).filter(ContentItem.id == request.content_item_id).first()
    )
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Content item not found"
        )

    correct_answer = _resolve_cloze_answer(item)
    is_correct = request.typed_answer.strip().lower() == correct_answer.strip().lower()

    _upsert_quiz_answer(
        db,
        session,
        content_item_id=item.id,
        is_correct=is_correct,
        time_spent_seconds=request.time_spent_seconds,
        answer_data={
            "type": "word_cloze_quiz",
            "typed_answer": request.typed_answer,
            "correct_answer": correct_answer,
        },
    )
    db.commit()
    return {"success": True, "is_correct": is_correct, "correct_answer": correct_answer}


# ---------------------------------------------------------------------------
# Shared completion endpoint (3 modes share identical logic)
# ---------------------------------------------------------------------------


def _complete_quiz(
    db: Session,
    student_id: int,
    assignment_id: int,
    expected_mode: str,
    session_id: Optional[int],
) -> Tuple[float, int, int]:
    sa = _get_student_assignment_or_404(db, assignment_id, student_id)
    _get_assignment_or_400(db, sa, expected_mode)

    # Idempotent: if the assignment was already submitted we still return the
    # score so the frontend "提交完成" handler is safe to retry.
    if sa.status in (AssignmentStatus.SUBMITTED, AssignmentStatus.GRADED):
        score = sa.score or 0
        # Best-effort answered/total counts from the most recent session
        recent = (
            db.query(PracticeSession)
            .filter(
                PracticeSession.student_assignment_id == assignment_id,
                PracticeSession.practice_mode == expected_mode,
            )
            .order_by(PracticeSession.id.desc())
            .first()
        )
        answered = recent.words_practiced if recent else 0
        correct = recent.correct_count if recent else 0
        return score, correct, answered

    if session_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="session_id is required to complete the quiz",
        )
    session = _get_quiz_session(db, session_id, student_id, assignment_id)

    # Total questions = ContentItems in this assignment; correct = is_correct=true rows
    total_items = (
        db.query(ContentItem)
        .join(AssignmentContent, AssignmentContent.content_id == ContentItem.content_id)
        .filter(AssignmentContent.assignment_id == sa.assignment_id)
        .count()
    )
    correct_count = (
        db.query(PracticeAnswer)
        .filter(
            PracticeAnswer.practice_session_id == session.id,
            PracticeAnswer.is_correct.is_(True),
        )
        .count()
    )
    answered = (
        db.query(PracticeAnswer)
        .filter(PracticeAnswer.practice_session_id == session.id)
        .count()
    )

    score = round((correct_count / total_items) * 100, 1) if total_items else 0.0

    now = datetime.now(timezone.utc)
    session.completed_at = now
    sa.status = AssignmentStatus.SUBMITTED
    sa.submitted_at = now
    sa.score = score
    db.commit()
    return score, correct_count, answered


class _QuizCompleteRequest(BaseModel):
    session_id: Optional[int] = None


@router.post("/assignments/{assignment_id}/vocabulary/selection_quiz/complete")
async def complete_word_selection_quiz(
    assignment_id: int,
    request: _QuizCompleteRequest,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    student_id = int(current_student.get("sub"))
    score, correct, answered = _complete_quiz(
        db, student_id, assignment_id, "word_selection_quiz", request.session_id
    )
    return {
        "success": True,
        "score": score,
        "correct_count": correct,
        "answered_count": answered,
    }


@router.post("/assignments/{assignment_id}/vocabulary/spelling_quiz/complete")
async def complete_word_spelling_quiz(
    assignment_id: int,
    request: _QuizCompleteRequest,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    student_id = int(current_student.get("sub"))
    score, correct, answered = _complete_quiz(
        db, student_id, assignment_id, "word_spelling_quiz", request.session_id
    )
    return {
        "success": True,
        "score": score,
        "correct_count": correct,
        "answered_count": answered,
    }


@router.post("/assignments/{assignment_id}/vocabulary/cloze_quiz/complete")
async def complete_word_cloze_quiz(
    assignment_id: int,
    request: _QuizCompleteRequest,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    student_id = int(current_student.get("sub"))
    score, correct, answered = _complete_quiz(
        db, student_id, assignment_id, "word_cloze_quiz", request.session_id
    )
    return {
        "success": True,
        "score": score,
        "correct_count": correct,
        "answered_count": answered,
    }
