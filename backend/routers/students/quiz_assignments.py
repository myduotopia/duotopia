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
    # NOTE: correctness is ALWAYS recomputed server-side from the content item;
    # this client-sent value is accepted for backward-compat but ignored, so a
    # student cannot post is_correct=true to fake a 100% score (#828 review).
    is_correct: Optional[bool] = None


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
    db: Session,
    assignment: Assignment,
    shuffle: bool,
    seed: Optional[int] = None,
) -> List[ContentItem]:
    """Load ALL ContentItems for the assignment, ordered for quiz delivery.

    When ``shuffle`` is on, pass ``seed`` (e.g. the PracticeSession id) so the
    same student gets the SAME order every time they re-enter the quiz —
    otherwise ``question_number`` would change on each refresh and the progress
    bar ("3/5") becomes meaningless (Issue #828 review feedback).
    """
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
        rng = random.Random(seed) if seed is not None else random
        rng.shuffle(items)
    return items


def _start_quiz_session(
    db: Session,
    student_id: int,
    student_assignment: StudentAssignment,
    practice_mode: str,
) -> PracticeSession:
    """Get the in-flight PracticeSession for this quiz, or create one.

    Quiz is one-attempt; resuming preserves the same session so prior
    answers carry over and the integral countdown timer (Issue #828)
    doesn't reset every time the student re-enters.
    """
    if student_assignment.status == AssignmentStatus.NOT_STARTED:
        student_assignment.status = AssignmentStatus.IN_PROGRESS
        student_assignment.started_at = datetime.now(timezone.utc)

    existing = (
        db.query(PracticeSession)
        .filter(
            PracticeSession.student_assignment_id == student_assignment.id,
            PracticeSession.practice_mode == practice_mode,
            PracticeSession.completed_at.is_(None),
        )
        .order_by(PracticeSession.id.desc())
        .first()
    )
    if existing:
        db.commit()
        return existing

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


