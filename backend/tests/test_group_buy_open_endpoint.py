"""Endpoint tests for POST /api/credit-packages/group-buy-open (issue #768 Phase 3).

TapPay is mocked. The endpoint's own try/except, audit-log, and Period
creation logic is verified end-to-end; deeper service logic is covered by
test_group_buy_service.py.
"""

from decimal import Decimal
from unittest.mock import Mock, patch

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
    TeacherSubscriptionTransaction,
)


@pytest.fixture
def teacher(shared_test_session):
    t = Teacher(
        email="gb-open@duotopia.com",
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
def auth_header(teacher):
    token = create_access_token({"sub": str(teacher.id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def gb_plan(shared_test_session):
    p = Plan(
        name="團購-30席",
        price=None,
        quota=1000,
        teacher_seats=30,
        annual_fee=1300,
        topup_discount=Decimal("0.90"),
        is_active=True,
    )
    shared_test_session.add(p)
    shared_test_session.commit()
    shared_test_session.refresh(p)
    return p


@pytest.fixture
def individual_plan(shared_test_session):
    p = Plan(name="Tutor Teachers", price=299, quota=2000, is_active=True)
    shared_test_session.add(p)
    shared_test_session.commit()
    return p


def test_returns_payment_disabled_when_enable_payment_false(
    test_client, auth_header, gb_plan
):
    with patch("routers.credit_packages.ENABLE_PAYMENT", False):
        r = test_client.post(
            "/api/credit-packages/group-buy-open",
            json={"prime": "prime-x", "plan_name": gb_plan.name},
            headers=auth_header,
        )
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is False
    assert "尚未開放" in body["message"]


def test_rejects_unknown_plan_with_400(test_client, auth_header):
    with patch("routers.credit_packages.ENABLE_PAYMENT", True), patch(
        "routers.credit_packages.TapPayService"
    ) as mock_tappay_class:
        r = test_client.post(
            "/api/credit-packages/group-buy-open",
            json={"prime": "prime-x", "plan_name": "does-not-exist"},
            headers=auth_header,
        )
    assert r.status_code == 400
    assert "Unknown plan" in r.json()["detail"]
    mock_tappay_class.assert_not_called()


def test_rejects_individual_plan_with_400(test_client, auth_header, individual_plan):
    with patch("routers.credit_packages.ENABLE_PAYMENT", True), patch(
        "routers.credit_packages.TapPayService"
    ) as mock_tappay_class:
        r = test_client.post(
            "/api/credit-packages/group-buy-open",
            json={"prime": "prime-x", "plan_name": individual_plan.name},
            headers=auth_header,
        )
    assert r.status_code == 400
    assert "not a group-buy plan" in r.json()["detail"]
    mock_tappay_class.assert_not_called()


def test_happy_path_creates_org_school_binding_period(
    test_client, auth_header, teacher, gb_plan, shared_test_session
):
    mock_tappay = Mock()
    mock_tappay.process_payment.return_value = {
        "status": 0,
        "rec_trade_id": "REC-OPEN-123",
        "card_secret": {},
    }
    with patch("routers.credit_packages.ENABLE_PAYMENT", True), patch(
        "routers.credit_packages.TapPayService", return_value=mock_tappay
    ):
        r = test_client.post(
            "/api/credit-packages/group-buy-open",
            json={"prime": "prime-x", "plan_name": gb_plan.name},
            headers=auth_header,
        )

    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["success"] is True
    assert body["transaction_id"] == "REC-OPEN-123"
    assert body["teacher_seat_limit"] == gb_plan.teacher_seats
    assert body["organization_id"]
    assert body["school_id"]

    # Verify the charged amount = annual_fee * teacher_seats (server-side)
    call_kwargs = mock_tappay.process_payment.call_args.kwargs
    assert call_kwargs["amount"] == gb_plan.annual_fee * gb_plan.teacher_seats

    # Side effects in DB
    shared_test_session.expire_all()
    org = (
        shared_test_session.query(Organization)
        .filter(Organization.id == body["organization_id"])
        .one()
    )
    assert org.org_type == "group_buy"
    school = (
        shared_test_session.query(School).filter(School.id == body["school_id"]).one()
    )
    assert school.plan_id == gb_plan.id
    ts = (
        shared_test_session.query(TeacherSchool)
        .filter(
            TeacherSchool.teacher_id == teacher.id,
            TeacherSchool.school_id == school.id,
        )
        .one()
    )
    assert ts.roles == ["school_admin"]
    # F3 — TeacherOrganization with role='org_owner' must also be created so
    # the opener can use /org-purchase and /org-renew.
    t_org = (
        shared_test_session.query(TeacherOrganization)
        .filter(
            TeacherOrganization.teacher_id == teacher.id,
            TeacherOrganization.organization_id == org.id,
        )
        .one()
    )
    assert t_org.role == "org_owner"
    assert t_org.is_active is True
    period = (
        shared_test_session.query(SubscriptionPeriod)
        .filter(
            SubscriptionPeriod.teacher_id == teacher.id,
            SubscriptionPeriod.plan_name == gb_plan.name,
        )
        .one()
    )
    assert period.quota_total == 1000
    assert period.payment_id == "REC-OPEN-123"
    # Successful TeacherSubscriptionTransaction logged
    txn = (
        shared_test_session.query(TeacherSubscriptionTransaction)
        .filter(TeacherSubscriptionTransaction.teacher_id == teacher.id)
        .one()
    )
    assert txn.status == "SUCCESS"
    assert txn.amount == gb_plan.annual_fee * gb_plan.teacher_seats
    assert txn.subscription_type == gb_plan.name


def test_idempotent_within_60s_returns_existing_transaction(
    test_client, auth_header, teacher, gb_plan, shared_test_session
):
    # Seed a recent successful transaction for this teacher + plan
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    existing = TeacherSubscriptionTransaction(
        teacher_id=teacher.id,
        teacher_email=teacher.email,
        transaction_type="RECHARGE",
        subscription_type=gb_plan.name,
        amount=gb_plan.annual_fee * gb_plan.teacher_seats,
        currency="TWD",
        status="SUCCESS",
        months=12,
        period_start=now,
        period_end=now,
        new_end_date=now,
        payment_provider="tappay",
        payment_method="credit_card",
        external_transaction_id="REC-PREVIOUS",
        processed_at=now,
    )
    shared_test_session.add(existing)
    shared_test_session.commit()

    with patch("routers.credit_packages.ENABLE_PAYMENT", True), patch(
        "routers.credit_packages.TapPayService"
    ) as mock_tappay_class:
        r = test_client.post(
            "/api/credit-packages/group-buy-open",
            json={"prime": "prime-x", "plan_name": gb_plan.name},
            headers=auth_header,
        )

    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["transaction_id"] == "REC-PREVIOUS"
    # TapPay should NOT be called again
    mock_tappay_class.assert_not_called()
