"""
Shared preview service for Demo and Teacher preview endpoints.

Extracts common business logic so that demo.py and assignment_ops.py
both delegate to the same functions. Neither API paths nor frontend
code are affected by this refactoring.
"""

import logging
import random
from datetime import datetime, timezone
from typing import List

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


async def ensure_example_sentence_audio(items: List[ContentItem], db: Session) -> dict:
    """Lazily generate missing example_sentence_audio_url for vocab items.

    Used by reading / rearrangement / word_cloze flows so the student (or
    teacher preview) always hears the full sentence audio rather than a
    fallback / blank.

    Idempotent and concurrency-safe: only updates rows where
    example_sentence_audio_url IS NULL at the time of write.

    Returns a dict {item_id: url} of every item now known to have audio
    (newly generated + already cached). Callers should use this dict as
    an authoritative override for `ci.example_sentence_audio_url` to
    avoid issues where SQLAlchemy expires attributes after commit and a
    subsequent refresh fails silently, leaving the in-memory attribute
    None even though DB has the URL.
    """
    # Lazy imports to avoid heavyweight module loads at request time
    from services.tts import TTSService
    from utils.ttsVoiceResolver import get_voice_and_rate
    from sqlalchemy import text as _sa_text

    # Start with whatever's already on the items (no-op for items that had it)
    audio_by_id: dict = {}
    for ci in items:
        if ci.example_sentence_audio_url:
            audio_by_id[ci.id] = ci.example_sentence_audio_url

    missing_audio_items = [
        ci
        for ci in items
        if ci.example_sentence
        and ci.example_sentence.strip()
        and not ci.example_sentence_audio_url
    ]
    if not missing_audio_items:
        return audio_by_id

    tts_service = TTSService()
    generated = 0
    for item in missing_audio_items:
        try:
            audio_settings = (
                item.item_metadata.get("audio_settings", {})
                if item.item_metadata
                else {}
            )
            voice, rate = get_voice_and_rate(
                audio_settings.get("accent", "American English"),
                audio_settings.get("gender", "Male"),
                audio_settings.get("speed", "Normal x1"),
            )
            url = await tts_service.generate_tts(item.example_sentence, voice, rate)
            rows = db.execute(
                _sa_text(
                    "UPDATE content_items "
                    "SET example_sentence_audio_url = :url "
                    "WHERE id = :id "
                    "AND (example_sentence_audio_url IS NULL "
                    "     OR example_sentence_audio_url = '')"
                ),
                {"url": url, "id": item.id},
            ).rowcount
            if rows > 0:
                item.example_sentence_audio_url = url
                generated += 1
            audio_by_id[item.id] = url
        except Exception as e:
            logger.warning(
                f"Lazy TTS generation failed for content_item {item.id}: {e}"
            )
    if generated > 0:
        db.commit()
        logger.info(f"Lazy-generated example sentence TTS for {generated} item(s)")
    return audio_by_id


