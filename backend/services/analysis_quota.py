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


def increment_analysis_count(progress: StudentItemProgress, db: Session) -> int:
    """Atomic +1 on successful Azure analysis. Hard cap at MAX. Returns final count.

    Issues a single UPDATE ... WHERE count < MAX so two concurrent
    callers cannot both pass the quota gate at count=N and both
    successfully write count=N+1 — the second UPDATE simply matches 0
    rows and the cap holds. This closes the race window between the
    application-level gate (check_can_analyze) and the write.

    `synchronize_session="fetch"` updates the in-memory `progress`
    object's ai_analysis_count attribute to match the DB value while
    preserving any other unsaved attribute changes the caller has
    already made on the same instance (scores, ai_feedback, etc.).

    Caller commits.
    """
    rows = (
        db.query(StudentItemProgress)
        .filter(
            StudentItemProgress.id == progress.id,
            StudentItemProgress.ai_analysis_count < MAX_AI_ANALYSIS_ATTEMPTS,
        )
        .update(
            {
                StudentItemProgress.ai_analysis_count: (
                    StudentItemProgress.ai_analysis_count + 1
                )
            },
            synchronize_session="fetch",
        )
    )
    if rows == 0:
        # Race lost: another concurrent caller already pushed the row to
        # MAX between our gate check and this UPDATE. Reflect the cap on
        # the in-memory object so response payloads see the truth.
        progress.ai_analysis_count = MAX_AI_ANALYSIS_ATTEMPTS
        return MAX_AI_ANALYSIS_ATTEMPTS
    # synchronize_session="fetch" already wrote the new (count+1) value
    # into the in-memory attribute. Return it directly — never `or` with
    # a fallback, since `or` would short-circuit a legitimate 0 (which
    # can't happen here, but the defensive `or` masked any future bug).
    return int(progress.ai_analysis_count)


def reset_analysis_count_for_assignment(student_assignment_id: int, db: Session) -> int:
    """Zero ai_analysis_count for every item of a single student assignment.

    Called from the single-student return-for-revision endpoint. Returns
    rows updated. Caller commits.

    Session-staleness note: this issues an UPDATE with
    `synchronize_session=False`, so any StudentItemProgress instances
    already loaded in this session retain their pre-reset values until
    the caller commits (which invalidates lazy-loaded attributes) or
    explicitly expires them. Callers MUST commit before reading the
    affected rows back; the production grading paths satisfy this
    automatically since they commit immediately after.
    """
    return reset_analysis_count_for_assignments([student_assignment_id], db)


def reset_analysis_count_for_assignments(
    student_assignment_ids: list[int], db: Session
) -> int:
    """Bulk variant — zero ai_analysis_count for every item of multiple SAs.

    Single UPDATE with WHERE sa_id IN (...) avoids the N+1 query that
    would result from looping over the single-id helper in the batch
    finalize-grading path. Empty input is a no-op (no-op SQL is illegal
    on some dialects). Same session-staleness contract as the singular
    variant — caller commits before reading affected rows back.
    """
    if not student_assignment_ids:
        return 0
    return (
        db.query(StudentItemProgress)
        .filter(StudentItemProgress.student_assignment_id.in_(student_assignment_ids))
        .update(
            {StudentItemProgress.ai_analysis_count: 0},
            synchronize_session=False,
        )
    )
