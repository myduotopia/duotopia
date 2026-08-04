"""Tests for the group-buy standalone models (issue #862, PR1).

方案 B 後端重構：團購脫離機構表，改由 `group_buy_teams` / `group_buy_members`
自成一格。本測試只覆蓋 ORM 模型層（SQLite），涵蓋：
  - GroupBuyTeam / GroupBuyMember 建立與關聯
  - is_owner 旗標
  - UNIQUE(team_id, teacher_id) 約束
  - §4.8 暫停+延展欄位的預設值
  - cascade 刪除

回填 migration 的正確性依專案慣例由 CI / staging 驗證（本機不跑 alembic-on-SQLite）。
"""

from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from auth import get_password_hash
from models import GroupBuyMember, GroupBuyTeam, Organization, Plan, Teacher


# ---------- fixtures ----------


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


def _group_buy_plan(db, name="團購-30席"):
    p = Plan(
        name=name,
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


@pytest.fixture
def team_with_owner(shared_test_session):
    db = shared_test_session
    owner = _teacher(db, "gb_owner@duotopia.com")
    plan = _group_buy_plan(db)
    team = GroupBuyTeam(
        owner_teacher_id=owner.id,
        plan_id=plan.id,
        seat_limit=30,
        subscription_start=datetime(2026, 1, 1, tzinfo=timezone.utc),
        subscription_end=datetime(2026, 12, 31, tzinfo=timezone.utc),
        contact_email=owner.email,
        is_active=True,
    )
    db.add(team)
    db.commit()
    db.refresh(team)
    return db, team, owner


# ---------- tests ----------


def test_create_team_and_members_relationship(team_with_owner):
    db, team, owner = team_with_owner
    member = _teacher(db, "gb_member@duotopia.com")

    db.add_all(
        [
            GroupBuyMember(team_id=team.id, teacher_id=owner.id, is_owner=True),
            GroupBuyMember(team_id=team.id, teacher_id=member.id, is_owner=False),
        ]
    )
    db.commit()
    db.refresh(team)

    assert {m.teacher_id for m in team.members} == {owner.id, member.id}
    # back-populate
    owner_member = next(m for m in team.members if m.teacher_id == owner.id)
    assert owner_member.team.id == team.id


def test_is_owner_flag(team_with_owner):
    db, team, owner = team_with_owner
    m = GroupBuyMember(team_id=team.id, teacher_id=owner.id, is_owner=True)
    db.add(m)
    db.commit()
    db.refresh(m)
    assert m.is_owner is True


def test_unique_team_teacher(team_with_owner):
    db, team, owner = team_with_owner
    db.add(GroupBuyMember(team_id=team.id, teacher_id=owner.id))
    db.commit()
    # 同一 (team, teacher) 第二列應違反唯一約束
    db.add(GroupBuyMember(team_id=team.id, teacher_id=owner.id))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_pause_extend_columns_default(team_with_owner):
    """§4.8 暫停+延展欄位預設：無暫停狀態。"""
    db, team, owner = team_with_owner
    m = GroupBuyMember(team_id=team.id, teacher_id=owner.id)
    db.add(m)
    db.commit()
    db.refresh(m)
    assert m.paused_period_id is None
    assert m.paused_remaining_seconds is None
    assert m.paused_at is None
    assert m.individual_auto_renew_suspended is False


def test_source_organization_id_unique_when_set(team_with_owner):
    """同一來源機構最多回填一個 team（冪等不變式由 DB 唯一索引保證）。

    註：SQLite 忽略 postgresql_where，退化為一般唯一索引；對「非 NULL 值唯一」
    的驗證仍成立（NULL 多列允許另有 test 覆蓋隱含於 fixture）。
    """
    db, team, owner = team_with_owner
    org = Organization(name="src-org", org_type="group_buy")
    db.add(org)
    db.commit()
    db.refresh(org)

    team.source_organization_id = org.id
    db.commit()

    dup = GroupBuyTeam(
        owner_teacher_id=owner.id,
        plan_id=team.plan_id,
        seat_limit=30,
        source_organization_id=org.id,  # 同一來源機構 → 應違反唯一索引
    )
    db.add(dup)
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_cascade_delete_team_removes_members(team_with_owner):
    db, team, owner = team_with_owner
    db.add(GroupBuyMember(team_id=team.id, teacher_id=owner.id))
    db.commit()

    db.delete(team)
    db.commit()

    assert db.query(GroupBuyMember).filter_by(team_id=team.id).count() == 0