async def ensure_word_audio(items: List[ContentItem], db: Session) -> dict:
    """Lazily generate missing audio_url (single-word TTS) for vocab items.

    Used by word_reading / word_spelling flows so the student (or teacher
    preview) always hears the word audio. Without this, audio mode for
    spelling shows nothing — translation is hidden by design and the
    audio button only renders when audio_url exists.

    Returns a dict {item_id: url}. See ensure_example_sentence_audio for
    why we return the dict instead of relying on in-memory attributes.
    """
    from services.tts import TTSService
    from utils.ttsVoiceResolver import get_voice_and_rate
    from sqlalchemy import text as _sa_text

    audio_by_id: dict = {}
    for ci in items:
        if ci.audio_url:
            audio_by_id[ci.id] = ci.audio_url

    missing_audio_items = [
        ci for ci in items if ci.text and ci.text.strip() and not ci.audio_url
    ]
    if not missing_audio_items:
        return audio_by_id

    tts_service = TTSService()
    generated = 0
    for item in missing_audio_items:
        try:
            audio_settings = (
                item.item_metadata.get("audio_settings", {})
                if item.item_metadata
                else {}
            )
            voice, rate = get_voice_and_rate(
                audio_settings.get("accent", "American English"),
                audio_settings.get("gender", "Male"),
                audio_settings.get("speed", "Normal x1"),
            )
            url = await tts_service.generate_tts(item.text, voice, rate)
            rows = db.execute(
                _sa_text(
                    "UPDATE content_items "
                    "SET audio_url = :url "
                    "WHERE id = :id "
                    "AND (audio_url IS NULL OR audio_url = '')"
                ),
                {"url": url, "id": item.id},
            ).rowcount
            if rows > 0:
                item.audio_url = url
                generated += 1
            audio_by_id[item.id] = url
        except Exception as e:
            logger.warning(
                f"Lazy word TTS generation failed for content_item {item.id}: {e}"
            )
    if generated > 0:
        db.commit()
        logger.info(f"Lazy-generated word TTS for {generated} item(s)")
    return audio_by_id


