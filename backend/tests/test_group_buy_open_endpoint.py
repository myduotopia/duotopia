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
    GroupBuyMember,
    GroupBuyTeam,
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
    # issue #838 Bug 1 — the 發起人's email is persisted onto the org so
    # admins can identify/contact the initiator (was previously NULL).
    assert org.contact_email == teacher.email
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

    # issue #862 PR2 雙寫：開團端點應於同一交易鏡射到新表（讀取仍走舊表）。
    # 這鎖定 call-site wiring（傳對 org、交易順序），非只測 pure function。
    team = (
        shared_test_session.query(GroupBuyTeam)
        .filter(GroupBuyTeam.source_organization_id == org.id)
        .one()
    )
    assert team.owner_teacher_id == teacher.id
    assert team.plan_id == gb_plan.id
    assert team.seat_limit == gb_plan.teacher_seats
    owner_member = (
        shared_test_session.query(GroupBuyMember)
        .filter(
            GroupBuyMember.team_id == team.id,
            GroupBuyMember.teacher_id == teacher.id,
        )
        .one()
    )
    assert owner_member.is_owner is True
    assert owner_member.is_active is True


def test_open_pauses_leader_existing_individual_subscription(
    test_client, auth_header, teacher, gb_plan, shared_test_session
):
    """issue #862 §4.8：發起人開團前若已有有效個人訂閱，開團後該個人 period 應被
    暫停（status=paused）且 auto_renew 關掉（防 P1 重複收費）。端點級整合驗證。"""
    from datetime import datetime, timedelta, timezone

    teacher.subscription_auto_renew = True
    ind = SubscriptionPeriod(
        teacher_id=teacher.id,
        plan_name="Tutor Teachers",
        amount_paid=299,
        quota_total=2000,
        quota_used=300,
        start_date=datetime.now(timezone.utc) - timedelta(days=5),
        end_date=datetime.now(timezone.utc) + timedelta(days=90),
        payment_method="manual",
        payment_status="paid",
        status="active",
    )
    shared_test_session.add(ind)
    shared_test_session.commit()

    mock_tappay = Mock()
    mock_tappay.process_payment.return_value = {
        "status": 0,
        "rec_trade_id": "REC-PAUSE",
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

    shared_test_session.expire_all()
    shared_test_session.refresh(ind)
    assert ind.status == "paused"  # 個人訂閱被暫停凍結
    t2 = shared_test_session.query(Teacher).filter(Teacher.id == teacher.id).one()
    assert t2.subscription_auto_renew is False  # 關掉月扣防 P1


def test_open_survives_mirror_failure(
    test_client, auth_header, teacher, gb_plan, shared_test_session, monkeypatch
):
    """issue #862：雙寫鏡射失敗**不可**讓一筆已扣款的開團被 rollback→退款。
    強迫 sync 拋錯，斷言端點仍成功、org/school/period 仍寫入、team 未建（鏡射回滾）。"""
    import services.group_buy as gb

    def _boom(org, db):
        raise RuntimeError("mirror boom")

    monkeypatch.setattr(gb, "sync_group_buy_team_from_org", _boom)

    mock_tappay = Mock()
    mock_tappay.process_payment.return_value = {
        "status": 0,
        "rec_trade_id": "REC-BOOM",
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

    assert r.status_code == 200, r.json()  # 已扣款購買未被鏡射失敗連累
    body = r.json()
    shared_test_session.expire_all()
    # 真實寫入仍 commit
    assert (
        shared_test_session.query(Organization)
        .filter(Organization.id == body["organization_id"])
        .one()
    )
    assert (
        shared_test_session.query(SubscriptionPeriod)
        .filter(SubscriptionPeriod.teacher_id == teacher.id)
        .count()
        >= 1
    )
    # 鏡射（SAVEPOINT）已回滾 → 無 team 列
    assert (
        shared_test_session.query(GroupBuyTeam)
        .filter(GroupBuyTeam.source_organization_id == body["organization_id"])
        .count()
        == 0
    )


def test_repeat_open_adds_school_to_existing_org(
    test_client, auth_header, teacher, gb_plan, shared_test_session
):
    """issue #838 Bug 2 — A repeat open by the same 發起人 is no longer
    rejected: it reuses the teacher's existing group-buy org and adds a new
    分校 (School) under it, charging normally. Seat cap aggregates across
    分校 and the 發起人 contact info is backfilled onto the org."""
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    # Seed an existing owned group-buy org + its first school, created well
    # outside the 60s retry window (no recent SUCCESS txn ⇒ not idempotent).
    org = Organization(
        name="Pre-existing 團",
        org_type="group_buy",
        teacher_limit=gb_plan.teacher_seats,
        subscription_start_date=now - timedelta(days=10),
        subscription_end_date=now + timedelta(days=355),
        is_active=True,
        created_at=now - timedelta(hours=1),
    )
    shared_test_session.add(org)
    shared_test_session.flush()
    first_school = School(
        organization_id=org.id,
        name="Pre-existing 團 School",
        plan_id=gb_plan.id,
        teacher_seat_limit=gb_plan.teacher_seats,
        is_active=True,
    )
    shared_test_session.add(first_school)
    shared_test_session.add(
        TeacherOrganization(
            teacher_id=teacher.id,
            organization_id=org.id,
            role="org_owner",
            is_active=True,
        )
    )
    shared_test_session.commit()
    org_id = org.id
    first_school_id = first_school.id

    mock_tappay = Mock()
    mock_tappay.process_payment.return_value = {
        "status": 0,
        "rec_trade_id": "REC-OPEN-2ND",
        "card_secret": {},
    }
    with patch("routers.credit_packages.ENABLE_PAYMENT", True), patch(
        "routers.credit_packages.TapPayService", return_value=mock_tappay
    ):
        r = test_client.post(
            "/api/credit-packages/group-buy-open",
            json={
                "prime": "prime-x",
                "plan_name": gb_plan.name,
                "leader_phone": "0912345678",
            },
            headers=auth_header,
        )

    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["success"] is True
    # Charged again (repeat open is a real purchase).
    mock_tappay.process_payment.assert_called_once()

    # Reused the SAME org, but created a NEW 分校.
    assert body["organization_id"] == str(org_id)
    assert body["school_id"] != str(first_school_id)

    shared_test_session.expire_all()
    schools = (
        shared_test_session.query(School).filter(School.organization_id == org_id).all()
    )
    assert len(schools) == 2, "a new 分校 should be added under the existing org"

    reused_org = (
        shared_test_session.query(Organization).filter(Organization.id == org_id).one()
    )
    # Seat cap aggregates across 分校.
    assert reused_org.teacher_limit == gb_plan.teacher_seats * 2
    # 發起人 contact info backfilled onto the org.
    assert reused_org.contact_email == teacher.email
    assert reused_org.contact_phone == "0912345678"

    # Owner bound as school_admin of the new 分校.
    new_school_id = body["school_id"]
    ts = (
        shared_test_session.query(TeacherSchool)
        .filter(
            TeacherSchool.teacher_id == teacher.id,
            TeacherSchool.school_id == new_school_id,
        )
        .one()
    )
    assert ts.roles == ["school_admin"]

    # Only ONE org owned by this teacher — repeat opens accrete 分校, they
    # do not spawn a second org.
    owned_orgs = (
        shared_test_session.query(TeacherOrganization)
        .filter(
            TeacherOrganization.teacher_id == teacher.id,
            TeacherOrganization.role == "org_owner",
        )
        .count()
    )
    assert owned_orgs == 1


def test_idempotent_within_60s_returns_existing_transaction(
    test_client, auth_header, teacher, gb_plan, shared_test_session
):
    """R2-F5 — A retry within 60s (network timeout, mobile re-send) must
    return the original transaction AND populate org_id / school_id /
    subscription_end_date / teacher_seat_limit so the frontend can still
    redirect the user to their new team page."""
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    # Seed the full production-shape state the original (just-succeeded)
    # request would have left: Org + School + TeacherOrganization + recent
    # SUCCESS transaction. The R2-F2 guard skips orgs younger than 60s, so
    # this lands in the idempotency-shortcut block.
    org = Organization(
        name="Existing 團",
        org_type="group_buy",
        subscription_start_date=now,
        subscription_end_date=now + timedelta(days=365),
        is_active=True,
    )
    shared_test_session.add(org)
    shared_test_session.flush()
    school = School(
        organization_id=org.id,
        name="Existing 團 School",
        plan_id=gb_plan.id,
        teacher_seat_limit=gb_plan.teacher_seats,
        is_active=True,
    )
    shared_test_session.add(school)
    shared_test_session.flush()
    shared_test_session.add(
        TeacherOrganization(
            teacher_id=teacher.id,
            organization_id=org.id,
            role="org_owner",
            is_active=True,
        )
    )
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
        period_end=now + timedelta(days=365),
        new_end_date=now + timedelta(days=365),
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
    # R2-F5 assertions: redirect fields must be populated, not null
    assert body["organization_id"] == str(org.id)
    assert body["school_id"] == str(school.id)
    assert body["subscription_end_date"] is not None
    assert body["teacher_seat_limit"] == gb_plan.teacher_seats
    # TapPay should NOT be called again
    mock_tappay_class.assert_not_called()


def test_idempotent_retry_with_roster_returns_existing_with_member_count(
    test_client, auth_header, teacher, gb_plan, shared_test_session
):
    """Issue #768 PR #851 review round 7 #3 — Cover the retry path where
    the leader re-submits a roster request after a successful purchase.
    The endpoint should:

      (a) NOT charge TapPay a second time,
      (b) Return the existing org/school IDs (same as the no-roster
          retry path), AND
      (c) Surface `members_bound` consistent with the new-path semantic
          (member count excluding the leader), so the frontend's
          success screen shows the same number whether it's the first
          response or a retry.

    Without this test, a future refactor of the idempotency-shortcut
    block could silently switch `retry_bound` to include the leader and
    the UI would display the wrong member count on retry.
    """
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    # Production-shape state after the original purchase committed:
    # org + school + leader's TeacherOrganization + leader's TeacherSchool
    # + a couple of member TeacherSchool rows + a SUCCESS transaction.
    org = Organization(
        name="Existing 團 (with members)",
        org_type="group_buy",
        subscription_start_date=now,
        subscription_end_date=now + timedelta(days=365),
        is_active=True,
    )
    shared_test_session.add(org)
    shared_test_session.flush()
    school = School(
        organization_id=org.id,
        name="Existing 團 School (with members)",
        plan_id=gb_plan.id,
        teacher_seat_limit=gb_plan.teacher_seats,
        is_active=True,
    )
    shared_test_session.add(school)
    shared_test_session.flush()
    shared_test_session.add(
        TeacherOrganization(
            teacher_id=teacher.id,
            organization_id=org.id,
            role="org_owner",
            is_active=True,
        )
    )
    # Leader binding into the school.
    shared_test_session.add(
        TeacherSchool(
            teacher_id=teacher.id,
            school_id=school.id,
            roles=["school_admin"],
            is_active=True,
        )
    )
    # Three member bindings — what `members_bound` should report on retry.
    from auth import get_password_hash

    expected_members = 3
    for i in range(expected_members):
        m = Teacher(
            email=f"retry-member-{i}@duotopia.com",
            password_hash=get_password_hash("x"),
            name=f"RetryMember{i}",
            is_active=True,
            email_verified=True,
        )
        shared_test_session.add(m)
        shared_test_session.flush()
        shared_test_session.add(
            TeacherSchool(
                teacher_id=m.id,
                school_id=school.id,
                roles=["teacher"],
                is_active=True,
            )
        )
    shared_test_session.add(
        TeacherSubscriptionTransaction(
            teacher_id=teacher.id,
            teacher_email=teacher.email,
            transaction_type="RECHARGE",
            subscription_type=gb_plan.name,
            amount=gb_plan.annual_fee * gb_plan.teacher_seats,
            currency="TWD",
            status="SUCCESS",
            months=12,
            period_start=now,
            period_end=now + timedelta(days=365),
            new_end_date=now + timedelta(days=365),
            payment_provider="tappay",
            payment_method="credit_card",
            external_transaction_id="REC-RETRY-WITH-ROSTER",
            processed_at=now,
        )
    )
    shared_test_session.commit()

    # Retry with a member_emails list — mirrors a real frontend re-send.
    roster = [f"retry-member-{i}@duotopia.com" for i in range(expected_members)]
    with patch("routers.credit_packages.ENABLE_PAYMENT", True), patch(
        "routers.credit_packages.TapPayService"
    ) as mock_tappay_class:
        r = test_client.post(
            "/api/credit-packages/group-buy-open",
            json={
                "prime": "prime-retry",
                "plan_name": gb_plan.name,
                "member_emails": roster,
            },
            headers=auth_header,
        )

    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["transaction_id"] == "REC-RETRY-WITH-ROSTER"
    # (a) No second TapPay call.
    mock_tappay_class.assert_not_called()
    # (b) Same org/school IDs.
    assert body["organization_id"] == str(org.id)
    assert body["school_id"] == str(school.id)
    # (c) `members_bound` excludes the leader — same semantic as new path.
    assert body["members_bound"] == expected_members
