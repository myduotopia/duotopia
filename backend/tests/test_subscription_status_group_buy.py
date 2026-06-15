"""Tests for GET /api/subscription/status group-buy branch
(issue #768 comment 4638082532 item 4).

Verifies the backend overrides applied for group-buy members so the
frontend can render the correct expiry, auto-renew semantics, and a
distinct plan_type for UI dispatch.
"""

from datetime import datetime, timedelta, timezone
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
def gb_plan(shared_test_session):
    p = Plan(
        name="團購-10席-sub-status",
        price=None,
        quota=1000,
        teacher_seats=10,
        annual_fee=1500,
        topup_discount=Decimal("0.95"),
        is_active=True,
    )
    shared_test_session.add(p)
    shared_test_session.commit()
    shared_test_session.refresh(p)
    return p


def _make_teacher(shared_test_session, email):
    t = Teacher(
        email=email,
        password_hash=get_password_hash("x"),
        name=email.split("@")[0],
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


def _make_group_buy_team(
    shared_test_session, gb_plan, owner, members, *, end_in_days=365
):
    """Seed a fully-shaped group-buy org + school + owner / member
    bindings. Returns (org, school)."""
    now = datetime.now(timezone.utc)
    org = Organization(
        name="Sub-status 團",
        org_type="group_buy",
        subscription_start_date=now,
        subscription_end_date=now + timedelta(days=end_in_days),
        is_active=True,
    )
    shared_test_session.add(org)
    shared_test_session.flush()
    school = School(
        organization_id=org.id,
        name="Sub-status 團 School",
        plan_id=gb_plan.id,
        teacher_seat_limit=gb_plan.teacher_seats,
        is_active=True,
    )
    shared_test_session.add(school)
    shared_test_session.flush()
    shared_test_session.add(
        TeacherOrganization(
            teacher_id=owner.id,
            organization_id=org.id,
            role="org_owner",
            is_active=True,
        )
    )
    shared_test_session.add(
        TeacherSchool(
            teacher_id=owner.id,
            school_id=school.id,
            roles=["school_admin"],
            is_active=True,
        )
    )
    for m in members:
        shared_test_session.add(
            TeacherSchool(
                teacher_id=m.id,
                school_id=school.id,
                roles=["teacher"],
                is_active=True,
            )
        )
        # Each member also has a current month's SubscriptionPeriod —
        # what the cron grants. End date is month-end, but the status
        # endpoint must override it with the org's annual end date.
        shared_test_session.add(
            SubscriptionPeriod(
                teacher_id=m.id,
                plan_name=gb_plan.name,
                amount_paid=0,
                quota_total=1000,
                quota_used=0,
                start_date=datetime.now(timezone.utc),
                end_date=datetime.now(timezone.utc).replace(day=28, hour=23, minute=59),
                payment_method="group_buy",
                payment_status="paid",
                status="active",
            )
        )
    shared_test_session.commit()
    return org, school


def test_group_buy_member_status_overrides_end_date_and_plan_type(
    test_client, shared_test_session, gb_plan
):
    """Member's `current_period.end_date` is month-end; status endpoint
    MUST surface the org's annual `subscription_end_date` instead so
    the UI shows the correct user-perceived expiry. Also asserts
    plan_type=group_buy_member, auto_renew=False, days_remaining
    derived from the annual end date."""
    owner = _make_teacher(shared_test_session, "gbsub-owner@duotopia.com")
    member = _make_teacher(shared_test_session, "gbsub-member@duotopia.com")
    org, _ = _make_group_buy_team(
        shared_test_session, gb_plan, owner, [member], end_in_days=365
    )

    r = test_client.get("/api/subscription/status", headers=_bearer(member.id))
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["plan_type"] == "group_buy_member"
    assert body["auto_renew"] is False
    # end_date should match the org's annual subscription end date,
    # NOT the member's monthly period end_date.
    org_end_iso = org.subscription_end_date.isoformat()
    assert body["end_date"] == org_end_iso
    # ~365 days minus the time elapsed since fixture setup (sub-second).
    assert body["days_remaining"] >= 360
    assert body["is_active"] is True


def test_group_buy_owner_status_returns_group_buy_owner_plan_type(
    test_client, shared_test_session, gb_plan
):
    """Owner gets the distinct `group_buy_owner` plan_type so the
    frontend can later surface team-management UI without re-querying."""
    owner = _make_teacher(shared_test_session, "gbsub-owner2@duotopia.com")
    member = _make_teacher(shared_test_session, "gbsub-member2@duotopia.com")
    _make_group_buy_team(shared_test_session, gb_plan, owner, [member])

    r = test_client.get("/api/subscription/status", headers=_bearer(owner.id))
    assert r.status_code == 200
    body = r.json()
    assert body["plan_type"] == "group_buy_owner"
    assert body["auto_renew"] is False


def test_individual_teacher_status_unaffected_by_group_buy_branch(
    test_client, shared_test_session
):
    """Regression guard: a teacher with no group-buy binding still
    returns plan_type='individual' and the existing auto_renew /
    end_date semantics."""
    solo = _make_teacher(shared_test_session, "gbsub-solo@duotopia.com")
    r = test_client.get("/api/subscription/status", headers=_bearer(solo.id))
    assert r.status_code == 200
    body = r.json()
    assert body["plan_type"] == "individual"
    # auto_renew defaults to True per the existing endpoint behaviour
    # when the teacher has no explicit subscription_auto_renew flag.
    assert body["auto_renew"] is True
