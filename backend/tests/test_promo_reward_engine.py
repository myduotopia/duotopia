"""
PR 3 (issue #637) — referral reward engine tests.

Covers grant idempotency, signup rewards, first-paid gating (subscription vs
credit-package mutual exclusivity), admin-editable point values, and the
no-reward-configured pass-through. Service-level (runs on SQLite).
"""

from datetime import datetime, timezone

from config.plans import PLAN_TUTOR, PLAN_SCHOOL
from models import (
    Teacher,
    PromoReferral,
    PromoRewardConfig,
    PromoRewardEvent,
    CreditPackage,
)
from services.promo_code_service import create_personal_code_for_teacher, bind_referral
from services.promo_reward_service import (
    dispatch_signup_rewards,
    dispatch_subscription_reward,
    dispatch_credit_package_reward,
)


def _make_teacher(db, email):
    t = Teacher(name="T", email=email, password_hash="x")
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _seed_reward_configs(db):
    """conftest builds the schema via Base.metadata.create_all, which does not
    run the seed migration — seed the configs the engine reads."""
    defaults = [
        ("signup_verified", 10, "referrer"),
        ("subscribe_tutor", 1000, "referrer"),
        ("subscribe_school", 2000, "referrer"),
        ("package_pkg-5000", 200, "referrer"),
        ("package_pkg-10000", 500, "referrer"),
        ("package_pkg-20000", 800, "referrer"),
        ("referred_signup_bonus", 300, "referred"),
    ]
    for key, points, recipient in defaults:
        if (
            db.query(PromoRewardConfig)
            .filter(PromoRewardConfig.reward_key == key)
            .first()
            is None
        ):
            db.add(
                PromoRewardConfig(reward_key=key, points=points, recipient=recipient)
            )
    db.commit()


def _referral(db, referrer_email, referred_email):
    referrer = _make_teacher(db, referrer_email)
    referred = _make_teacher(db, referred_email)
    code = create_personal_code_for_teacher(db, referrer.id)
    referral = bind_referral(db, code.code, referred.id)
    return referrer, referred, referral


def _points_to(db, teacher_id):
    return (
        db.query(CreditPackage)
        .filter(
            CreditPackage.teacher_id == teacher_id,
            CreditPackage.source == "referral_reward",
        )
        .all()
    )


# ---------------------------------------------------------------- signup


def test_signup_rewards_grant_both_sides(test_db_session):
    _seed_reward_configs(test_db_session)
    referrer, referred, referral = _referral(
        test_db_session, "s_ref@test.com", "s_new@test.com"
    )

    dispatch_signup_rewards(test_db_session, referred.id)

    referrer_pkgs = _points_to(test_db_session, referrer.id)
    referred_pkgs = _points_to(test_db_session, referred.id)
    assert len(referrer_pkgs) == 1 and referrer_pkgs[0].points_total == 10
    assert len(referred_pkgs) == 1 and referred_pkgs[0].points_total == 300

    test_db_session.refresh(referral)
    assert referral.referred_bonus_granted is True


def test_signup_rewards_idempotent(test_db_session):
    _seed_reward_configs(test_db_session)
    referrer, referred, _ = _referral(
        test_db_session, "si_ref@test.com", "si_new@test.com"
    )
    dispatch_signup_rewards(test_db_session, referred.id)
    dispatch_signup_rewards(test_db_session, referred.id)  # second call no-ops

    assert len(_points_to(test_db_session, referrer.id)) == 1
    assert len(_points_to(test_db_session, referred.id)) == 1
    events = test_db_session.query(PromoRewardEvent).all()
    assert len(events) == 2  # signup_verified + referred_signup_bonus, once each


def test_signup_rewards_no_referral_noop(test_db_session):
    _seed_reward_configs(test_db_session)
    lone = _make_teacher(test_db_session, "lone@test.com")
    dispatch_signup_rewards(test_db_session, lone.id)
    assert test_db_session.query(PromoRewardEvent).count() == 0