def _time_remaining(assignment: Assignment, session: PracticeSession) -> Optional[int]:
    """Compute seconds left for a quiz session.

    None ⇒ no whole-paper limit. Negative results clamp to 0 so the
    frontend can immediately auto-submit on next user interaction.
    """
    total = assignment.quiz_time_limit_seconds
    if not total:
        return None
    started = session.started_at
    if started is None:
        return total
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    remaining = total - int(elapsed)
    return max(0, remaining)


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
        # Issue #828: 整卷限時（秒）— null 不限時
        "quiz_time_limit_seconds": assignment.quiz_time_limit_seconds,
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
        # Seed per-item so the SAME options are produced every call — start and
        # review must agree, otherwise the review page's "你選的" highlight can
        # silently miss the option the student actually picked, and the options
        # would reshuffle on every refresh (Issue #828 review feedback).
        rng = random.Random(item.id)
        correct_text = getattr(item, answer_key) or ""
        stored = normalize_distractors(item.distractors)
        if len(stored) >= 3:
            distractors = list(stored[:3])
        else:
            target = correct_text.lower().strip()
            others = [
                p for p in pool if p["text"] and p["text"].lower().strip() != target
            ]
            rng.shuffle(others)
            distractors = others[:3]

        while len(distractors) < 3:
            distractors.append(
                {"text": f"選項{chr(65 + len(distractors))}", "image_url": None}
            )

        correct_option = {"text": correct_text, "image_url": item.image_url}
        opts = [correct_option] + distractors
        rng.shuffle(opts)
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

    session = _start_quiz_session(db, student_id, sa, "word_selection_quiz")
    items = _load_quiz_items(
        db, assignment, assignment.shuffle_questions, seed=session.id
    )
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
        # 退回後 status=RETURNED → 前端進入訂正模式（強制答對 + 答錯 reveal）
        "status": sa.status.value if sa.status else None,
        "words": words,
        "total_questions": len(words),
        **_common_settings(assignment),
        "time_remaining_seconds": _time_remaining(assignment, session),
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
    assignment = _get_assignment_or_400(db, sa, "word_selection_quiz")
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

    # Correctness is computed server-side (never trust the client) — compare the
    # selected option against the item's answer text, same field/normalisation as
    # _build_selection_options uses to build the correct option.
    show_image = assignment.show_image if assignment.show_image is not None else True
    answer_key = text_field_for_show_image(show_image)
    correct_text = getattr(item, answer_key) or ""
    is_correct = request.selected_answer.strip().lower() == correct_text.strip().lower()

    _upsert_quiz_answer(
        db,
        session,
        content_item_id=item.id,
        is_correct=is_correct,
        time_spent_seconds=request.time_spent_seconds,
        answer_data={
            "type": "word_selection_quiz",
            "selected_answer": request.selected_answer,
            "correct_text": correct_text,
        },
    )
    db.commit()
    return {"success": True, "is_correct": is_correct}


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

    session = _start_quiz_session(db, student_id, sa, "word_spelling_quiz")
    items = _load_quiz_items(
        db, assignment, assignment.shuffle_questions, seed=session.id
    )
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
        # 退回後 status=RETURNED → 前端進入訂正模式（強制答對 + 答錯 reveal）
        "status": sa.status.value if sa.status else None,
        "words": words,
        "total_questions": len(words),
        **_common_settings(assignment),
        "time_remaining_seconds": _time_remaining(assignment, session),
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
    # Case-insensitive, consistent with cloze quiz (#828 review): apple == Apple.
    is_correct = request.typed_answer.strip().lower() == correct_answer.strip().lower()

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

    session = _start_quiz_session(db, student_id, sa, "word_cloze_quiz")
    items = _load_quiz_items(
        db, assignment, assignment.shuffle_questions, seed=session.id
    )
    existing = _existing_answers_for_session(db, session.id)

    def builder(item: ContentItem) -> Dict[str, Any]:
        prior = existing.get(item.id)
        cloze_answer = _resolve_cloze_answer(item)
        return {
            "content_item_id": item.id,
            "text": item.text,
            "translation": item.translation or "",
            "part_of_speech": item.part_of_speech,
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
        # 退回後 status=RETURNED → 前端進入訂正模式（強制答對 + 答錯 reveal）
        "status": sa.status.value if sa.status else None,
        "words": words,
        "total_questions": len(words),
        **_common_settings(assignment),
        "time_remaining_seconds": _time_remaining(assignment, session),
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
# Shared quiz scoring (single source of truth — #830)
#
# 小考分數一律由 practice_answers 自動算（correct/total*100），集中在這裡。
# 同時被學生提交端點 `_complete_quiz` 與通用提交 `assignments.submit_assignment`
# 使用，確保不論走哪條路徑都不會把小考存成 0 / 設成 GRADED。
# ---------------------------------------------------------------------------


def latest_quiz_session(
    db: Session, sa_id: int, expected_mode: str, *, completed_only: bool = False
) -> Optional[PracticeSession]:
    """該 student_assignment 在某小考 mode 下最新的 PracticeSession。"""
    q = db.query(PracticeSession).filter(
        PracticeSession.student_assignment_id == sa_id,
        PracticeSession.practice_mode == expected_mode,
    )
    if completed_only:
        q = q.filter(PracticeSession.completed_at.isnot(None))
    return q.order_by(PracticeSession.id.desc()).first()


def compute_quiz_score(
    db: Session, sa: StudentAssignment, session: Optional[PracticeSession]
) -> Tuple[float, int, int, int]:
    """從 session 的 practice_answers 算分。回 (score, correct, total_items, answered)。"""
    total_items = (
        db.query(ContentItem)
        .join(AssignmentContent, AssignmentContent.content_id == ContentItem.content_id)
        .filter(AssignmentContent.assignment_id == sa.assignment_id)
        .count()
    )
    correct_count = 0
    answered = 0
    if session is not None:
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
    return score, correct_count, total_items, answered


def finalize_quiz_submission(
    db: Session,
    sa: StudentAssignment,
    session: Optional[PracticeSession],
    score: float,
    *,
    write_score: bool = True,
) -> None:
    """收卷：status=SUBMITTED、submitted_at、session.completed_at；視需要寫 score。

    小考永遠停在 SUBMITTED（不 GRADED），老師才能退回。不 commit，由呼叫端 commit。
    """
    now = datetime.now(timezone.utc)
    if session is not None:
        session.completed_at = now
    sa.status = AssignmentStatus.SUBMITTED
    sa.submitted_at = now
    if write_score:
        sa.score = score


def score_and_finalize_quiz(
    db: Session, sa: StudentAssignment, expected_mode: str
) -> Tuple[float, int, int]:
    """通用提交路徑用：抓最新 session、算分、收卷（寫分數）。回 (score, correct, answered)。"""
    session = latest_quiz_session(db, sa.id, expected_mode)
    score, correct_count, _total, answered = compute_quiz_score(db, sa, session)
    finalize_quiz_submission(db, sa, session, score, write_score=True)
    return score, correct_count, answered


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

    is_revision = sa.status == AssignmentStatus.RETURNED

    # Idempotent：以「是否已有 completed session」判斷（不再只看 status），
    # 避免別的路徑搶先把 status 設成 SUBMITTED/GRADED 時、真正計分被永久跳過
    # （#830：小考 0 分根因）。重複提交時回既有分數即可。
    if not is_revision:
        completed = latest_quiz_session(db, sa.id, expected_mode, completed_only=True)
        if completed is not None:
            return (
                sa.score or 0,
                completed.correct_count or 0,
                completed.words_practiced or 0,
            )

    if session_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="session_id is required to complete the quiz",
        )
    session = _get_quiz_session(db, session_id, student_id, assignment_id)
    score, correct_count, total_items, answered = compute_quiz_score(db, sa, session)

    # 訂正再提交（退回後 status=RETURNED）：強制改到全對才能交，且成績以舊的為準。
    if is_revision and correct_count < total_items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "QUIZ_REVISION_INCOMPLETE",
                "correct_count": correct_count,
                "total": total_items,
            },
        )

    finalize_quiz_submission(db, sa, session, score, write_score=not is_revision)
    db.commit()
    final_score = sa.score if sa.score is not None else score
    return final_score, correct_count, answered


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


