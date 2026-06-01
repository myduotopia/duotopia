"""Institution per-student monthly billing (issue #768 Phase 4, 五.5).

For an `org_type='institution'` Organization with `per_student_price > 0`,
computes the monthly invoice amount = (count of billable students this
month) × per_student_price. Pure read-side: no payment, no DB writes.

Billing rule (per spec "月結計費以人頭計算"):
  A student is billable for month M iff they were 'active' at any moment
  during [M_start, M_end_exclusive]. Inactive entire month → not billable;
  joined or left mid-month → still billable.

"Active at time T" is derived from student_status_history (most recent
history.changed_at ≤ T). For students with NO history rows (pre-existing
when the mechanism was introduced), the fallback is Student.is_active,
treated as the status held throughout the queried month.
"""

from calendar import monthrange
from datetime import datetime, timedelta
from typing import List, Optional
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from models import (
    Organization,
    School,
    Student,
    StudentSchool,
    StudentStatusHistory,
)


TAIPEI = ZoneInfo("Asia/Taipei")


def _month_window(year: int, month: int) -> tuple[datetime, datetime]:
    """Return (start_inclusive, end_exclusive) at Taipei midnight.

    end_exclusive = midnight of the first day of the NEXT month, so the
    queried range is half-open [start, end_exclusive).

    Year must be 1..9998 (9999 + month=12 would overflow Python's
    datetime.MAXYEAR=9999 when computing end_exclusive). Both bounds raise
    a friendly ValueError so the router can return a clean 400 instead of
    a raw OverflowError → 500.
    """
    if not 1 <= year <= 9998:
        raise ValueError(f"year must be 1..9998, got {year}")
    if not 1 <= month <= 12:
        raise ValueError(f"month must be 1..12, got {month}")
    start = datetime(year, month, 1, 0, 0, 0, tzinfo=TAIPEI)
    if month == 12:
        end_exclusive = datetime(year + 1, 1, 1, 0, 0, 0, tzinfo=TAIPEI)
    else:
        end_exclusive = datetime(year, month + 1, 1, 0, 0, 0, tzinfo=TAIPEI)
    return start, end_exclusive