def get_sentence_fields(item: ContentItem, content_type, practice_mode: str):
    """Return (text, translation, audio_url) based on content type and practice mode.

    When using vocabulary set content in sentence practice modes (reading /
    rearrangement), we use the item's *example_sentence* fields instead of
    the primary text/translation (which hold the single word).

    Returns ``None`` when the item should be **skipped** — only happens for
    rearrangement mode without an example sentence (you can't shuffle a
    single word). Reading mode falls back to the word itself so the student
    still gets something to read aloud and AI-assess.
    """
    if practice_mode in ("reading", "rearrangement") and _is_vocab_type(content_type):
        sentence = (item.example_sentence or "").strip()
        if not sentence:
            if practice_mode == "rearrangement":
                return None  # 單字無法重組，整個 item 跳過
            # Reading mode 退回：用單字本身（text + audio_url）讓學生仍可朗讀
            return (item.text or "", item.translation or "", item.audio_url)
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
            # Issue #860: 例句挖空（與學生端同一支 extract_cloze_for_item）
            from utils.cloze import (
                extract_cloze_for_item as _extract_cloze,
                collapse_to_single_blank as _collapse_blank,
            )

            _item_cloze = _extract_cloze(item)
            items_data.append(
                {
                    "id": item.id,
                    "text": q_text,
                    "translation": q_translation,
                    "audio_url": q_audio,
                    "recording_url": None,
                    # Issue #860: 讓教師預覽頁在「顯示例句（答案挖空）」模式能重現題目。
                    # blanked_sentence 由後端算（含 cloze_answer 缺漏時的 fallback），
                    # 與學生端同源。
                    #
                    # 與 quiz_assignments._example_cloze_fields 一致，刻意不送
                    # example_sentence_translation / example_sentence_audio_url：
                    # 兩者都會洩漏答案（翻譯講出該單字、音檔唸出含答案的整句），
                    # 而本函式會被「公開未認證」的 demo preview 端點呼叫。
                    "example_sentence": getattr(item, "example_sentence", "") or "",
                    "cloze_answer": _item_cloze[1] if _item_cloze else "",
                    # Fail closed：挖不出空回空字串，不可退回原句（原句含答案）
                    "blanked_sentence": (
                        _collapse_blank(_item_cloze[0]) if _item_cloze else ""
                    ),
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
        "time_limit_per_question": assignment.time_limit_per_question,
        # Issue #828: surface the teacher's display settings so the quiz preview
        # reflects the actual assignment config (was hardcoded in the frontend).
        "play_audio": assignment.play_audio or False,
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
        "show_option_images": bool(getattr(assignment, "show_option_images", False)),
        "show_example_sentence": bool(
            getattr(assignment, "show_example_sentence", False)
        ),
        "quiz_time_limit_seconds": assignment.quiz_time_limit_seconds,
        # #854: 即刻練習練習畫面進階設定面板的初值需要這兩個欄位
        "shuffle_questions": bool(getattr(assignment, "shuffle_questions", False)),
        "target_proficiency": getattr(assignment, "target_proficiency", None),
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


async def get_word_selection_start(
    assignment: Assignment,
    db: Session,
    exclude_ids: str = "",
    ignore_stored_distractors: bool = False,
) -> dict:
    """Return word-selection practice data with options/distractors.

    ``ignore_stored_distractors`` (#923 demo): when the display language is
    overridden at runtime (e.g. a demo visitor flips ``show_image``), the
    stored distractors — generated for the assignment's original language —
    would mismatch the correct answer's language. Passing True forces the
    same-language runtime fallback below instead of reusing stored ones.
    """
    if assignment.practice_mode not in ("word_selection", "tug_of_war"):
        raise HTTPException(
            status_code=400,
            detail="This assignment does not support word-selection or tug-of-war mode",
        )

    # Issue #860: 例句挖空模式的 per-item payload 走與學生端相同的處理（見下方組裝）
    from utils.cloze import (
        extract_cloze_for_item as _extract_cloze,
        collapse_to_single_blank as _collapse_blank,
    )

    _show_example_sentence = bool(getattr(assignment, "show_example_sentence", False))

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

    if assignment.practice_mode == "tug_of_war":
        # 拔河模式：使用全部單字
        if not remaining_items:
            remaining_items = list(content_items)
        if assignment.shuffle_questions:
            random.shuffle(remaining_items)
        content_items = remaining_items
    else:
        if len(remaining_items) < 10:
            remaining_items = list(content_items)
        if assignment.shuffle_questions:
            random.shuffle(remaining_items)
        content_items = remaining_items[:10]

    # Backfill missing example_sentence_audio_url so tug_of_war cloze mode
    # always has audio (TTS-generated on demand if needed). Runs after
    # exclude filtering so we don't generate TTS for discarded words.
    sentence_audio_by_id = await ensure_example_sentence_audio(list(content_items), db)

    # Build response — Issue #631: options 升級為 list[{text, image_url}]
    # show_image 模式：選項用英文（item.text），題目隱藏英文，避免答案太明顯。
    from utils.distractors import normalize_distractors, text_field_for_show_image

    show_image_for_options = (
        assignment.show_image if assignment.show_image is not None else True
    )
    answer_field = text_field_for_show_image(show_image_for_options)

    words_with_options = []

    for item in content_items:
        correct_answer = getattr(item, answer_field) or ""

        # Use stored distractors if available (≥3), else fallback to other words
        stored = normalize_distractors(item.distractors)
        if not ignore_stored_distractors and len(stored) >= 3:
            final_distractors = list(stored[:3])
        else:
            target = correct_answer.lower().strip()
            pool = [
                {"text": getattr(other, answer_field), "image_url": other.image_url}
                for other in content_items
                if getattr(other, answer_field)
                and getattr(other, answer_field).lower().strip() != target
            ]
            random.shuffle(pool)
            final_distractors = pool[:3]

        # Fallback for small word sets
        num_needed = 3 - len(final_distractors)
        for j in range(num_needed):
            final_distractors.append({"text": f"選項{chr(65 + j)}", "image_url": None})

        correct_option = {"text": correct_answer, "image_url": item.image_url}
        options = [correct_option] + final_distractors
        random.shuffle(options)

        # Issue #860: 例句挖空模式下，per-item payload 必須與學生端同一套處理 ——
        # 送後端算好的 blanked_sentence，並拿掉例句翻譯／例句音檔（翻譯直接講出
        # 該單字、音檔唸出含答案的整句）。本函式支撐「公開未認證」的 demo 端點，
        # 前端有沒有渲染不算數，JSON 裡有就是洩漏。
        if _show_example_sentence:
            _cloze = _extract_cloze(item)
            example_fields = {
                "example_sentence": item.example_sentence or "",
                "cloze_answer": _cloze[1] if _cloze else "",
                "blanked_sentence": (_collapse_blank(_cloze[0]) if _cloze else ""),
            }
        else:
            example_fields = {
                "example_sentence": item.example_sentence or "",
                "example_sentence_translation": (
                    item.example_sentence_translation or ""
                ),
                "example_sentence_audio_url": (
                    sentence_audio_by_id.get(item.id)
                    or item.example_sentence_audio_url
                    or ""
                ),
            }

        words_with_options.append(
            {
                "content_item_id": item.id,
                "text": item.text,
                "translation": item.translation or "",
                "correct_text": correct_answer,
                "audio_url": item.audio_url,
                "image_url": item.image_url,
                **example_fields,
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
        "show_option_images": bool(getattr(assignment, "show_option_images", False)),
        "show_example_sentence": bool(
            getattr(assignment, "show_example_sentence", False)
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

    show_image_mode = (
        assignment.show_image if assignment.show_image is not None else True
    )
    correct_text = (
        content_item.text if show_image_mode else content_item.translation
    ) or ""
    is_correct = selected_answer == correct_text

    return {
        "is_correct": is_correct,
        "correct_answer": correct_text,
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


# ---------------------------------------------------------------------------
# GET /word-spelling-start — word spelling practice data
# ---------------------------------------------------------------------------


async def get_word_spelling_start(
    assignment: Assignment,
    db: Session,
    exclude_ids: str = "",
) -> dict:
    """Return word-spelling practice data (preview/demo).

    Mirrors the Ebbinghaus pattern from word-selection: each "round" returns
    up to 10 items; the frontend tracks practiced ids and passes them via
    exclude_ids so subsequent rounds rotate through unpractised items first.

    Lazily backfills missing ci.audio_url so audio mode always has the
    word TTS to play.
    """
    if assignment.practice_mode != "word_spelling":
        raise HTTPException(
            status_code=400,
            detail="This assignment does not support word-spelling mode",
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

    # Backfill missing single-word audio so 播放音檔 mode actually has audio.
    word_audio_by_id = await ensure_word_audio(list(content_items), db)
    sentence_audio_by_id = await ensure_example_sentence_audio(list(content_items), db)

    total_words_in_assignment = len(content_items)
    exclude_id_set = _parse_exclude_ids(exclude_ids)
    remaining_items = [item for item in content_items if item.id not in exclude_id_set]
    if len(remaining_items) < 10:
        # round wraps — start a fresh cycle
        remaining_items = list(content_items)
    if assignment.shuffle_questions:
        random.shuffle(remaining_items)
    items_list = remaining_items[:10]

    words_data = [
        {
            "content_item_id": ci.id,
            "text": ci.text,
            "translation": ci.translation or "",
            "audio_url": word_audio_by_id.get(ci.id) or ci.audio_url,
            "image_url": ci.image_url,
            "memory_strength": 0,
            # Issue #715: 答對後翻面顯示完整單字卡所需欄位
            "part_of_speech": ci.part_of_speech,
            "example_sentence": ci.example_sentence,
            "example_sentence_translation": ci.example_sentence_translation,
            "example_sentence_audio_url": (
                sentence_audio_by_id.get(ci.id) or ci.example_sentence_audio_url
            ),
        }
        for ci in items_list
    ]

    return {
        "session_id": None,
        "words": words_data,
        "total_words": total_words_in_assignment,
        "current_proficiency": 0,
        "target_proficiency": assignment.target_proficiency or 80,
        "words_mastered": 0,
        "achieved": False,
        "is_practice_mode": False,
        "show_translation": (
            assignment.show_translation
            if assignment.show_translation is not None
            else True
        ),
        "show_image": (
            assignment.show_image if assignment.show_image is not None else True
        ),
        "play_audio": assignment.play_audio or False,
        "show_answer": assignment.show_answer or False,
        "time_limit_per_question": assignment.time_limit_per_question,
    }


# ---------------------------------------------------------------------------
# GET /word-cloze-start — word cloze practice data
# ---------------------------------------------------------------------------


async def get_word_cloze_start(
    assignment: Assignment,
    db: Session,
    exclude_ids: str = "",
) -> dict:
    """Return word-cloze practice data (preview/demo).

    Returns up to 10 cloze questions per round. Frontend tracks practiced
    ids and passes them via exclude_ids to cycle through unpractised items
    first.

    Lazily backfills missing example_sentence_audio_url so previews hear
    the full sentence audio.
    """
    if assignment.practice_mode != "word_cloze":
        raise HTTPException(
            status_code=400,
            detail="This assignment does not support word-cloze mode",
        )

    # Lazy import to avoid circular dependency
    from routers.students.assignments import extract_cloze_for_item

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

    # Generate any missing example sentence audio so audio_url isn't blank.
    sentence_audio_by_id = await ensure_example_sentence_audio(list(content_items), db)

    exclude_id_set = _parse_exclude_ids(exclude_ids)
    remaining_items = [item for item in content_items if item.id not in exclude_id_set]
    if len(remaining_items) < 10:
        remaining_items = list(content_items)
    if assignment.shuffle_questions:
        random.shuffle(remaining_items)

    questions = []
    for ci in remaining_items:
        if len(questions) >= 10:
            break
        cloze = extract_cloze_for_item(ci)
        if cloze is None:
            continue
        blanked_sentence, correct_answer = cloze
        is_vocab_item = bool(ci.example_sentence)
        sentence_audio_for_item = (
            sentence_audio_by_id.get(ci.id) or ci.example_sentence_audio_url
            if is_vocab_item
            else ci.audio_url
        )
        questions.append(
            {
                "content_item_id": ci.id,
                "base_word": ci.text if is_vocab_item else "",
                "translation": ci.translation if is_vocab_item else "",
                "blanked_sentence": blanked_sentence,
                "sentence_translation": (
                    ci.example_sentence_translation
                    if is_vocab_item
                    else (ci.translation or "")
                )
                or "",
                # Vocab items must use example sentence audio (not the
                # single-word audio); example sentence content uses its
                # own audio_url which IS the sentence audio.
                # Use the helper's authoritative dict to dodge SQLAlchemy
                # expire_on_commit edge cases.
                "audio_url": sentence_audio_for_item,
                "correct_answer": correct_answer,
                "correct_answer_length": len(correct_answer),
                # Issue #880: 派發面板的「顯示圖片」開關需要題目圖片才能生效
                "image_url": ci.image_url,
                # Issue #715: 答對後翻面顯示完整單字卡所需欄位
                "part_of_speech": ci.part_of_speech if is_vocab_item else None,
                "example_sentence": ci.example_sentence if is_vocab_item else None,
                "example_sentence_translation": (
                    ci.example_sentence_translation if is_vocab_item else None
                ),
                "example_sentence_audio_url": (
                    sentence_audio_for_item if is_vocab_item else None
                ),
                "word_audio_url": ci.audio_url if is_vocab_item else None,
            }
        )

    if not questions:
        raise HTTPException(
            status_code=400,
            detail=(
                "No usable cloze questions: example sentences do not contain "
                "the target word."
            ),
        )

    return {
        "session_id": None,
        "questions": questions,
        "total_questions": total_words_in_assignment,
        "current_proficiency": 0,
        "target_proficiency": assignment.target_proficiency or 80,
        "words_mastered": 0,
        "achieved": False,
        "is_practice_mode": False,
        "show_translation": (
            assignment.show_translation
            if assignment.show_translation is not None
            else True
        ),
        "show_image": (
            assignment.show_image if assignment.show_image is not None else True
        ),
        "play_audio": assignment.play_audio or False,
        "show_answer": assignment.show_answer or False,
        "time_limit_per_question": assignment.time_limit_per_question,
    }
