"""§4.8 暫停 + 延展（殘值保留）service 層測試（issue #862 PR4b）.

覆蓋 pause_individual_for_member / resume_individual_for_member 的：
  - 有個人訂閱 → 暫停（period status=paused、凍結殘值、關 auto_renew）
  - 無/已過期個人訂閱 → no-op
  - 冪等（重複 pause / resume）
  - resume 殘值保留（時間 + 未用點數）、恢復 auto_renew
  - pause→resume 往返
  - paused period 不進 current_period（讀取路徑安全）
"""

from datetime import datetime, timedelta, timezone

from auth import get_password_hash
from models import (
    GroupBuyMember,
    GroupBuyTeam,
    Plan,
    SubscriptionPeriod,
    Teacher,
)
from models import Organization, School, TeacherOrganization, TeacherSchool
from services.group_buy import (
    pause_individual_for_member,
    pause_joining_teachers_for_org,
    pause_member_on_group_buy_bind,
    resume_ended_paused_memberships,
    resume_individual_for_member,
    resume_member_on_group_buy_unbind,
    sync_group_buy_team_from_org,
)


def _teacher(db, email, *, auto_renew=True):
    t = Teacher(
        email=email,
        password_hash=get_password_hash("x"),
        name=email.split("@")[0],
        is_active=True,
        email_verified=True,
        subscription_auto_renew=auto_renew,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _plan(db):
    p = Plan(
        name="團購-30席-pe",
        price=None,
        quota=1000,
        teacher_seats=30,
        annual_fee=1300,
        is_active=True,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _member(db, plan, teacher):
    team = GroupBuyTeam(
        owner_teacher_id=teacher.id, plan_id=plan.id, seat_limit=30, is_active=True
    )
    db.add(team)
    db.flush()
    m = GroupBuyMember(
        team_id=team.id, teacher_id=teacher.id, is_owner=False, is_active=True
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


def _indiv_period(db, teacher, *, days_left=100, quota_used=500):
    now = datetime.now(timezone.utc)
    p = SubscriptionPeriod(
        teacher_id=teacher.id,
        plan_name="Tutor Teachers",
        amount_paid=299,
        quota_total=2000,
        quota_used=quota_used,
        start_date=now - timedelta(days=10),
        end_date=now + timedelta(days=days_left),
        payment_method="manual",
        payment_status="paid",
        status="active",
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


# ---------- pause ----------


def test_pause_freezes_period_and_disables_auto_renew(shared_test_session):
    db = shared_test_session
    t = _teacher(db, "pe1@d.com", auto_renew=True)
    plan = _plan(db)
    m = _member(db, plan, t)
    ind = _indiv_period(db, t, days_left=100, quota_used=500)

    now = datetime.now(timezone.utc)
    applied = pause_individual_for_member(t, m, db, now=now)
    db.commit()

    assert applied is True
    db.refresh(ind)
    db.refresh(m)
    db.refresh(t)
    assert ind.status == "paused"
    assert m.paused_period_id == ind.id
    # ~100 days frozen (allow small delta from setup)
    assert abs(m.paused_remaining_seconds - 100 * 86400) < 3600
    assert t.subscription_auto_renew is False
    assert m.individual_auto_renew_suspended is True


def test_pause_noop_without_individual_period(shared_test_session):
    db = shared_test_session
    t = _teacher(db, "pe2@d.com")
    plan = _plan(db)
    m = _member(db, plan, t)

    assert (
        pause_individual_for_member(t, m, db, now=datetime.now(timezone.utc)) is False
    )
    db.refresh(m)
    assert m.paused_period_id is None


def test_pause_noop_when_period_expired(shared_test_session):
    db = shared_test_session
    t = _teacher(db, "pe3@d.com")
    plan = _plan(db)
    m = _member(db, plan, t)
    _indiv_period(db, t, days_left=-1)  # already expired

    assert (
        pause_individual_for_member(t, m, db, now=datetime.now(timezone.utc)) is False
    )
    db.refresh(m)
    assert m.paused_period_id is None


def test_pause_idempotent(shared_test_session):
    db = shared_test_session
    t = _teacher(db, "pe4@d.com")
    plan = _plan(db)
    m = _member(db, plan, t)
    _indiv_period(db, t)

    now = datetime.now(timezone.utc)
    assert pause_individual_for_member(t, m, db, now=now) is True
    db.commit()
    # second call → already paused → no-op
    assert pause_individual_for_member(t, m, db, now=now) is False


def test_pause_keeps_auto_renew_flag_when_already_off(shared_test_session):
    db = shared_test_session
    t = _teacher(db, "pe5@d.com", auto_renew=False)
    plan = _plan(db)
    m = _member(db, plan, t)
    _indiv_period(db, t)

    assert pause_individual_for_member(t, m, db, now=datetime.now(timezone.utc)) is True
    db.refresh(m)
    # auto_renew was already off → we did NOT suspend it (so resume won't wrongly
    # turn it on)
    assert m.individual_auto_renew_suspended is False


# ---------- resume ----------


def test_resume_restores_residual_and_auto_renew(shared_test_session):
    db = shared_test_session
    t = _teacher(db, "pe6@d.com", auto_renew=True)
    plan = _plan(db)
    m = _member(db, plan, t)
    ind = _indiv_period(db, t, days_left=100, quota_used=500)

    pause_at = datetime.now(timezone.utc)
    pause_individual_for_member(t, m, db, now=pause_at)
    db.commit()
    frozen = m.paused_remaining_seconds

    resume_at = pause_at + timedelta(days=200)  # 提早退團/團購結束
    resumed = resume_individual_for_member(m, db, now=resume_at)
    db.commit()

    assert resumed is True
    db.refresh(ind)
    db.refresh(m)
    db.refresh(t)
    assert ind.status == "active"
    # 殘值時間平移到 resume 之後
    assert abs((_naive(ind.end_date) - _naive(resume_at)).total_seconds() - frozen) < 5
    assert ind.quota_used == 500  # 未用點數殘值保留
    assert t.subscription_auto_renew is True  # 恢復月扣
    # 清掉 bookkeeping
    assert m.paused_period_id is None
    assert m.individual_auto_renew_suspended is False


def test_resume_noop_when_not_paused(shared_test_session):
    db = shared_test_session
    t = _teacher(db, "pe7@d.com")
    plan = _plan(db)
    m = _member(db, plan, t)
    assert resume_individual_for_member(m, db, now=datetime.now(timezone.utc)) is False


def test_resume_idempotent(shared_test_session):
    db = shared_test_session
    t = _teacher(db, "pe8@d.com")
    plan = _plan(db)
    m = _member(db, plan, t)
    _indiv_period(db, t)
    pause_individual_for_member(t, m, db, now=datetime.now(timezone.utc))
    db.commit()

    assert resume_individual_for_member(m, db, now=datetime.now(timezone.utc)) is True
    db.commit()
    # second resume → already cleared → no-op
    assert resume_individual_for_member(m, db, now=datetime.now(timezone.utc)) is False


def test_paused_period_not_selected_as_current(shared_test_session):
    """讀取路徑安全：paused 個人 period 不進 current_period。"""
    db = shared_test_session
    t = _teacher(db, "pe9@d.com")
    plan = _plan(db)
    m = _member(db, plan, t)
    _indiv_period(db, t)
    assert t.current_period is not None  # active 時是 current
    pause_individual_for_member(t, m, db, now=datetime.now(timezone.utc))
    db.commit()
    db.refresh(t)
    assert t.current_period is None  # paused 後不再被選為 current


def _naive(dt):
    return dt.replace(tzinfo=None) if dt and dt.tzinfo else dt


# ---------- orchestration (join-pause / unbind-resume / ended-sweep) ----------


def _full_group_buy(db, owner, plan, *, end_in_days=365):
    """Build a real group_buy org+school+owner-binding and sync it into new
    tables. Returns (org, school, team)."""
    now = datetime.now(timezone.utc)
    org = Organization(
        name="gb-orch",
        org_type="group_buy",
        teacher_limit=30,
        is_active=True,
        subscription_start_date=now,
        subscription_end_date=now + timedelta(days=end_in_days),
    )
    db.add(org)
    db.flush()
    school = School(
        organization_id=org.id,
        name="S",
        plan_id=plan.id,
        teacher_seat_limit=30,
        is_active=True,
    )
    db.add(school)
    db.flush()
    db.add(
        TeacherOrganization(
            teacher_id=owner.id,
            organization_id=org.id,
            role="org_owner",
            is_active=True,
        )
    )
    db.add(
        TeacherSchool(
            teacher_id=owner.id,
            school_id=school.id,
            roles=["school_admin"],
            is_active=True,
        )
    )
    db.flush()
    team = sync_group_buy_team_from_org(org, db)
    db.commit()
    return org, school, team


def test_pause_joining_teachers_for_org(shared_test_session):
    db = shared_test_session
    owner = _teacher(db, "orch_owner@d.com", auto_renew=True)
    plan = _plan(db)
    org, school, team = _full_group_buy(db, owner, plan)
    ind = _indiv_period(db, owner, days_left=80)

    n = pause_joining_teachers_for_org(org, [owner], db, now=datetime.now(timezone.utc))
    db.commit()
    assert n == 1
    db.refresh(ind)
    assert ind.status == "paused"


def test_resume_on_group_buy_unbind(shared_test_session):
    db = shared_test_session
    owner = _teacher(db, "orch_unbind@d.com")
    plan = _plan(db)
    org, school, team = _full_group_buy(db, owner, plan)
    ind = _indiv_period(db, owner, days_left=80)
    pause_joining_teachers_for_org(org, [owner], db, now=datetime.now(timezone.utc))
    db.commit()

    ok = resume_member_on_group_buy_unbind(
        owner.id, school.id, db, now=datetime.now(timezone.utc)
    )
    db.commit()
    assert ok is True
    db.refresh(ind)
    assert ind.status == "active"


def test_resume_ended_sweep_by_team_expiry(shared_test_session):
    """team subscription_end 過期 → sweep 恢復 paused 成員。"""
    db = shared_test_session
    owner = _teacher(db, "orch_end@d.com")
    plan = _plan(db)
    org, school, team = _full_group_buy(db, owner, plan, end_in_days=365)
    ind = _indiv_period(db, owner, days_left=80)
    pause_joining_teachers_for_org(org, [owner], db, now=datetime.now(timezone.utc))
    db.commit()

    # 團購年度已過（把 team.subscription_end 移到過去）
    team.subscription_end = datetime.now(timezone.utc) - timedelta(days=1)
    db.commit()

    n = resume_ended_paused_memberships(db, now=datetime.now(timezone.utc))
    db.commit()
    assert n == 1
    db.refresh(ind)
    assert ind.status == "active"


def test_pause_member_on_group_buy_bind(shared_test_session):
    """#1：老師經通用 join 端點被加進團購 school（非 open/admin）→ bind helper 應
    mirror 出 member 列並暫停其個人訂閱。"""
    db = shared_test_session
    owner = _teacher(db, "bind_owner@d.com")
    joiner = _teacher(db, "bind_joiner@d.com", auto_renew=True)
    plan = _plan(db)
    org, school, team = _full_group_buy(db, owner, plan)
    ind = _indiv_period(db, joiner, days_left=90)
    db.add(
        TeacherSchool(
            teacher_id=joiner.id, school_id=school.id, roles=["teacher"], is_active=True
        )
    )
    db.commit()

    ok = pause_member_on_group_buy_bind(
        joiner.id, school.id, db, now=datetime.now(timezone.utc)
    )
    db.commit()
    assert ok is True
    db.refresh(ind)
    assert ind.status == "paused"
    joiner_db = _reload(db, joiner.id)
    assert joiner_db.subscription_auto_renew is False


def test_resume_restores_auto_renew_even_if_period_gone(shared_test_session):
    """#2：paused period 不見了（p None），resume 仍要恢復 auto_renew、不可讓老師
    永久卡在不續約。"""
    db = shared_test_session
    t = _teacher(db, "strand@d.com", auto_renew=True)
    plan = _plan(db)
    m = _member(db, plan, t)
    ind = _indiv_period(db, t)
    pause_individual_for_member(t, m, db, now=datetime.now(timezone.utc))
    db.commit()
    db.refresh(t)
    assert t.subscription_auto_renew is False  # pause 關掉了

    db.delete(ind)  # 模擬 period 消失
    db.commit()

    resumed = resume_individual_for_member(m, db, now=datetime.now(timezone.utc))
    db.commit()
    assert resumed is False  # period 沒了 → 沒 resume
    db.refresh(t)
    db.refresh(m)
    assert t.subscription_auto_renew is True  # 但 auto_renew 已恢復（不卡死）
    assert m.individual_auto_renew_suspended is False


def _reload(db, teacher_id):
    return db.query(Teacher).filter(Teacher.id == teacher_id).first()


def test_resume_ended_sweep_skips_still_active_membership(shared_test_session):
    """會籍仍有效（team active、未過期）→ sweep 不動 paused 成員。"""
    db = shared_test_session
    owner = _teacher(db, "orch_active@d.com")
    plan = _plan(db)
    org, school, team = _full_group_buy(db, owner, plan, end_in_days=365)
    ind = _indiv_period(db, owner, days_left=80)
    pause_joining_teachers_for_org(org, [owner], db, now=datetime.now(timezone.utc))
    db.commit()

    n = resume_ended_paused_memberships(db, now=datetime.now(timezone.utc))
    db.commit()
    assert n == 0
    db.refresh(ind)
    assert ind.status == "paused"
