"""Tests for backend.services.institution_billing (issue #768 Phase 4, 五.5)."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from auth import get_password_hash
from models import (
    Organization,
    School,
    Student,
    StudentSchool,
    StudentStatusHistory,
    Teacher,
)
from services.institution_billing import (
    _month_window,
    compute_monthly_billing,
)


TAIPEI = ZoneInfo("Asia/Taipei")


# ---------- fixtures ----------


@pytest.fixture
def teacher(shared_test_session):
    t = Teacher(
        email="billing-teacher@duotopia.com",
        password_hash=get_password_hash("x"),
        name="T",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


@pytest.fixture
def institution_org(shared_test_session):
    o = Organization(
        name="Acme Institution",
        org_type="institution",
        per_student_price=100,
        is_active=True,
    )
    shared_test_session.add(o)
    shared_test_session.commit()
    shared_test_session.refresh(o)
    return o


@pytest.fixture
def institution_school(shared_test_session, institution_org):
    s = School(
        organization_id=institution_org.id,
        name="Branch A",
        is_active=True,
    )
    shared_test_session.add(s)
    shared_test_session.commit()
    shared_test_session.refresh(s)
    return s


def _enrol(db, student, school):
    db.add(StudentSchool(student_id=student.id, school_id=school.id, is_active=True))
    db.commit()


def _student(db, name, *, is_active=True):
    # Student has student_number etc — let's check the columns
    s = Student(
        name=name,
        email=f"{name.lower().replace(' ', '-')}@example.com",
        password_hash=get_password_hash("x"),
        is_active=is_active,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def _status(db, student, when, status):
    db.add(StudentStatusHistory(student_id=student.id, status=status, changed_at=when))
    db.commit()


# ---------- _month_window ----------


def test_month_window_normal():
    start, end = _month_window(2026, 6)
    assert (start.year, start.month, start.day) == (2026, 6, 1)
    assert (end.year, end.month, end.day) == (2026, 7, 1)


def test_month_window_december_rolls():
    start, end = _month_window(2026, 12)
    assert start.month == 12
    assert (end.year, end.month, end.day) == (2027, 1, 1)


def test_month_window_february_leap_year():
    start, end = _month_window(2028, 2)
    assert (end.month, end.day) == (3, 1)
    # 29 days in Feb 2028
    assert (end - start).days == 29


def test_month_window_rejects_invalid_month():
    with pytest.raises(ValueError):
        _month_window(2026, 13)


def test_month_window_rejects_year_zero():
    with pytest.raises(ValueError, match="year"):
        _month_window(0, 1)


def test_month_window_rejects_year_negative():
    with pytest.raises(ValueError, match="year"):
        _month_window(-1, 6)


def test_month_window_rejects_year_9999_to_prevent_overflow():
    """9999 + month=12 would compute datetime(10000, ...) and OverflowError.
    The guard rejects 9999 with a friendly ValueError so the router returns
    a clean 400 / 422 instead."""
    with pytest.raises(ValueError, match="year"):
        _month_window(9999, 12)


# ---------- compute_monthly_billing ----------


def test_rejects_non_institution_org(shared_test_session, teacher):
    org = Organization(name="Group Buy", org_type="group_buy", is_active=True)
    shared_test_session.add(org)
    shared_test_session.commit()
    with pytest.raises(ValueError, match="not an institution"):
        compute_monthly_billing(org, 2026, 6, shared_test_session)


def test_rejects_zero_per_student_price(shared_test_session):
    """R3-F2 regression: per_student_price=0 must NOT silently produce a
    zero invoice. Service-layer guard is defense-in-depth — the DB CHECK
    constraint from Phase 2 also rejects ≤0, so we construct the org
    without persisting to exercise the service guard in isolation."""
    org = Organization(
        name="ZeroPrice",
        org_type="institution",
        per_student_price=0,
        is_active=True,
    )
    # Do NOT add/commit — the DB CHECK constraint would reject first.
    with pytest.raises(ValueError, match="per_student_price"):
        compute_monthly_billing(org, 2026, 6, shared_test_session)


def test_rejects_negative_per_student_price(shared_test_session):
    """R3-F2 regression: a negative per_student_price must NOT pass the
    `not org.per_student_price` check and produce a negative invoice.
    Defense-in-depth alongside the DB CHECK."""
    org = Organization(
        name="NegPrice",
        org_type="institution",
        per_student_price=-50,
        is_active=True,
    )
    with pytest.raises(ValueError, match="per_student_price"):
        compute_monthly_billing(org, 2026, 6, shared_test_session)


def test_rejects_org_with_no_per_student_price(shared_test_session):
    org = Organization(
        name="Acme",
        org_type="institution",
        per_student_price=None,
        is_active=True,
    )
    shared_test_session.add(org)
    shared_test_session.commit()
    with pytest.raises(ValueError, match="per_student_price"):
        compute_monthly_billing(org, 2026, 6, shared_test_session)


def test_zero_students_returns_zero_total(shared_test_session, institution_org):
    result = compute_monthly_billing(institution_org, 2026, 6, shared_test_session)
    assert result["billable_student_count"] == 0
    assert result["total_amount"] == 0
    assert result["students"] == []


def test_no_history_active_student_is_billable(
    shared_test_session, institution_org, institution_school
):
    """Per design decision: no history → fall back to Student.is_active."""
    s = _student(shared_test_session, "Alice", is_active=True)
    _enrol(shared_test_session, s, institution_school)

    result = compute_monthly_billing(institution_org, 2026, 6, shared_test_session)
    assert result["billable_student_count"] == 1
    assert result["total_amount"] == 100  # per_student_price
    assert result["students"][0]["billable"] is True


def test_no_history_inactive_student_is_not_billable(
    shared_test_session, institution_org, institution_school
):
    s = _student(shared_test_session, "Bob", is_active=False)
    _enrol(shared_test_session, s, institution_school)

    result = compute_monthly_billing(institution_org, 2026, 6, shared_test_session)
    assert result["billable_student_count"] == 0
    assert result["total_amount"] == 0


def test_active_throughout_month_is_billable(
    shared_test_session, institution_org, institution_school
):
    s = _student(shared_test_session, "Charlie", is_active=False)
    _enrol(shared_test_session, s, institution_school)
    # Activated before the queried month
    _status(shared_test_session, s, datetime(2026, 5, 15, tzinfo=TAIPEI), "active")

    result = compute_monthly_billing(institution_org, 2026, 6, shared_test_session)
    assert result["billable_student_count"] == 1


def test_inactive_throughout_month_is_not_billable(
    shared_test_session, institution_org, institution_school
):
    s = _student(shared_test_session, "Dave", is_active=True)
    _enrol(shared_test_session, s, institution_school)
    # Deactivated before the month, never re-activated
    _status(shared_test_session, s, datetime(2026, 5, 15, tzinfo=TAIPEI), "active")
    _status(shared_test_session, s, datetime(2026, 5, 20, tzinfo=TAIPEI), "inactive")

    result = compute_monthly_billing(institution_org, 2026, 6, shared_test_session)
    assert result["billable_student_count"] == 0


def test_joined_mid_month_is_billable(
    shared_test_session, institution_org, institution_school
):
    s = _student(shared_test_session, "Eve", is_active=False)
    _enrol(shared_test_session, s, institution_school)
    # Inactive at month start, then activated mid-June
    _status(shared_test_session, s, datetime(2026, 5, 1, tzinfo=TAIPEI), "inactive")
    _status(shared_test_session, s, datetime(2026, 6, 15, tzinfo=TAIPEI), "active")

    result = compute_monthly_billing(institution_org, 2026, 6, shared_test_session)
    assert result["billable_student_count"] == 1


def test_left_mid_month_is_still_billable(
    shared_test_session, institution_org, institution_school
):
    s = _student(shared_test_session, "Frank", is_active=True)
    _enrol(shared_test_session, s, institution_school)
    # Active at month start, deactivated mid-June
    _status(shared_test_session, s, datetime(2026, 5, 1, tzinfo=TAIPEI), "active")
    _status(shared_test_session, s, datetime(2026, 6, 15, tzinfo=TAIPEI), "inactive")

    result = compute_monthly_billing(institution_org, 2026, 6, shared_test_session)
    assert result["billable_student_count"] == 1


def test_flipped_active_inactive_active_is_billable(
    shared_test_session, institution_org, institution_school
):
    s = _student(shared_test_session, "Grace", is_active=True)
    _enrol(shared_test_session, s, institution_school)
    _status(shared_test_session, s, datetime(2026, 5, 1, tzinfo=TAIPEI), "inactive")
    _status(shared_test_session, s, datetime(2026, 6, 10, tzinfo=TAIPEI), "active")
    _status(shared_test_session, s, datetime(2026, 6, 20, tzinfo=TAIPEI), "inactive")

    result = compute_monthly_billing(institution_org, 2026, 6, shared_test_session)
    assert result["billable_student_count"] == 1


def test_first_ever_history_is_inactivation_within_window_still_billable(
    shared_test_session, institution_org, institution_school
):
    """R2-F1 regression: a student whose FIRST EVER history row is an
    inactivation inside the queried window was active before — even if
    Student.is_active is currently False (set by that very inactivation).

    Pre-fix bug: status_at_start fell back to student.is_active=False,
    masked the active days at the start of the month, and the student
    was not billed despite being active June 1-9.
    """
    s = _student(shared_test_session, "Justin", is_active=True)
    _enrol(shared_test_session, s, institution_school)
    # First and only history row: deactivated mid-June. is_active updated
    # in lock-step (typical app behaviour on a deactivation event).
    _status(shared_test_session, s, datetime(2026, 6, 10, tzinfo=TAIPEI), "inactive")
    s.is_active = False
    shared_test_session.commit()

    result = compute_monthly_billing(institution_org, 2026, 6, shared_test_session)
    # Was active June 1–9 → MUST be billable, despite current is_active=False
    assert result["billable_student_count"] == 1


def test_first_ever_history_is_activation_within_window_is_billable(
    shared_test_session, institution_org, institution_school
):
    """Companion to F1 regression: a student whose FIRST EVER history row is
    an activation inside the window was inactive before — billable because
    they became active during the month (joined mid-month case)."""
    s = _student(shared_test_session, "Kara", is_active=True)
    _enrol(shared_test_session, s, institution_school)
    _status(shared_test_session, s, datetime(2026, 6, 15, tzinfo=TAIPEI), "active")

    result = compute_monthly_billing(institution_org, 2026, 6, shared_test_session)
    assert result["billable_student_count"] == 1


def test_future_history_row_does_not_affect_current_month(
    shared_test_session, institution_org, institution_school
):
    """A history row whose changed_at is AFTER the queried month must not
    leak into the decision (e.g. July deactivation doesn't affect June bill)."""
    s = _student(shared_test_session, "Henry", is_active=True)
    _enrol(shared_test_session, s, institution_school)
    # Future deactivation, well after June
    _status(shared_test_session, s, datetime(2026, 7, 10, tzinfo=TAIPEI), "inactive")

    result = compute_monthly_billing(institution_org, 2026, 6, shared_test_session)
    # Still active throughout June (fallback to is_active=True since no
    # history row precedes month_start)
    assert result["billable_student_count"] == 1


def test_total_amount_scales_with_count(
    shared_test_session, institution_org, institution_school
):
    s1 = _student(shared_test_session, "Stu1", is_active=True)
    s2 = _student(shared_test_session, "Stu2", is_active=True)
    s3 = _student(shared_test_session, "Stu3", is_active=False)
    _enrol(shared_test_session, s1, institution_school)
    _enrol(shared_test_session, s2, institution_school)
    _enrol(shared_test_session, s3, institution_school)

    result = compute_monthly_billing(institution_org, 2026, 6, shared_test_session)
    assert result["billable_student_count"] == 2
    assert result["total_amount"] == 200  # 2 × 100
    assert {b["student_id"] for b in result["students"] if b["billable"]} == {
        s1.id,
        s2.id,
    }


def test_student_in_multiple_schools_under_same_org_counts_once(
    shared_test_session, institution_org, institution_school
):
    """A student enrolled in 2 schools under the same institution org should
    be counted ONCE per month, not twice."""
    second_school = School(
        organization_id=institution_org.id,
        name="Branch B",
        is_active=True,
    )
    shared_test_session.add(second_school)
    shared_test_session.commit()

    s = _student(shared_test_session, "Iris", is_active=True)
    _enrol(shared_test_session, s, institution_school)
    _enrol(shared_test_session, s, second_school)

    result = compute_monthly_billing(institution_org, 2026, 6, shared_test_session)
    assert result["billable_student_count"] == 1
    assert result["total_amount"] == 100
