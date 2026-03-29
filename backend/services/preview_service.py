"""
Shared preview service for Demo and Teacher preview endpoints.

Extracts common business logic so that demo.py and assignment_ops.py
both delegate to the same functions. Neither API paths nor frontend
code are affected by this refactoring.
"""

import logging
import random
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session, selectinload

from models import (
    Assignment,
    AssignmentContent,
    Content,
    ContentItem,
    ContentType,
)


# ---------------------------------------------------------------------------
# Shared Pydantic request models (used by both demo.py and assignment_ops.py)
# ---------------------------------------------------------------------------


class WordSelectionAnswerRequest(BaseModel):
    content_item_id: int
    selected_answer: str


class RearrangementAnswerRequest(BaseModel):
    content_item_id: int
    selected_word: str
    current_position: int = 0


class RearrangementCompleteRequest(BaseModel):
    expected_score: float = 100.0
    timeout: bool = False


logger = logging.getLogger(__name__)

# Content types that represent vocabulary sets (word lists with example sentences)
_VOCABULARY_CONTENT_TYPES = {
    ContentType.VOCABULARY_SET,
    ContentType.SENTENCE_MAKING,  # legacy alias
}


def _is_vocab_type(content_type) -> bool:
    """Check if a content type is a vocabulary set type."""
    return content_type in _VOCABULARY_CONTENT_TYPES


def get_sentence_fields(item: ContentItem, content_type, practice_mode: str):
    """Return (text, translation, audio_url) based on content type and practice mode.

    When using vocabulary set content in sentence practice modes (reading /
    rearrangement), we use the item's *example_sentence* fields instead of
    the primary text/translation (which hold the single word).

    Returns ``None`` when the item should be **skipped** (vocab item without
    an example sentence in a sentence practice mode).
    """
    if practice_mode in ("reading", "rearrangement") and _is_vocab_type(content_type):
        sentence = (item.example_sentence or "").strip()
        if not sentence:
            return None  # skip this item
        audio = item.example_sentence_audio_url or item.audio_url
        return (
            sentence,
            (item.example_sentence_translation or item.translation or ""),
            audio,
        )
    return item.text, item.translation, item.audio_url


# Audio formats accepted for speech assessment
ALLOWED_AUDIO_FORMATS = [
    "audio/wav",
    "audio/webm",
    "audio/webm;codecs=opus",
    "audio/mp3",
    "audio/mpeg",
    "audio/mp4",
    "video/mp4",
    "application/octet-stream",
]

MAX_AUDIO_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


# ---------------------------------------------------------------------------
# GET /preview — build assignment preview data
# ---------------------------------------------------------------------------


def build_assignment_preview(assignment: Assignment, db: Session) -> dict:
    """Build the full assignment preview payload.

    Returns the same structure consumed by student / preview frontend.
    """
    assignment_contents = (
        db.query(AssignmentContent)
        .filter(AssignmentContent.assignment_id == assignment.id)
        .order_by(AssignmentContent.order_index)
        .all()
    )

    # Batch-load contents with items (avoid N+1)
    content_ids = [ac.content_id for ac in assignment_contents]
    contents = (
        db.query(Content)
        .filter(Content.id.in_(content_ids))
        .options(selectinload(Content.content_items))
        .all()
    )
    content_dict = {content.id: content for content in contents}

    activities = []

    for idx, ac in enumerate(assignment_contents):
        content = content_dict.get(ac.content_id)
        if not content:
            continue

        activity_data = {
            "id": idx + 1,
            "content_id": content.id,
            "order": idx + 1,
            "type": content.type.value if content.type else "reading_assessment",
            "title": content.title,
            "duration": content.time_limit_seconds or 60,
            "points": (
                100 // len(assignment_contents) if len(assignment_contents) > 0 else 100
            ),
            "status": "NOT_STARTED",
            "score": None,
            "completed_at": None,
        }

        content_items = sorted(content.content_items, key=lambda x: x.order_index)

        items_data = []
        for item in content_items:
            fields = get_sentence_fields(
                item, content.type, assignment.practice_mode or ""
            )
            if fields is None:
                continue  # skip vocab items without example_sentence
            q_text, q_translation, q_audio = fields
            items_data.append(
                {
                    "id": item.id,
                    "text": q_text,
                    "translation": q_translation,
                    "audio_url": q_audio,
                    "recording_url": None,
                }
            )

        activity_data["items"] = items_data
        activity_data["item_count"] = len(items_data)

        if content.type == ContentType.READING_ASSESSMENT:
            activity_data["target_wpm"] = content.target_wpm
            activity_data["target_accuracy"] = content.target_accuracy

        activities.append(activity_data)

    return {
        "assignment_id": assignment.id,
        "title": assignment.title,
        "status": "preview",
        "practice_mode": assignment.practice_mode,
        "show_answer": assignment.show_answer or False,
        "score_category": assignment.score_category,
        "total_activities": len(activities),
        "activities": activities,
    }