# ---------------------------------------------------------------- subscription


def test_subscription_reward_tutor(test_db_session):
    _seed_reward_configs(test_db_session)
    referrer, referred, referral = _referral(
        test_db_session, "sub_ref@test.com", "sub_new@test.com"
    )
    dispatch_subscription_reward(test_db_session, referred.id, PLAN_TUTOR)

    pkgs = _points_to(test_db_session, referrer.id)
    assert len(pkgs) == 1 and pkgs[0].points_total == 1000
    test_db_session.refresh(referral)
    assert referral.first_paid_event_consumed is True


def test_subscription_reward_school(test_db_session):
    _seed_reward_configs(test_db_session)
    referrer, referred, _ = _referral(
        test_db_session, "sch_ref@test.com", "sch_new@test.com"
    )
    dispatch_subscription_reward(test_db_session, referred.id, PLAN_SCHOOL)
    pkgs = _points_to(test_db_session, referrer.id)
    assert len(pkgs) == 1 and pkgs[0].points_total == 2000


def test_unknown_plan_no_reward(test_db_session):
    _seed_reward_configs(test_db_session)
    referrer, referred, referral = _referral(
        test_db_session, "fp_ref@test.com", "fp_new@test.com"
    )
    dispatch_subscription_reward(test_db_session, referred.id, "Free Trial")
    assert len(_points_to(test_db_session, referrer.id)) == 0
    test_db_session.refresh(referral)
    assert referral.first_paid_event_consumed is False  # slot untouched


# ---------------------------------------------------------------- credit package


def test_credit_package_reward(test_db_session):
    _seed_reward_configs(test_db_session)
    referrer, referred, _ = _referral(
        test_db_session, "cp_ref@test.com", "cp_new@test.com"
    )
    dispatch_credit_package_reward(test_db_session, referred.id, "pkg-10000")
    pkgs = _points_to(test_db_session, referrer.id)
    assert len(pkgs) == 1 and pkgs[0].points_total == 500


def test_credit_package_without_reward_leaves_slot_open(test_db_session):
    _seed_reward_configs(test_db_session)
    referrer, referred, referral = _referral(
        test_db_session, "cpn_ref@test.com", "cpn_new@test.com"
    )
    # pkg-1000 has no configured reward.
    dispatch_credit_package_reward(test_db_session, referred.id, "pkg-1000")
    assert len(_points_to(test_db_session, referrer.id)) == 0
    test_db_session.refresh(referral)
    assert referral.first_paid_event_consumed is False
    # A later qualifying purchase still rewards.
    dispatch_credit_package_reward(test_db_session, referred.id, "pkg-5000")
    assert len(_points_to(test_db_session, referrer.id)) == 1


# ---------------------------------------------------------------- first-paid gate


def test_first_paid_is_mutually_exclusive(test_db_session):
    _seed_reward_configs(test_db_session)
    referrer, referred, _ = _referral(
        test_db_session, "me_ref@test.com", "me_new@test.com"
    )
    # First paid action = subscription (1000). A later package purchase must
    # NOT reward again.
    dispatch_subscription_reward(test_db_session, referred.id, PLAN_TUTOR)
    dispatch_credit_package_reward(test_db_session, referred.id, "pkg-20000")

    pkgs = _points_to(test_db_session, referrer.id)
    assert len(pkgs) == 1 and pkgs[0].points_total == 1000


def test_admin_edited_points_are_used(test_db_session):
    _seed_reward_configs(test_db_session)
    config = (
        test_db_session.query(PromoRewardConfig)
        .filter(PromoRewardConfig.reward_key == "subscribe_tutor")
        .first()
    )
    config.points = 1234  # admin override
    test_db_session.commit()

    referrer, referred, _ = _referral(
        test_db_session, "ae_ref@test.com", "ae_new@test.com"
    )
    dispatch_subscription_reward(test_db_session, referred.id, PLAN_TUTOR)
    pkgs = _points_to(test_db_session, referrer.id)
    assert len(pkgs) == 1 and pkgs[0].points_total == 1234


