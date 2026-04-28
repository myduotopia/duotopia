"""Analysis quota service.

Server-authoritative enforcement of the 3-AI-analysis-per-item rule.
The frontend hook is a UX preview; this module is the source of truth.

The reset semantics deliberately match the frontend hook: when an
assignment transitions to RETURNED, ALL items have their counter zeroed.
Items that the teacher already approved (teacher_passed=True) are still
locked from re-analysis — but via the 403 branch in check_can_analyze,
not by skipping the reset. Two-rule design keeps each rule simple.
"""
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models.progress import StudentItemProgress

MAX_AI_ANALYSIS_ATTEMPTS = 3


def check_can_analyze(progress: StudentItemProgress) -> None:
    """Raise on quota exhaustion or already-passed item before Azure is called.

    403 takes precedence over 429: a teacher-approved item is the clearer
    user-facing reason and shouldn't be masked by "out of attempts".
    """
    if progress.teacher_passed is True:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "ITEM_ALREADY_PASSED",
                "message": "This item has already been approved by the teacher.",
            },
        )

    count = progress.ai_analysis_count or 0
    if count >= MAX_AI_ANALYSIS_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "AI_ANALYSIS_QUOTA_EXCEEDED",
                "message": "AI analysis quota exhausted for this item.",
                "ai_analysis_count": count,
                "ai_analysis_remaining": 0,
                "max_attempts": MAX_AI_ANALYSIS_ATTEMPTS,
            },
        )


def increment_analysis_count(progress: StudentItemProgress) -> int:
    """Increment counter on successful Azure analysis. Caps at MAX. Returns new count.

    Caller commits. The cap is defensive against re-entrancy where the
    check_can_analyze gate passed but a concurrent caller already
    incremented past MAX between the gate and here.

    Race note: two requests at count=0 can both read 0, both set to 1,
    and commit 1 — losing one increment. We accept that for a 3-attempt
    learning gate; tightening it would require row-level locking that
    isn't worth the latency cost here.
    """
    current = progress.ai_analysis_count or 0
    if current >= MAX_AI_ANALYSIS_ATTEMPTS:
        return current
    progress.ai_analysis_count = current + 1
    return progress.ai_analysis_count


def reset_analysis_count_for_assignment(student_assignment_id: int, db: Session) -> int:
    """Zero ai_analysis_count for every item of a student assignment.

    Called when assignment status transitions to RETURNED (single +
    batch grading flows). Returns rows updated. Caller commits.
    """
    return (
        db.query(StudentItemProgress)
        .filter(StudentItemProgress.student_assignment_id == student_assignment_id)
        .update(
            {StudentItemProgress.ai_analysis_count: 0},
            synchronize_session=False,
        )
    )
