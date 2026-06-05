"""Tests for admin plans CRUD endpoints (price/quota overrides)."""

import pytest
from models import Teacher, Plan
from auth import get_password_hash, create_access_token


@pytest.fixture
def admin_teacher(shared_test_session):
    teacher = Teacher(
        email="admin-plans@duotopia.com",
        password_hash=get_password_hash("admin_password"),
        name="Admin Plans",
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
        email="regular-plans@duotopia.com",
        password_hash=get_password_hash("regular_password"),
        name="Regular Plans",
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
def seed_plans(shared_test_session):
    """Seed plans table with the same 5 plans the migration creates."""
    rows = [
        Plan(name="Free Trial", price=0, quota=2000, display_order=1),
        Plan(name="Tutor Teachers", price=299, quota=2000, display_order=2),
        Plan(name="School Teachers", price=599, quota=6000, display_order=3),
        Plan(name="Demo Unlimited Plan", price=0, quota=999999, display_order=4),
        Plan(name="VIP", price=0, quota=0, display_order=5),
    ]
    for r in rows:
        shared_test_session.add(r)
    shared_test_session.commit()
    return rows


# ============ GET /api/admin/plans ============
def test_list_plans_as_admin_returns_seeded_rows(
    seed_plans, auth_headers_admin, test_client
):
    response = test_client.get("/api/admin/plans", headers=auth_headers_admin)

    assert response.status_code == 200
    data = response.json()
    names = [p["name"] for p in data]
    assert "Tutor Teachers" in names
    assert "School Teachers" in names
    # Should be ordered by display_order
    assert data[0]["name"] == "Free Trial"
    assert data[1]["name"] == "Tutor Teachers"
    # Fields surface to the client
    tutor = next(p for p in data if p["name"] == "Tutor Teachers")
    assert tutor["price"] == 299
    assert tutor["quota"] == 2000
    assert tutor["is_active"] is True


def test_list_plans_non_admin_forbidden(seed_plans, auth_headers_regular, test_client):
    response = test_client.get("/api/admin/plans", headers=auth_headers_regular)
    assert response.status_code == 403


def test_list_plans_unauthenticated_rejected(seed_plans, test_client):
    response = test_client.get("/api/admin/plans")
    assert response.status_code in (401, 403)


# ============ PUT /api/admin/plans/{name} ============
def test_update_plan_price_and_quota_as_admin(
    seed_plans, admin_teacher, auth_headers_admin, test_client, shared_test_session
):
    response = test_client.put(
        "/api/admin/plans/Tutor Teachers",
        headers=auth_headers_admin,
        json={"price": 350, "quota": 2500, "is_active": True},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == "Tutor Teachers"
    assert body["price"] == 350
    assert body["quota"] == 2500

    # Persisted in DB
    shared_test_session.expire_all()
    row = shared_test_session.query(Plan).filter(Plan.name == "Tutor Teachers").first()
    assert row.price == 350
    assert row.quota == 2500
    assert row.updated_by_admin_id == admin_teacher.id


def test_update_plan_partial_only_price(
    seed_plans, auth_headers_admin, test_client, shared_test_session
):
    response = test_client.put(
        "/api/admin/plans/School Teachers",
        headers=auth_headers_admin,
        json={"price": 699},
    )
    assert response.status_code == 200

    shared_test_session.expire_all()
    row = shared_test_session.query(Plan).filter(Plan.name == "School Teachers").first()
    assert row.price == 699
    assert row.quota == 6000  # untouched


def test_update_plan_toggle_inactive(
    seed_plans, auth_headers_admin, test_client, shared_test_session
):
    response = test_client.put(
        "/api/admin/plans/VIP",
        headers=auth_headers_admin,
        json={"is_active": False},
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is False


def test_update_plan_unknown_name_returns_404(
    seed_plans, auth_headers_admin, test_client
):
    response = test_client.put(
        "/api/admin/plans/Nonexistent Plan",
        headers=auth_headers_admin,
        json={"price": 100},
    )
    assert response.status_code == 404


def test_update_plan_negative_price_rejected(
    seed_plans, auth_headers_admin, test_client
):
    response = test_client.put(
        "/api/admin/plans/Tutor Teachers",
        headers=auth_headers_admin,
        json={"price": -1},
    )
    assert response.status_code == 422


def test_update_plan_negative_quota_rejected(
    seed_plans, auth_headers_admin, test_client
):
    response = test_client.put(
        "/api/admin/plans/Tutor Teachers",
        headers=auth_headers_admin,
        json={"quota": -10},
    )
    assert response.status_code == 422


def test_update_plan_non_admin_forbidden(seed_plans, auth_headers_regular, test_client):
    response = test_client.put(
        "/api/admin/plans/Tutor Teachers",
        headers=auth_headers_regular,
        json={"price": 100},
    )
    assert response.status_code == 403


# ============ Helper integration: get_plan_price / get_plan_quota ============
def test_get_plan_price_prefers_db_override(seed_plans, shared_test_session):
    """After admin edits Plan row, get_plan_price returns the new value."""
    from config.plans import get_plan_price

    row = shared_test_session.query(Plan).filter(Plan.name == "Tutor Teachers").first()
    row.price = 450
    shared_test_session.commit()

    assert get_plan_price("Tutor Teachers", db=shared_test_session) == 450


def test_get_plan_quota_prefers_db_override(seed_plans, shared_test_session):
    from config.plans import get_plan_quota

    row = shared_test_session.query(Plan).filter(Plan.name == "School Teachers").first()
    row.quota = 8000
    shared_test_session.commit()

    assert get_plan_quota("School Teachers", db=shared_test_session) == 8000


def test_get_plan_price_falls_back_when_no_row(shared_test_session):
    """No Plan row → falls back to PLAN_PRICES constant."""
    from config.plans import get_plan_price

    assert get_plan_price("Tutor Teachers", db=shared_test_session) == 299


# ============ PR #837 (issue #768): group-buy lever guards ============


@pytest.fixture
def seed_group_buy_plan(shared_test_session):
    """A group-buy plan (teacher_seats not-NULL) for the new lever tests."""
    from decimal import Decimal

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


def test_update_plan_annual_fee_on_non_group_buy_returns_400(
    seed_plans, auth_headers_admin, test_client
):
    """PR #837: annual_fee is a group-buy-only lever. Setting it on an
    individual plan (teacher_seats IS NULL) must be rejected with 400 so
    an accidental admin edit can't silently land on a plan that won't
    actually read the field."""
    r = test_client.put(
        "/api/admin/plans/Tutor%20Teachers",
        headers=auth_headers_admin,
        json={"annual_fee": 1500},
    )
    assert r.status_code == 400
    assert "annual_fee" in r.json()["detail"]
    assert "teacher_seats" in r.json()["detail"]


def test_update_plan_topup_discount_on_non_group_buy_returns_400(
    seed_plans, auth_headers_admin, test_client
):
    """Same guard as above for the topup_discount lever."""
    r = test_client.put(
        "/api/admin/plans/Tutor%20Teachers",
        headers=auth_headers_admin,
        json={"topup_discount": 0.9},
    )
    assert r.status_code == 400
    assert "topup_discount" in r.json()["detail"]


def test_update_plan_topup_discount_out_of_range_returns_422(
    seed_group_buy_plan, auth_headers_admin, test_client
):
    """Pydantic validation: topup_discount must be 0 < x ≤ 1.
    Sending 1.5 → 422 (request validation), 0 → 422 (gt=0)."""
    r = test_client.put(
        "/api/admin/plans/%E5%9C%98%E8%B3%BC-30%E5%B8%AD",  # 團購-30席 URL-encoded
        headers=auth_headers_admin,
        json={"topup_discount": 1.5},
    )
    assert r.status_code == 422

    r = test_client.put(
        "/api/admin/plans/%E5%9C%98%E8%B3%BC-30%E5%B8%AD",
        headers=auth_headers_admin,
        json={"topup_discount": 0},
    )
    assert r.status_code == 422


def test_update_plan_annual_fee_on_group_buy_persists(
    seed_group_buy_plan, auth_headers_admin, test_client, shared_test_session
):
    """Happy path: setting annual_fee on a group-buy plan returns the
    updated row and the value is persisted to the DB."""
    r = test_client.put(
        "/api/admin/plans/%E5%9C%98%E8%B3%BC-30%E5%B8%AD",
        headers=auth_headers_admin,
        json={"annual_fee": 1400, "topup_discount": 0.88},
    )
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["annual_fee"] == 1400
    assert float(body["topup_discount"]) == 0.88

    shared_test_session.expire_all()
    row = shared_test_session.query(Plan).filter(Plan.name == "團購-30席").one()
    assert row.annual_fee == 1400
    assert float(row.topup_discount) == 0.88
    # teacher_seats stays as-seeded (not editable via this endpoint)
    assert row.teacher_seats == 30
