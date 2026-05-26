"""
Promo referral reward engine (issue #637, PR 3).

Grants points to the referrer (and a one-time bonus to the referred teacher)
when referral milestones fire:

- email verified         → signup_verified (referrer) + referred_signup_bonus
- first paid subscription→ subscribe_tutor / subscribe_school (referrer)
- first paid credit pack → package_pkg-5000 / -10000 / -20000 (referrer)

Subscription and credit-package rewards are mutually exclusive and fire only
on the referred teacher's FIRST paid action. That "first only" guarantee is
the ``PromoReferral.first_paid_event_consumed`` flag — whichever paid event
arrives first consumes it; there is no need to scan prior transactions.

Every grant is idempotent via ``PromoRewardEvent.idempotency_key`` so retries
and races never double-award. All entry points are non-fatal: a failure here
must never break payment, registration, or verification.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from config.plans import (
    PLAN_TUTOR,
    PLAN_SCHOOL,
    PLAN_FREE_TRIAL,
    CREDIT_PACKAGE_VALIDITY_DAYS,
)
from models import (
    PromoReferral,
    PromoRewardConfig,
    PromoRewardEvent,
    CreditPackage,
)

logger = logging.getLogger(__name__)

# Plan display name -> reward_key for paid-subscription rewards.
_PLAN_REWARD_KEYS = {
    PLAN_TUTOR: "subscribe_tutor",
    PLAN_SCHOOL: "subscribe_school",
}

_REWARD_PACKAGE_ID = "referral-reward"


def _get_referral(db: Session, referred_teacher_id: int) -> Optional[PromoReferral]:
    return (
        db.query(PromoReferral)
        .filter(PromoReferral.referred_teacher_id == referred_teacher_id)
        .first()
    )


def _recipient_teacher_id(referral: PromoReferral, recipient: str) -> int:
    if recipient == "referred":
        return referral.referred_teacher_id
    return referral.referrer_teacher_id


def _get_active_config(db: Session, reward_key: str) -> Optional[PromoRewardConfig]:
    return (
        db.query(PromoRewardConfig)
        .filter(
            PromoRewardConfig.reward_key == reward_key,
            PromoRewardConfig.is_active.is_(True),
        )
        .first()
    )


def _build_reward_rows(
    db: Session,
    referral: PromoReferral,
    reward_key: str,
    trigger_type: str,
    config: PromoRewardConfig,
    event_payload: Optional[dict] = None,
) -> PromoRewardEvent:
    """Create the CreditPackage + PromoRewardEvent in the CURRENT (uncommitted)
    transaction and return the event. The caller owns the commit, so the grant
    can be made atomic with other writes (e.g. the first-paid slot claim).
    Assumes no prior grant for this key exists (idempotency checked by caller)."""
    idempotency_key = f"{referral.id}:{reward_key}"
    recipient_id = _recipient_teacher_id(referral, config.recipient)
    now = datetime.now(timezone.utc)

    credit_package = CreditPackage(
        teacher_id=recipient_id,
        package_id=_REWARD_PACKAGE_ID,
        points_total=config.points,
        points_used=0,
        price_paid=0,
        purchased_at=now,
        expires_at=now + timedelta(days=CREDIT_PACKAGE_VALIDITY_DAYS),
        status="active",
        source="referral_reward",
        admin_metadata={
            "reward_key": reward_key,
            "referral_id": referral.id,
            "referrer_teacher_id": referral.referrer_teacher_id,
            "referred_teacher_id": referral.referred_teacher_id,
        },
    )
    db.add(credit_package)
    db.flush()  # assign credit_package.id without ending the transaction

    event = PromoRewardEvent(
        referral_id=referral.id,
        reward_key=reward_key,
        trigger_type=trigger_type,
        points=config.points,
        granted_to_teacher_id=recipient_id,
        credit_package_id=credit_package.id,
        idempotency_key=idempotency_key,
        event_payload=event_payload,
    )
    db.add(event)
    return event


def _grant_reward(
    db: Session,
    referral: PromoReferral,
    reward_key: str,
    trigger_type: str,
    event_payload: Optional[dict] = None,
) -> Optional[PromoRewardEvent]:
    """Grant the points configured for ``reward_key`` to the right teacher,
    committing on its own.

    Idempotent on ``{referral.id}:{reward_key}``: a prior grant (or a
    concurrent one losing the unique race) returns the existing event without
    awarding again. Returns None when the reward is unconfigured or inactive.
    """
    config = _get_active_config(db, reward_key)
    if config is None:
        return None

    idempotency_key = f"{referral.id}:{reward_key}"
    existing = (
        db.query(PromoRewardEvent)
        .filter(PromoRewardEvent.idempotency_key == idempotency_key)
        .first()
    )
    if existing is not None:
        return existing

    event = _build_reward_rows(
        db, referral, reward_key, trigger_type, config, event_payload
    )
    try:
        db.commit()
    except IntegrityError:
        # Concurrent grant won the unique(idempotency_key) race.
        db.rollback()
        return (
            db.query(PromoRewardEvent)
            .filter(PromoRewardEvent.idempotency_key == idempotency_key)
            .first()
        )
    db.refresh(event)
    logger.info(
        f"Referral reward granted: {reward_key} ({config.points} pts) "
        f"to teacher {event.granted_to_teacher_id} (referral {referral.id})"
    )
    return event


def dispatch_signup_rewards(db: Session, referred_teacher_id: int) -> None:
    """On email verification: stamp verified_at, then reward the referrer
    (signup_verified) and the referred teacher (referred_signup_bonus).

    verified_at is stamped and committed BEFORE granting so it can never end up
    NULL while a reward exists (which would understate the admin report's
    verified_count). Non-fatal."""
    try:
        referral = _get_referral(db, referred_teacher_id)
        if referral is None:
            return

        # Stamp verified_at first so verified_count stays consistent with grants.
        if referral.verified_at is None:
            referral.verified_at = datetime.now(timezone.utc)
            db.commit()

        _grant_reward(db, referral, "signup_verified", "signup")

        bonus = _grant_reward(db, referral, "referred_signup_bonus", "signup")
        if bonus is not None:
            # Atomic flag set: concurrent double-verify can't double-write.
            db.execute(
                update(PromoReferral)
                .where(PromoReferral.referred_teacher_id == referred_teacher_id)
                .where(PromoReferral.referred_bonus_granted.is_(False))
                .values(referred_bonus_granted=True)
            )
            db.commit()
    except Exception as e:
        db.rollback()
        logger.error(
            f"dispatch_signup_rewards failed for teacher {referred_teacher_id}: {e}"
        )


def dispatch_subscription_reward(db: Session, teacher_id: int, plan_name: str) -> None:
    """On the referred teacher's first paid subscription: reward the referrer
    based on the plan tier. Non-fatal; no-op if not their first paid action."""
    try:
        reward_key = _PLAN_REWARD_KEYS.get(plan_name)
        if reward_key is None:
            # Free Trial has no reward (expected). Any OTHER unmapped name is a
            # surprise (i18n rename / client bug) — log so it's observable.
            if plan_name not in (PLAN_FREE_TRIAL,):
                logger.warning(
                    f"No referral reward mapping for plan_name {plan_name!r} "
                    f"(teacher {teacher_id})"
                )
            return
        _dispatch_first_paid(
            db, teacher_id, reward_key, "subscription", {"plan_name": plan_name}
        )
    except Exception as e:
        db.rollback()
        logger.error(
            f"dispatch_subscription_reward failed for teacher {teacher_id}: {e}"
        )


def dispatch_credit_package_reward(
    db: Session, teacher_id: int, package_id: str
) -> None:
    """On the referred teacher's first paid credit-package purchase: reward the
    referrer based on the package. Non-fatal; no-op if not their first paid
    action or the package has no configured reward."""
    try:
        _dispatch_first_paid(
            db,
            teacher_id,
            f"package_{package_id}",
            "credit_package",
            {"package_id": package_id},
        )
    except Exception as e:
        db.rollback()
        logger.error(
            f"dispatch_credit_package_reward failed for teacher {teacher_id}: {e}"
        )


def _dispatch_first_paid(
    db: Session,
    teacher_id: int,
    reward_key: str,
    trigger_type: str,
    payload: dict,
) -> None:
    """Shared body for paid-event rewards. Consumes the one-time
    ``first_paid_event_consumed`` slot so subscription and package rewards are
    mutually exclusive and fire only once.

    The slot claim and the reward grant share ONE transaction: if the grant
    fails the claim is rolled back too (no consume-without-grant), while the
    conditional UPDATE's row lock serializes concurrent paid events so only one
    ever grants.
    """
    referral = _get_referral(db, teacher_id)
    if referral is None or referral.first_paid_event_consumed:
        return

    # Skip packages with no active reward (e.g. pkg-1000/2000) BEFORE claiming
    # the slot, so a later qualifying purchase can still reward. Pass this
    # config straight to _build_reward_rows so an admin deactivating it mid-flight
    # cannot leave the slot consumed with nothing granted.
    config = _get_active_config(db, reward_key)
    if config is None:
        return

    idempotency_key = f"{referral.id}:{reward_key}"
    if (
        db.query(PromoRewardEvent)
        .filter(PromoRewardEvent.idempotency_key == idempotency_key)
        .first()
        is not None
    ):
        return  # already granted

    try:
        # Atomically claim the one-time slot. Two concurrent paid events with
        # different reward keys would both pass the in-memory check above; this
        # conditional UPDATE (row lock) lets only one win.
        rows_updated = db.execute(
            update(PromoReferral)
            .where(PromoReferral.referred_teacher_id == teacher_id)
            .where(PromoReferral.first_paid_event_consumed.is_(False))
            .values(first_paid_event_consumed=True)
        ).rowcount
        if rows_updated == 0:
            db.rollback()
            return  # another paid event already consumed the slot

        # Grant in the SAME transaction so commit persists claim + reward together.
        _build_reward_rows(db, referral, reward_key, trigger_type, config, payload)
        db.commit()
    except IntegrityError:
        # Lost the idempotency race; rollback reverts the claim too.
        db.rollback()
        return
    logger.info(
        f"Referral reward granted: {reward_key} ({config.points} pts) "
        f"(referral {referral.id}, first paid action)"
    )
