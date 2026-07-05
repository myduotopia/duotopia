"""Endpoint tests for GET /api/organizations/{org_id}/billing/monthly
(issue #768 Phase 4, 五.5).

Covers the auth split (admin / org_owner / outside-teacher), validation
(non-institution / missing per_student_price), and a happy path with full
response shape.
"""

import pytest

from auth import create_access_token, get_password_hash
from models import (
    InstitutionInvoiceEmail,
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


def test_deactivated_org_owner_gets_403(
    test_client, shared_test_session, institution_org_with_one_active_student
):
    """5-1 R2-F1 lock-in: a TeacherOrganization row with role='org_owner'
    but `is_active=False` must NOT pass the role check (revoked-owner case).
    Locks in the `is_active.is_(True)` filter against future refactor."""
    org, _, _ = institution_org_with_one_active_student
    revoked = Teacher(
        email="bill-revoked-owner@duotopia.com",
        password_hash=get_password_hash("x"),
        name="RevokedOwner",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(revoked)
    shared_test_session.flush()
    shared_test_session.add(
        TeacherOrganization(
            teacher_id=revoked.id,
            organization_id=org.id,
            role="org_owner",
            is_active=False,  # revoked
        )
    )
    shared_test_session.commit()

    r = test_client.get(
        f"/api/organizations/{org.id}/billing/monthly?year=2026&month=6",
        headers=_bearer(revoked.id),
    )
    assert r.status_code == 403


def test_org_member_non_owner_gets_403(
    test_client, shared_test_session, institution_org_with_one_active_student
):
    """Auth bypass guard: an active org_admin (member but not org_owner)
    must NOT receive billing PII (student names + billable status).
    Locks in the role check added after PR #823 round 0 review F1."""
    org, _, _ = institution_org_with_one_active_student
    member = Teacher(
        email="bill-org-admin@duotopia.com",
        password_hash=get_password_hash("x"),
        name="OrgAdminMember",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(member)
    shared_test_session.flush()
    shared_test_session.add(
        TeacherOrganization(
            teacher_id=member.id,
            organization_id=org.id,
            role="org_admin",  # member, but NOT org_owner
            is_active=True,
        )
    )
    shared_test_session.commit()
    r = test_client.get(
        f"/api/organizations/{org.id}/billing/monthly?year=2026&month=6",
        headers=_bearer(member.id),
    )
    assert r.status_code == 403
    assert "org_owner" in r.json()["detail"]


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


# ---------- PDF endpoint (issue #838 Phase B) ----------


def test_pdf_outsider_teacher_gets_403(
    test_client, outsider, institution_org_with_one_active_student
):
    org, _, _ = institution_org_with_one_active_student
    r = test_client.get(
        f"/api/organizations/{org.id}/billing/monthly.pdf?year=2026&month=6",
        headers=_bearer(outsider.id),
    )
    assert r.status_code == 403


def test_pdf_owner_downloads_valid_pdf(
    test_client, owner, institution_org_with_one_active_student
):
    org, _, _ = institution_org_with_one_active_student
    r = test_client.get(
        f"/api/organizations/{org.id}/billing/monthly.pdf?year=2026&month=6",
        headers=_bearer(owner.id),
    )
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"
    # Valid PDF payload + attachment disposition with the org-slug filename.
    assert r.content[:4] == b"%PDF"
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd
    assert "acme-institution-2026-06.pdf" in cd


def test_pdf_admin_can_download_any_org(
    test_client, admin, institution_org_with_one_active_student
):
    org, _, _ = institution_org_with_one_active_student
    r = test_client.get(
        f"/api/organizations/{org.id}/billing/monthly.pdf?year=2026&month=6",
        headers=_bearer(admin.id),
    )
    assert r.status_code == 200
    assert r.content[:4] == b"%PDF"


def test_pdf_400_when_org_is_not_institution(test_client, admin, shared_test_session):
    org = Organization(name="Group Buy", org_type="group_buy", is_active=True)
    shared_test_session.add(org)
    shared_test_session.commit()
    r = test_client.get(
        f"/api/organizations/{org.id}/billing/monthly.pdf?year=2026&month=6",
        headers=_bearer(admin.id),
    )
    assert r.status_code == 400


# ---------- send-email endpoint (issue #838 Phase C) ----------


def test_send_email_400_when_no_contact_email(
    test_client, admin, institution_org_with_one_active_student
):
    """The fixture org has no contact_email → 400 with a 'set email' hint."""
    org, _, _ = institution_org_with_one_active_student
    r = test_client.post(
        f"/api/organizations/{org.id}/billing/monthly/send-email",
        json={"year": 2026, "month": 6},
        headers=_bearer(admin.id),
    )
    assert r.status_code == 400
    assert "email" in r.json()["detail"].lower() or "聯絡" in r.json()["detail"]


def test_send_email_outsider_gets_403(
    test_client, outsider, institution_org_with_one_active_student
):
    org, _, _ = institution_org_with_one_active_student
    r = test_client.post(
        f"/api/organizations/{org.id}/billing/monthly/send-email",
        json={"year": 2026, "month": 6},
        headers=_bearer(outsider.id),
    )
    assert r.status_code == 403


def test_send_email_success_writes_audit_and_history(
    test_client, admin, shared_test_session, institution_org_with_one_active_student
):
    org, _, _ = institution_org_with_one_active_student
    org.contact_email = "finance@acme.example"
    shared_test_session.commit()

    r = test_client.post(
        f"/api/organizations/{org.id}/billing/monthly/send-email",
        json={"year": 2026, "month": 6, "cc": ["cc@acme.example"]},
        headers=_bearer(admin.id),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True
    assert body["recipient"] == "finance@acme.example"
    assert body["cc"] == ["cc@acme.example"]
    assert body["sent_at"]

    rows = (
        shared_test_session.query(InstitutionInvoiceEmail)
        .filter(InstitutionInvoiceEmail.organization_id == org.id)
        .all()
    )
    assert len(rows) == 1
    assert rows[0].recipient == "finance@acme.example"

    # History endpoint surfaces the last-sent time.
    h = test_client.get(
        f"/api/organizations/{org.id}/billing/monthly/email-history"
        "?year=2026&month=6",
        headers=_bearer(admin.id),
    )
    assert h.status_code == 200
    hist = h.json()
    assert hist["last_sent_at"]
    assert len(hist["history"]) == 1
