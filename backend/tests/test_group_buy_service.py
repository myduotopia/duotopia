"""Tests for backend.services.group_buy (issue #768 Phase 3).

Covers:
  - validate_group_buy_plan: not-found / inactive / individual-plan / valid
  - compute_group_buy_total: server-authoritative annual_fee × teacher_seats
  - month_end_taipei: end-of-month edge cases incl. December roll-over
  - create_group_buy_org_and_school: creates org + school + owner binding
  - create_group_buy_period: shape of inserted SubscriptionPeriod
  - grant_monthly_for_group_buy: cron Phase 3 behavior incl. idempotency
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from auth import get_password_hash
from models import (
    Organization,
    Plan,
    School,
    SubscriptionPeriod,
    Teacher,
    TeacherSchool,
)
from services.group_buy import (
    GROUP_BUY_MONTHLY_QUOTA,
    compute_group_buy_total,
    create_group_buy_org_and_school,
    create_group_buy_period,
    grant_monthly_for_group_buy,
    month_end_taipei,
    validate_group_buy_plan,
)


TAIPEI = ZoneInfo("Asia/Taipei")


def _naive(dt):
    """SQLite strips tzinfo on TIMESTAMPTZ store; Postgres preserves it.
    Helper so equality checks survive both."""
    return dt.replace(tzinfo=None) if dt and dt.tzinfo else dt


# ---------- fixtures ----------


@pytest.fixture
def owner(shared_test_session):
    t = Teacher(
        email="owner@duotopia.com",
        password_hash=get_password_hash("x"),
        name="Owner",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


def _make_group_buy_plan(db, name="團購-30席", seats=30, fee=1300, discount=0.90):
    p = Plan(
        name=name,
        price=None,
        quota=1000,
        teacher_seats=seats,
        annual_fee=fee,
        topup_discount=Decimal(str(discount)),
        is_active=True,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _make_individual_plan(db, name="Tutor Teachers"):
    p = Plan(
        name=name,
        price=299,
        quota=2000,
        teacher_seats=None,
        annual_fee=None,
        topup_discount=None,
        is_active=True,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


# ---------- validate_group_buy_plan ----------


def test_validate_raises_for_unknown_plan(shared_test_session):
    with pytest.raises(ValueError, match="Unknown plan"):
        validate_group_buy_plan("does-not-exist", shared_test_session)


def test_validate_raises_for_inactive_plan(shared_test_session):
    p = _make_group_buy_plan(shared_test_session)
    p.is_active = False
    shared_test_session.commit()
    with pytest.raises(ValueError, match="not active"):
        validate_group_buy_plan(p.name, shared_test_session)


def test_validate_raises_for_individual_plan(shared_test_session):
    p = _make_individual_plan(shared_test_session)
    with pytest.raises(ValueError, match="not a group-buy plan"):
        validate_group_buy_plan(p.name, shared_test_session)


def test_validate_returns_plan_when_valid(shared_test_session):
    p = _make_group_buy_plan(shared_test_session)
    got = validate_group_buy_plan(p.name, shared_test_session)
    assert got.id == p.id


# ---------- compute_group_buy_total ----------


def test_compute_total_is_annual_fee_times_seats(shared_test_session):
    p = _make_group_buy_plan(shared_test_session, seats=30, fee=1300)
    assert compute_group_buy_total(p) == 30 * 1300


# ---------- month_end_taipei ----------


def test_month_end_normal_month():
    today = datetime(2026, 5, 15, 10, 0, 0, tzinfo=TAIPEI)
    end = month_end_taipei(today)
    assert end.year == 2026 and end.month == 5 and end.day == 31
    assert end.hour == 23 and end.minute == 59 and end.second == 59


def test_month_end_december_rolls_to_next_year():
    today = datetime(2026, 12, 10, 10, 0, 0, tzinfo=TAIPEI)
    end = month_end_taipei(today)
    assert end.year == 2026 and end.month == 12 and end.day == 31


def test_month_end_february_leap_year():
    today = datetime(2028, 2, 5, 10, 0, 0, tzinfo=TAIPEI)
    end = month_end_taipei(today)
    assert end.month == 2 and end.day == 29


# ---------- create_group_buy_org_and_school ----------


def test_open_creates_org_school_and_owner_binding(shared_test_session, owner):
    plan = _make_group_buy_plan(shared_test_session)
    now = datetime.now(timezone.utc)
    org, school, ts = create_group_buy_org_and_school(
        owner, plan, shared_test_session, now=now
    )
    shared_test_session.commit()

    assert org.org_type == "group_buy"
    # SQLite strips tzinfo on TIMESTAMPTZ store; compare naive values.
    assert _naive(org.subscription_start_date) == _naive(now)
    assert _naive(org.subscription_end_date) == _naive(now + timedelta(days=365))
    assert school.organization_id == org.id
    assert school.plan_id == plan.id
    assert school.teacher_seat_limit == plan.teacher_seats
    assert ts.teacher_id == owner.id
    assert ts.school_id == school.id
    assert ts.roles == ["school_admin"]


# ---------- create_group_buy_period ----------


def test_create_period_inserts_active_1000_quota(shared_test_session, owner):
    plan = _make_group_buy_plan(shared_test_session)
    start = datetime(2026, 5, 15, 10, 0, 0, tzinfo=TAIPEI)
    period = create_group_buy_period(
        owner, plan, shared_test_session, start=start, payment_id="pay-123"
    )
    shared_test_session.commit()

    assert period.teacher_id == owner.id
    assert period.plan_name == plan.name
    assert period.quota_total == GROUP_BUY_MONTHLY_QUOTA
    assert period.quota_used == 0
    assert _naive(period.start_date) == _naive(start)
    assert period.end_date.month == 5 and period.end_date.day == 31
    assert period.payment_method == "group_buy"
    assert period.payment_id == "pay-123"
    assert period.status == "active"


# ---------- grant_monthly_for_group_buy ----------


def _bootstrap_active_group_buy(db, owner, plan, *, now):
    """Create a full active group-buy: org + school + owner TeacherSchool."""
    return create_group_buy_org_and_school(owner, plan, db, now=now)


def test_grant_creates_one_period_per_bound_teacher(shared_test_session, owner):
    plan = _make_group_buy_plan(shared_test_session)
    today = datetime(2026, 6, 1, 2, 0, 0, tzinfo=TAIPEI)
    _bootstrap_active_group_buy(
        shared_test_session, owner, plan, now=today - timedelta(days=10)
    )
    shared_test_session.commit()

    result = grant_monthly_for_group_buy(today, shared_test_session)
    assert result == {"grants_created": 1, "grants_skipped_duplicate": 0}

    period = (
        shared_test_session.query(SubscriptionPeriod)
        .filter(SubscriptionPeriod.teacher_id == owner.id)
        .one()
    )
    assert period.quota_total == GROUP_BUY_MONTHLY_QUOTA
    assert period.plan_name == plan.name


def test_grant_skips_when_teacher_already_granted_this_month(
    shared_test_session, owner
):
    plan = _make_group_buy_plan(shared_test_session)
    today = datetime(2026, 6, 1, 14, 0, 0, tzinfo=TAIPEI)
    _bootstrap_active_group_buy(shared_test_session, owner, plan, now=today)
    # Pre-existing grant from the open endpoint earlier today
    create_group_buy_period(owner, plan, shared_test_session, start=today)
    shared_test_session.commit()

    result = grant_monthly_for_group_buy(today, shared_test_session)
    assert result == {"grants_created": 0, "grants_skipped_duplicate": 1}


def test_grant_skips_inactive_organization(shared_test_session, owner):
    plan = _make_group_buy_plan(shared_test_session)
    today = datetime(2026, 6, 1, 2, 0, 0, tzinfo=TAIPEI)
    org, _, _ = _bootstrap_active_group_buy(
        shared_test_session, owner, plan, now=today - timedelta(days=10)
    )
    org.is_active = False
    shared_test_session.commit()

    result = grant_monthly_for_group_buy(today, shared_test_session)
    assert result["grants_created"] == 0


def test_grant_skips_expired_subscription(shared_test_session, owner):
    plan = _make_group_buy_plan(shared_test_session)
    today = datetime(2026, 6, 1, 2, 0, 0, tzinfo=TAIPEI)
    org, _, _ = _bootstrap_active_group_buy(
        shared_test_session, owner, plan, now=today - timedelta(days=400)
    )
    # Force expired
    org.subscription_end_date = today - timedelta(days=1)
    shared_test_session.commit()

    result = grant_monthly_for_group_buy(today, shared_test_session)
    assert result["grants_created"] == 0


def test_grant_skips_inactive_school(shared_test_session, owner):
    plan = _make_group_buy_plan(shared_test_session)
    today = datetime(2026, 6, 1, 2, 0, 0, tzinfo=TAIPEI)
    _, school, _ = _bootstrap_active_group_buy(
        shared_test_session, owner, plan, now=today - timedelta(days=10)
    )
    school.is_active = False
    shared_test_session.commit()

    result = grant_monthly_for_group_buy(today, shared_test_session)
    assert result["grants_created"] == 0


def test_grant_skips_inactive_teacher_school_binding(shared_test_session, owner):
    plan = _make_group_buy_plan(shared_test_session)
    today = datetime(2026, 6, 1, 2, 0, 0, tzinfo=TAIPEI)
    _, _, ts = _bootstrap_active_group_buy(
        shared_test_session, owner, plan, now=today - timedelta(days=10)
    )
    ts.is_active = False
    shared_test_session.commit()

    result = grant_monthly_for_group_buy(today, shared_test_session)
    assert result["grants_created"] == 0


def test_grant_stacks_alongside_individual_subscription(shared_test_session, owner):
    """Per design decision: group-buy and individual subscriptions are
    independent; both active SubscriptionPeriods coexist."""
    plan = _make_group_buy_plan(shared_test_session)
    today = datetime(2026, 6, 1, 2, 0, 0, tzinfo=TAIPEI)
    _bootstrap_active_group_buy(
        shared_test_session, owner, plan, now=today - timedelta(days=10)
    )
    # Pre-existing individual Tutor Teachers subscription
    individual = SubscriptionPeriod(
        teacher_id=owner.id,
        plan_name="Tutor Teachers",
        amount_paid=299,
        quota_total=2000,
        quota_used=0,
        start_date=today - timedelta(days=5),
        end_date=today + timedelta(days=25),
        payment_method="auto_renew",
        payment_status="paid",
        status="active",
    )
    shared_test_session.add(individual)
    shared_test_session.commit()

    grant_monthly_for_group_buy(today, shared_test_session)

    periods = (
        shared_test_session.query(SubscriptionPeriod)
        .filter(
            SubscriptionPeriod.teacher_id == owner.id,
            SubscriptionPeriod.status == "active",
        )
        .all()
    )
    assert len(periods) == 2
    names = sorted(p.plan_name for p in periods)
    assert names == ["Tutor Teachers", plan.name]
