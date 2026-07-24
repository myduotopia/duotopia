"""Group-buy domain helpers (issue #768 Phase 3).

Centralizes the open-group flow and the monthly point-grant logic so both
the HTTP endpoint and the cron job share identical Period creation rules.

All amount/quota computations are server-side from the Plan row — never
trust the frontend.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Tuple
from zoneinfo import ZoneInfo

from dateutil.relativedelta import relativedelta
from sqlalchemy import text
from sqlalchemy.orm import Session

from models import (
    GroupBuyMember,
    GroupBuyTeam,
    Organization,
    Plan,
    School,
    SubscriptionPeriod,
    Teacher,
    TeacherOrganization,
    TeacherSchool,
)


logger = logging.getLogger(__name__)


# Each monthly grant gives this many points to every teacher bound to an
# active group-buy school. Matches the spec in issue #768.
GROUP_BUY_MONTHLY_QUOTA = 1000


# ---------- pure helpers ----------


def _as_utc(dt: datetime) -> datetime:
    """Normalise a datetime to tz-aware UTC. SQLite strips tzinfo on
    TIMESTAMPTZ load (naive), Postgres preserves it (aware); coercing both
    sides before comparison avoids a naive/aware TypeError."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


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
    leader_phone: str | None = None,
) -> Tuple[Organization, School, TeacherSchool, TeacherOrganization]:
    """Atomically create the Organization, School, owner TeacherSchool, AND
    owner TeacherOrganization (role='org_owner') for a new group-buy
    purchase. Subscription dates set on the Organization (1 year from `now`).

    TeacherOrganization is required so the opener can use the existing
    /org-purchase and /org-renew endpoints, both of which gate on
    `TeacherOrganization.role == 'org_owner'`.

    issue #838 comment — the initiator's contact info is persisted onto the
    org (`contact_email` = the opener's email, `contact_phone` =
    `leader_phone`) so admins can identify/contact the 發起人 instead of the
    field being left NULL.
    """
    owner_label = owner.name or owner.email
    org = Organization(
        name=f"{owner_label}'s 團購",
        # issue #768 comment #2: populate display_name + teacher_limit so the
        # admin org edit modal shows meaningful values instead of blanks.
        # display_name includes seat count for at-a-glance identification.
        display_name=f"{owner_label}'s 團購-{plan.teacher_seats}位",
        org_type="group_buy",
        teacher_limit=plan.teacher_seats,
        # issue #838 — persist 發起人 contact info (was previously NULL).
        contact_email=owner.email,
        contact_phone=leader_phone,
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


def find_owned_group_buy_org(owner: Teacher, db: Session) -> Organization | None:
    """Return the active group-buy Organization this teacher owns
    (role='org_owner'), or None. Earliest-created wins so repeat opens keep
    accreting 分校 under the teacher's first org rather than spawning new
    orgs. Used by the open endpoint to decide reuse-vs-create (issue #838).
    """
    return (
        db.query(Organization)
        .join(
            TeacherOrganization,
            TeacherOrganization.organization_id == Organization.id,
        )
        .filter(
            TeacherOrganization.teacher_id == owner.id,
            TeacherOrganization.role == "org_owner",
            TeacherOrganization.is_active.is_(True),
            Organization.org_type == "group_buy",
            Organization.is_active.is_(True),
        )
        .order_by(Organization.created_at.asc())
        .first()
    )


def add_group_buy_school_to_org(
    owner: Teacher,
    org: Organization,
    plan: Plan,
    db: Session,
    *,
    now: datetime,
    leader_phone: str | None = None,
) -> Tuple[School, TeacherSchool]:
    """Add a new 分校 (School) under an EXISTING group-buy org for a repeat
    open by the same 發起人 (issue #838).

    Per product decision, a repeat open is equivalent to 新增一個分校:
      - a new School (its own Plan / seat limit) is created under `org`;
      - the owner is bound to it as school_admin (they already have the
        org-level org_owner TeacherOrganization, so no new one is made);
      - the org's teacher_limit grows by this plan's seats (aggregate cap
        across all 分校);
      - the org subscription is extended to cover the new cohort's year
        (keep the later end date so the newest purchase never shortens an
        existing cohort's grant window);
      - contact info is refreshed to the latest 發起人 email/phone.

    Returns the new (School, owner TeacherSchool). The caller creates the
    owner/member SubscriptionPeriods and roster bindings against the
    returned school, mirroring the fresh-org path.
    """
    # Ordinal suffix so repeated 分校 are distinguishable in the admin UI
    # (the fresh-org path names its first school "{org.name} School"; the
    # 2nd/3rd accretions become "... School 2", "... School 3", ...).
    existing_count = db.query(School).filter(School.organization_id == org.id).count()
    school = School(
        organization_id=org.id,
        name=f"{org.name} School {existing_count + 1}",
        plan_id=plan.id,
        teacher_seat_limit=plan.teacher_seats,
        is_active=True,
    )
    db.add(school)
    db.flush()  # need school.id for FK

    teacher_school = TeacherSchool(
        teacher_id=owner.id,
        school_id=school.id,
        roles=["school_admin"],
        is_active=True,
    )
    db.add(teacher_school)

    # Aggregate the seat cap across all 分校.
    org.teacher_limit = (org.teacher_limit or 0) + int(plan.teacher_seats)

    # Extend the org subscription to cover this cohort's year, but never
    # shorten an existing later end date. SQLite strips tzinfo on
    # TIMESTAMPTZ load while Postgres preserves it, so normalise both sides
    # to tz-aware UTC before comparing to avoid a naive/aware TypeError.
    new_end = now + relativedelta(years=1)
    existing_end = org.subscription_end_date
    if existing_end is None or _as_utc(existing_end) < _as_utc(new_end):
        org.subscription_end_date = new_end

    # Refresh 發起人 contact info (latest wins); backfills orgs opened before
    # the issue #838 fix that still have NULL contact_email.
    org.contact_email = owner.email
    if leader_phone:
        org.contact_phone = leader_phone

    db.flush()
    return school, teacher_school


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
        # Fixed int64 advisory-lock key — replaces hashtext() which returns
        # int32 (~1-in-4-billion collision risk with other advisory locks).
        # Value is a hand-picked random int64 dedicated to this cron job;
        # never reuse across other lock sites in this codebase.
        # Mnemonic: "GBMG" (Group-Buy Monthly Grant) encoded.
        GRANT_MONTHLY_LOCK_KEY = 7386349847423521791
        locked = db.execute(
            text("SELECT pg_try_advisory_xact_lock(:k)"),
            {"k": GRANT_MONTHLY_LOCK_KEY},
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

    # issue #862 read-switch：發點眼前先全量 re-sync，補平任何 best-effort 鏡射
    # 失敗留下的漂移，確保下方以新表計算資格時是最新狀態（在 advisory lock 內、
    # commit 前執行，heal 與發點同一交易原子提交）。
    resync_all_group_buy_teams(db)

    # issue #862 §4.8 B：heal 之後（停用的 org/school 已把 team 翻 inactive）掃描
    # 「會籍/團隊已結束但個人訂閱仍 paused」的成員 → 恢復殘值。涵蓋團購到期
    # （subscription_end < now）、退團漏勾即時 hook、團隊/成員被停用。防 P2 吞權益。
    resume_ended_paused_memberships(db, now=today_local)

    # 資格改讀新表 group_buy_members → group_buy_teams（取代舊 TeacherSchool→
    # School→Org join）。條件對齊舊語意：成員 active、team active 且訂閱未過期、
    # 方案 active 且為團購方案、老師 active。
    rows = (
        db.query(Teacher, Plan)
        .join(GroupBuyMember, GroupBuyMember.teacher_id == Teacher.id)
        .join(GroupBuyTeam, GroupBuyTeam.id == GroupBuyMember.team_id)
        .join(Plan, Plan.id == GroupBuyTeam.plan_id)
        .filter(
            GroupBuyMember.is_active.is_(True),
            GroupBuyTeam.is_active.is_(True),
            GroupBuyTeam.subscription_end >= today_local,
            Teacher.is_active.is_(True),
            Plan.is_active.is_(True),
            Plan.teacher_seats.isnot(None),
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


# ---------- dual-write mirror (issue #862 PR2) ----------


def sync_group_buy_team_from_org(org: Organization, db: Session) -> GroupBuyTeam | None:
    """Idempotently mirror an old-table group-buy Organization (+ its School /
    TeacherOrganization / TeacherSchool) into the new group_buy_teams /
    group_buy_members tables (issue #862 方案 B PR2 雙寫).

    Called after every old-table write path (open / add-branch / add-member /
    renew / leave) inside the same transaction, so the new tables stay fresh
    while reads still run off the old tables until PR3. Reads the org's CURRENT
    old-table state and upserts new rows — self-healing against drift, safe to
    re-run (no duplicate teams/members).

    Returns the synced GroupBuyTeam, or None when the org isn't a syncable
    group-buy (not group_buy, no active school-with-plan, no active org_owner,
    or seat_limit fully underivable — mirroring the backfill's skip rules).

    Does NOT commit; the caller owns the transaction. Fields are derived
    identically to the PR1 backfill so team/member state matches whether a row
    arrived via backfill or via this live mirror.
    """
    if org.org_type != "group_buy":
        return None

    def _orphan_none() -> None:
        """issue #862 #2 — the org is (or became) un-syncable: no active
        school-with-plan / no active org_owner / seat underivable. If a team row
        already exists for this org, flip it inactive so the read-switched
        status/roster/grant paths stop surfacing it. This is the ONLY heal for
        SCHOOL-level deactivation (schools.py delete/update_school flips
        School.is_active without touching the org or the mirror), which would
        otherwise leave group_buy_teams.is_active stuck True and keep granting.
        """
        existing = (
            db.query(GroupBuyTeam)
            .filter(GroupBuyTeam.source_organization_id == org.id)
            .first()
        )
        if existing is not None and existing.is_active:
            existing.is_active = False
            db.flush()
        return None

    # Earliest active school with a plan → source of plan/seat (matches backfill).
    school = (
        db.query(School)
        .filter(
            School.organization_id == org.id,
            School.is_active.is_(True),
            School.plan_id.isnot(None),
        )
        .order_by(School.created_at.asc())
        .first()
    )
    if school is None:
        return _orphan_none()
    plan = db.query(Plan).filter(Plan.id == school.plan_id).first()

    owner_org = (
        db.query(TeacherOrganization)
        .filter(
            TeacherOrganization.organization_id == org.id,
            TeacherOrganization.role == "org_owner",
            TeacherOrganization.is_active.is_(True),
        )
        .order_by(TeacherOrganization.created_at.asc())
        .first()
    )
    if owner_org is None:
        return _orphan_none()
    owner_id = owner_org.teacher_id

    # seat_limit is NOT NULL; NULL org/school limits mean "unlimited", so fall
    # back to plan.teacher_seats (guaranteed set for group-buy plans) — same
    # accepted narrowing as the backfill.
    seat_limit = (
        org.teacher_limit
        if org.teacher_limit is not None
        else school.teacher_seat_limit
        if school.teacher_seat_limit is not None
        else (plan.teacher_seats if plan is not None else None)
    )
    if seat_limit is None:
        return _orphan_none()

    team = (
        db.query(GroupBuyTeam)
        .filter(GroupBuyTeam.source_organization_id == org.id)
        .first()
    )
    if team is None:
        team = GroupBuyTeam(source_organization_id=org.id)
        db.add(team)
    team.owner_teacher_id = owner_id
    team.plan_id = school.plan_id
    team.seat_limit = int(seat_limit)
    team.subscription_start = org.subscription_start_date
    team.subscription_end = org.subscription_end_date
    team.contact_email = org.contact_email
    team.contact_phone = org.contact_phone
    team.is_active = org.is_active
    db.flush()  # need team.id for member FKs

    # Members: all teacher_schools under the org's ACTIVE schools (aligned with
    # the team's active-school sourcing). Dedup by teacher, preferring the
    # active binding so a teacher in two schools keeps their in-team state.
    # Deterministic order (active first, then school_id) so that when a teacher
    # has multiple same-active-state bindings across branch schools, the winning
    # source_school_id is stable across runs rather than DB-order-dependent.
    ts_rows = (
        db.query(TeacherSchool)
        .join(School, School.id == TeacherSchool.school_id)
        .filter(
            School.organization_id == org.id,
            School.is_active.is_(True),
        )
        .order_by(TeacherSchool.is_active.desc(), TeacherSchool.school_id.asc())
        .all()
    )
    best_by_teacher: dict[int, TeacherSchool] = {}
    for ts in ts_rows:
        cur = best_by_teacher.get(ts.teacher_id)
        if cur is None or (ts.is_active and not cur.is_active):
            best_by_teacher[ts.teacher_id] = ts

    for teacher_id, ts in best_by_teacher.items():
        member = (
            db.query(GroupBuyMember)
            .filter(
                GroupBuyMember.team_id == team.id,
                GroupBuyMember.teacher_id == teacher_id,
            )
            .first()
        )
        if member is None:
            member = GroupBuyMember(team_id=team.id, teacher_id=teacher_id)
            db.add(member)
        member.is_owner = teacher_id == owner_id
        member.is_active = ts.is_active
        member.source_school_id = ts.school_id
    db.flush()

    return team


def mirror_group_buy_dual_write(org: Organization | None, db: Session) -> None:
    """Best-effort dual-write of a group-buy org into the new tables (issue #862).

    Wraps ``sync_group_buy_team_from_org`` in a SAVEPOINT so a mirror failure
    rolls back ONLY the mirror rows — never the caller's real write / charge —
    then absorbs + logs the error. Shared by every write call site so the
    SAVEPOINT + logging behaviour lives in one place (review PR #968 #2).

    After the PR3 read-switch the mirror is load-bearing, so a swallowed failure
    means a briefly stale new-table row; ``resync_all_group_buy_teams`` (run at
    the monthly cron start) heals that drift, and the ERROR log flags it for ops.
    """
    if org is None:
        return
    try:
        with db.begin_nested():
            sync_group_buy_team_from_org(org, db)
    except Exception as sync_err:  # noqa: BLE001 - best-effort mirror
        logger.error(
            "group-buy dual-write mirror failed (non-fatal; healed by monthly "
            "re-sync) org=%s: %s",
            getattr(org, "id", "?"),
            sync_err,
        )


def resync_all_group_buy_teams(db: Session) -> int:
    """Re-run the mirror for every group-buy Organization (issue #862).

    Heals drift left by any best-effort mirror write that failed after the
    read-switch. Idempotent (``sync_group_buy_team_from_org`` upserts). Returns
    the number of orgs synced. Does NOT commit — caller owns the transaction.

    Does NOT filter on ``Organization.is_active``: a group-buy org can be
    deactivated / soft-deleted via the generic org endpoints (PUT/DELETE
    /organizations/{id}) which don't call the mirror, so an inactive org is
    exactly the drift case we must heal — ``sync_group_buy_team_from_org`` sets
    ``team.is_active = org.is_active`` regardless, flipping the stale team to
    inactive so the read-switched status/roster queries stop surfacing it.
    """
    orgs = db.query(Organization).filter(Organization.org_type == "group_buy").all()
    synced = 0
    for org in orgs:
        # Per-org SAVEPOINT so one bad org can't abort the whole heal / the
        # monthly grant transaction it runs inside.
        try:
            with db.begin_nested():
                if sync_group_buy_team_from_org(org, db) is not None:
                    synced += 1
        except Exception as sync_err:  # noqa: BLE001 - best-effort heal
            logger.error(
                "group-buy re-sync heal failed for org=%s: %s", org.id, sync_err
            )
    return synced


# ---------- §4.8 pause + extend (residual preservation) ----------


def pause_individual_for_member(
    teacher: Teacher, member: GroupBuyMember, db: Session, *, now: datetime
) -> bool:
    """On group-buy join, pause the teacher's active INDIVIDUAL subscription and
    record the frozen residual on the group_buy_member (issue #862 §4.8).

    Freezes remaining time (`paused_remaining_seconds`) and the paused period id;
    the period's `quota_used` is left untouched so unused points are preserved.
    Flips the individual period `status='paused'` (drops it out of `current_period`
    selection and out of cron Phase-1 expiry) and — critically — turns OFF
    `subscription_auto_renew` so the monthly renewal cron can't re-charge and
    create a fresh active individual period that would shadow the group-buy points.

    Idempotent: no-op if the member is already paused. No-op (returns False) if the
    teacher has no active, not-yet-expired individual period. Does NOT commit.
    Returns True if a pause was applied.
    """
    if member.paused_period_id is not None:
        return False  # already paused for this membership
    ind = (
        db.query(SubscriptionPeriod)
        .filter(
            SubscriptionPeriod.teacher_id == teacher.id,
            SubscriptionPeriod.status == "active",
            SubscriptionPeriod.payment_method != "group_buy",
        )
        .order_by(SubscriptionPeriod.start_date.desc())
        .first()
    )
    if ind is None:
        return False
    end = _as_utc(ind.end_date)
    now_utc = _as_utc(now)
    if end <= now_utc:
        return False  # already expired → nothing to preserve; treat as pure member

    member.paused_period_id = ind.id
    member.paused_remaining_seconds = int((end - now_utc).total_seconds())
    member.paused_at = now
    ind.status = "paused"
    if teacher.subscription_auto_renew:
        teacher.subscription_auto_renew = False
        member.individual_auto_renew_suspended = True
    db.flush()
    return True


def resume_individual_for_member(
    member: GroupBuyMember, db: Session, *, now: datetime
) -> bool:
    """On leave / team-end, restore the paused individual subscription's residual
    (issue #862 §4.8): shift the frozen period to start at `now` and run for the
    frozen remaining seconds, with `quota_used` unchanged (unused points carry).
    Re-enables `subscription_auto_renew` if it was suspended for this membership,
    so the existing monthly cron takes over once the residual runs out.

    Idempotent: no-op if the member isn't paused, or if the referenced period is
    no longer `paused` (already resumed elsewhere). Always clears the member's
    pause bookkeeping so a second trigger can't double-resume. Does NOT commit.
    Returns True if a period was resumed.
    """
    if member.paused_period_id is None:
        return False

    resumed = False
    p = (
        db.query(SubscriptionPeriod)
        .filter(SubscriptionPeriod.id == member.paused_period_id)
        .first()
    )
    if p is not None and p.status == "paused":
        p.start_date = now
        p.end_date = now + timedelta(seconds=member.paused_remaining_seconds or 0)
        p.status = "active"  # quota_used untouched → points residual preserved
        resumed = True
    elif member.individual_auto_renew_suspended:
        # Period gone / already-resumed elsewhere: residual is unrecoverable, but
        # we must NOT leave the teacher permanently opted out of auto-renew. Flag
        # for ops since the bookkeeping recording this is wiped just below.
        logger.warning(
            "group-buy resume: paused period %s for member %s missing or no "
            "longer paused; restoring auto_renew, residual unrecoverable",
            member.paused_period_id,
            member.id,
        )

    # Restore auto_renew whenever WE suspended it — independent of whether the
    # period could be resumed — so a lost/expired paused period can't strand the
    # teacher with subscription_auto_renew=False forever.
    if member.individual_auto_renew_suspended:
        teacher = db.query(Teacher).filter(Teacher.id == member.teacher_id).first()
        if teacher is not None:
            teacher.subscription_auto_renew = True

    # Clear bookkeeping regardless, so a later trigger is a clean no-op.
    member.paused_period_id = None
    member.paused_remaining_seconds = None
    member.individual_auto_renew_suspended = False
    member.paused_at = None
    db.flush()
    return resumed


# ---------- §4.8 orchestration (join / leave / team-end / reconcile) ----------


def pause_joining_teachers_for_org(
    org: Organization, teachers: list, db: Session, *, now: datetime
) -> int:
    """After a group-buy open / add-member writes the old tables and the mirror
    has created the group_buy_members rows, pause each joining teacher's active
    individual subscription (issue #862 §4.8). Idempotent per member. Returns the
    number actually paused. Does NOT commit.
    """
    team = (
        db.query(GroupBuyTeam)
        .filter(
            GroupBuyTeam.source_organization_id == org.id,
            GroupBuyTeam.is_active.is_(True),
        )
        .first()
    )
    if team is None:
        return 0
    paused = 0
    for teacher in teachers:
        member = (
            db.query(GroupBuyMember)
            .filter(
                GroupBuyMember.team_id == team.id,
                GroupBuyMember.teacher_id == teacher.id,
            )
            .first()
        )
        if member is not None and pause_individual_for_member(
            teacher, member, db, now=now
        ):
            paused += 1
    return paused


def resume_member_on_group_buy_unbind(
    teacher_id: int, school_id, db: Session, *, now: datetime
) -> bool:
    """Immediate resume trigger (§4.8 A): when a TeacherSchool under a group-buy
    school is deactivated via the generic schools.py endpoints (which aren't
    group-buy-aware), restore that member's paused individual subscription right
    away instead of waiting for the monthly reconcile. No-op for non-group-buy
    schools or non-paused members. Does NOT commit. Returns True if resumed.
    """
    school = db.query(School).filter(School.id == school_id).first()
    if school is None:
        return False
    org = (
        db.query(Organization)
        .filter(
            Organization.id == school.organization_id,
            Organization.org_type == "group_buy",
        )
        .first()
    )
    if org is None:
        return False
    member = (
        db.query(GroupBuyMember)
        .join(GroupBuyTeam, GroupBuyTeam.id == GroupBuyMember.team_id)
        .filter(
            GroupBuyTeam.source_organization_id == org.id,
            GroupBuyMember.teacher_id == teacher_id,
        )
        .first()
    )
    if member is None:
        return False
    return resume_individual_for_member(member, db, now=now)


def pause_member_on_group_buy_bind(
    teacher_id: int, school_id, db: Session, *, now: datetime
) -> bool:
    """Immediate pause trigger symmetric to ``resume_member_on_group_buy_unbind``
    (§4.8 #1): when a teacher is added to / reactivated in a group-buy school via
    the generic schools.py endpoints (which aren't group-buy-aware and skip the
    payment/admin join flow), mirror the org so the GroupBuyMember row exists,
    then pause that teacher's individual subscription right away. Closes the P1
    double-charge gap on the non-payment join paths — otherwise the teacher keeps
    auto-renewing their individual sub in parallel with the group-buy grant, and
    the cron Phase-2 guard wouldn't even see them until the next monthly heal.

    No-op for non-group-buy schools / teachers without an active individual sub.
    Does NOT commit. Returns True if a pause was applied.
    """
    school = db.query(School).filter(School.id == school_id).first()
    if school is None:
        return False
    org = (
        db.query(Organization)
        .filter(
            Organization.id == school.organization_id,
            Organization.org_type == "group_buy",
        )
        .first()
    )
    if org is None:
        return False
    # Ensure the just-added/reactivated TeacherSchool is visible, then mirror so
    # the GroupBuyMember row exists (autoflush is off in this project).
    db.flush()
    mirror_group_buy_dual_write(org, db)
    team = (
        db.query(GroupBuyTeam)
        .filter(
            GroupBuyTeam.source_organization_id == org.id,
            GroupBuyTeam.is_active.is_(True),
        )
        .first()
    )
    if team is None:
        return False
    member = (
        db.query(GroupBuyMember)
        .filter(
            GroupBuyMember.team_id == team.id,
            GroupBuyMember.teacher_id == teacher_id,
        )
        .first()
    )
    if member is None:
        return False
    teacher = db.query(Teacher).filter(Teacher.id == teacher_id).first()
    if teacher is None:
        return False
    return pause_individual_for_member(teacher, member, db, now=now)


def resume_ended_paused_memberships(db: Session, *, now: datetime) -> int:
    """Backstop resume sweep (§4.8 B + team-end): resume every still-paused member
    whose group-buy benefit has ended — membership deactivated, team deactivated,
    or team subscription window elapsed (發起人 didn't renew). Catches any leave
    path that skipped the immediate hook, and the team-expiry case. Idempotent
    (resume clears bookkeeping). Returns count resumed. Does NOT commit.

    Run inside the monthly cron (after the re-sync heal, which flips teams of
    deactivated orgs/schools to inactive so they get swept here too).
    """
    now_utc = _as_utc(now)
    rows = (
        db.query(GroupBuyMember)
        .join(GroupBuyTeam, GroupBuyTeam.id == GroupBuyMember.team_id)
        .filter(
            GroupBuyMember.paused_period_id.isnot(None),
            (
                (GroupBuyMember.is_active.is_(False))
                | (GroupBuyTeam.is_active.is_(False))
                | (GroupBuyTeam.subscription_end < now_utc)
            ),
        )
        .all()
    )
    resumed = 0
    for member in rows:
        if resume_individual_for_member(member, db, now=now):
            resumed += 1
    return resumed
