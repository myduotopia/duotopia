"""Add promo code / referral tables (issue #637)

Revision ID: 20260525_1000
Revises: 20260522_1000
Create Date: 2026-05-25 10:00:00

Creates the four data-layer tables for the Promo Code referral system:

- promo_codes          每位老師的推銷碼（個人預設碼 + admin 特約碼）
- promo_referrals      被推薦人 ↔ 推薦人綁定（一個被推薦人僅一筆）
- promo_reward_configs admin 可調整的各事件獎勵點數（seed 7 筆預設）
- promo_reward_events  已發放紀錄，idempotency_key 防重複發放

All statements are idempotent (CREATE ... IF NOT EXISTS / ON CONFLICT)
so the migration is safe to re-run across develop / staging / production.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260525_1000"
down_revision: Union[str, None] = "20260522_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---- promo_codes -------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS promo_codes (
            id SERIAL PRIMARY KEY,
            code VARCHAR(16) NOT NULL,
            teacher_id INTEGER NOT NULL
                REFERENCES teachers(id) ON DELETE CASCADE,
            kind VARCHAR(16) NOT NULL DEFAULT 'personal',
            expires_at TIMESTAMPTZ,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            note TEXT,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ,
            admin_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
            admin_reason TEXT,
            admin_metadata JSONB
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_promo_codes_code " "ON promo_codes (code)"
    )
    # One personal code per teacher; affiliate codes are unconstrained.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_codes_teacher_personal "
        "ON promo_codes (teacher_id) WHERE kind = 'personal'"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_promo_codes_teacher_id "
        "ON promo_codes (teacher_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_promo_codes_active_expires "
        "ON promo_codes (is_active, expires_at)"
    )

    # ---- promo_referrals ---------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS promo_referrals (
            id SERIAL PRIMARY KEY,
            referrer_teacher_id INTEGER NOT NULL
                REFERENCES teachers(id) ON DELETE CASCADE,
            referred_teacher_id INTEGER NOT NULL
                REFERENCES teachers(id) ON DELETE CASCADE,
            promo_code VARCHAR(16) NOT NULL,
            promo_code_id INTEGER
                REFERENCES promo_codes(id) ON DELETE SET NULL,
            signup_at TIMESTAMPTZ DEFAULT now(),
            verified_at TIMESTAMPTZ,
            first_paid_event_consumed BOOLEAN NOT NULL DEFAULT FALSE,
            referred_bonus_granted BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ,
            CONSTRAINT uq_promo_referrals_referred_teacher
                UNIQUE (referred_teacher_id),
            CONSTRAINT ck_promo_referrals_no_self_referral
                CHECK (referrer_teacher_id != referred_teacher_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_promo_referrals_referrer "
        "ON promo_referrals (referrer_teacher_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_promo_referrals_promo_code "
        "ON promo_referrals (promo_code)"
    )

    # ---- promo_reward_configs ----------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS promo_reward_configs (
            id SERIAL PRIMARY KEY,
            reward_key VARCHAR(64) NOT NULL,
            points INTEGER NOT NULL,
            recipient VARCHAR(16) NOT NULL DEFAULT 'referrer',
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            updated_at TIMESTAMPTZ DEFAULT now(),
            updated_by_admin_id INTEGER
                REFERENCES teachers(id) ON DELETE SET NULL
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_promo_reward_configs_reward_key "
        "ON promo_reward_configs (reward_key)"
    )
    # Seed default reward values. ON CONFLICT keeps existing admin edits.
    op.execute(
        """
        INSERT INTO promo_reward_configs (reward_key, points, recipient) VALUES
            ('signup_verified', 10, 'referrer'),
            ('subscribe_tutor', 1000, 'referrer'),
            ('subscribe_school', 2000, 'referrer'),
            ('package_pkg-5000', 200, 'referrer'),
            ('package_pkg-10000', 500, 'referrer'),
            ('package_pkg-20000', 800, 'referrer'),
            ('referred_signup_bonus', 300, 'referred')
        ON CONFLICT (reward_key) DO NOTHING
        """
    )

    # ---- promo_reward_events -----------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS promo_reward_events (
            id SERIAL PRIMARY KEY,
            referral_id INTEGER NOT NULL
                REFERENCES promo_referrals(id) ON DELETE CASCADE,
            reward_key VARCHAR(64) NOT NULL,
            trigger_type VARCHAR(32) NOT NULL,
            points INTEGER NOT NULL,
            granted_to_teacher_id INTEGER NOT NULL
                REFERENCES teachers(id) ON DELETE CASCADE,
            credit_package_id INTEGER
                REFERENCES credit_packages(id) ON DELETE SET NULL,
            idempotency_key VARCHAR(128) NOT NULL,
            event_payload JSONB,
            created_at TIMESTAMPTZ DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_promo_reward_events_idempotency_key "
        "ON promo_reward_events (idempotency_key)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_promo_reward_events_granted_to "
        "ON promo_reward_events (granted_to_teacher_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_promo_reward_events_referral "
        "ON promo_reward_events (referral_id)"
    )


def downgrade() -> None:
    # Intentional no-op: dropping these tables would lose referral history
    # and granted-reward audit trail. Leaving them in place is harmless.
    pass
