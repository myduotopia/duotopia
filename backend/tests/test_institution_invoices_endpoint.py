"""Endpoint tests for the admin institution-invoice ledger + overdue cron
(issue #838 Phase D).

Covers admin-only auth, server-side amount lock + idempotency, list filters,
PATCH mark-paid / invalid-status, and the CRON_SECRET-gated overdue sweep.
"""

from datetime import date
from unittest.mock import patch

import pytest

from auth import create_access_token, get_password_hash
from models import (
    InstitutionInvoice,
    Organization,
    School,
    Student,
    StudentSchool,
    Teacher,
)


def _bearer(teacher_id):
    return {
        "Authorization": f"Bearer {create_access_token({'sub': str(teacher_id), 'type': 'teacher'})}"
    }


@pytest.fixture
def admin(shared_test_session):
    t = Teacher(
        email="inv-admin@duotopia.com",
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
def non_admin(shared_test_session):
    t = Teacher(
        email="inv-teacher@duotopia.com",
        password_hash=get_password_hash("x"),
        name="Teacher",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


@pytest.fixture
def institution_with_student(shared_test_session):
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
    student = Student(
        name="Alice",
        email="alice-inv@example.com",
        password_hash=get_password_hash("x"),
        is_active=True,
    )
    shared_test_session.add(student)
    shared_test_session.flush()
    shared_test_session.add(
        StudentSchool(student_id=student.id, school_id=school.id, is_active=True)
    )
    shared_test_session.commit()
    return org


# ---------- create (lock) ----------


def test_create_requires_admin(test_client, non_admin, institution_with_student):
    r = test_client.post(
        "/api/admin/institution-invoices",
        json={
            "organization_id": str(institution_with_student.id),
            "year": 2026,
            "month": 6,
        },
        headers=_bearer(non_admin.id),
    )
    assert r.status_code == 403


def test_create_locks_amount_and_is_idempotent(
    test_client, admin, shared_test_session, institution_with_student
):
    org = institution_with_student
    payload = {"organization_id": str(org.id), "year": 2026, "month": 6}
    r1 = test_client.post(
        "/api/admin/institution-invoices", json=payload, headers=_bearer(admin.id)
    )
    assert r1.status_code == 200, r1.text
    body = r1.json()
    # 1 billable student × 150
    assert body["amount"] == 150
    assert body["status"] == "pending"
    assert body["organization_name"]

    # Repeat lock → same row (UPDATE, not a duplicate).
    r2 = test_client.post(
        "/api/admin/institution-invoices", json=payload, headers=_bearer(admin.id)
    )
    assert r2.status_code == 200
    assert r2.json()["id"] == body["id"]
    count = (
        shared_test_session.query(InstitutionInvoice)
        .filter(InstitutionInvoice.organization_id == org.id)
        .count()
    )
    assert count == 1


# ---------- list ----------


def test_list_filters_by_status(test_client, admin, institution_with_student):
    org = institution_with_student
    test_client.post(
        "/api/admin/institution-invoices",
        json={"organization_id": str(org.id), "year": 2026, "month": 6},
        headers=_bearer(admin.id),
    )
    r = test_client.get(
        "/api/admin/institution-invoices?status=pending", headers=_bearer(admin.id)
    )
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) >= 1
    assert all(x["status"] == "pending" for x in rows)

    # A status with no rows returns empty.
    r2 = test_client.get(
        "/api/admin/institution-invoices?status=cancelled", headers=_bearer(admin.id)
    )
    assert r2.status_code == 200
    assert r2.json() == []


def test_list_requires_admin(test_client, non_admin):
    r = test_client.get(
        "/api/admin/institution-invoices", headers=_bearer(non_admin.id)
    )
    assert r.status_code == 403


# ---------- patch ----------


def test_patch_mark_paid_records_admin(
    test_client, admin, shared_test_session, institution_with_student
):
    org = institution_with_student
    created = test_client.post(
        "/api/admin/institution-invoices",
        json={"organization_id": str(org.id), "year": 2026, "month": 6},
        headers=_bearer(admin.id),
    ).json()
    r = test_client.patch(
        f"/api/admin/institution-invoices/{created['id']}",
        json={"status": "paid", "payment_note": "ATM 收訖"},
        headers=_bearer(admin.id),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "paid"
    assert body["paid_at"]
    assert body["paid_by_admin_id"] == admin.id
    assert body["payment_note"] == "ATM 收訖"


def test_patch_rejects_invalid_status(test_client, admin, institution_with_student):
    org = institution_with_student
    created = test_client.post(
        "/api/admin/institution-invoices",
        json={"organization_id": str(org.id), "year": 2026, "month": 6},
        headers=_bearer(admin.id),
    ).json()
    r = test_client.patch(
        f"/api/admin/institution-invoices/{created['id']}",
        json={"status": "pending"},
        headers=_bearer(admin.id),
    )
    assert r.status_code == 400


def test_patch_rejects_settled_invoice(test_client, admin, institution_with_student):
    """A paid invoice is terminal — a second PATCH must be rejected (400)
    rather than silently overwriting the payment stamp."""
    org = institution_with_student
    created = test_client.post(
        "/api/admin/institution-invoices",
        json={"organization_id": str(org.id), "year": 2026, "month": 6},
        headers=_bearer(admin.id),
    ).json()
    paid = test_client.patch(
        f"/api/admin/institution-invoices/{created['id']}",
        json={"status": "paid"},
        headers=_bearer(admin.id),
    )
    assert paid.status_code == 200
    # Second transition on a settled invoice → 400.
    again = test_client.patch(
        f"/api/admin/institution-invoices/{created['id']}",
        json={"status": "cancelled"},
        headers=_bearer(admin.id),
    )
    assert again.status_code == 400


def test_list_rejects_invalid_status(test_client, admin):
    r = test_client.get(
        "/api/admin/institution-invoices?status=bogus", headers=_bearer(admin.id)
    )
    assert r.status_code == 400


# ---------- overdue cron ----------


def test_overdue_cron_requires_secret(test_client):
    r = test_client.post("/api/cron/billing-overdue-check")
    assert r.status_code == 401


def test_overdue_cron_marks_overdue(
    test_client, shared_test_session, institution_with_student
):
    org = institution_with_student
    # A pending invoice already past its due date.
    inv = InstitutionInvoice(
        organization_id=org.id,
        year=2026,
        month=1,
        amount=150,
        status="pending",
        due_date=date(2020, 1, 1),
    )
    shared_test_session.add(inv)
    shared_test_session.commit()

    with patch("routers.cron.CRON_SECRET", "test-secret"):
        r = test_client.post(
            "/api/cron/billing-overdue-check",
            headers={"X-Cron-Secret": "test-secret"},
        )
    assert r.status_code == 200, r.text
    assert r.json()["marked_overdue"] >= 1
    shared_test_session.refresh(inv)
    assert inv.status == "overdue"
