"""Dual-write mirror: sync_group_buy_team_from_org (issue #862 PR2).

PR2 走 expand/contract 的「雙寫優先」：舊表寫入路徑呼叫此函式，把 group_buy
Organization 的當前狀態鏡射進 group_buy_teams/members，讀取仍走舊表到 PR3。
本測試（SQLite ORM 層）鎖定：
  - 首次同步建立 team + members（含 owner is_owner）
  - 冪等重跑不重複
  - 續約/加席（org 欄位變動）反映到 team
  - 退團（TeacherSchool.is_active=False）反映到 member.is_active
  - 非 group_buy / 缺 owner / 缺 school → 回 None，不建列
"""

from datetime import datetime, timezone

from auth import get_password_hash
from models import (
    GroupBuyMember,
    GroupBuyTeam,
    Organization,
    Plan,
    School,
    Teacher,
    TeacherOrganization,
    TeacherSchool,
)
from services.group_buy import (
    resync_all_group_buy_teams,
    sync_group_buy_team_from_org,
)


def _teacher(db, email):
    t = Teacher(
        email=email,
        password_hash=get_password_hash("x"),
        name=email.split("@")[0],
        is_active=True,
        email_verified=True,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _plan(db, seats=30):
    p = Plan(
        name=f"團購-{seats}席",
        price=None,
        quota=1000,
        teacher_seats=seats,
        annual_fee=1300,
        is_active=True,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _group_buy_org(db, owner, plan, *, teacher_limit=30, org_type="group_buy"):
    org = Organization(
        name="gb",
        org_type=org_type,
        teacher_limit=teacher_limit,
        is_active=True,
        subscription_start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
        subscription_end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
        contact_email=owner.email,
    )
    db.add(org)
    db.flush()
    school = School(
        organization_id=org.id,
        name="S",
        plan_id=plan.id,
        teacher_seat_limit=plan.teacher_seats,
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
    db.commit()
    return org, school


def _bind_member(db, teacher, school, is_active=True):
    ts = TeacherSchool(
        teacher_id=teacher.id,
        school_id=school.id,
        roles=["teacher"],
        is_active=is_active,
    )
    db.add(ts)
    db.commit()
    return ts


def test_first_sync_creates_team_and_members(shared_test_session):
    db = shared_test_session
    owner = _teacher(db, "o@d.com")
    m1 = _teacher(db, "m1@d.com")
    plan = _plan(db)
    org, school = _group_buy_org(db, owner, plan)
    _bind_member(db, m1, school)

    team = sync_group_buy_team_from_org(org, db)
    db.commit()

    assert team is not None
    assert team.source_organization_id == org.id
    assert team.owner_teacher_id == owner.id
    assert team.plan_id == plan.id
    assert team.seat_limit == 30
    assert team.subscription_end == org.subscription_end_date

    members = db.query(GroupBuyMember).filter_by(team_id=team.id).all()
    by_tid = {m.teacher_id: m for m in members}
    assert set(by_tid) == {owner.id, m1.id}
    assert by_tid[owner.id].is_owner is True
    assert by_tid[m1.id].is_owner is False


def test_sync_is_idempotent(shared_test_session):
    db = shared_test_session
    owner = _teacher(db, "o2@d.com")
    plan = _plan(db)
    org, _ = _group_buy_org(db, owner, plan)

    sync_group_buy_team_from_org(org, db)
    db.commit()
    sync_group_buy_team_from_org(org, db)
    db.commit()

    assert db.query(GroupBuyTeam).filter_by(source_organization_id=org.id).count() == 1
    team = db.query(GroupBuyTeam).filter_by(source_organization_id=org.id).first()
    assert db.query(GroupBuyMember).filter_by(team_id=team.id).count() == 1


def test_sync_deactivates_team_when_only_school_deactivated(shared_test_session):
    """#2（PR4）：org 仍 active、但其唯一 school 被停用（schools.py delete/update，
    不經鏡射）→ sync 找不到 active school 會 return None，此時必須把既有 team 翻
    inactive，否則切讀後 cron 持續發點、membership 持續說「已在團」。"""
    db = shared_test_session
    owner = _teacher(db, "o_school@d.com")
    plan = _plan(db)
    org, school = _group_buy_org(db, owner, plan)
    team = sync_group_buy_team_from_org(org, db)
    db.commit()
    assert team.is_active is True

    # 只停用 school（org 不動）→ sync 應 return None 且把 team 翻 inactive
    school.is_active = False
    db.commit()
    result = sync_group_buy_team_from_org(org, db)
    db.commit()
    assert result is None
    db.refresh(team)
    assert team.is_active is False


def test_sync_reflects_renew_and_seat_change(shared_test_session):
    db = shared_test_session
    owner = _teacher(db, "o3@d.com")
    plan = _plan(db)
    org, _ = _group_buy_org(db, owner, plan)
    sync_group_buy_team_from_org(org, db)
    db.commit()

    # 模擬續約 + 加席（reopen 加分校時 org 欄位被更新）
    org.subscription_end_date = datetime(2027, 12, 31, tzinfo=timezone.utc)
    org.teacher_limit = 60
    db.commit()
    team = sync_group_buy_team_from_org(org, db)
    db.commit()

    # SQLite 讀回會去 tzinfo，比日期即可（Postgres 保留，CI 驗證）
    assert team.subscription_end.replace(tzinfo=None) == datetime(2027, 12, 31)
    assert team.seat_limit == 60


def test_sync_reflects_member_leave(shared_test_session):
    db = shared_test_session
    owner = _teacher(db, "o4@d.com")
    m1 = _teacher(db, "m4@d.com")
    plan = _plan(db)
    org, school = _group_buy_org(db, owner, plan)
    ts = _bind_member(db, m1, school)
    team = sync_group_buy_team_from_org(org, db)
    db.commit()
    assert (
        db.query(GroupBuyMember)
        .filter_by(team_id=team.id, teacher_id=m1.id)
        .first()
        .is_active
        is True
    )

    # 退團：舊表 TeacherSchool.is_active=False → 再 sync 反映到 member
    ts.is_active = False
    db.commit()
    sync_group_buy_team_from_org(org, db)
    db.commit()
    assert (
        db.query(GroupBuyMember)
        .filter_by(team_id=team.id, teacher_id=m1.id)
        .first()
        .is_active
        is False
    )


def test_resync_heals_deactivated_org(shared_test_session):
    """B（PR3 review）：團購 org 經一般 org 端點停用（不經鏡射）後，heal 必須把
    stale 的 team.is_active 從 True 翻成 False，否則切讀後成員無限期顯示團購身分。
    resync 不可過濾 is_active，否則永遠掃不到這個 org。"""
    db = shared_test_session
    owner = _teacher(db, "o_heal@d.com")
    plan = _plan(db)
    org, _ = _group_buy_org(db, owner, plan)
    team = sync_group_buy_team_from_org(org, db)
    db.commit()
    assert team.is_active is True

    # 一般 org 端點停用（不經鏡射）→ 新表 stale
    org.is_active = False
    db.commit()

    synced = resync_all_group_buy_teams(db)
    db.commit()
    assert synced >= 1
    db.refresh(team)
    assert team.is_active is False


def test_sync_skips_non_group_buy(shared_test_session):
    db = shared_test_session
    owner = _teacher(db, "o5@d.com")
    plan = _plan(db)
    org, _ = _group_buy_org(db, owner, plan, org_type="institution")

    assert sync_group_buy_team_from_org(org, db) is None
    assert db.query(GroupBuyTeam).filter_by(source_organization_id=org.id).count() == 0


def test_sync_seat_limit_falls_back_to_plan_seats(shared_test_session):
    """org.teacher_limit / school.teacher_seat_limit 皆 NULL → 用 plan.teacher_seats。"""
    db = shared_test_session
    owner = _teacher(db, "o6@d.com")
    plan = _plan(db, seats=50)
    org, school = _group_buy_org(db, owner, plan, teacher_limit=None)
    school.teacher_seat_limit = None
    db.commit()

    team = sync_group_buy_team_from_org(org, db)
    db.commit()
    assert team.seat_limit == 50
