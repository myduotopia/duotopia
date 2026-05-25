"""
PR 1 (issue #637) — Promo Code data-layer tests.

Covers the four new tables and the code-generation service. No reward
dispatch or API behaviour here (those land in later PRs); this only proves
the schema, constraints, defaults, and the collision-free code generator.
"""

import pytest
from sqlalchemy.exc import IntegrityError

from models import (
    Teacher,
    PromoCode,
    PromoReferral,
    PromoRewardConfig,
    PromoRewardEvent,
)
from services.promo_code_service import (
    generate_unique_code,
    create_personal_code_for_teacher,
    CODE_ALPHABET,
    CODE_LENGTH,
)


def _make_teacher(db, email):
    teacher = Teacher(name="T", email=email, password_hash="x")
    db.add(teacher)
    db.commit()
    db.refresh(teacher)
    return teacher


# ---------------------------------------------------------------- generator


def test_code_alphabet_excludes_ambiguous_chars():
    assert CODE_LENGTH == 8
    for ch in "01OIL":
        assert ch not in CODE_ALPHABET


def test_generate_unique_code_uses_alphabet(test_db_session):
    code = generate_unique_code(test_db_session)
    assert len(code) == CODE_LENGTH
    assert all(c in CODE_ALPHABET for c in code)


def test_generate_unique_code_retries_on_collision(test_db_session, monkeypatch):
    teacher = _make_teacher(test_db_session, "collide@test.com")
    # Seed an existing code, force the RNG to emit it once, then a fresh one.
    existing = create_personal_code_for_teacher(test_db_session, teacher.id)

    seq = iter([existing.code, "AAAA2222"])
    monkeypatch.setattr("services.promo_code_service._random_code", lambda: next(seq))
    new_code = generate_unique_code(test_db_session)
    assert new_code == "AAAA2222"


# ---------------------------------------------------------------- PromoCode


def test_create_personal_code_is_idempotent(test_db_session):
    teacher = _make_teacher(test_db_session, "idem@test.com")
    first = create_personal_code_for_teacher(test_db_session, teacher.id)
    second = create_personal_code_for_teacher(test_db_session, teacher.id)
    assert first.id == second.id
    codes = (
        test_db_session.query(PromoCode)
        .filter(PromoCode.teacher_id == teacher.id, PromoCode.kind == "personal")
        .all()
    )
    assert len(codes) == 1


def test_personal_code_defaults(test_db_session):
    teacher = _make_teacher(test_db_session, "defaults@test.com")
    code = create_personal_code_for_teacher(test_db_session, teacher.id)
    assert code.kind == "personal"
    assert code.expires_at is None  # NULL = permanent
    assert code.is_active is True


def test_promo_code_unique_code(test_db_session):
    t1 = _make_teacher(test_db_session, "u1@test.com")
    t2 = _make_teacher(test_db_session, "u2@test.com")
    test_db_session.add(PromoCode(code="DUP12345", teacher_id=t1.id, kind="personal"))
    test_db_session.commit()
    test_db_session.add(PromoCode(code="DUP12345", teacher_id=t2.id, kind="affiliate"))
    with pytest.raises(IntegrityError):
        test_db_session.commit()
    test_db_session.rollback()


# ---------------------------------------------------------------- Referral


def test_referral_one_per_referred_teacher(test_db_session):
    referrer = _make_teacher(test_db_session, "ref@test.com")
    referred = _make_teacher(test_db_session, "new@test.com")
    test_db_session.add(
        PromoReferral(
            referrer_teacher_id=referrer.id,
            referred_teacher_id=referred.id,
            promo_code="ABCD2345",
        )
    )
    test_db_session.commit()
    # Second referral for the same referred teacher must fail.
    test_db_session.add(
        PromoReferral(
            referrer_teacher_id=referrer.id,
            referred_teacher_id=referred.id,
            promo_code="WXYZ6789",
        )
    )
    with pytest.raises(IntegrityError):
        test_db_session.commit()
    test_db_session.rollback()


def test_referral_cannot_refer_self(test_db_session):
    teacher = _make_teacher(test_db_session, "self@test.com")
    test_db_session.add(
        PromoReferral(
            referrer_teacher_id=teacher.id,
            referred_teacher_id=teacher.id,
            promo_code="SELF2345",
        )
    )
    with pytest.raises(IntegrityError):
        test_db_session.commit()
    test_db_session.rollback()


def test_referral_flags_default_false(test_db_session):
    referrer = _make_teacher(test_db_session, "r2@test.com")
    referred = _make_teacher(test_db_session, "n2@test.com")
    referral = PromoReferral(
        referrer_teacher_id=referrer.id,
        referred_teacher_id=referred.id,
        promo_code="FLAG2345",
    )
    test_db_session.add(referral)
    test_db_session.commit()
    test_db_session.refresh(referral)
    assert referral.first_paid_event_consumed is False
    assert referral.referred_bonus_granted is False
    assert referral.verified_at is None


# ---------------------------------------------------------------- RewardConfig


EXPECTED_DEFAULTS = {
    "signup_verified": (10, "referrer"),
    "subscribe_tutor": (1000, "referrer"),
    "subscribe_school": (2000, "referrer"),
    "package_pkg-5000": (200, "referrer"),
    "package_pkg-10000": (500, "referrer"),
    "package_pkg-20000": (800, "referrer"),
    "referred_signup_bonus": (300, "referred"),
}


def test_reward_config_seed_defaults():
    from services.promo_code_service import DEFAULT_REWARD_CONFIGS

    seeded = {
        c["reward_key"]: (c["points"], c["recipient"]) for c in DEFAULT_REWARD_CONFIGS
    }
    assert seeded == EXPECTED_DEFAULTS


def test_reward_config_unique_key(test_db_session):
    test_db_session.add(PromoRewardConfig(reward_key="signup_verified", points=10))
    test_db_session.commit()
    test_db_session.add(PromoRewardConfig(reward_key="signup_verified", points=99))
    with pytest.raises(IntegrityError):
        test_db_session.commit()
    test_db_session.rollback()


# ---------------------------------------------------------------- RewardEvent


def test_reward_event_idempotency_key_unique(test_db_session):
    referrer = _make_teacher(test_db_session, "re@test.com")
    referred = _make_teacher(test_db_session, "rd@test.com")
    referral = PromoReferral(
        referrer_teacher_id=referrer.id,
        referred_teacher_id=referred.id,
        promo_code="EVNT2345",
    )
    test_db_session.add(referral)
    test_db_session.commit()
    test_db_session.refresh(referral)

    key = f"{referral.id}:signup_verified"
    test_db_session.add(
        PromoRewardEvent(
            referral_id=referral.id,
            reward_key="signup_verified",
            trigger_type="signup",
            points=10,
            granted_to_teacher_id=referrer.id,
            idempotency_key=key,
        )
    )
    test_db_session.commit()
    test_db_session.add(
        PromoRewardEvent(
            referral_id=referral.id,
            reward_key="signup_verified",
            trigger_type="signup",
            points=10,
            granted_to_teacher_id=referrer.id,
            idempotency_key=key,
        )
    )
    with pytest.raises(IntegrityError):
        test_db_session.commit()
    test_db_session.rollback()