# ---------------------------------------------------------------------------
# Review endpoints — 提交後讓學生看自己答案 + 正解 + 對錯
# ---------------------------------------------------------------------------


def _latest_completed_session(
    db: Session, assignment_id: int, expected_mode: str
) -> Optional[PracticeSession]:
    return (
        db.query(PracticeSession)
        .filter(
            PracticeSession.student_assignment_id == assignment_id,
            PracticeSession.practice_mode == expected_mode,
        )
        .order_by(PracticeSession.id.desc())
        .first()
    )


def _build_review_response(
    db: Session,
    student_id: int,
    assignment_id: int,
    expected_mode: str,
    build_item,
    build_context=None,
) -> Dict[str, Any]:
    """Shared review skeleton — 各模式只差 build_item 怎麼組每題的內容。

    ``build_context(assignment, items)`` runs once and its result is passed to
    every ``build_item(item, prior, context)`` call, so per-mode setup (e.g.
    selection's option lists) can reuse the already-loaded sa/assignment/items
    instead of re-querying them (#828 review: duplicate-query fix).
    """
    sa = _get_student_assignment_or_404(db, assignment_id, student_id)
    assignment = _get_assignment_or_400(db, sa, expected_mode)
    if sa.status not in (AssignmentStatus.SUBMITTED, AssignmentStatus.GRADED):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "QUIZ_NOT_SUBMITTED",
                "status": sa.status.value if sa.status else None,
            },
        )
    # 不洗牌：複盤頁固定按 order_index 顯示，方便師生對照
    items = _load_quiz_items(db, assignment, shuffle=False)
    context = build_context(assignment, items) if build_context else None
    session = _latest_completed_session(db, assignment_id, expected_mode)
    answers_map: Dict[int, PracticeAnswer] = {}
    if session:
        answers_map = _existing_answers_for_session(db, session.id)

    words = []
    correct_count = 0
    for idx, item in enumerate(items, start=1):
        prior = answers_map.get(item.id)
        word = build_item(item, prior, context)
        word["question_number"] = idx
        word["is_correct"] = bool(prior.is_correct) if prior else False
        if word["is_correct"]:
            correct_count += 1
        words.append(word)

    return {
        "practice_mode": expected_mode,
        "words": words,
        "total_questions": len(items),
        "correct_count": correct_count,
        "score": sa.score if sa.score is not None else 0,
        "status": sa.status.value if sa.status else None,
        "submitted_at": sa.submitted_at.isoformat() if sa.submitted_at else None,
    }


