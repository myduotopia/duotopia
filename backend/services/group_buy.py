"""Group-buy domain helpers (issue #768 Phase 3).

Centralizes the open-group flow and the monthly point-grant logic so both
the HTTP endpoint and the cron job share identical Period creation rules.

All amount/quota computations are server-side from the Plan row — never
trust the frontend.
"""

from datetime import datetime, timedelta
from typing import Tuple
from zoneinfo import ZoneInfo

from dateutil.relativedelta import relativedelta
from sqlalchemy import text
from sqlalchemy.orm import Session

from models import (
    Organization,
    Plan,
    School,
    SubscriptionPeriod,
    Teacher,
    TeacherOrganization,
    TeacherSchool,
)


# Each monthly grant gives this many points to every teacher bound to an
# active group-buy school. Matches the spec in issue #768.
GROUP_BUY_MONTHLY_QUOTA = 1000


# ---------- pure helpers ----------


def validate_group_buy_plan(plan_name: str, db: Session) -> Plan:
    """Load the Plan row and verify it is a group-buy plan (teacher_seats set).

    Detection by column, not by name pattern, so seed-name changes never
    silently let an individual plan slip through.
    """
    plan = db.query(Plan).filter(Plan.name == plan_name).first()
    if plan is None:
        raise ValueError(f"Unknown plan: {plan_name!r}")
    if not plan.is_active:
        raise ValueError(f"Plan {plan_name!r} is not active")
    if plan.teacher_seats is None or plan.annual_fee is None:
        raise ValueError(
            f"Plan {plan_name!r} is not a group-buy plan "
            "(teacher_seats / annual_fee not set)"
        )
    return plan


def compute_group_buy_total(plan: Plan) -> int:
    """Server-authoritative total: annual_fee × teacher_seats. Integer NT$."""
    return int(plan.annual_fee) * int(plan.teacher_seats)


def month_end_taipei(today: datetime) -> datetime:
    """End-of-current-month at 23:59:59.999999 in Asia/Taipei timezone.

    Used as the end_date for monthly group-buy SubscriptionPeriods so the
    next month's cron Phase 1 (`end_date < today`) marks them expired and
    Phase 3 creates the next month's grant.
    """
    taipei = ZoneInfo("Asia/Taipei")
    base = today.astimezone(taipei) if today.tzinfo else today.replace(tzinfo=taipei)
    if base.month == 12:
        first_of_next = base.replace(
            year=base.year + 1,
            month=1,
            day=1,
            hour=0,
            minute=0,
            second=0,
            microsecond=0,
        )
    else:
        first_of_next = base.replace(
            month=base.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0
        )
    return first_of_next - timedelta(microseconds=1)


# ---------- creation primitives ----------


def create_group_buy_org_and_school(
    owner: Teacher,
    plan: Plan,
    db: Session,
    *,
    now: datetime,
) -> Tuple[Organization, School, TeacherSchool, TeacherOrganization]:
    """Atomically create the Organization, School, owner TeacherSchool, AND
    owner TeacherOrganization (role='org_owner') for a new group-buy
    purchase. Subscription dates set on the Organization (1 year from `now`).

    TeacherOrganization is required so the opener can use the existing
    /org-purchase and /org-renew endpoints, both of which gate on
    `TeacherOrganization.role == 'org_owner'`.
    """
    org = Organization(
        name=f"{owner.name or owner.email}'s 團購",
        org_type="group_buy",
        subscription_start_date=now,
        # relativedelta(years=1) handles Feb 29 → Feb 28 edge correctly;
        # `timedelta(days=365)` would produce an off-by-one in leap years.
        subscription_end_date=now + relativedelta(years=1),
        is_active=True,
    )
    db.add(org)
    db.flush()  # need org.id for FK

    school = School(
        organization_id=org.id,
        name=f"{org.name} School",
        plan_id=plan.id,
        teacher_seat_limit=plan.teacher_seats,
        is_active=True,
    )
    db.add(school)
    db.flush()

    teacher_school = TeacherSchool(
        teacher_id=owner.id,
        school_id=school.id,
        roles=["school_admin"],
        is_active=True,
    )
    db.add(teacher_school)

    teacher_org = TeacherOrganization(
        teacher_id=owner.id,
        organization_id=org.id,
        role="org_owner",
        is_active=True,
    )
    db.add(teacher_org)
    db.flush()

    return org, school, teacher_school, teacher_org


