"""Tests for GET /api/credit-packages/group-buy-plans (issue #768 Phase 5-2).

Verifies the filter logic (Plan.is_active + teacher_seats/annual_fee/
topup_discount IS NOT NULL) and the display_order + teacher_seats sort.
"""

from decimal import Decimal

import pytest

from auth import create_access_token, get_password_hash
from models import Plan, Teacher


def _bearer(teacher_id):
    token = create_access_token({"sub": str(teacher_id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def teacher(shared_test_session):
    t = Teacher(
        email="gb-plans@duotopia.com",
        password_hash=get_password_hash("x"),
        name="T",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


def _gb_plan(db, *, name, seats, fee, discount, order, quota=1000, active=True):
    p = Plan(
        name=name,
        price=None,
        quota=quota,
        teacher_seats=seats,
        annual_fee=fee,
        topup_discount=Decimal(str(discount)),
        display_order=order,
        is_active=active,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def test_returns_active_group_buy_plans_ordered_by_display_then_seats(
    test_client, teacher, shared_test_session
):
    # Seed in a deliberately wrong order; assert response sorted
    _gb_plan(
        shared_test_session,
        name="團購-50席",
        seats=50,
        fee=1000,
        discount=0.85,
        order=12,
    )
    _gb_plan(
        shared_test_session,
        name="團購-10席",
        seats=10,
        fee=1500,
        discount=0.95,
        order=10,
    )
    _gb_plan(
        shared_test_session,
        name="團購-30席",
        seats=30,
        fee=1300,
        discount=0.90,
        order=11,
    )

    r = test_client.get(
        "/api/credit-packages/group-buy-plans", headers=_bearer(teacher.id)
    )
    assert r.status_code == 200, r.json()
    body = r.json()
    assert len(body) == 3
    # Ordered by display_order ASC then teacher_seats ASC
    assert [p["teacher_seats"] for p in body] == [10, 30, 50]
    # Server-authoritative total_amount = annual_fee × teacher_seats
    assert body[0]["total_amount"] == 1500 * 10
    assert body[1]["total_amount"] == 1300 * 30
    assert body[2]["total_amount"] == 1000 * 50


def test_excludes_inactive_plans(test_client, teacher, shared_test_session):
    _gb_plan(
        shared_test_session,
        name="團購-30席",
        seats=30,
        fee=1300,
        discount=0.90,
        order=11,
        active=False,
    )

    r = test_client.get(
        "/api/credit-packages/group-buy-plans", headers=_bearer(teacher.id)
    )
    assert r.status_code == 200
    assert r.json() == []


def test_excludes_individual_plans_with_null_teacher_seats(
    test_client, teacher, shared_test_session
):
    """An individual plan (teacher_seats IS NULL) must not appear even if
    active — only group-buy plans should be returned."""
    individual = Plan(
        name="Tutor Teachers",
        price=299,
        quota=2000,
        teacher_seats=None,
        annual_fee=None,
        topup_discount=None,
        is_active=True,
    )
    shared_test_session.add(individual)
    shared_test_session.commit()

    r = test_client.get(
        "/api/credit-packages/group-buy-plans", headers=_bearer(teacher.id)
    )
    assert r.status_code == 200
    names = [p["name"] for p in r.json()]
    assert "Tutor Teachers" not in names


def test_empty_when_no_group_buy_plans(test_client, teacher):
    r = test_client.get(
        "/api/credit-packages/group-buy-plans", headers=_bearer(teacher.id)
    )
    assert r.status_code == 200
    assert r.json() == []
