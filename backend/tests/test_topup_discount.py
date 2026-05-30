"""Tests for backend.services.topup_discount (issue #768 Phase 2).

Covers the four scenarios the credit-package purchase flow needs:
  - teacher not in any group-buy school -> no discount
  - teacher in one group-buy school     -> that school's discount
  - teacher in multiple group-buy schools -> best (lowest) discount
  - teacher's TeacherSchool inactive    -> ignored
  - school.is_active = False            -> ignored
"""

from decimal import Decimal

import pytest

from auth import get_password_hash
from models import (
    Organization,
    Plan,
    School,
    Teacher,
    TeacherSchool,
)
from services.topup_discount import get_teacher_topup_discount


@pytest.fixture
def org(shared_test_session):
    o = Organization(name="Test Org", is_active=True)
    shared_test_session.add(o)
    shared_test_session.commit()
    shared_test_session.refresh(o)
    return o


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


def _bind(db, teacher, org, plan, *, ts_active=True, school_active=True):
    s = School(
        organization_id=org.id,
        name=f"School-{plan.name}",
        plan_id=plan.id,
        teacher_seat_limit=plan.teacher_seats,
        is_active=school_active,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    ts = TeacherSchool(
        teacher_id=teacher.id,
        school_id=s.id,
        roles=["teacher"],
        is_active=ts_active,
    )
    db.add(ts)
    db.commit()
    return s


def test_returns_none_when_teacher_has_no_group_buy_school(
    shared_test_session, teacher
):
    assert get_teacher_topup_discount(teacher, shared_test_session) is None


def test_returns_discount_for_single_group_buy_school(
    shared_test_session, teacher, org
):
    plan = _make_group_buy_plan(shared_test_session, "團購-30席", 0.90)
    _bind(shared_test_session, teacher, org, plan)

    assert get_teacher_topup_discount(teacher, shared_test_session) == Decimal("0.90")


def test_returns_best_discount_when_teacher_in_multiple_group_buy_schools(
    shared_test_session, teacher, org
):
    # Lowest topup_discount == best discount (most savings)
    p1 = _make_group_buy_plan(shared_test_session, "團購-10席", 0.95)
    p2 = _make_group_buy_plan(shared_test_session, "團購-50席", 0.85)
    p3 = _make_group_buy_plan(shared_test_session, "團購-30席", 0.90)
    _bind(shared_test_session, teacher, org, p1)
    _bind(shared_test_session, teacher, org, p2)
    _bind(shared_test_session, teacher, org, p3)

    assert get_teacher_topup_discount(teacher, shared_test_session) == Decimal("0.85")


def test_ignores_inactive_teacher_school(shared_test_session, teacher, org):
    plan = _make_group_buy_plan(shared_test_session, "團購-30席", 0.90)
    _bind(shared_test_session, teacher, org, plan, ts_active=False)

    assert get_teacher_topup_discount(teacher, shared_test_session) is None


def test_ignores_inactive_school(shared_test_session, teacher, org):
    plan = _make_group_buy_plan(shared_test_session, "團購-30席", 0.90)
    _bind(shared_test_session, teacher, org, plan, school_active=False)

    assert get_teacher_topup_discount(teacher, shared_test_session) is None


def test_ignores_inactive_plan(shared_test_session, teacher, org):
    # Deactivated group-buy plan (contract ended) should not produce a discount
    plan = _make_group_buy_plan(shared_test_session, "團購-30席", 0.90)
    plan.is_active = False
    shared_test_session.commit()
    _bind(shared_test_session, teacher, org, plan)

    assert get_teacher_topup_discount(teacher, shared_test_session) is None


def test_ignores_school_with_no_plan_id(shared_test_session, teacher, org):
    # School without plan_id (institution school, not group-buy)
    s = School(
        organization_id=org.id,
        name="Institution School",
        plan_id=None,
        is_active=True,
    )
    shared_test_session.add(s)
    shared_test_session.commit()
    shared_test_session.refresh(s)
    ts = TeacherSchool(
        teacher_id=teacher.id, school_id=s.id, roles=["teacher"], is_active=True
    )
    shared_test_session.add(ts)
    shared_test_session.commit()

    assert get_teacher_topup_discount(teacher, shared_test_session) is None
