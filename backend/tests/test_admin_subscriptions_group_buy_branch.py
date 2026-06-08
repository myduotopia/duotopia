"""Tests for the group-buy branch of POST /api/admin/subscription/create
(issue #768 comment #1).

Admin manually joins an existing teacher to an existing group-buy team
without going through TapPay. Covers validation, seat / duplicate
checks, and the happy path.
"""

from datetime import datetime, timezone
from decimal import Decimal

import pytest

from auth import create_access_token, get_password_hash
from models import (
    Organization,
    Plan,
    School,
    SubscriptionPeriod,
    Teacher,
    TeacherOrganization,
    TeacherSchool,
)


def _bearer(teacher_id):
    token = create_access_token(data={"sub": str(teacher_id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin(shared_test_session):
    t = Teacher(
        email="gb-admin@duotopia.com",
        password_hash=get_password_hash("x"),
        name="GBAdmin",
        is_active=True,
        email_verified=True,
        is_admin=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


@pytest.fixture
def owner(shared_test_session):
    """A teacher who has already opened a group-buy team."""
    t = Teacher(
        email="gb-team-owner@duotopia.com",
        password_hash=get_password_hash("x"),
        name="Owner",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


@pytest.fixture
def target(shared_test_session):
    """The teacher admin wants to manually add to the team."""
    t = Teacher(
        email="gb-target@duotopia.com",
        password_hash=get_password_hash("x"),
        name="Target",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


@pytest.fixture
def gb_plan_30(shared_test_session):
    p = Plan(
        name="團購-30席",
        price=None,
        quota=1000,
        teacher_seats=30,
        annual_fee=1300,
        topup_discount=Decimal("0.90"),
        display_order=11,
        is_active=True,
    )
    shared_test_session.add(p)
    shared_test_session.commit()
    shared_test_session.refresh(p)
    return p


@pytest.fixture
def opened_team(shared_test_session, owner, gb_plan_30):
    """Simulate the state after owner opened a group-buy team via
    /credit-packages/group-buy-open: org + school + binding."""
    from services.group_buy import create_group_buy_org_and_school

    org, school, _, _ = create_group_buy_org_and_school(
        owner, gb_plan_30, shared_test_session, now=datetime.now(timezone.utc)
    )
    shared_test_session.commit()
    return org, school


def _post_create(test_client, admin, body):
    return test_client.post(
        "/api/admin/subscription/create",
        headers=_bearer(admin.id),
        json=body,
    )


# ---------- validation ----------


def test_group_buy_plan_without_owner_email_returns_400(
    test_client, admin, target, opened_team, gb_plan_30
):
    r = _post_create(
        test_client,
        admin,
        {
            "teacher_email": target.email,
            "plan_name": gb_plan_30.name,
            "reason": "test missing owner email",
        },
    )
    assert r.status_code == 400
    assert "group_owner_email" in r.json()["detail"]


def test_group_buy_unknown_owner_email_returns_404(
    test_client, admin, target, opened_team, gb_plan_30
):
    r = _post_create(
        test_client,
        admin,
        {
            "teacher_email": target.email,
            "plan_name": gb_plan_30.name,
            "group_owner_email": "nobody@nowhere.com",
            "reason": "test unknown owner",
        },
    )
    assert r.status_code == 404
    assert "owner" in r.json()["detail"].lower()


def test_group_buy_owner_not_leading_this_plan_returns_400(
    test_client, admin, owner, target, opened_team, shared_test_session
):
    """Owner leads a 團購-30席 team; admin tries to put target into a
    團購-10席 team led by the same owner → owner doesn't lead that plan."""
    p10 = Plan(
        name="團購-10席",
        price=None,
        quota=1000,
        teacher_seats=10,
        annual_fee=1500,
        topup_discount=Decimal("0.95"),
        display_order=10,
        is_active=True,
    )
    shared_test_session.add(p10)
    shared_test_session.commit()

    r = _post_create(
        test_client,
        admin,
        {
            "teacher_email": target.email,
            "plan_name": p10.name,
            "group_owner_email": owner.email,
            "reason": "wrong plan",
        },
    )
    assert r.status_code == 400
    assert "team" in r.json()["detail"].lower()


# ---------- happy path ----------


def test_admin_joins_teacher_to_existing_team(
    test_client,
    admin,
    owner,
    target,
    opened_team,
    gb_plan_30,
    shared_test_session,
):
    org, school = opened_team

    r = _post_create(
        test_client,
        admin,
        {
            "teacher_email": target.email,
            "plan_name": gb_plan_30.name,
            "group_owner_email": owner.email,
            "reason": "comp customer support",
        },
    )
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["teacher_email"] == target.email
    assert body["plan_name"] == gb_plan_30.name
    assert body["quota_total"] == 1000

    shared_test_session.expire_all()
    # TeacherSchool binding created
    ts = (
        shared_test_session.query(TeacherSchool)
        .filter(
            TeacherSchool.teacher_id == target.id,
            TeacherSchool.school_id == school.id,
            TeacherSchool.is_active.is_(True),
        )
        .one()
    )
    assert ts.roles == ["teacher"]
    # SubscriptionPeriod created with group_buy payment_method
    period = (
        shared_test_session.query(SubscriptionPeriod)
        .filter(
            SubscriptionPeriod.teacher_id == target.id,
            SubscriptionPeriod.plan_name == gb_plan_30.name,
            SubscriptionPeriod.payment_method == "group_buy",
        )
        .one()
    )
    assert period.quota_total == 1000
    # Audit metadata captured
    ops = period.admin_metadata.get("operations", [])
    assert ops and ops[0]["action"] == "admin_join_group_buy"
    assert ops[0]["group_owner_email"] == owner.email


# ---------- post-join guards ----------


def test_duplicate_join_returns_400(
    test_client, admin, owner, target, opened_team, gb_plan_30
):
    body = {
        "teacher_email": target.email,
        "plan_name": gb_plan_30.name,
        "group_owner_email": owner.email,
        "reason": "first join",
    }
    r1 = _post_create(test_client, admin, body)
    assert r1.status_code == 200

    body["reason"] = "second join attempt"
    r2 = _post_create(test_client, admin, body)
    # Either duplicate-binding 400 or active-period-this-month 400 is
    # acceptable — both encode the "already in team" semantics.
    assert r2.status_code == 400


def test_seat_full_returns_400(
    test_client,
    admin,
    owner,
    target,
    opened_team,
    gb_plan_30,
    shared_test_session,
):
    """Force the school to a full-seat state and verify next admin join
    is rejected."""
    org, school = opened_team
    # Fill seats up to the limit (owner already takes 1)
    seats_to_fill = (school.teacher_seat_limit or 0) - 1  # minus owner
    for i in range(seats_to_fill):
        t = Teacher(
            email=f"filler-{i}@x.com",
            password_hash=get_password_hash("x"),
            name=f"Filler{i}",
            is_active=True,
            email_verified=True,
        )
        shared_test_session.add(t)
        shared_test_session.flush()
        shared_test_session.add(
            TeacherSchool(
                teacher_id=t.id,
                school_id=school.id,
                roles=["teacher"],
                is_active=True,
            )
        )
    shared_test_session.commit()

    r = _post_create(
        test_client,
        admin,
        {
            "teacher_email": target.email,
            "plan_name": gb_plan_30.name,
            "group_owner_email": owner.email,
            "reason": "joining full team",
        },
    )
    assert r.status_code == 400
    assert "full" in r.json()["detail"].lower()


# ---------- regression: individual plan path still works ----------


def test_individual_plan_path_still_works(
    test_client, admin, target, shared_test_session
):
    """Ensure the new group-buy branch doesn't break the existing
    individual-plan create flow."""
    p = Plan(
        name="Tutor Teachers",
        price=299,
        quota=2000,
        teacher_seats=None,
        annual_fee=None,
        is_active=True,
    )
    shared_test_session.add(p)
    shared_test_session.commit()

    r = _post_create(
        test_client,
        admin,
        {
            "teacher_email": target.email,
            "plan_name": "Tutor Teachers",
            "end_date": "2026-12-31",
            "reason": "regression test",
        },
    )
    assert r.status_code == 200, r.json()
    assert r.json()["plan_name"] == "Tutor Teachers"
    assert r.json()["quota_total"] == 2000