def create_group_buy_period(
    teacher: Teacher,
    plan: Plan,
    db: Session,
    *,
    start: datetime,
    payment_id: str | None = None,
) -> SubscriptionPeriod:
    """Insert a fresh group-buy SubscriptionPeriod for a teacher.

    Both start_date and end_date are normalised to Taipei time so they
    represent the same calendar reference (avoids the late-UTC-evening
    open-purchase that would otherwise mix UTC start with Taipei end).
    end_date = month_end_taipei(start) so next month's cron Phase 1 expires
    it and Phase 3 grants the next month's points.
    """
    taipei = ZoneInfo("Asia/Taipei")
    start_taipei = (
        start.astimezone(taipei) if start.tzinfo else start.replace(tzinfo=taipei)
    )
    period = SubscriptionPeriod(
        teacher_id=teacher.id,
        plan_name=plan.name,
        amount_paid=0,  # group-buy quota is bundled in the annual school fee
        quota_total=GROUP_BUY_MONTHLY_QUOTA,
        quota_used=0,
        start_date=start_taipei,
        end_date=month_end_taipei(start_taipei),
        payment_method="group_buy",
        payment_id=payment_id,
        payment_status="paid",
        status="active",
    )
    db.add(period)
    db.flush()
    return period


# ---------- monthly cron primitive ----------


def grant_monthly_for_group_buy(today: datetime, db: Session) -> dict:
    """Cron Phase 3: create one fresh GROUP_BUY_MONTHLY_QUOTA-point period
    for every teacher actively bound to an active group-buy school whose
    organization subscription is still in date.

    Idempotency: if the teacher already has an active group-buy period for
    this plan whose start_date is on/after the current month-start, skip —
    that handles the edge case where the cron runs after the open endpoint
    has already created the period for day 1.

    Race-safety (Phase 5-1 R3.1): a Postgres advisory xact-lock on a fixed
    cron-job key prevents two concurrent invocations (Cloud Scheduler
    at-least-once retries, or `?force=true` ops re-run while the scheduled
    fire is still in flight) from both reading an empty existing_keys set
    and double-granting. Lock auto-releases on commit/rollback. SQLite
    test path is a no-op.
    """
    if db.get_bind().dialect.name == "postgresql":
        locked = db.execute(
            text(
                "SELECT pg_try_advisory_xact_lock(hashtext("
                "'grant_monthly_for_group_buy'))"
            )
        ).scalar()
        if not locked:
            # Another invocation holds the lock — bail out cleanly. The
            # other run will grant the points; this caller returns zero
            # counters so its summary reflects "did nothing".
            return {"grants_created": 0, "grants_skipped_duplicate": 0}

    taipei = ZoneInfo("Asia/Taipei")
    today_local = (
        today.astimezone(taipei) if today.tzinfo else today.replace(tzinfo=taipei)
    )
    month_start = today_local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    rows = (
        db.query(Teacher, Plan)
        .join(TeacherSchool, TeacherSchool.teacher_id == Teacher.id)
        .join(School, School.id == TeacherSchool.school_id)
        .join(Plan, Plan.id == School.plan_id)
        .join(Organization, Organization.id == School.organization_id)
        .filter(
            TeacherSchool.is_active.is_(True),
            School.is_active.is_(True),
            Teacher.is_active.is_(True),
            Plan.is_active.is_(True),
            Plan.teacher_seats.isnot(None),
            Organization.org_type == "group_buy",
            Organization.is_active.is_(True),
            Organization.subscription_end_date >= today_local,
        )
        .all()
    )

    # Bulk-load existing group-buy periods for the affected teachers in a
    # single round-trip (kills N+1). The duplicate check filters on
    # payment_method='group_buy' so an individual SubscriptionPeriod that
    # happens to share a plan_name can't mask the grant.
    counters = {"grants_created": 0, "grants_skipped_duplicate": 0}
    teacher_ids = {t.id for t, _ in rows}
    existing_keys: set[tuple[int, str]] = set()
    if teacher_ids:
        existing_keys = {
            (p.teacher_id, p.plan_name)
            for p in db.query(
                SubscriptionPeriod.teacher_id, SubscriptionPeriod.plan_name
            )
            .filter(
                SubscriptionPeriod.teacher_id.in_(teacher_ids),
                SubscriptionPeriod.status == "active",
                SubscriptionPeriod.payment_method == "group_buy",
                SubscriptionPeriod.start_date >= month_start,
            )
            .all()
        }

    for teacher, plan in rows:
        if (teacher.id, plan.name) in existing_keys:
            counters["grants_skipped_duplicate"] += 1
            continue
        create_group_buy_period(teacher, plan, db, start=today_local)
        # R2-F3 — Update the dedup set inside the loop so a teacher bound to
        # multiple group-buy schools sharing the same plan_name doesn't
        # receive 2× grants in the same cron run.
        existing_keys.add((teacher.id, plan.name))
        counters["grants_created"] += 1

    db.commit()
    return counters