def test_inactive_config_skips_reward(test_db_session):
    _seed_reward_configs(test_db_session)
    config = (
        test_db_session.query(PromoRewardConfig)
        .filter(PromoRewardConfig.reward_key == "subscribe_tutor")
        .first()
    )
    config.is_active = False
    test_db_session.commit()

    referrer, referred, referral = _referral(
        test_db_session, "ia_ref@test.com", "ia_new@test.com"
    )
    dispatch_subscription_reward(test_db_session, referred.id, PLAN_TUTOR)
    assert len(_points_to(test_db_session, referrer.id)) == 0
    # No reward granted, so the first-paid slot stays open.
    test_db_session.refresh(referral)
    assert referral.first_paid_event_consumed is False


def test_reward_credit_package_has_one_year_expiry(test_db_session):
    _seed_reward_configs(test_db_session)
    referrer, referred, _ = _referral(
        test_db_session, "ex_ref@test.com", "ex_new@test.com"
    )
    dispatch_subscription_reward(test_db_session, referred.id, PLAN_TUTOR)
    pkg = _points_to(test_db_session, referrer.id)[0]
    delta_days = (pkg.expires_at - pkg.purchased_at).days
    assert 364 <= delta_days <= 366


def test_grant_failure_does_not_consume_first_paid_slot(test_db_session, monkeypatch):
    """If the grant raises, the slot claim must roll back so a retry can still
    reward (no consume-without-grant)."""
    _seed_reward_configs(test_db_session)
    referrer, referred, referral = _referral(
        test_db_session, "gf_ref@test.com", "gf_new@test.com"
    )

    import services.promo_reward_service as svc

    def _boom(*args, **kwargs):
        raise RuntimeError("simulated grant failure")

    monkeypatch.setattr(svc, "_build_reward_rows", _boom)
    dispatch_subscription_reward(test_db_session, referred.id, PLAN_TUTOR)

    test_db_session.refresh(referral)
    assert referral.first_paid_event_consumed is False  # slot rolled back
    assert len(_points_to(test_db_session, referrer.id)) == 0

    # Retry after the transient failure clears: reward is granted, slot consumed.
    monkeypatch.undo()
    dispatch_subscription_reward(test_db_session, referred.id, PLAN_TUTOR)
    test_db_session.refresh(referral)
    assert referral.first_paid_event_consumed is True
    assert len(_points_to(test_db_session, referrer.id)) == 1


# ---------------------------------------------------------------- admin report


def test_referral_report_aggregates(test_db_session):
    from routers.admin_promo_codes import build_referral_report

    _seed_reward_configs(test_db_session)
    referrer, referred, _ = _referral(
        test_db_session, "rep_ref@test.com", "rep_new@test.com"
    )
    # second referred teacher for the same referrer, verified + paid
    referred2 = _make_teacher(test_db_session, "rep_new2@test.com")
    code = (
        test_db_session.query(PromoReferral)
        .filter(PromoReferral.referrer_teacher_id == referrer.id)
        .first()
        .promo_code
    )
    bind_referral(test_db_session, code, referred2.id)

    # Mirror the real verify flow: stamp verified_at, then grant signup rewards.
    from services.promo_code_service import mark_referral_verified

    mark_referral_verified(test_db_session, referred.id)
    dispatch_signup_rewards(test_db_session, referred.id)  # +10pts
    dispatch_subscription_reward(test_db_session, referred.id, PLAN_TUTOR)  # +1000

    rows = build_referral_report(test_db_session)
    by_ref = {r.referrer_teacher_id: r for r in rows}
    row = by_ref[referrer.id]
    assert row.referral_count == 2
    assert row.verified_count == 1
    assert row.paid_count == 1
    # referrer received 10 (signup) + 1000 (subscription) = 1010
    assert row.total_points_awarded == 1010
