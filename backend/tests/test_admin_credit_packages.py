"""Tests for admin credit package instance CRUD endpoints.

Covers per-teacher CreditPackage row editing and soft-cancellation
(status -> 'refunded') with audit trail in admin_metadata.
"""

from datetime import datetime, timedelta, timezone

import pytest

from auth import create_access_token, get_password_hash
from models import CreditPackage, Teacher


# ============ Fixtures ============
@pytest.fixture
def admin_teacher(shared_test_session):
    teacher = Teacher(
        email="admin-cp@duotopia.com",
        password_hash=get_password_hash("admin_password"),
        name="Admin CP",
        is_active=True,
        is_admin=True,
        email_verified=True,
    )
    shared_test_session.add(teacher)
    shared_test_session.commit()
    shared_test_session.refresh(teacher)
    return teacher


@pytest.fixture
def regular_teacher(shared_test_session):
    teacher = Teacher(
        email="user-cp@duotopia.com",
        password_hash=get_password_hash("user_password"),
        name="User CP",
        is_active=True,
        is_admin=False,
        email_verified=True,
    )
    shared_test_session.add(teacher)
    shared_test_session.commit()
    shared_test_session.refresh(teacher)
    return teacher


@pytest.fixture
def auth_headers_admin(admin_teacher):
    token = create_access_token(data={"sub": str(admin_teacher.id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth_headers_regular(regular_teacher):
    token = create_access_token(
        data={"sub": str(regular_teacher.id), "type": "teacher"}
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def active_package(shared_test_session, regular_teacher):
    now = datetime.now(timezone.utc)
    pkg = CreditPackage(
        teacher_id=regular_teacher.id,
        package_id="trial-bonus",
        points_total=2000,
        points_used=300,
        price_paid=0,
        purchased_at=now - timedelta(days=10),
        expires_at=now + timedelta(days=355),
        status="active",
        source="trial_bonus",
    )
    shared_test_session.add(pkg)
    shared_test_session.commit()
    shared_test_session.refresh(pkg)
    return pkg


@pytest.fixture
def refunded_package(shared_test_session, regular_teacher):
    now = datetime.now(timezone.utc)
    pkg = CreditPackage(
        teacher_id=regular_teacher.id,
        package_id="pkg-1000",
        points_total=1000,
        points_used=0,
        price_paid=180,
        purchased_at=now - timedelta(days=30),
        expires_at=now + timedelta(days=335),
        status="refunded",
        source="purchase",
    )
    shared_test_session.add(pkg)
    shared_test_session.commit()
    shared_test_session.refresh(pkg)
    return pkg


# ============ PUT /api/admin/subscription/credit-package/{id} ============
def test_edit_credit_package_happy_path(
    active_package, admin_teacher, auth_headers_admin, test_client, shared_test_session
):
    new_expires = (datetime.now(timezone.utc) + timedelta(days=400)).date().isoformat()
    response = test_client.put(
        f"/api/admin/subscription/credit-package/{active_package.id}",
        headers=auth_headers_admin,
        json={
            "points_total": 1800,
            "expires_at": new_expires,
            "reason": "Extending expiry per customer request",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == active_package.id
    assert body["points_total"] == 1800
    assert body["expires_at"].startswith(new_expires)

    shared_test_session.expire_all()
    row = shared_test_session.get(CreditPackage, active_package.id)
    assert row.points_total == 1800
    assert row.admin_id == admin_teacher.id
    assert row.admin_reason == "Extending expiry per customer request"
    # Audit history accumulated
    assert row.admin_metadata is not None
    ops = row.admin_metadata.get("operations", [])
    assert len(ops) == 1
    assert ops[0]["action"] == "edit"
    assert ops[0]["admin_id"] == admin_teacher.id
    assert ops[0]["reason"] == "Extending expiry per customer request"


def test_edit_credit_package_partial_points_only(
    active_package, auth_headers_admin, test_client, shared_test_session
):
    response = test_client.put(
        f"/api/admin/subscription/credit-package/{active_package.id}",
        headers=auth_headers_admin,
        json={"points_total": 1500, "reason": "correction"},
    )
    assert response.status_code == 200

    shared_test_session.expire_all()
    row = shared_test_session.get(CreditPackage, active_package.id)
    assert row.points_total == 1500
    # expires_at untouched
    assert row.expires_at == active_package.expires_at


def test_edit_credit_package_points_below_used_rejected(
    active_package, auth_headers_admin, test_client
):
    # active_package.points_used == 300, so 200 should be rejected
    response = test_client.put(
        f"/api/admin/subscription/credit-package/{active_package.id}",
        headers=auth_headers_admin,
        json={"points_total": 200, "reason": "bad reduce"},
    )
    assert response.status_code == 422
    assert "points_used" in response.json()["detail"].lower()


def test_edit_credit_package_negative_points_rejected(
    active_package, auth_headers_admin, test_client
):
    response = test_client.put(
        f"/api/admin/subscription/credit-package/{active_package.id}",
        headers=auth_headers_admin,
        json={"points_total": -1, "reason": "bad"},
    )
    assert response.status_code == 422


def test_edit_credit_package_reason_required(
    active_package, auth_headers_admin, test_client
):
    response = test_client.put(
        f"/api/admin/subscription/credit-package/{active_package.id}",
        headers=auth_headers_admin,
        json={"points_total": 1500},
    )
    assert response.status_code == 422


def test_edit_credit_package_reason_empty_rejected(
    active_package, auth_headers_admin, test_client
):
    response = test_client.put(
        f"/api/admin/subscription/credit-package/{active_package.id}",
        headers=auth_headers_admin,
        json={"points_total": 1500, "reason": ""},
    )
    assert response.status_code == 422


def test_edit_credit_package_not_found(auth_headers_admin, test_client):
    response = test_client.put(
        "/api/admin/subscription/credit-package/999999",
        headers=auth_headers_admin,
        json={"points_total": 1000, "reason": "test"},
    )
    assert response.status_code == 404


def test_edit_credit_package_already_refunded_rejected(
    refunded_package, auth_headers_admin, test_client
):
    response = test_client.put(
        f"/api/admin/subscription/credit-package/{refunded_package.id}",
        headers=auth_headers_admin,
        json={"points_total": 500, "reason": "should fail"},
    )
    assert response.status_code == 422


def test_edit_credit_package_points_equal_used_accepted(
    active_package, auth_headers_admin, test_client, shared_test_session
):
    """points_total == points_used is the lower bound and must be accepted."""
    response = test_client.put(
        f"/api/admin/subscription/credit-package/{active_package.id}",
        headers=auth_headers_admin,
        json={"points_total": active_package.points_used, "reason": "exact match"},
    )
    assert response.status_code == 200, response.text

    shared_test_session.expire_all()
    row = shared_test_session.get(CreditPackage, active_package.id)
    assert row.points_total == active_package.points_used


def test_edit_credit_package_non_admin_forbidden(
    active_package, auth_headers_regular, test_client
):
    response = test_client.put(
        f"/api/admin/subscription/credit-package/{active_package.id}",
        headers=auth_headers_regular,
        json={"points_total": 1500, "reason": "should fail"},
    )
    assert response.status_code == 403


def test_edit_credit_package_unauthenticated(active_package, test_client):
    response = test_client.put(
        f"/api/admin/subscription/credit-package/{active_package.id}",
        json={"points_total": 1500, "reason": "test"},
    )
    assert response.status_code in (401, 403)


def test_edit_credit_package_accumulates_history(
    active_package, admin_teacher, auth_headers_admin, test_client, shared_test_session
):
    """Two consecutive edits should produce two operation entries."""
    test_client.put(
        f"/api/admin/subscription/credit-package/{active_package.id}",
        headers=auth_headers_admin,
        json={"points_total": 1800, "reason": "first edit"},
    )
    test_client.put(
        f"/api/admin/subscription/credit-package/{active_package.id}",
        headers=auth_headers_admin,
        json={"points_total": 1500, "reason": "second edit"},
    )

    shared_test_session.expire_all()
    row = shared_test_session.get(CreditPackage, active_package.id)
    ops = row.admin_metadata.get("operations", [])
    assert len(ops) == 2
    assert [op["reason"] for op in ops] == ["first edit", "second edit"]
    # Latest admin_reason reflects last edit
    assert row.admin_reason == "second edit"


# ============ POST /api/admin/subscription/credit-package/{id}/cancel ============
def test_cancel_credit_package_happy_path(
    active_package, admin_teacher, auth_headers_admin, test_client, shared_test_session
):
    response = test_client.post(
        f"/api/admin/subscription/credit-package/{active_package.id}/cancel",
        headers=auth_headers_admin,
        json={"reason": "Customer refund request"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "refunded"

    shared_test_session.expire_all()
    row = shared_test_session.get(CreditPackage, active_package.id)
    assert row.status == "refunded"
    assert row.admin_id == admin_teacher.id
    assert row.admin_reason == "Customer refund request"
    ops = row.admin_metadata.get("operations", [])
    assert len(ops) == 1
    assert ops[0]["action"] == "cancel"


def test_cancel_credit_package_reason_required(
    active_package, auth_headers_admin, test_client
):
    response = test_client.post(
        f"/api/admin/subscription/credit-package/{active_package.id}/cancel",
        headers=auth_headers_admin,
        json={},
    )
    assert response.status_code == 422


def test_cancel_credit_package_not_found(auth_headers_admin, test_client):
    response = test_client.post(
        "/api/admin/subscription/credit-package/999999/cancel",
        headers=auth_headers_admin,
        json={"reason": "test"},
    )
    assert response.status_code == 404


def test_cancel_credit_package_already_refunded_rejected(
    refunded_package, auth_headers_admin, test_client
):
    response = test_client.post(
        f"/api/admin/subscription/credit-package/{refunded_package.id}/cancel",
        headers=auth_headers_admin,
        json={"reason": "double cancel"},
    )
    assert response.status_code == 422


def test_cancel_credit_package_non_admin_forbidden(
    active_package, auth_headers_regular, test_client
):
    response = test_client.post(
        f"/api/admin/subscription/credit-package/{active_package.id}/cancel",
        headers=auth_headers_regular,
        json={"reason": "should fail"},
    )
    assert response.status_code == 403


# ============ admin_operations surfacing ============
def test_edit_response_includes_admin_operations(
    active_package, auth_headers_admin, test_client
):
    response = test_client.put(
        f"/api/admin/subscription/credit-package/{active_package.id}",
        headers=auth_headers_admin,
        json={"points_total": 1500, "reason": "history surfacing"},
    )
    assert response.status_code == 200
    body = response.json()
    assert "admin_operations" in body
    assert len(body["admin_operations"]) == 1
    op = body["admin_operations"][0]
    assert op["action"] == "edit"
    assert op["reason"] == "history surfacing"
    assert "timestamp" in op
    assert "changes" in op


def test_cancel_response_includes_admin_operations(
    active_package, auth_headers_admin, test_client
):
    response = test_client.post(
        f"/api/admin/subscription/credit-package/{active_package.id}/cancel",
        headers=auth_headers_admin,
        json={"reason": "refund test"},
    )
    assert response.status_code == 200
    body = response.json()
    ops = body["admin_operations"]
    assert len(ops) == 1
    assert ops[0]["action"] == "cancel"


def test_teacher_periods_includes_admin_operations(
    active_package, auth_headers_admin, regular_teacher, test_client
):
    # Generate one edit so the package has history
    test_client.put(
        f"/api/admin/subscription/credit-package/{active_package.id}",
        headers=auth_headers_admin,
        json={"points_total": 1500, "reason": "seeding history"},
    )

    response = test_client.get(
        f"/api/admin/subscription/teacher/{regular_teacher.id}/periods",
        headers=auth_headers_admin,
    )
    assert response.status_code == 200
    pkg = next(
        p for p in response.json()["credit_packages"] if p["id"] == active_package.id
    )
    assert pkg["admin_operations"]
    assert pkg["admin_operations"][0]["action"] == "edit"


def test_teacher_periods_empty_admin_operations_for_untouched_pkg(
    active_package, auth_headers_admin, regular_teacher, test_client
):
    response = test_client.get(
        f"/api/admin/subscription/teacher/{regular_teacher.id}/periods",
        headers=auth_headers_admin,
    )
    pkg = next(
        p for p in response.json()["credit_packages"] if p["id"] == active_package.id
    )
    assert pkg["admin_operations"] == []


# ============ List filter ============
def test_teacher_periods_excludes_refunded_packages(
    active_package,
    refunded_package,
    regular_teacher,
    auth_headers_admin,
    test_client,
):
    response = test_client.get(
        f"/api/admin/subscription/teacher/{regular_teacher.id}/periods",
        headers=auth_headers_admin,
    )
    assert response.status_code == 200
    body = response.json()
    pkg_ids = [p["id"] for p in body["credit_packages"]]
    assert active_package.id in pkg_ids
    assert refunded_package.id not in pkg_ids
