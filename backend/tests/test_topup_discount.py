"""Tests for backend.services.topup_discount.

issue #862 read-switch：折扣改讀新表 group_buy_members → group_buy_teams → Plan。
Covers:
  - teacher not in any group-buy team    -> no discount
  - teacher in one group-buy team        -> that team's discount
  - teacher in multiple group-buy teams  -> best (lowest) discount
  - GroupBuyMember inactive               -> ignored
  - GroupBuyTeam inactive                 -> ignored
  - Plan inactive (contract ended)        -> ignored
"""

from decimal import Decimal

import pytest

from auth import get_password_hash
from models import GroupBuyMember, GroupBuyTeam, Plan, Teacher
from services.topup_discount import get_teacher_topup_discount


@pytest.fixture
def teacher(shared_test_session):
    t = Teacher(
        email="topup-discount@duotopia.com",
        password_hash=get_password_hash("x"),
        name="T",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


def _make_group_buy_plan(db, name, discount):
    p = Plan(
        name=name,
        price=None,
        quota=1000,
        teacher_seats=10,
        annual_fee=1500,
        topup_discount=Decimal(str(discount)),
        is_active=True,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _bind(db, teacher, plan, *, member_active=True, team_active=True):
    team = GroupBuyTeam(
        owner_teacher_id=teacher.id,
        plan_id=plan.id,
        seat_limit=plan.teacher_seats,
        is_active=team_active,
    )
    db.add(team)
    db.flush()
    m = GroupBuyMember(
        team_id=team.id,
        teacher_id=teacher.id,
        is_owner=False,
        is_active=member_active,
    )
    db.add(m)
    db.commit()
    return team


def test_returns_none_when_teacher_has_no_group_buy_team(shared_test_session, teacher):
    assert get_teacher_topup_discount(teacher, shared_test_session) is None


def test_returns_discount_for_single_group_buy_team(shared_test_session, teacher):
    plan = _make_group_buy_plan(shared_test_session, "團購-30席", 0.90)
    _bind(shared_test_session, teacher, plan)

    assert get_teacher_topup_discount(teacher, shared_test_session) == Decimal("0.90")


def test_returns_best_discount_when_teacher_in_multiple_group_buy_teams(
    shared_test_session, teacher
):
    # Lowest topup_discount == best discount (most savings)
    p1 = _make_group_buy_plan(shared_test_session, "團購-10席", 0.95)
    p2 = _make_group_buy_plan(shared_test_session, "團購-50席", 0.85)
    p3 = _make_group_buy_plan(shared_test_session, "團購-30席", 0.90)
    _bind(shared_test_session, teacher, p1)
    _bind(shared_test_session, teacher, p2)
    _bind(shared_test_session, teacher, p3)

    assert get_teacher_topup_discount(teacher, shared_test_session) == Decimal("0.85")


def test_ignores_inactive_member(shared_test_session, teacher):
    plan = _make_group_buy_plan(shared_test_session, "團購-30席", 0.90)
    _bind(shared_test_session, teacher, plan, member_active=False)

    assert get_teacher_topup_discount(teacher, shared_test_session) is None


def test_ignores_inactive_team(shared_test_session, teacher):
    plan = _make_group_buy_plan(shared_test_session, "團購-30席", 0.90)
    _bind(shared_test_session, teacher, plan, team_active=False)

    assert get_teacher_topup_discount(teacher, shared_test_session) is None


def test_ignores_inactive_plan(shared_test_session, teacher):
    # Deactivated group-buy plan (contract ended) should not produce a discount
    plan = _make_group_buy_plan(shared_test_session, "團購-30席", 0.90)
    plan.is_active = False
    shared_test_session.commit()
    _bind(shared_test_session, teacher, plan)

    assert get_teacher_topup_discount(teacher, shared_test_session) is None
