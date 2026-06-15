"""Tests for POST /api/credit-packages/validate-team-emails (issue #768
comment #3). The endpoint backs the group-buy roster's per-email on-blur
check + post-CSV-import revalidation in the new 3-step open flow.
"""

from decimal import Decimal

import pytest

from auth import create_access_token, get_password_hash
from models import (
    Organization,
    Plan,
    School,
    Teacher,
    TeacherSchool,
)


def _bearer(teacher_id):
    token = create_access_token(data={"sub": str(teacher_id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def caller(shared_test_session):
    """Some authenticated teacher hitting the endpoint."""
    t = Teacher(
        email="caller-validate-emails@duotopia.com",
        password_hash=get_password_hash("x"),
        name="Caller",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


@pytest.fixture
def verified_teacher(shared_test_session):
    t = Teacher(
        email="verified-validate-emails@school.com",
        password_hash=get_password_hash("x"),
        name="Verified",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


@pytest.fixture
def unverified_teacher(shared_test_session):
    t = Teacher(
        email="unverified-validate-emails@school.com",
        password_hash=get_password_hash("x"),
        name="Unverified",
        is_active=True,
        email_verified=False,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


@pytest.fixture
def teacher_in_group_buy_team(shared_test_session):
    """A teacher already bound to an active group-buy school."""
    t = Teacher(
        email="in-team-validate-emails@school.com",
        password_hash=get_password_hash("x"),
        name="InTeam",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.flush()
    # Distinct plan name so this file's fixtures can't collide with
    # other test modules that also seed a 團購 plan when pytest reuses
    # the same shared_test_session across files. Plan.name is the
    # natural key, so any clash would be a hard failure here.
    plan = Plan(
        name="團購-10席-validate-fixture",
        price=None,
        quota=1000,
        teacher_seats=10,
        annual_fee=1500,
        topup_discount=Decimal("0.95"),
        is_active=True,
    )
    shared_test_session.add(plan)
    shared_test_session.flush()
    org = Organization(
        name="Existing 團",
        org_type="group_buy",
        is_active=True,
    )
    shared_test_session.add(org)
    shared_test_session.flush()
    school = School(
        organization_id=org.id,
        name="Existing 團 School",
        plan_id=plan.id,
        teacher_seat_limit=plan.teacher_seats,
        is_active=True,
    )
    shared_test_session.add(school)
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
    return t


def _post(test_client, caller, emails):
    return test_client.post(
        "/api/credit-packages/validate-team-emails",
        headers=_bearer(caller.id),
        json={"emails": emails},
    )


def test_classifies_each_email_in_one_call(
    test_client,
    caller,
    verified_teacher,
    unverified_teacher,
    teacher_in_group_buy_team,
):
    """Single call returns per-email status — frontend uses this to render
    the ✓/✗ badges and decide whether to show 'share invite link'."""
    r = _post(
        test_client,
        caller,
        [
            verified_teacher.email,
            unverified_teacher.email,
            teacher_in_group_buy_team.email,
            "nobody@nowhere.com",
        ],
    )
    assert r.status_code == 200, r.json()
    results = {row["email"]: row for row in r.json()["results"]}

    assert results[verified_teacher.email]["status"] == "ok"
    assert results[verified_teacher.email]["exists"] is True
    assert results[verified_teacher.email]["verified"] is True
    assert results[verified_teacher.email]["in_group_buy_team"] is False

    assert results[unverified_teacher.email]["status"] == "not_verified"
    assert results[unverified_teacher.email]["exists"] is True
    assert results[unverified_teacher.email]["verified"] is False

    assert results[teacher_in_group_buy_team.email]["status"] == "in_group_buy_team"
    assert results[teacher_in_group_buy_team.email]["in_group_buy_team"] is True

    assert results["nobody@nowhere.com"]["status"] == "not_registered"
    assert results["nobody@nowhere.com"]["exists"] is False
    assert results["nobody@nowhere.com"]["verified"] is False


def test_normalizes_uppercase_and_whitespace(test_client, caller, verified_teacher):
    """Input ' VERIFIED@SCHOOL.COM ' should resolve to verified-validate-emails@school.com
    so the frontend doesn't need to do its own case-folding."""
    r = _post(test_client, caller, [f"  {verified_teacher.email.upper()}  "])
    assert r.status_code == 200
    row = r.json()["results"][0]
    assert row["email"] == verified_teacher.email
    assert row["status"] == "ok"


def test_rejects_batches_over_100(test_client, caller):
    """Hard cap so a runaway CSV upload can't DoS the lookup."""
    emails = [f"t{i}@example.com" for i in range(101)]
    r = _post(test_client, caller, emails)
    assert r.status_code == 400
    assert "100" in r.json()["detail"]


def test_invalid_email_format_returns_422(test_client, caller):
    """Pydantic EmailStr enforces format before our logic runs."""
    r = _post(test_client, caller, ["not-an-email"])
    assert r.status_code == 422


def test_requires_auth(test_client):
    r = test_client.post(
        "/api/credit-packages/validate-team-emails",
        json={"emails": ["someone@x.com"]},
    )
    assert r.status_code == 401
