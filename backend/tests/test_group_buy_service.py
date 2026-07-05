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
from dateutil.relativedelta import relativedelta

from auth import get_password_hash
from models import (
    Organization,
    Plan,
    School,
    SubscriptionPeriod,
    Teacher,
    TeacherOrganization,
    TeacherSchool,
)
from services.group_buy import (
    GROUP_BUY_MONTHLY_QUOTA,
    add_group_buy_school_to_org,
    compute_group_buy_total,
    create_group_buy_org_and_school,
    create_group_buy_period,
    find_owned_group_buy_org,
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
    org, school, ts, t_org = create_group_buy_org_and_school(
        owner, plan, shared_test_session, now=now
    )
    shared_test_session.commit()

    assert org.org_type == "group_buy"
    # SQLite strips tzinfo on TIMESTAMPTZ store; compare naive values.
    assert _naive(org.subscription_start_date) == _naive(now)
    # W3 — Production uses relativedelta(years=1), NOT timedelta(days=365).
    # The two diverge on leap-year boundaries (Feb 29 + 1y → Feb 28 vs Mar 1).
    assert _naive(org.subscription_end_date) == _naive(now + relativedelta(years=1))
    assert school.organization_id == org.id
    assert school.plan_id == plan.id
    assert school.teacher_seat_limit == plan.teacher_seats
    assert ts.teacher_id == owner.id
    assert ts.school_id == school.id
    assert ts.roles == ["school_admin"]
    # F3 — TeacherOrganization with role='org_owner' so the opener can
    # use /org-purchase and /org-renew, both of which gate on this row.
    assert t_org.teacher_id == owner.id
    assert t_org.organization_id == org.id
    assert t_org.role == "org_owner"
    assert t_org.is_active is True
    # Issue #768 comment #2: admin org edit modal shows display_name and
    # teacher_limit, both of which must be populated by the create flow
    # (not just `name`) so admin sees meaningful values.
    owner_label = owner.name or owner.email
    assert org.display_name == f"{owner_label}'s 團購-{plan.teacher_seats}位"
    assert org.teacher_limit == plan.teacher_seats


# ---------- issue #838: 發起人 contact + repeat-open 分校 ----------


def test_open_persists_initiator_contact_email_and_phone(shared_test_session, owner):
    """Bug 1 — the create flow persists the 發起人's email onto the org's
    contact_email, and leader_phone onto contact_phone (were NULL before)."""
    plan = _make_group_buy_plan(shared_test_session)
    now = datetime.now(timezone.utc)
    org, _, _, _ = create_group_buy_org_and_school(
        owner, plan, shared_test_session, now=now, leader_phone="0912345678"
    )
    shared_test_session.commit()
    assert org.contact_email == owner.email
    assert org.contact_phone == "0912345678"


def test_find_owned_group_buy_org_returns_owned_or_none(shared_test_session, owner):
    plan = _make_group_buy_plan(shared_test_session)
    # No org yet.
    assert find_owned_group_buy_org(owner, shared_test_session) is None
    org, _, _, _ = create_group_buy_org_and_school(
        owner, plan, shared_test_session, now=datetime.now(timezone.utc)
    )
    shared_test_session.commit()
    found = find_owned_group_buy_org(owner, shared_test_session)
    assert found is not None and found.id == org.id


def test_add_group_buy_school_adds_branch_and_aggregates(shared_test_session, owner):
    """Bug 2 — a repeat open adds a new 分校 under the existing org:
    aggregates teacher_limit, extends subscription, binds owner as
    school_admin, and backfills contact info."""
    plan = _make_group_buy_plan(shared_test_session, seats=30)
    now = datetime.now(timezone.utc)
    org, first_school, _, _ = create_group_buy_org_and_school(
        owner, plan, shared_test_session, now=now - relativedelta(days=10)
    )
    shared_test_session.commit()
    original_end = org.subscription_end_date

    school2, ts2 = add_group_buy_school_to_org(
        owner, org, plan, shared_test_session, now=now, leader_phone="0900111222"
    )
    shared_test_session.commit()

    # New 分校 distinct from the first, both under the same org, and named
    # with an ordinal suffix so admins can tell 分校 apart.
    assert school2.id != first_school.id
    assert school2.organization_id == org.id
    assert school2.name == f"{org.name} School 2"
    schools = (
        shared_test_session.query(School).filter(School.organization_id == org.id).all()
    )
    assert len(schools) == 2
    # Seat cap aggregates across 分校.
    assert org.teacher_limit == 30 * 2
    # Subscription extended to cover the newest cohort's year.
    assert _naive(org.subscription_end_date) == _naive(now + relativedelta(years=1))
    assert org.subscription_end_date >= original_end
    # Owner bound as school_admin of the new 分校.
    assert ts2.teacher_id == owner.id
    assert ts2.school_id == school2.id
    assert ts2.roles == ["school_admin"]
    # Contact info backfilled to latest.
    assert org.contact_email == owner.email
    assert org.contact_phone == "0900111222"


def test_add_group_buy_school_does_not_shorten_later_subscription(
    shared_test_session, owner
):
    """Extending the org subscription must never shorten an existing later
    end date (keep the max)."""
    plan = _make_group_buy_plan(shared_test_session)
    now = datetime.now(timezone.utc)
    org, _, _, _ = create_group_buy_org_and_school(
        owner, plan, shared_test_session, now=now
    )
    # Force a far-future end date, then add a school "now".
    far_future = now + relativedelta(years=5)
    org.subscription_end_date = far_future
    shared_test_session.commit()

    add_group_buy_school_to_org(owner, org, plan, shared_test_session, now=now)
    shared_test_session.commit()
    assert _naive(org.subscription_end_date) == _naive(far_future)


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
    org, _, _, _ = _bootstrap_active_group_buy(
        shared_test_session, owner, plan, now=today - timedelta(days=10)
    )
    org.is_active = False
    shared_test_session.commit()

    result = grant_monthly_for_group_buy(today, shared_test_session)
    assert result["grants_created"] == 0


def test_grant_skips_expired_subscription(shared_test_session, owner):
    plan = _make_group_buy_plan(shared_test_session)
    today = datetime(2026, 6, 1, 2, 0, 0, tzinfo=TAIPEI)
    org, _, _, _ = _bootstrap_active_group_buy(
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
    _, school, _, _ = _bootstrap_active_group_buy(
        shared_test_session, owner, plan, now=today - timedelta(days=10)
    )
    school.is_active = False
    shared_test_session.commit()

    result = grant_monthly_for_group_buy(today, shared_test_session)
    assert result["grants_created"] == 0


def test_grant_skips_inactive_teacher_school_binding(shared_test_session, owner):
    plan = _make_group_buy_plan(shared_test_session)
    today = datetime(2026, 6, 1, 2, 0, 0, tzinfo=TAIPEI)
    _, _, ts, _ = _bootstrap_active_group_buy(
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


def test_grant_does_not_double_grant_teacher_in_two_schools_same_plan(
    shared_test_session, owner
):
    """R2-F3 — A teacher bound to two active group-buy schools that share
    the same plan_name must receive ONE grant, not two. The dedup set must
    be updated inside the loop so the second iteration sees the first one."""
    plan = _make_group_buy_plan(shared_test_session)
    today = datetime(2026, 6, 1, 2, 0, 0, tzinfo=TAIPEI)

    # First active group-buy school the teacher owns
    _bootstrap_active_group_buy(
        shared_test_session, owner, plan, now=today - timedelta(days=10)
    )

    # Second active group-buy school the teacher is bound to (e.g. joined a
    # second team), same plan_name. Create org/school/binding manually to
    # avoid duplicating the helper's TeacherOrganization unique-key collision.
    from models import Organization, School, TeacherSchool

    org2 = Organization(
        name="Second 團",
        org_type="group_buy",
        subscription_start_date=today - timedelta(days=5),
        subscription_end_date=today + timedelta(days=360),
        is_active=True,
    )
    shared_test_session.add(org2)
    shared_test_session.flush()
    school2 = School(
        organization_id=org2.id,
        name="Second 團 School",
        plan_id=plan.id,
        teacher_seat_limit=plan.teacher_seats,
        is_active=True,
    )
    shared_test_session.add(school2)
    shared_test_session.flush()
    shared_test_session.add(
        TeacherSchool(
            teacher_id=owner.id,
            school_id=school2.id,
            roles=["teacher"],
            is_active=True,
        )
    )
    shared_test_session.commit()

    result = grant_monthly_for_group_buy(today, shared_test_session)
    # Critical safety property: even if the join returns >1 row for this
    # teacher (one per TeacherSchool), exactly ONE SubscriptionPeriod must
    # be created. grants_created + grants_skipped_duplicate accounts for
    # every row the join returned.
    assert result["grants_created"] == 1
    assert result["grants_created"] + result["grants_skipped_duplicate"] >= 1

    periods = (
        shared_test_session.query(SubscriptionPeriod)
        .filter(
            SubscriptionPeriod.teacher_id == owner.id,
            SubscriptionPeriod.plan_name == plan.name,
            SubscriptionPeriod.payment_method == "group_buy",
        )
        .all()
    )
    assert len(periods) == 1


def test_grant_duplicate_check_filters_by_payment_method(shared_test_session, owner):
    """F5 — If a teacher has an active SubscriptionPeriod whose plan_name
    matches the group-buy plan but whose payment_method is NOT 'group_buy'
    (e.g. an individual subscription that happens to share the name), the
    cron must still create the group-buy grant for them."""
    plan = _make_group_buy_plan(shared_test_session)
    today = datetime(2026, 6, 1, 2, 0, 0, tzinfo=TAIPEI)
    _bootstrap_active_group_buy(
        shared_test_session, owner, plan, now=today - timedelta(days=10)
    )

    # Decoy active period with the same plan_name but auto_renew (not group_buy)
    decoy = SubscriptionPeriod(
        teacher_id=owner.id,
        plan_name=plan.name,
        amount_paid=299,
        quota_total=2000,
        quota_used=0,
        start_date=today,
        end_date=today + timedelta(days=30),
        payment_method="auto_renew",
        payment_status="paid",
        status="active",
    )
    shared_test_session.add(decoy)
    shared_test_session.commit()

    result = grant_monthly_for_group_buy(today, shared_test_session)
    assert result["grants_created"] == 1  # NOT skipped despite matching name
