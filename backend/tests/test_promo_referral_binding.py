"""
PR 2 (issue #637) — referral binding at registration + verify-time stamping.

Backend only: validates promo code, binds the referral, and stamps
verified_at on email verification. No point granting here (that lands in
PR 3); these tests assert binding behaviour and edge cases.
"""

from datetime import datetime, timedelta, timezone

from models import Teacher, PromoCode, PromoReferral
from services.promo_code_service import (
    create_personal_code_for_teacher,
    validate_promo_code,
    bind_referral,
    mark_referral_verified,
)


def _make_teacher(db, email):
    t = Teacher(name="T", email=email, password_hash="x")
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


# ------------------------------------------------------------ validate_promo_code


def test_validate_active_code(test_db_session):
    teacher = _make_teacher(test_db_session, "v1@test.com")
    code = create_personal_code_for_teacher(test_db_session, teacher.id)
    found = validate_promo_code(test_db_session, code.code)
    assert found is not None
    assert found.id == code.id


def test_validate_is_case_insensitive(test_db_session):
    teacher = _make_teacher(test_db_session, "v2@test.com")
    code = create_personal_code_for_teacher(test_db_session, teacher.id)
    assert validate_promo_code(test_db_session, code.code.lower()) is not None
    assert validate_promo_code(test_db_session, f"  {code.code}  ") is not None


def test_validate_none_and_empty(test_db_session):
    assert validate_promo_code(test_db_session, None) is None
    assert validate_promo_code(test_db_session, "") is None
    assert validate_promo_code(test_db_session, "   ") is None


def test_validate_unknown_code(test_db_session):
    assert validate_promo_code(test_db_session, "NOTACODE") is None


def test_validate_inactive_code(test_db_session):
    teacher = _make_teacher(test_db_session, "v3@test.com")
    code = create_personal_code_for_teacher(test_db_session, teacher.id)
    code.is_active = False
    test_db_session.commit()
    assert validate_promo_code(test_db_session, code.code) is None


def test_validate_expired_code(test_db_session):
    teacher = _make_teacher(test_db_session, "v4@test.com")
    test_db_session.add(
        PromoCode(
            code="EXPIRED2",
            teacher_id=teacher.id,
            kind="affiliate",
            expires_at=datetime.now(timezone.utc) - timedelta(days=1),
        )
    )
    test_db_session.commit()
    assert validate_promo_code(test_db_session, "EXPIRED2") is None


def test_validate_future_expiry_is_valid(test_db_session):
    teacher = _make_teacher(test_db_session, "v5@test.com")
    test_db_session.add(
        PromoCode(
            code="FUTURE22",
            teacher_id=teacher.id,
            kind="affiliate",
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
        )
    )
    test_db_session.commit()
    assert validate_promo_code(test_db_session, "FUTURE22") is not None


# ------------------------------------------------------------ bind_referral


def test_bind_referral_success(test_db_session):
    referrer = _make_teacher(test_db_session, "ref@test.com")
    referred = _make_teacher(test_db_session, "new@test.com")
    code = create_personal_code_for_teacher(test_db_session, referrer.id)

    referral = bind_referral(test_db_session, code.code, referred.id)
    assert referral is not None
    assert referral.referrer_teacher_id == referrer.id
    assert referral.referred_teacher_id == referred.id
    assert referral.promo_code == code.code
    assert referral.promo_code_id == code.id
    assert referral.verified_at is None


def test_bind_referral_invalid_code_returns_none(test_db_session):
    referred = _make_teacher(test_db_session, "n2@test.com")
    assert bind_referral(test_db_session, "NOPE", referred.id) is None
    assert bind_referral(test_db_session, None, referred.id) is None
    # No referral row was created.
    assert (
        test_db_session.query(PromoReferral)
        .filter(PromoReferral.referred_teacher_id == referred.id)
        .count()
        == 0
    )


def test_bind_referral_rejects_self_referral(test_db_session):
    teacher = _make_teacher(test_db_session, "selfref@test.com")
    code = create_personal_code_for_teacher(test_db_session, teacher.id)
    assert bind_referral(test_db_session, code.code, teacher.id) is None


def test_bind_referral_idempotent_when_already_bound(test_db_session):
    r1 = _make_teacher(test_db_session, "r1@test.com")
    r2 = _make_teacher(test_db_session, "r2@test.com")
    referred = _make_teacher(test_db_session, "bound@test.com")
    code1 = create_personal_code_for_teacher(test_db_session, r1.id)
    code2 = create_personal_code_for_teacher(test_db_session, r2.id)

    first = bind_referral(test_db_session, code1.code, referred.id)
    # A second attempt with a different code must NOT rebind; returns existing.
    second = bind_referral(test_db_session, code2.code, referred.id)
    assert first.id == second.id
    assert second.referrer_teacher_id == r1.id
    assert (
        test_db_session.query(PromoReferral)
        .filter(PromoReferral.referred_teacher_id == referred.id)
        .count()
        == 1
    )


# ------------------------------------------------------------ mark_referral_verified


def test_mark_referral_verified_sets_timestamp(test_db_session):
    referrer = _make_teacher(test_db_session, "mv1@test.com")
    referred = _make_teacher(test_db_session, "mv2@test.com")
    code = create_personal_code_for_teacher(test_db_session, referrer.id)
    bind_referral(test_db_session, code.code, referred.id)

    referral = mark_referral_verified(test_db_session, referred.id)
    assert referral is not None
    assert referral.verified_at is not None


def test_mark_referral_verified_idempotent(test_db_session):
    referrer = _make_teacher(test_db_session, "mv3@test.com")
    referred = _make_teacher(test_db_session, "mv4@test.com")
    code = create_personal_code_for_teacher(test_db_session, referrer.id)
    bind_referral(test_db_session, code.code, referred.id)

    first = mark_referral_verified(test_db_session, referred.id)
    first_ts = first.verified_at
    second = mark_referral_verified(test_db_session, referred.id)
    assert second.verified_at == first_ts  # unchanged on second call


def test_mark_referral_verified_no_referral(test_db_session):
    teacher = _make_teacher(test_db_session, "noref@test.com")
    assert mark_referral_verified(test_db_session, teacher.id) is None