@router.get("/assignments/{assignment_id}/vocabulary/selection_quiz/review")
async def review_word_selection_quiz(
    assignment_id: int,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    student_id = int(current_student.get("sub"))

    # options/answer_key built once via build_context — reuses the sa/assignment/
    # items loaded inside _build_review_response (no duplicate queries, #828).
    def build_context(
        assignment: Assignment, items: List[ContentItem]
    ) -> Dict[str, Any]:
        show_image = (
            assignment.show_image if assignment.show_image is not None else True
        )
        return {
            "options_by_item": _build_selection_options(items, assignment),
            "answer_key": text_field_for_show_image(show_image),
        }

    def build_item(
        item: ContentItem,
        prior: Optional[PracticeAnswer],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        correct = getattr(item, context["answer_key"]) or ""
        student_answer = (
            prior.answer_data.get("selected_answer")
            if prior and prior.answer_data
            else None
        )
        options = list(context["options_by_item"].get(item.id, []))
        # Safety net: options are deterministic now, but a session answered
        # before that fix (or with edited distractors) might have a pick not in
        # the list — inject it so the frontend "你選的" highlight never misses.
        if student_answer is not None and not any(
            (o.get("text") or "").strip().lower() == student_answer.strip().lower()
            for o in options
        ):
            target = correct.strip().lower()
            replaced = False
            for i, o in enumerate(options):
                if (o.get("text") or "").strip().lower() != target:
                    options[i] = {"text": student_answer, "image_url": None}
                    replaced = True
                    break
            if not replaced:
                options.append({"text": student_answer, "image_url": None})
        return {
            "content_item_id": item.id,
            "text": item.text,
            "translation": item.translation or "",
            "correct_answer": correct,
            "student_answer": student_answer,
            "audio_url": item.audio_url,
            "image_url": item.image_url,
            "options": options,
        }

    return _build_review_response(
        db,
        student_id,
        assignment_id,
        "word_selection_quiz",
        build_item,
        build_context,
    )


@router.get("/assignments/{assignment_id}/vocabulary/spelling_quiz/review")
async def review_word_spelling_quiz(
    assignment_id: int,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    student_id = int(current_student.get("sub"))

    def build_item(
        item: ContentItem,
        prior: Optional[PracticeAnswer],
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return {
            "content_item_id": item.id,
            "text": item.text,
            "translation": item.translation or "",
            "part_of_speech": item.part_of_speech,
            "audio_url": item.audio_url,
            "image_url": item.image_url,
            "correct_answer": item.text or "",
            "student_answer": (
                prior.answer_data.get("typed_answer")
                if prior and prior.answer_data
                else None
            ),
        }

    return _build_review_response(
        db, student_id, assignment_id, "word_spelling_quiz", build_item
    )


@router.get("/assignments/{assignment_id}/vocabulary/cloze_quiz/review")
async def review_word_cloze_quiz(
    assignment_id: int,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    student_id = int(current_student.get("sub"))

    def build_item(
        item: ContentItem,
        prior: Optional[PracticeAnswer],
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        cloze_answer = _resolve_cloze_answer(item)
        return {
            "content_item_id": item.id,
            "text": item.text,
            "translation": item.translation or "",
            "part_of_speech": item.part_of_speech,
            "example_sentence": item.example_sentence or "",
            "example_sentence_translation": item.example_sentence_translation or "",
            "example_sentence_audio_url": item.example_sentence_audio_url,
            "audio_url": item.audio_url,
            "image_url": item.image_url,
            "correct_answer": cloze_answer,
            "student_answer": (
                prior.answer_data.get("typed_answer")
                if prior and prior.answer_data
                else None
            ),
        }

    return _build_review_response(
        db, student_id, assignment_id, "word_cloze_quiz", build_item
    )