# ---------------------------------------------------------------------------
# POST /assess-speech — pronunciation assessment (no DB storage)
# ---------------------------------------------------------------------------


async def assess_speech_preview(
    audio_file: UploadFile,
    reference_text: str,
) -> dict:
    """Perform pronunciation assessment without saving to DB."""
    from routers.speech_assessment import convert_audio_to_wav, assess_pronunciation

    if audio_file.content_type not in ALLOWED_AUDIO_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported audio format. "
                f"Allowed formats: {', '.join(ALLOWED_AUDIO_FORMATS)}"
            ),
        )

    audio_data = await audio_file.read()
    if len(audio_data) > MAX_AUDIO_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size: {MAX_AUDIO_FILE_SIZE / 1024 / 1024}MB",
        )

    try:
        wav_audio_data = convert_audio_to_wav(audio_data, audio_file.content_type)
        assessment_result = assess_pronunciation(wav_audio_data, reference_text)

        return {
            "success": True,
            "preview_mode": True,
            "assessment": assessment_result,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Preview assessment failed: {e}")
        raise HTTPException(
            status_code=503,
            detail="AI assessment failed, please try again later",
        )


# ---------------------------------------------------------------------------
# GET /vocabulary/activities — word reading practice data
# ---------------------------------------------------------------------------


def get_vocabulary_activities(assignment: Assignment, db: Session) -> dict:
    """Return vocabulary word-reading practice items."""
    if assignment.practice_mode != "word_reading":
        raise HTTPException(
            status_code=400,
            detail="This assignment is not in word_reading mode",
        )

    content_items = (
        db.query(ContentItem)
        .join(Content)
        .join(AssignmentContent)
        .filter(AssignmentContent.assignment_id == assignment.id)
        .order_by(ContentItem.order_index)
        .all()
    )

    if not content_items:
        raise HTTPException(status_code=404, detail="No vocabulary items found")

    items = []
    for item in content_items:
        items.append(
            {
                "id": item.id,
                "text": item.text,
                "translation": item.translation,
                "audio_url": item.audio_url,
                "image_url": item.image_url,
                "part_of_speech": item.part_of_speech,
                "order_index": item.order_index,
                "recording_url": None,
            }
        )

    return {
        "assignment_id": assignment.id,
        "title": assignment.title,
        "status": "preview",
        "practice_mode": "word_reading",
        "show_translation": (
            assignment.show_translation
            if assignment.show_translation is not None
            else True
        ),
        "show_image": (
            assignment.show_image if assignment.show_image is not None else True
        ),
        "time_limit_per_question": assignment.time_limit_per_question or 0,
        "total_items": len(items),
        "items": items,
    }


# ---------------------------------------------------------------------------
# GET /word-selection-start — word selection practice data
# ---------------------------------------------------------------------------


def _parse_exclude_ids(exclude_ids: str) -> set:
    """Parse comma-separated exclude IDs, skipping invalid tokens."""
    result = set()
    if not exclude_ids:
        return result
    for x in exclude_ids.split(","):
        x = x.strip()
        if x:
            try:
                result.add(int(x))
            except ValueError:
                pass
    return result


def get_word_selection_start(
    assignment: Assignment,
    db: Session,
    exclude_ids: str = "",
) -> dict:
    """Return word-selection practice data with options/distractors."""
    if assignment.practice_mode != "word_selection":
        raise HTTPException(
            status_code=400,
            detail="This assignment is not in word_selection mode",
        )

    content_items = (
        db.query(ContentItem)
        .join(Content)
        .join(AssignmentContent)
        .filter(AssignmentContent.assignment_id == assignment.id)
        .order_by(ContentItem.order_index)
        .all()
    )

    if not content_items:
        raise HTTPException(
            status_code=404,
            detail="No vocabulary items found for this assignment",
        )

    total_words_in_assignment = len(content_items)

    # (#379) Exclude already-practiced words
    exclude_id_set = _parse_exclude_ids(exclude_ids)
    remaining_items = [item for item in content_items if item.id not in exclude_id_set]

    if len(remaining_items) < 10:
        remaining_items = list(content_items)

    if assignment.shuffle_questions:
        random.shuffle(remaining_items)

    content_items = remaining_items[:10]

    # Build response
    words_with_options = []

    all_translations = {
        item.translation.lower().strip(): item.translation
        for item in content_items
        if item.translation
    }

    for item in content_items:
        correct_answer = item.translation or ""

        # Use stored distractors if available (≥3), else fallback to other words
        stored_distractors = item.distractors
        if isinstance(stored_distractors, list) and len(stored_distractors) >= 3:
            final_distractors = list(stored_distractors[:3])
        else:
            other_translations = [
                t
                for key, t in all_translations.items()
                if key != correct_answer.lower().strip()
            ]
            random.shuffle(other_translations)
            final_distractors = other_translations[:3]

        # Fallback for small word sets
        num_needed = 3 - len(final_distractors)
        for j in range(num_needed):
            final_distractors.append(f"選項{chr(65 + j)}")

        options = [correct_answer] + final_distractors
        random.shuffle(options)

        words_with_options.append(
            {
                "content_item_id": item.id,
                "text": item.text,
                "translation": correct_answer,
                "audio_url": item.audio_url,
                "image_url": item.image_url,
                "memory_strength": 0,
                "options": options,
            }
        )

    return {
        "session_id": None,
        "words": words_with_options,
        "total_words": total_words_in_assignment,
        "current_proficiency": 0,
        "target_proficiency": assignment.target_proficiency or 80,
        "show_word": assignment.show_word if assignment.show_word is not None else True,
        "show_image": (
            assignment.show_image if assignment.show_image is not None else True
        ),
        "play_audio": assignment.play_audio or False,
        "time_limit_per_question": assignment.time_limit_per_question,
    }


# ---------------------------------------------------------------------------
# POST /word-selection-answer — validate word selection
# ---------------------------------------------------------------------------


def check_word_selection_answer(
    content_item_id: int,
    selected_answer: str,
    assignment: Assignment,
    db: Session,
) -> dict:
    """Validate a word-selection answer (preview mode — no DB writes)."""
    content_item = (
        db.query(ContentItem).filter(ContentItem.id == content_item_id).first()
    )
    if not content_item:
        raise HTTPException(status_code=404, detail="Content item not found")

    is_correct = selected_answer == content_item.translation

    return {
        "is_correct": is_correct,
        "correct_answer": content_item.translation,
        "new_memory_strength": 0.5 if is_correct else 0,
        "current_mastery": 50.0,
        "target_mastery": assignment.target_proficiency or 80,
        "achieved": False,
    }


# ---------------------------------------------------------------------------
# GET /rearrangement-questions
# ---------------------------------------------------------------------------


def get_rearrangement_questions(assignment: Assignment, db: Session) -> dict:
    """Return rearrangement practice questions."""
    if assignment.practice_mode != "rearrangement":
        raise HTTPException(
            status_code=400,
            detail="This assignment is not in rearrangement mode",
        )

    content_items = (
        db.query(ContentItem)
        .join(Content)
        .join(AssignmentContent)
        .filter(AssignmentContent.assignment_id == assignment.id)
        .order_by(ContentItem.order_index)
        .all()
    )

    if not content_items:
        raise HTTPException(status_code=404, detail="No questions found")

    if assignment.shuffle_questions:
        random.shuffle(content_items)

    questions = []
    for item in content_items:
        fields = get_sentence_fields(
            item, item.content.type if item.content else None, "rearrangement"
        )
        if fields is None:
            continue  # skip vocab items without example_sentence
        q_text, q_translation, q_audio = fields

        words = q_text.strip().split()
        shuffled_words = words.copy()
        random.shuffle(shuffled_words)

        questions.append(
            {
                "content_item_id": item.id,
                "shuffled_words": shuffled_words,
                "word_count": item.word_count or len(words),
                "max_errors": item.max_errors or (3 if len(words) <= 10 else 5),
                "time_limit": (
                    assignment.time_limit_per_question
                    if assignment.time_limit_per_question is not None
                    else 30
                ),
                "play_audio": assignment.play_audio or False,
                "audio_url": q_audio,
                "translation": q_translation,
                "original_text": q_text.strip(),
            }
        )

    if not questions:
        # Return empty response instead of 404 to avoid breaking existing
        # assignments created before example_sentence data was available
        return {
            "student_assignment_id": assignment.id,
            "practice_mode": "rearrangement",
            "show_answer": assignment.show_answer or False,
            "score_category": assignment.score_category,
            "questions": [],
            "total_questions": 0,
        }

    return {
        "student_assignment_id": assignment.id,
        "practice_mode": "rearrangement",
        "show_answer": assignment.show_answer or False,
        "score_category": assignment.score_category,
        "questions": questions,
        "total_questions": len(questions),
    }


# ---------------------------------------------------------------------------
# POST /rearrangement-answer — per-word verification
# ---------------------------------------------------------------------------


def check_rearrangement_answer(
    content_item_id: int,
    selected_word: str,
    current_position: int,
    db: Session,
) -> dict:
    """Validate a single rearrangement word placement (preview — no DB writes)."""
    content_item = (
        db.query(ContentItem).filter(ContentItem.id == content_item_id).first()
    )
    if not content_item:
        raise HTTPException(status_code=404, detail="Content item not found")

    # Use example_sentence for vocab content in rearrangement mode
    fields = get_sentence_fields(
        content_item,
        content_item.content.type if content_item.content else None,
        "rearrangement",
    )
    q_text = fields[0] if fields else content_item.text
    correct_words = q_text.strip().split()
    word_count = len(correct_words)

    if current_position >= word_count:
        raise HTTPException(status_code=400, detail="Invalid position")

    correct_word = correct_words[current_position]
    is_correct = selected_word.strip() == correct_word.strip()

    max_errors = content_item.max_errors or (3 if word_count <= 10 else 5)

    return {
        "is_correct": is_correct,
        "correct_word": correct_word if not is_correct else None,
        "error_count": 0 if is_correct else 1,
        "max_errors": max_errors,
        "expected_score": 100.0 if is_correct else 90.0,
        "correct_word_count": current_position + 1 if is_correct else current_position,
        "total_word_count": word_count,
        "challenge_failed": False,
        "completed": is_correct and (current_position + 1 >= word_count),
    }


# ---------------------------------------------------------------------------
# POST /rearrangement-retry
# ---------------------------------------------------------------------------


def handle_rearrangement_retry() -> dict:
    """Return a simulated retry response (preview — no DB writes)."""
    return {
        "success": True,
        "retry_count": 1,
        "message": "Progress reset. You can start again.",
    }


# ---------------------------------------------------------------------------
# POST /rearrangement-complete
# ---------------------------------------------------------------------------


def handle_rearrangement_complete(
    expected_score: float = 100.0,
    timeout: bool = False,
) -> dict:
    """Return a simulated completion response (preview — no DB writes)."""
    return {
        "success": True,
        "final_score": expected_score,
        "timeout": timeout,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
