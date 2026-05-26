"""
Promo code service (issue #637).

PR 1 scope: collision-free code generation and idempotent creation of a
teacher's personal promo code. Reward dispatch lives in a later PR.
"""

import secrets
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from models import PromoCode, PromoReferral

# Alphabet excludes ambiguous glyphs (0/O, 1/I/L) so codes read cleanly
# off a screen or printed page.
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 8
_MAX_GENERATION_ATTEMPTS = 10

# Default reward point values, seeded by the migration. `recipient` is who
# receives the points when the event fires. `package_*` keys map directly to
# config.plans.CREDIT_PACKAGES keys so the PR 3 dispatcher can look them up.
DEFAULT_REWARD_CONFIGS = [
    {"reward_key": "signup_verified", "points": 10, "recipient": "referrer"},
    {"reward_key": "subscribe_tutor", "points": 1000, "recipient": "referrer"},
    {"reward_key": "subscribe_school", "points": 2000, "recipient": "referrer"},
    {"reward_key": "package_pkg-5000", "points": 200, "recipient": "referrer"},
    {"reward_key": "package_pkg-10000", "points": 500, "recipient": "referrer"},
    {"reward_key": "package_pkg-20000", "points": 800, "recipient": "referrer"},
    {"reward_key": "referred_signup_bonus", "points": 300, "recipient": "referred"},
]


def _random_code() -> str:
    """Return a single random candidate code. Extracted so tests can patch it."""
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def generate_unique_code(db: Session) -> str:
    """Generate a code not already present in ``promo_codes``.

    Retries on collision; the keyspace (31^8 ≈ 8.5e11) makes collisions
    vanishingly rare, so a small attempt cap is plenty.
    """
    for _ in range(_MAX_GENERATION_ATTEMPTS):
        candidate = _random_code()
        exists = db.query(PromoCode.id).filter(PromoCode.code == candidate).first()
        if not exists:
            return candidate
    raise RuntimeError("Could not generate a unique promo code after retries")


def create_personal_code_for_teacher(db: Session, teacher_id: int) -> PromoCode:
    """Return the teacher's personal promo code, creating it if absent.

    Idempotent: a teacher has at most one ``kind='personal'`` code (enforced
    by a partial unique index); repeated calls return the existing row.
    """
    existing = (
        db.query(PromoCode)
        .filter(PromoCode.teacher_id == teacher_id, PromoCode.kind == "personal")
        .first()
    )
    if existing:
        return existing

    code = PromoCode(
        code=generate_unique_code(db),
        teacher_id=teacher_id,
        kind="personal",
        expires_at=None,  # permanent
        is_active=True,
    )
    db.add(code)
    db.commit()
    db.refresh(code)
    return code


def _is_expired(expires_at) -> bool:
    """NULL expiry means permanent. Tolerate naive datetimes (SQLite) by
    assuming UTC."""
    if expires_at is None:
        return False
    exp = expires_at
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    return exp < datetime.now(timezone.utc)


def validate_promo_code(db: Session, code: Optional[str]) -> Optional[PromoCode]:
    """Return an active, non-expired ``PromoCode`` matching ``code`` (case-
    insensitive), or None. Codes are stored uppercase."""
    if not code:
        return None
    normalized = code.strip().upper()
    if not normalized:
        return None
    pc = (
        db.query(PromoCode)
        .filter(PromoCode.code == normalized, PromoCode.is_active.is_(True))
        .first()
    )
    if pc is None or _is_expired(pc.expires_at):
        return None
    return pc


def bind_referral(
    db: Session, code: Optional[str], referred_teacher_id: int
) -> Optional[PromoReferral]:
    """Bind a newly registered teacher to the owner of ``code``.

    Returns the referral, or None when the binding is disqualified — invalid /
    expired code, self-referral, or the teacher is already bound (a teacher can
    only ever be referred once). Idempotent: a second call for an
    already-bound teacher returns the existing referral. Non-fatal by design
    so registration never fails because of a bad promo code.
    """
    pc = validate_promo_code(db, code)
    if pc is None:
        return None
    if pc.teacher_id == referred_teacher_id:
        return None  # cannot refer yourself

    existing = (
        db.query(PromoReferral)
        .filter(PromoReferral.referred_teacher_id == referred_teacher_id)
        .first()
    )
    if existing is not None:
        return existing

    referral = PromoReferral(
        referrer_teacher_id=pc.teacher_id,
        referred_teacher_id=referred_teacher_id,
        promo_code=pc.code,
        promo_code_id=pc.id,
    )
    db.add(referral)
    db.commit()
    db.refresh(referral)
    return referral


def mark_referral_verified(
    db: Session, referred_teacher_id: int
) -> Optional[PromoReferral]:
    """Stamp ``verified_at`` on the teacher's referral once their email is
    verified. Idempotent: only sets the timestamp the first time. Returns the
    referral, or None if the teacher has no referral."""
    referral = (
        db.query(PromoReferral)
        .filter(PromoReferral.referred_teacher_id == referred_teacher_id)
        .first()
    )
    if referral is None:
        return None
    if referral.verified_at is None:
        referral.verified_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(referral)
    return referral
