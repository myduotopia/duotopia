"""
Demo router - Public demo assignment preview endpoints with rate limiting.

This module provides public access to demo assignments created by the demo teacher account.
No authentication required, but rate-limited to prevent abuse.

Includes:
- Demo Azure Speech Token endpoint (with daily quota)
- Demo assignment preview endpoints
- Demo speech assessment endpoints
"""

import logging
import os
from typing import Optional
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    status,
    Request,
    Header,
    UploadFile,
    File,
    Form,
)
from sqlalchemy.orm import Session
from core.limiter import limiter
from core.demo_quota import (
    get_demo_quota_manager,
    validate_referer,
    reset_demo_quota,
    DEMO_TOKEN_DAILY_LIMIT,
)
from database import get_db
from models import (
    DemoConfig,
    Teacher,
    Assignment,
    Classroom,
)
from services.preview_service import (
    build_assignment_preview,
    assess_speech_preview,
    get_vocabulary_activities,
    get_word_selection_start,
    get_word_spelling_start,
    get_word_cloze_start,
    check_word_selection_answer,
    get_rearrangement_questions,
    check_rearrangement_answer,
    handle_rearrangement_retry,
    handle_rearrangement_complete,
    WordSelectionAnswerRequest,
    RearrangementAnswerRequest,
    RearrangementCompleteRequest,
)
from utils.practice_mode import validate_practice_mode
from utils.score_category import resolve_score_category

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/demo", tags=["demo"])

# Demo teacher email - from environment or default
DEMO_TEACHER_EMAIL = os.getenv("DEMO_TEACHER_EMAIL", "contact@duotopia.co")


# ============================================================================
# Helper Functions
# ============================================================================


def get_demo_assignment(assignment_id: int, db: Session) -> Assignment:
    """
    Validate that assignment belongs to demo teacher account.

    Args:
        assignment_id: Assignment ID to validate
        db: Database session

    Returns:
        Assignment object if valid

    Raises:
        HTTPException: 404 if assignment not found or doesn't belong to demo account
    """
    assignment = (
        db.query(Assignment)
        .join(Classroom)
        .join(Teacher)
        .filter(
            Assignment.id == assignment_id,
            Teacher.email == DEMO_TEACHER_EMAIL,
            Assignment.is_active == True,  # noqa: E712
        )
        .first()
    )

    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Demo assignment not found",
        )

    return assignment


# ============================================================================
# Stateless settings overlay (#923)
# ============================================================================
#
# The demo assignment is a SINGLE row shared by every anonymous visitor. To let
# a visitor try the same material with different settings / practice modes via
# the advanced-settings panel WITHOUT persisting anything, demo read endpoints
# accept the settings as optional query params and wrap the real row in a
# read-only overlay. The overlay is not a SQLAlchemy instance and is never added
# to the session, so a visitor's choices can never leak into the shared row.


class _AssignmentOverlay:
    """Read-only overlay: returns overridden settings where provided, else falls
    through to the real Assignment row. Never enters the DB session (#923)."""

    __slots__ = ("_assignment", "_overrides")

    def __init__(self, assignment: Assignment, overrides: dict):
        object.__setattr__(self, "_assignment", assignment)
        object.__setattr__(self, "_overrides", overrides)

    def __getattr__(self, name):
        overrides = object.__getattribute__(self, "_overrides")
        if name in overrides:
            return overrides[name]
        return getattr(object.__getattribute__(self, "_assignment"), name)


def demo_overrides(
    practice_mode: Optional[str] = Query(None),
    show_answer: Optional[bool] = Query(None),
    play_audio: Optional[bool] = Query(None),
    show_translation: Optional[bool] = Query(None),
    show_word: Optional[bool] = Query(None),
    show_image: Optional[bool] = Query(None),
    show_option_images: Optional[bool] = Query(None),
    shuffle_questions: Optional[bool] = Query(None),
    time_limit_per_question: Optional[int] = Query(None),
    quiz_time_limit_seconds: Optional[int] = Query(None),
    target_proficiency: Optional[int] = Query(None),
) -> dict:
    """Collect optional demo settings overrides from the query string (#923).

    Absent params stay absent (the real row's value is used). ``practice_mode``
    is whitelist-validated; an invalid value is a 422.
    """
    if practice_mode is not None:
        try:
            validate_practice_mode(practice_mode)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
            )
    provided = {
        "practice_mode": practice_mode,
        "show_answer": show_answer,
        "play_audio": play_audio,
        "show_translation": show_translation,
        "show_word": show_word,
        "show_image": show_image,
        "show_option_images": show_option_images,
        "shuffle_questions": shuffle_questions,
        "time_limit_per_question": time_limit_per_question,
        "quiz_time_limit_seconds": quiz_time_limit_seconds,
        "target_proficiency": target_proficiency,
    }
    return {k: v for k, v in provided.items() if v is not None}


