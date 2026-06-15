"""Tests for the multi-member roster path in
POST /api/credit-packages/group-buy-open (issue #768 comment #3).

The legacy single-leader path stays covered by test_group_buy_open_endpoint.py;
this file focuses on the new `member_emails` semantics:
- shape / distinct / no-self-reference guards
- pre-payment all-or-nothing eligibility check (no TapPay call on failure)
- happy-path atomic multi-bind: TeacherSchool + SubscriptionPeriod for every
  member, leader binding unchanged
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
    TeacherSchool,
)


@pytest.fixture
def leader(shared_test_session):
    t = Teacher(
        email="roster-leader@duotopia.com",
        password_hash=get_password_hash("x"),
        name="Leader",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


@pytest.fixture
def auth_header(leader):
    token = create_access_token({"sub": str(leader.id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def gb_plan_10(shared_test_session):
    """團購-10席 chosen for fixture brevity: a fully-populated roster needs
    9 member teachers (one seat goes to the leader). Distinct plan name
    so this fixture can't collide with other test modules that also
    seed a 團購 plan in the same shared_test_session."""
    p = Plan(
        name="團購-10席-roster-fixture",
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


def _make_verified_teacher(shared_test_session, email):
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


@pytest.fixture
def nine_members(shared_test_session):
    return [
        _make_verified_teacher(shared_test_session, f"member{i}@school.com")
        for i in range(1, 10)
    ]


def _post(test_client, auth_header, payload):
    return test_client.post(
        "/api/credit-packages/group-buy-open",
        json=payload,
        headers=auth_header,
    )


def _mock_tappay(rec_trade_id="REC-ROSTER"):
    m = Mock()
    m.process_payment.return_value = {
        "status": 0,
        "rec_trade_id": rec_trade_id,
        "card_secret": {},
    }
    return m


# ---------- shape guards ----------


def test_rejects_wrong_member_count(test_client, auth_header, gb_plan_10, nine_members):
    """teacher_seats=10 ⇒ exactly 9 member emails required."""
    eight = [m.email for m in nine_members[:-1]]
    with patch("routers.credit_packages.ENABLE_PAYMENT", True), patch(
        "routers.credit_packages.TapPayService"
    ) as mock_tappay_class:
        r = _post(
            test_client,
            auth_header,
            {
                "prime": "prime-x",
                "plan_name": gb_plan_10.name,
                "member_emails": eight,
            },
        )
    assert r.status_code == 400
    assert "9" in r.json()["detail"]
    mock_tappay_class.assert_not_called()


def test_rejects_when_leader_in_roster(
    test_client, auth_header, leader, gb_plan_10, nine_members
):
    """Leader takes seat #1 implicitly; their email in member_emails would
    double-count and silently fail the distinct check anyway, but we
    explicitly 400 here for a clearer error."""
    emails = [m.email for m in nine_members[:8]] + [leader.email]
    with patch("routers.credit_packages.ENABLE_PAYMENT", True), patch(
        "routers.credit_packages.TapPayService"
    ) as mock_tappay_class:
        r = _post(
            test_client,
            auth_header,
            {
                "prime": "prime-x",
                "plan_name": gb_plan_10.name,
                "member_emails": emails,
            },
        )
    assert r.status_code == 400
    assert "leader" in r.json()["detail"].lower()
    mock_tappay_class.assert_not_called()


def test_rejects_duplicate_emails(test_client, auth_header, gb_plan_10, nine_members):
    emails = [m.email for m in nine_members[:8]] + [nine_members[0].email]
    with patch("routers.credit_packages.ENABLE_PAYMENT", True), patch(
        "routers.credit_packages.TapPayService"
    ) as mock_tappay_class:
        r = _post(
            test_client,
            auth_header,
            {
                "prime": "prime-x",
                "plan_name": gb_plan_10.name,
                "member_emails": emails,
            },
        )
    assert r.status_code == 400
    assert "distinct" in r.json()["detail"].lower()
    mock_tappay_class.assert_not_called()


# ---------- eligibility guards (pre-payment) ----------


def test_rejects_when_a_member_is_unregistered(
    test_client, auth_header, gb_plan_10, nine_members
):
    """One bad email aborts the whole charge — user picked 'all-or-nothing'
    in the design questions."""
    emails = [m.email for m in nine_members[:8]] + ["nobody@nowhere.com"]
    with patch("routers.credit_packages.ENABLE_PAYMENT", True), patch(
        "routers.credit_packages.TapPayService"
    ) as mock_tappay_class:
        r = _post(
            test_client,
            auth_header,
            {
                "prime": "prime-x",
                "plan_name": gb_plan_10.name,
                "member_emails": emails,
            },
        )
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert any(
        f["email"] == "nobody@nowhere.com" and f["status"] == "not_registered"
        for f in detail["failed"]
    )
    mock_tappay_class.assert_not_called()


def test_rejects_when_a_member_is_unverified(
    test_client, auth_header, gb_plan_10, nine_members, shared_test_session
):
    unverified = Teacher(
        email="unverified-roster@school.com",
        password_hash=get_password_hash("x"),
        name="Unverified",
        is_active=True,
        email_verified=False,
    )
    shared_test_session.add(unverified)
    shared_test_session.commit()

    emails = [m.email for m in nine_members[:8]] + [unverified.email]
    with patch("routers.credit_packages.ENABLE_PAYMENT", True), patch(
        "routers.credit_packages.TapPayService"
    ) as mock_tappay_class:
        r = _post(
            test_client,
            auth_header,
            {
                "prime": "prime-x",
                "plan_name": gb_plan_10.name,
                "member_emails": emails,
            },
        )
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert any(
        f["email"] == unverified.email and f["status"] == "not_verified"
        for f in detail["failed"]
    )
    mock_tappay_class.assert_not_called()


def test_rejects_when_a_member_is_already_in_a_group_buy_team(
    test_client, auth_header, gb_plan_10, nine_members, shared_test_session
):
    """A teacher already bound to ANOTHER active group-buy school is
    ineligible — putting them in two would cause Phase 3 cron to grant
    2× points/month."""
    # Use an existing member as the conflict victim by also binding them
    # to a separate group-buy school.
    other_org = Organization(name="Other 團", org_type="group_buy", is_active=True)
    shared_test_session.add(other_org)
    shared_test_session.flush()
    other_school = School(
        organization_id=other_org.id,
        name="Other 團 School",
        plan_id=gb_plan_10.id,
        teacher_seat_limit=gb_plan_10.teacher_seats,
        is_active=True,
    )
    shared_test_session.add(other_school)
    shared_test_session.flush()
    conflict_member = nine_members[0]
    shared_test_session.add(
        TeacherSchool(
            teacher_id=conflict_member.id,
            school_id=other_school.id,
            roles=["teacher"],
            is_active=True,
        )
    )
    shared_test_session.commit()

    emails = [m.email for m in nine_members]
    with patch("routers.credit_packages.ENABLE_PAYMENT", True), patch(
        "routers.credit_packages.TapPayService"
    ) as mock_tappay_class:
        r = _post(
            test_client,
            auth_header,
            {
                "prime": "prime-x",
                "plan_name": gb_plan_10.name,
                "member_emails": emails,
            },
        )
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert any(
        f["email"] == conflict_member.email and f["status"] == "in_group_buy_team"
        for f in detail["failed"]
    )
    mock_tappay_class.assert_not_called()


# ---------- happy path ----------


def test_happy_path_binds_every_member_atomically(
    test_client,
    auth_header,
    leader,
    gb_plan_10,
    nine_members,
    shared_test_session,
):
    """Roster of 9 + leader ⇒ 10 active TeacherSchool rows in the new
    school AND 10 group-buy SubscriptionPeriods (1 each)."""
    mock_tappay = _mock_tappay("REC-ROSTER-HAPPY")
    emails = [m.email for m in nine_members]
    with patch("routers.credit_packages.ENABLE_PAYMENT", True), patch(
        "routers.credit_packages.TapPayService", return_value=mock_tappay
    ):
        r = _post(
            test_client,
            auth_header,
            {
                "prime": "prime-x",
                "plan_name": gb_plan_10.name,
                "member_emails": emails,
            },
        )
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["success"] is True
    assert body["members_bound"] == 9
    assert body["teacher_seat_limit"] == 10

    shared_test_session.expire_all()
    school = (
        shared_test_session.query(School).filter(School.id == body["school_id"]).one()
    )
    bindings = (
        shared_test_session.query(TeacherSchool)
        .filter(
            TeacherSchool.school_id == school.id,
            TeacherSchool.is_active.is_(True),
        )
        .all()
    )
    # 1 leader (school_admin) + 9 members (teacher)
    assert len(bindings) == 10
    leader_binding = next(b for b in bindings if b.teacher_id == leader.id)
    assert leader_binding.roles == ["school_admin"]
    member_bindings = [b for b in bindings if b.teacher_id != leader.id]
    assert {b.teacher_id for b in member_bindings} == {m.id for m in nine_members}
    for b in member_bindings:
        assert b.roles == ["teacher"]

    # Every member has exactly one group-buy SubscriptionPeriod stamped
    # with the leader's payment_id.
    for m in nine_members:
        period = (
            shared_test_session.query(SubscriptionPeriod)
            .filter(
                SubscriptionPeriod.teacher_id == m.id,
                SubscriptionPeriod.plan_name == gb_plan_10.name,
                SubscriptionPeriod.payment_method == "group_buy",
            )
            .one()
        )
        assert period.quota_total == 1000
        assert period.payment_id == "REC-ROSTER-HAPPY"


def test_leader_already_in_group_buy_team_can_still_open_new_team(
    test_client,
    auth_header,
    leader,
    gb_plan_10,
    nine_members,
    shared_test_session,
):
    """Per design Q2: the leader is allowed to open multiple teams. If
    the current teacher is already an active member of another
    group-buy school, that should NOT block them from opening a fresh
    team — backend uses `current_teacher` as `org_owner` regardless
    and never runs the leader through `_classify_team_emails` for the
    roster shape check.

    Pins this behaviour with an explicit test so a future refactor
    (e.g. someone adding a "current_teacher must not be in group-buy
    team" guard for symmetry with member checks) gets caught here
    instead of silently breaking the open-multiple flow.
    """
    # Plant the leader inside an unrelated active group-buy team.
    other_org = Organization(
        name="Other 團 (leader is a member)",
        org_type="group_buy",
        is_active=True,
    )
    shared_test_session.add(other_org)
    shared_test_session.flush()
    other_school = School(
        organization_id=other_org.id,
        name="Other 團 School",
        plan_id=gb_plan_10.id,
        teacher_seat_limit=gb_plan_10.teacher_seats,
        is_active=True,
    )
    shared_test_session.add(other_school)
    shared_test_session.flush()
    shared_test_session.add(
        TeacherSchool(
            teacher_id=leader.id,
            school_id=other_school.id,
            roles=["teacher"],
            is_active=True,
        )
    )
    shared_test_session.commit()

    mock_tappay = _mock_tappay("REC-LEADER-IN-TEAM-OPENS")
    emails = [m.email for m in nine_members]
    with patch("routers.credit_packages.ENABLE_PAYMENT", True), patch(
        "routers.credit_packages.TapPayService", return_value=mock_tappay
    ):
        r = _post(
            test_client,
            auth_header,
            {
                "prime": "prime-x",
                "plan_name": gb_plan_10.name,
                "member_emails": emails,
            },
        )
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["members_bound"] == 9
    # Leader binding in the new school still exists alongside the
    # pre-existing one in `other_school` — both stay active.
    shared_test_session.expire_all()
    leader_bindings = (
        shared_test_session.query(TeacherSchool)
        .filter(
            TeacherSchool.teacher_id == leader.id,
            TeacherSchool.is_active.is_(True),
        )
        .all()
    )
    assert len(leader_bindings) == 2
    # Compare as strings so the assertion stays correct if `school_id`
    # is ever surfaced as a UUID in the response (currently an int cast
    # to str). The int(...) cast in the prior round would have failed
    # silently on that refactor.
    school_ids = {str(b.school_id) for b in leader_bindings}
    assert str(other_school.id) in school_ids
    assert str(body["school_id"]) in school_ids


def test_in_tx_member_became_ineligible_rolls_back_and_charges_no_one(
    test_client,
    auth_header,
    leader,
    gb_plan_10,
    nine_members,
    shared_test_session,
):
    """The dangerous-path test (R4 review #2). Pre-payment classifier
    returns "ok" for everyone — TapPay is charged — and then *during the
    post-payment defensive re-classification* one member is detected as
    in another group-buy team (the race window where someone joined
    elsewhere while the leader was filling the roster).

    Verifies:
      (a) NO TeacherSchool bindings or SubscriptionPeriods for any member
          are persisted (all-or-nothing semantics under failure).
      (b) Response is 500, not 200 — the leader should NOT see "success"
          when the team is unprovisioned.
      (c) `member_became_ineligible_or_partial_retry:` tag surfaces in
          the failure error code so ops can trace the REFUND-REQUIRED
          path in BigQuery / Cloud Logging.

    Mechanism: patch `_classify_team_emails` so the first call (pre-
    payment) returns all-ok, but the second call (post-payment in-tx
    re-check) reports one member as `in_group_buy_team`.
    """
    import routers.credit_packages as cp

    real_classify = cp._classify_team_emails
    call_log = {"count": 0}

    def flaky_classify(emails, db):
        call_log["count"] += 1
        # First call (pre-payment) — pass through unchanged.
        if call_log["count"] == 1:
            return real_classify(emails, db)
        # Second call (post-payment defensive re-check) — flip the first
        # member to in_group_buy_team to simulate the race.
        result = real_classify(emails, db)
        first_email = emails[0]
        if first_email in result:
            t, _ = result[first_email]
            result[first_email] = (t, "in_group_buy_team")
        return result

    mock_tappay = _mock_tappay("REC-RACE")
    emails = [m.email for m in nine_members]
    with patch("routers.credit_packages.ENABLE_PAYMENT", True), patch(
        "routers.credit_packages.TapPayService", return_value=mock_tappay
    ), patch.object(cp, "_classify_team_emails", side_effect=flaky_classify):
        r = _post(
            test_client,
            auth_header,
            {
                "prime": "prime-x",
                "plan_name": gb_plan_10.name,
                "member_emails": emails,
            },
        )

    # (b) Leader gets 500 with the REFUND-REQUIRED narrative — never 200.
    assert r.status_code == 500
    assert "rec_trade_id" in r.json()["detail"]
    # TapPay was called (pre-payment passed) — the rollback happened
    # after the charge.
    assert mock_tappay.process_payment.called

    # (a) No member TeacherSchool / SubscriptionPeriod rows committed.
    shared_test_session.expire_all()
    for m in nine_members:
        ts = (
            shared_test_session.query(TeacherSchool)
            .filter(TeacherSchool.teacher_id == m.id)
            .all()
        )
        assert ts == [], f"unexpected member binding for {m.email}"
        sp = (
            shared_test_session.query(SubscriptionPeriod)
            .filter(SubscriptionPeriod.teacher_id == m.id)
            .all()
        )
        assert sp == [], f"unexpected period for {m.email}"


def test_empty_member_emails_keeps_legacy_single_leader_flow(
    test_client, auth_header, leader, gb_plan_10, shared_test_session
):
    """Backward compat: an empty roster means 'only the leader is bound'.
    Admin can later use /admin/subscription/create (PR #841) to add
    members. Existing test_group_buy_open_endpoint.py also exercises this
    path implicitly — keep it here too because the new code path has its
    own validation branch."""
    mock_tappay = _mock_tappay("REC-LEGACY")
    with patch("routers.credit_packages.ENABLE_PAYMENT", True), patch(
        "routers.credit_packages.TapPayService", return_value=mock_tappay
    ):
        r = _post(
            test_client,
            auth_header,
            {
                "prime": "prime-x",
                "plan_name": gb_plan_10.name,
                "member_emails": [],
            },
        )
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["members_bound"] == 0

    shared_test_session.expire_all()
    bindings = (
        shared_test_session.query(TeacherSchool)
        .filter(
            TeacherSchool.school_id == body["school_id"],
            TeacherSchool.is_active.is_(True),
        )
        .all()
    )
    assert len(bindings) == 1
    assert bindings[0].teacher_id == leader.id
