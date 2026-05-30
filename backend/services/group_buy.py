"""Group-buy domain helpers (issue #768 Phase 3).

Centralizes the open-group flow and the monthly point-grant logic so both
the HTTP endpoint and the cron job share identical Period creation rules.

All amount/quota computations are server-side from the Plan row — never
trust the frontend.
"""

from datetime import datetime, timedelta
from typing import Tuple
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from models import (
    Organization,
    Plan,
    School,
    SubscriptionPeriod,
    Teacher,
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
) -> Tuple[Organization, School, TeacherSchool]:
    """Atomically create the Organization, School, and owner TeacherSchool
    for a new group-buy purchase. Subscription dates set on the Organization
    (1 year from `now`)."""
    org = Organization(
        name=f"{owner.name or owner.email}'s 團購",
        org_type="group_buy",
        subscription_start_date=now,
        subscription_end_date=now + timedelta(days=365),
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
    db.flush()

    return org, school, teacher_school


def create_group_buy_period(
    teacher: Teacher,
    plan: Plan,
    db: Session,
    *,
    start: datetime,
    payment_id: str | None = None,
) -> SubscriptionPeriod:
    """Insert a fresh group-buy SubscriptionPeriod for a teacher.

    end_date = month_end_taipei(start) so next month's cron Phase 1 expires
    it and Phase 3 grants the next month's points.
    """
    period = SubscriptionPeriod(
        teacher_id=teacher.id,
        plan_name=plan.name,
        amount_paid=0,  # group-buy quota is bundled in the annual school fee
        quota_total=GROUP_BUY_MONTHLY_QUOTA,
        quota_used=0,
        start_date=start,
        end_date=month_end_taipei(start),
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
    """
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

    counters = {"grants_created": 0, "grants_skipped_duplicate": 0}
    for teacher, plan in rows:
        existing = (
            db.query(SubscriptionPeriod)
            .filter(
                SubscriptionPeriod.teacher_id == teacher.id,
                SubscriptionPeriod.plan_name == plan.name,
                SubscriptionPeriod.status == "active",
                SubscriptionPeriod.start_date >= month_start,
            )
            .first()
        )
        if existing is not None:
            counters["grants_skipped_duplicate"] += 1
            continue

        create_group_buy_period(teacher, plan, db, start=today_local)
        counters["grants_created"] += 1

    db.commit()
    return counters