def _apply_overrides(assignment: Assignment, overrides: dict) -> Assignment:
    """Wrap ``assignment`` with visitor ``overrides`` (no-op if empty).

    Recomputes ``score_category`` from the effective (practice_mode, play_audio)
    — the frontend must not send score_category — and enforces the
    ``show_image`` / ``show_option_images`` XOR invariant.
    """
    if not overrides:
        return assignment

    effective = dict(overrides)
    practice_mode = effective.get("practice_mode", assignment.practice_mode)
    play_audio = effective.get("play_audio", bool(assignment.play_audio))
    if effective.get("show_image") and effective.get("show_option_images"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="show_image and show_option_images are mutually exclusive",
        )
    effective["score_category"] = resolve_score_category(practice_mode, play_audio)
    # type: ignore[return-value] — overlay quacks like Assignment for readers.
    return _AssignmentOverlay(assignment, effective)


# ============================================================================
# Demo Azure Speech Token
# ============================================================================


def get_client_ip(request: Request) -> str:
    """Get real client IP from trusted proxy (Cloud Run / GCP Load Balancer).

    Uses the rightmost IP in X-Forwarded-For, which is the one appended by
    the last trusted proxy (e.g., Cloud Run ingress). The leftmost IP can be
    spoofed by the client, so we avoid using it for quota enforcement.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        ips = [ip.strip() for ip in forwarded.split(",")]
        # Always use rightmost — appended by our trusted proxy
        return ips[-1]
    if request.client:
        return request.client.host
    return "unknown"


@router.post("/azure-speech/token")
@limiter.limit("5/minute")
async def get_demo_speech_token(request: Request):
    """
    Demo-only Azure Speech Token endpoint.

    This endpoint provides Azure Speech tokens for demo users without authentication.
    Protected by multiple layers:
    1. Rate Limit: 5 requests per minute per IP (slowapi)
    2. Daily Quota: 60 requests per day per IP
    3. Referer Validation: Only accepts requests from allowed origins
    4. Short Token TTL: 5 minutes (vs normal 10 minutes)

    Rate limit: 5 requests per minute per IP.
    Daily limit: 60 requests per day per IP.

    Returns:
        {
            "token": "<azure-speech-token>",
            "region": "japaneast",
            "expires_in": 300,
            "demo_mode": true,
            "remaining_today": <remaining quota>
        }

    Errors:
        403: Invalid referer
        429: Rate limit or daily quota exceeded
        500: Azure token service error
    """
    client_ip = get_client_ip(request)
    referer = request.headers.get("referer", "")

    # Layer 1: Referer validation
    if not validate_referer(referer):
        logger.warning(
            f"Demo token rejected - invalid referer: {referer}, IP: {client_ip}"
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid request origin",
        )

    # Layer 2: Daily quota check
    quota_manager = get_demo_quota_manager()
    allowed, quota_info = quota_manager.check_and_increment(client_ip)

    if not allowed:
        logger.info(
            f"Demo token daily limit reached: IP={client_ip}, limit={DEMO_TOKEN_DAILY_LIMIT}"
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "daily_limit_exceeded",
                "message": "今日免費試用次數已達上限",
                "suggestion": "註冊帳號即可無限使用",
                "limit": DEMO_TOKEN_DAILY_LIMIT,
                "reset_at": quota_info["reset_at"],
            },
        )

    # Layer 3: Get token from Azure
    try:
        from services.azure_speech_token import get_azure_speech_token_service

        token_service = get_azure_speech_token_service()
        token_data = await token_service.get_token()

        logger.info(
            f"Demo token issued: IP={client_ip}, "
            f"remaining={quota_info['remaining']}/{DEMO_TOKEN_DAILY_LIMIT}, "
            f"referer={referer[:50] if referer else 'none'}"
        )

        return {
            "token": token_data["token"],
            "region": token_data["region"],
            "expires_in": 300,  # 5 minutes (shorter than normal 10 min)
            "demo_mode": True,
            "remaining_today": quota_info["remaining"],
        }

    except Exception as e:
        logger.error(f"Demo token error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get speech token",
        )


@router.post("/azure-speech/reset-quota")
async def reset_demo_quota_endpoint(
    request: Request,
    ip: str = None,
    admin_secret: Optional[str] = Header(default=None, alias="X-Admin-Secret"),
):
    """
    Reset demo token quota (development/staging only).

    This endpoint is only available in non-production environments
    for testing purposes. In staging, requires DEMO_RESET_SECRET.

    Args:
        ip: Optional specific IP to reset. If not provided, resets caller's IP.
        admin_secret: Required in staging for authorization.

    Returns:
        Number of entries reset
    """
    environment = os.getenv("ENVIRONMENT", "development")

    # Only allow in non-production environments
    if environment == "production":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint is not available in production",
        )

    # Require secret in staging
    if environment == "staging":
        expected_secret = os.getenv("DEMO_RESET_SECRET")
        if not expected_secret or admin_secret != expected_secret:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized",
            )

    # If no IP specified, reset the caller's IP
    target_ip = ip or get_client_ip(request)

    count = reset_demo_quota(target_ip)
    logger.info(f"Demo quota reset: IP={target_ip}, count={count}")

    return {
        "success": True,
        "message": f"Reset quota for {target_ip}",
        "entries_reset": count,
    }


# ============================================================================
# Demo Config API
# ============================================================================


@router.get("/config")
@limiter.limit("30/minute")
async def get_demo_config(request: Request, db: Session = Depends(get_db)):
    """
    Get demo configuration (assignment IDs for 4 practice modes).

    Rate limit: 30 requests per minute per IP.
    """
    configs = db.query(DemoConfig).all()
    return {c.key: c.value for c in configs}


# ============================================================================
# Demo Preview Endpoints — thin wrappers around preview_service
# ============================================================================


@router.get("/assignments/{assignment_id}/preview")
@limiter.limit("60/minute")
async def get_demo_preview(
    request: Request,
    assignment_id: int,
    ov: dict = Depends(demo_overrides),
    db: Session = Depends(get_db),
):
    """Get demo assignment preview (no authentication required).

    Optional settings overrides (#923) let the advanced-settings panel preview
    the same material in a different mode/config without persisting.
    """
    assignment = _apply_overrides(get_demo_assignment(assignment_id, db), ov)
    return build_assignment_preview(assignment, db)


@router.post("/assignments/preview/assess-speech")
@limiter.limit("120/minute")
async def demo_assess_speech(
    request: Request,
    audio_file: UploadFile = File(...),
    reference_text: str = Form(...),
    assignment_id: int = Form(...),
    db: Session = Depends(get_db),
):
    """Demo speech assessment (no authentication, no recording storage)."""
    get_demo_assignment(assignment_id, db)
    result = await assess_speech_preview(audio_file, reference_text)
    result["demo_mode"] = True
    return result


@router.get("/assignments/{assignment_id}/preview/vocabulary/activities")
@limiter.limit("60/minute")
async def demo_vocabulary_activities(
    request: Request,
    assignment_id: int,
    ov: dict = Depends(demo_overrides),
    db: Session = Depends(get_db),
):
    """Demo mode: Get vocabulary word reading practice data."""
    assignment = _apply_overrides(get_demo_assignment(assignment_id, db), ov)
    return get_vocabulary_activities(assignment, db)


@router.get("/assignments/{assignment_id}/preview/word-selection-start")
@limiter.limit("60/minute")
async def demo_word_selection_start(
    request: Request,
    assignment_id: int,
    exclude_ids: str = Query(
        default="", description="Already-practiced content_item_ids, comma-separated"
    ),
    ov: dict = Depends(demo_overrides),
    db: Session = Depends(get_db),
):
    """Demo mode: Start word selection practice."""
    assignment = _apply_overrides(get_demo_assignment(assignment_id, db), ov)
    # When show_image is overridden the answer language flips, so stored
    # distractors (built for the original language) would mismatch — force the
    # same-language runtime fallback in that case (#923).
    return await get_word_selection_start(
        assignment, db, exclude_ids, ignore_stored_distractors="show_image" in ov
    )


@router.get("/assignments/{assignment_id}/preview/word-spelling-start")
@limiter.limit("60/minute")
async def demo_word_spelling_start(
    request: Request,
    assignment_id: int,
    exclude_ids: str = Query(
        default="", description="Already-practiced content_item_ids, comma-separated"
    ),
    ov: dict = Depends(demo_overrides),
    db: Session = Depends(get_db),
):
    """Demo mode: Start word spelling practice."""
    assignment = _apply_overrides(get_demo_assignment(assignment_id, db), ov)
    return await get_word_spelling_start(assignment, db, exclude_ids)


@router.get("/assignments/{assignment_id}/preview/word-cloze-start")
@limiter.limit("60/minute")
async def demo_word_cloze_start(
    request: Request,
    assignment_id: int,
    exclude_ids: str = Query(
        default="", description="Already-practiced content_item_ids, comma-separated"
    ),
    ov: dict = Depends(demo_overrides),
    db: Session = Depends(get_db),
):
    """Demo mode: Start word cloze practice."""
    assignment = _apply_overrides(get_demo_assignment(assignment_id, db), ov)
    return await get_word_cloze_start(assignment, db, exclude_ids)


# ----------------------------------------------------------------------------
# Demo quiz-start endpoints (#923) — public, unauthenticated mirrors of the
# teacher-preview quiz-start endpoints. They share the same builders so the
# visitor sees exactly the teacher-preview screen (正解/選項, non-live, no
# scoring). answer/complete are short-circuited on the frontend in demo mode,
# so no submission endpoints are needed.
# ----------------------------------------------------------------------------


@router.get("/assignments/{assignment_id}/preview/selection-quiz-start")
@limiter.limit("60/minute")
async def demo_selection_quiz_start(
    request: Request,
    assignment_id: int,
    ov: dict = Depends(demo_overrides),
    db: Session = Depends(get_db),
):
    """Demo mode: Start word selection quiz."""
    assignment = _apply_overrides(get_demo_assignment(assignment_id, db), ov)
    if assignment.practice_mode != "word_selection_quiz":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This assignment is not a word_selection_quiz",
        )
    from routers.students.quiz_assignments import build_selection_quiz_payload

    return build_selection_quiz_payload(assignment, db)


@router.get("/assignments/{assignment_id}/preview/spelling-quiz-start")
@limiter.limit("60/minute")
async def demo_spelling_quiz_start(
    request: Request,
    assignment_id: int,
    ov: dict = Depends(demo_overrides),
    db: Session = Depends(get_db),
):
    """Demo mode: Start word spelling quiz."""
    assignment = _apply_overrides(get_demo_assignment(assignment_id, db), ov)
    if assignment.practice_mode != "word_spelling_quiz":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This assignment is not a word_spelling_quiz",
        )
    from routers.students.quiz_assignments import build_spelling_quiz_payload

    return build_spelling_quiz_payload(assignment, db)


@router.get("/assignments/{assignment_id}/preview/cloze-quiz-start")
@limiter.limit("60/minute")
async def demo_cloze_quiz_start(
    request: Request,
    assignment_id: int,
    ov: dict = Depends(demo_overrides),
    db: Session = Depends(get_db),
):
    """Demo mode: Start word cloze quiz."""
    assignment = _apply_overrides(get_demo_assignment(assignment_id, db), ov)
    if assignment.practice_mode != "word_cloze_quiz":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This assignment is not a word_cloze_quiz",
        )
    from routers.students.quiz_assignments import build_cloze_quiz_payload

    return build_cloze_quiz_payload(assignment, db)


@router.post("/assignments/{assignment_id}/preview/word-selection-answer")
@limiter.limit("120/minute")
async def demo_word_selection_answer(
    request: Request,
    assignment_id: int,
    data: WordSelectionAnswerRequest,
    db: Session = Depends(get_db),
):
    """Demo mode: Submit word selection answer."""
    assignment = get_demo_assignment(assignment_id, db)
    return check_word_selection_answer(
        data.content_item_id, data.selected_answer, assignment, db
    )


@router.get("/assignments/{assignment_id}/preview/rearrangement-questions")
@limiter.limit("60/minute")
async def demo_rearrangement_questions(
    request: Request,
    assignment_id: int,
    ov: dict = Depends(demo_overrides),
    db: Session = Depends(get_db),
):
    """Demo mode: Get rearrangement practice questions."""
    assignment = _apply_overrides(get_demo_assignment(assignment_id, db), ov)
    return get_rearrangement_questions(assignment, db)


@router.post("/assignments/{assignment_id}/preview/rearrangement-answer")
@limiter.limit("120/minute")
async def demo_rearrangement_answer(
    request: Request,
    assignment_id: int,
    data: RearrangementAnswerRequest,
    db: Session = Depends(get_db),
):
    """Demo mode: Submit rearrangement answer."""
    get_demo_assignment(assignment_id, db)
    return check_rearrangement_answer(
        data.content_item_id, data.selected_word, data.current_position, db
    )


@router.post("/assignments/{assignment_id}/preview/rearrangement-retry")
@limiter.limit("60/minute")
async def demo_rearrangement_retry(
    request: Request,
    assignment_id: int,
    db: Session = Depends(get_db),
):
    """Demo mode: Retry rearrangement practice."""
    get_demo_assignment(assignment_id, db)
    result = handle_rearrangement_retry()
    result["preview_mode"] = True
    result["demo_mode"] = True
    return result


@router.post("/assignments/{assignment_id}/preview/rearrangement-complete")
@limiter.limit("60/minute")
async def demo_rearrangement_complete(
    request: Request,
    assignment_id: int,
    data: RearrangementCompleteRequest,
    db: Session = Depends(get_db),
):
    """Demo mode: Complete rearrangement practice."""
    get_demo_assignment(assignment_id, db)
    return handle_rearrangement_complete(data.expected_score, data.timeout)
