"""
Promo code service (issue #637).

PR 1 scope: collision-free code generation and idempotent creation of a
teacher's personal promo code. Reward dispatch lives in a later PR.
"""

import secrets
from sqlalchemy.orm import Session

from models import PromoCode

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
