"""Endpoint tests for GET /api/organizations/{org_id}/billing/monthly
(issue #768 Phase 4, 五.5).

Covers the auth split (admin / org_owner / outside-teacher), validation
(non-institution / missing per_student_price), and a happy path with full
response shape.
"""

import pytest

from auth import create_access_token, get_password_hash
from models import (
    Organization,
    School,
    Student,
    StudentSchool,
    Teacher,
    TeacherOrganization,
)


# ---------- fixtures ----------


def _bearer(teacher_id):
    token = create_access_token({"sub": str(teacher_id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin(shared_test_session):
    t = Teacher(
        email="bill-admin@duotopia.com",
        password_hash=get_password_hash("x"),
        name="Admin",
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
    t = Teacher(
        email="bill-owner@duotopia.com",
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
def outsider(shared_test_session):
    t = Teacher(
        email="bill-outsider@duotopia.com",
        password_hash=get_password_hash("x"),
        name="Outsider",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


@pytest.fixture
def institution_org_with_one_active_student(shared_test_session, owner):
    """Institution org · 1 school · 1 active enrolled student · owner bound."""
    org = Organization(
        name="Acme Institution",
        org_type="institution",
        per_student_price=150,
        is_active=True,
    )
    shared_test_session.add(org)
    shared_test_session.flush()
    school = School(organization_id=org.id, name="Branch", is_active=True)
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
    student = Student(
        name="Alice",
        email="alice@example.com",
        password_hash=get_password_hash("x"),
        is_active=True,
    )
    shared_test_session.add(student)
    shared_test_session.flush()
    shared_test_session.add(
        StudentSchool(student_id=student.id, school_id=school.id, is_active=True)
    )
    shared_test_session.commit()
    return org, school, student


# ---------- auth ----------


def test_outsider_teacher_gets_403(
    test_client, outsider, institution_org_with_one_active_student
):
    org, _, _ = institution_org_with_one_active_student
    r = test_client.get(
        f"/api/organizations/{org.id}/billing/monthly?year=2026&month=6",
        headers=_bearer(outsider.id),
    )
    assert r.status_code == 403


def test_admin_can_query_any_org(
    test_client, admin, institution_org_with_one_active_student
):
    org, _, _ = institution_org_with_one_active_student
    r = test_client.get(
        f"/api/organizations/{org.id}/billing/monthly?year=2026&month=6",
        headers=_bearer(admin.id),
    )
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["org_id"] == str(org.id)


def test_owner_can_query_own_org(
    test_client, owner, institution_org_with_one_active_student
):
    org, _, _ = institution_org_with_one_active_student
    r = test_client.get(
        f"/api/organizations/{org.id}/billing/monthly?year=2026&month=6",
        headers=_bearer(owner.id),
    )
    assert r.status_code == 200, r.json()


# ---------- validation ----------


def test_400_when_org_is_not_institution(test_client, admin, shared_test_session):
    org = Organization(name="Group", org_type="group_buy", is_active=True)
    shared_test_session.add(org)
    shared_test_session.commit()
    r = test_client.get(
        f"/api/organizations/{org.id}/billing/monthly?year=2026&month=6",
        headers=_bearer(admin.id),
    )
    assert r.status_code == 400
    assert "not an institution" in r.json()["detail"]


def test_400_when_per_student_price_is_null(test_client, admin, shared_test_session):
    org = Organization(
        name="No Price",
        org_type="institution",
        per_student_price=None,
        is_active=True,
    )
    shared_test_session.add(org)
    shared_test_session.commit()
    r = test_client.get(
        f"/api/organizations/{org.id}/billing/monthly?year=2026&month=6",
        headers=_bearer(admin.id),
    )
    assert r.status_code == 400
    assert "per_student_price" in r.json()["detail"]


def test_404_when_org_does_not_exist(test_client, admin):
    fake = "00000000-0000-0000-0000-000000000000"
    r = test_client.get(
        f"/api/organizations/{fake}/billing/monthly?year=2026&month=6",
        headers=_bearer(admin.id),
    )
    assert r.status_code == 404


# ---------- response shape ----------


def test_happy_path_full_response(
    test_client, admin, institution_org_with_one_active_student
):
    org, _, student = institution_org_with_one_active_student
    r = test_client.get(
        f"/api/organizations/{org.id}/billing/monthly?year=2026&month=6",
        headers=_bearer(admin.id),
    )
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["org_id"] == str(org.id)
    assert body["year"] == 2026 and body["month"] == 6
    assert body["per_student_price"] == 150
    assert body["billable_student_count"] == 1
    assert body["total_amount"] == 150
    assert body["currency"] == "TWD"
    assert len(body["students"]) == 1
    assert body["students"][0]["student_id"] == student.id
    assert body["students"][0]["name"] == "Alice"
    assert body["students"][0]["billable"] is True
