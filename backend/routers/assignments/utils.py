"""
Utility functions for assignment processing
"""

from typing import List, Dict, Any


async def process_audio_with_whisper(
    audio_urls: List[str], expected_texts: List[str]
) -> Dict[str, Any]:
    """
    Mock implementation for processing audio with Whisper API

    In production, this should integrate with OpenAI Whisper API:
    - Send audio files to Whisper for transcription
    - Compare transcriptions with expected texts
    - Return accuracy scores and detailed analysis

    For now, returns mock data for development/testing
    """
    return {
        "transcriptions": [
            {
                "item_id": i,
                "expected_text": text,
                "transcribed_text": text,  # Mock: return same as expected
                "words": [],
            }
            for i, text in enumerate(expected_texts)
        ],
        "audio_analysis": {"total_duration": 10.0},
    }


def calculate_text_similarity(expected: str, actual: str) -> float:
    """Calculate similarity between expected and actual text"""
    if not expected or not actual:
        return 0.0
    # Simple mock implementation - should use proper text similarity algorithm
    return 0.85 if expected.lower() == actual.lower() else 0.5


def calculate_pronunciation_score(words: List[Dict]) -> float:
    """Calculate pronunciation score from word-level analysis"""
    # Mock implementation
    return 85.0


def calculate_fluency_score(audio_analysis: Dict[str, Any]) -> float:
    """Calculate fluency score from audio analysis"""
    # Mock implementation
    return 80.0


def calculate_wpm(text: str, duration: float) -> int:
    """Calculate words per minute"""
    if duration <= 0:
        return 0
    word_count = len(text.split()) if text else 0
    return int((word_count / duration) * 60)


def generate_ai_feedback(ai_scores: "AIScores", detailed_results: List[Dict]) -> str:
    """Generate AI feedback based on scores"""
    # Mock implementation
    feedback = "Overall performance is good. "
    feedback += f"Pronunciation: {ai_scores.pronunciation}/100. "
    feedback += f"Fluency: {ai_scores.fluency}/100. "
    feedback += f"Accuracy: {ai_scores.accuracy}/100."
    return feedback


# ============ Batch Grading Helper Functions ============


def get_score_with_fallback(
    item_progress,
    field_name: str,
    json_key: str,
    db,
    ai_feedback_data: dict = None,
) -> float:
    """
    Get score from independent field or ai_feedback JSON with automatic backfill.

    This handles migration from old data (scores in JSON) to new schema (independent fields).
    If score is NULL in field but exists in JSON, it backfills the field on-the-fly.

    Args:
        item_progress: StudentItemProgress instance
        field_name: Database field name (e.g., 'completeness_score')
        json_key: JSON key in ai_feedback (e.g., 'completeness_score')
        db: Database session for backfill commit
        ai_feedback_data: Parsed ai_feedback dict (optimization to avoid re-parsing)

    Returns:
        float: Score value (0 if not found in either location)
    """
    import json
    import logging
    from decimal import Decimal

    logger = logging.getLogger(__name__)
    score = getattr(item_progress, field_name)

    # If field has value, return it
    if score is not None:
        return float(score)

    # Field is NULL - try fallback to JSON
    if not item_progress.ai_feedback:
        return 0.0

    # Parse JSON if not already provided
    if ai_feedback_data is None:
        try:
            ai_feedback_data = (
                json.loads(item_progress.ai_feedback)
                if isinstance(item_progress.ai_feedback, str)
                else item_progress.ai_feedback
            )
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning(
                f"Failed to parse ai_feedback JSON for item_progress {item_progress.id}: {e}"
            )
            return 0.0

    # Try to get score from JSON
    json_score = ai_feedback_data.get(json_key)
    if json_score is None:
        return 0.0

    # Found score in JSON - backfill the database field on the session.
    # The caller (e.g. batch_grade_assignment) commits at the end of its
    # work; an inner commit here would partially persist work mid-loop and
    # leave the session inconsistent if a later failure rolls back the
    # outer transaction.
    try:
        setattr(item_progress, field_name, Decimal(str(json_score)))
        logger.info(
            f"Backfilled {field_name}={json_score} for item_progress "
            f"{item_progress.id} from ai_feedback JSON (uncommitted)"
        )
        return float(json_score)
    except Exception as e:
        logger.error(
            f"Failed to backfill {field_name} for item_progress {item_progress.id}: {e}"
        )
        # Don't rollback — caller owns the transaction. Return the JSON
        # value so scoring continues with the right number.
        return float(json_score)


def generate_item_comment(
    pronunciation: float,
    accuracy: float,
    fluency: float,
    completeness: float,
) -> str:
    """
    Generate AI comment for a single item based on scores.
    Returns Chinese feedback based on score patterns.

    Args:
        pronunciation: Pronunciation score (0-100)
        accuracy: Accuracy score (0-100)
        fluency: Fluency score (0-100)
        completeness: Completeness score (0-100)

    Returns:
        str: Chinese comment summarizing performance
    """
    comments = []

    # Pronunciation feedback
    if pronunciation >= 90:
        comments.append("發音非常標準")
    elif pronunciation >= 80:
        comments.append("發音良好")
    elif pronunciation >= 70:
        comments.append("發音尚可，可以再進步")
    else:
        comments.append("發音需要加強練習")

    # Fluency feedback
    if fluency >= 90:
        comments.append("表達流暢自然")
    elif fluency >= 80:
        comments.append("表達流暢")
    elif fluency < 70:
        comments.append("可以試著說得更流暢")

    # Completeness feedback
    if completeness < 70:
        comments.append("句子完整度需要提升")

    # Accuracy feedback
    if accuracy < 70:
        comments.append("準確度有待加強")

    return "、".join(comments) + "。" if comments else "表現良好。"