def _ensure_taipei(dt: datetime) -> datetime:
    """SQLite strips tzinfo on TIMESTAMPTZ load; Postgres preserves it.
    Normalise to tz-aware Taipei so cross-comparison with the window
    boundaries works on both backends."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=TAIPEI)
    return dt.astimezone(TAIPEI)


def _is_billable(
    student: Student,
    history_rows: List[StudentStatusHistory],
    month_start: datetime,
    month_end_exclusive: datetime,
) -> bool:
    """Decide if a single student is billable for the queried month.

    `history_rows` MUST be already filtered to this student and ordered by
    changed_at ASC. We pass it in (rather than querying) so the caller can
    bulk-load history for the whole org in one round-trip.
    """
    # R3-F1: sort-order invariant. Use an explicit raise instead of assert
    # so Python's -O flag (which strips asserts) cannot silently disable
    # this guard in production — a sort-order violation produces wrong
    # billing totals with no error surfaced otherwise.
    for i in range(len(history_rows) - 1):
        if _ensure_taipei(history_rows[i].changed_at) > _ensure_taipei(
            history_rows[i + 1].changed_at
        ):
            raise ValueError("history_rows must be sorted ASC by changed_at")

    if not history_rows:
        # No history at all → student pre-dates the mechanism; fall back to
        # Student.is_active treated as the steady-state for the whole month.
        return bool(student.is_active)

    # Status at month_start = the most recent history row with
    # changed_at ≤ month_start.
    status_at_start: Optional[str] = None
    for row in history_rows:
        if _ensure_taipei(row.changed_at) <= month_start:
            status_at_start = row.status
        else:
            break

    if status_at_start is None:
        # R2-F1: history exists but ALL rows postdate month_start (i.e. the
        # student's first ever recorded transition is in or after this
        # window). The pre-window state cannot be inferred from the
        # CURRENT Student.is_active (which reflects today, not the past),
        # so derive it from the first row: each history row represents a
        # state CHANGE, so the prior state is the opposite of what the
        # first row records.
        #   first row → 'inactive'  ⇒ was 'active' before  ⇒ billable
        #   first row → 'active'    ⇒ was 'inactive' before
        first = history_rows[0]
        status_at_start = "inactive" if first.status == "active" else "active"

    if status_at_start == "active":
        return True

    # Was inactive at month start; billable iff any flip to active happens
    # within the window.
    return any(
        row.status == "active"
        and month_start <= _ensure_taipei(row.changed_at) < month_end_exclusive
        for row in history_rows
    )


def compute_monthly_billing(
    org: Organization, year: int, month: int, db: Session
) -> dict:
    """Compute the monthly invoice for an institution org.

    Raises ValueError if org is not 'institution' or per_student_price is NULL.
    """
    if org.org_type != "institution":
        raise ValueError(
            f"Organization {org.id} is not an institution (org_type={org.org_type!r})"
        )
    # Explicit `is None or <= 0` is clearer than the truthiness shorthand
    # for billing-critical preconditions. The DB CHECK constraint added in
    # Phase 2 already rejects ≤0 on write; the service layer guards
    # explicitly so a stale ORM object or future caller cannot slip a
    # non-positive through and produce a zero/negative total_amount.
    if org.per_student_price is None or org.per_student_price <= 0:
        raise ValueError(
            f"Organization {org.id} per_student_price is not a positive integer."
        )

    month_start, month_end_exclusive = _month_window(year, month)

    # All distinct students enrolled in any school under this org. We
    # include enrollments regardless of student_schools.is_active AND
    # School.is_active — the billing question is "was the STUDENT active in
    # this org during M", which lives on student_status_history (the
    # canonical source for billing). A school decommissioned mid-month
    # doesn't change whether the org received service for its students
    # during their active days. Status history filtering below ensures
    # only truly-active students get charged.
    students = (
        db.query(Student)
        .join(StudentSchool, StudentSchool.student_id == Student.id)
        .join(School, School.id == StudentSchool.school_id)
        .filter(School.organization_id == org.id)
        .distinct()
        .all()
    )

    if not students:
        return {
            "org_id": str(org.id),
            "year": year,
            "month": month,
            "per_student_price": org.per_student_price,
            "billable_student_count": 0,
            "total_amount": 0,
            "currency": "TWD",
            "students": [],
        }

    student_ids = [s.id for s in students]

    # Bulk-load all status history rows up to the end of the queried month
    # in a single query. Each iteration over the loop just walks an in-memory
    # list; no per-student DB hit.
    history_by_student: dict[int, List[StudentStatusHistory]] = {
        sid: [] for sid in student_ids
    }
    rows = (
        db.query(StudentStatusHistory)
        .filter(
            StudentStatusHistory.student_id.in_(student_ids),
            StudentStatusHistory.changed_at < month_end_exclusive,
        )
        # `id` tiebreaker: when two rows for the same student share an
        # identical changed_at, fall back to insertion order so the
        # status-at-T derivation is deterministic.
        .order_by(
            StudentStatusHistory.student_id,
            StudentStatusHistory.changed_at.asc(),
            StudentStatusHistory.id.asc(),
        )
        .all()
    )
    for row in rows:
        history_by_student[row.student_id].append(row)

    breakdown = []
    billable_count = 0
    for student in students:
        history_rows = history_by_student.get(student.id, [])
        billable = _is_billable(student, history_rows, month_start, month_end_exclusive)
        if billable:
            billable_count += 1
        breakdown.append(
            {
                "student_id": student.id,
                "name": student.name,
                "billable": billable,
            }
        )

    return {
        "org_id": str(org.id),
        "year": year,
        "month": month,
        "per_student_price": org.per_student_price,
        "billable_student_count": billable_count,
        "total_amount": billable_count * org.per_student_price,
        "currency": "TWD",
        "students": breakdown,
    }