def generate_assignment_feedback(
    total_items: int,
    completed_items: int,
    avg_score: float,
    avg_pronunciation: float,
    avg_fluency: float,
    avg_accuracy: float,
    avg_completeness: float,
) -> str:
    """
    Generate overall assignment feedback in Chinese.

    Args:
        total_items: Total number of items in assignment
        completed_items: Number of items with recordings
        avg_score: Average overall score
        avg_pronunciation: Average pronunciation score
        avg_fluency: Average fluency score
        avg_accuracy: Average accuracy score
        avg_completeness: Average completeness score

    Returns:
        str: Chinese feedback summarizing overall performance
    """
    feedback_parts = []

    # Completion status
    completion_rate = (completed_items / total_items * 100) if total_items > 0 else 0
    if completion_rate == 100:
        feedback_parts.append(f"完整完成了所有 {total_items} 題")
    else:
        feedback_parts.append(f"完成了 {completed_items}/{total_items} 題")

    # Overall performance
    if avg_score >= 90:
        feedback_parts.append("整體表現優秀")
    elif avg_score >= 80:
        feedback_parts.append("整體表現良好")
    elif avg_score >= 70:
        feedback_parts.append("整體表現尚可")
    else:
        feedback_parts.append("還有進步空間")

    # Detailed breakdown (only if has completed items)
    if completed_items > 0:
        details = []
        if avg_pronunciation >= 85:
            details.append(f"發音標準（{avg_pronunciation:.0f}分）")
        elif avg_pronunciation < 70:
            details.append(f"發音需加強（{avg_pronunciation:.0f}分）")

        if avg_fluency >= 85:
            details.append(f"表達流暢（{avg_fluency:.0f}分）")
        elif avg_fluency < 70:
            details.append(f"流暢度需提升（{avg_fluency:.0f}分）")

        if avg_completeness >= 85:
            details.append(f"內容完整（{avg_completeness:.0f}分）")
        elif avg_completeness < 70:
            details.append(f"完整度需加強（{avg_completeness:.0f}分）")

        if details:
            feedback_parts.append("。".join(details))

    return "，".join(feedback_parts) + "。"


async def trigger_ai_assessment_for_item(
    item_progress,
    db,
    content_item=None,
) -> bool:
    """
    Trigger AI assessment for a single item that has recording but no scores.

    This function:
    1. Downloads audio from recording_url
    2. Converts audio to WAV format
    3. Calls Azure Speech Assessment API
    4. Stores results in database

    Args:
        item_progress: StudentItemProgress instance
        db: Database session
        content_item: Pre-loaded ContentItem instance (optional, for performance)

    Returns:
        bool: True if assessment succeeded, False otherwise
    """
    import json
    import logging
    from datetime import datetime, timezone
    from decimal import Decimal

    logger = logging.getLogger(__name__)

    if not item_progress.recording_url:
        logger.warning(f"Item {item_progress.id} has no recording_url")
        return False

    if item_progress.ai_assessed_at is not None:
        logger.info(f"Item {item_progress.id} already assessed, skipping")
        return False  # Already assessed

    try:
        # Import httpx for downloading audio
        import httpx
        from models import ContentItem

        # Get reference text from content item (use pre-loaded or query if not provided)
        if content_item is None:
            content_item = (
                db.query(ContentItem)
                .filter(ContentItem.id == item_progress.content_item_id)
                .first()
            )

        if not content_item:
            logger.error(f"ContentItem not found for item_progress {item_progress.id}")
            return False

        reference_text = content_item.text

        # Download audio from recording_url
        async with httpx.AsyncClient(timeout=30.0) as client:
            audio_response = await client.get(item_progress.recording_url)
            audio_data = audio_response.content
            # GCS returns the upload's stored Content-Type. Pass it through —
            # convert_audio_to_wav prefers magic-byte sniffing anyway, so a
            # mislabel still works, but a correct label helps when sniffing
            # can't decide.
            content_type = audio_response.headers.get("content-type", "")

        # Convert audio to WAV format
        from routers.speech_assessment import convert_audio_to_wav

        wav_data = convert_audio_to_wav(audio_data, content_type)

        # Call Azure Speech Assessment API (synchronous function)
        from routers.speech_assessment import assess_pronunciation

        assessment_result = assess_pronunciation(wav_data, reference_text)

        # Store results
        item_progress.accuracy_score = Decimal(
            str(assessment_result.get("accuracy_score", 0))
        )
        item_progress.fluency_score = Decimal(
            str(assessment_result.get("fluency_score", 0))
        )
        item_progress.pronunciation_score = Decimal(
            str(assessment_result.get("pronunciation_score", 0))
        )
        item_progress.completeness_score = Decimal(
            str(assessment_result.get("completeness_score", 0))
        )
        item_progress.transcription = assessment_result.get("recognized_text", "")
        item_progress.ai_feedback = json.dumps(assessment_result)
        item_progress.ai_assessed_at = datetime.now(timezone.utc)

        db.commit()
        logger.info(f"Successfully assessed item_progress {item_progress.id}")
        return True

    except Exception as e:
        logger.error(f"Failed to assess item_progress {item_progress.id}: {e}")
        db.rollback()
        return False
