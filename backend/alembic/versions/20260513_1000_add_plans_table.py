"""Add plans table for admin-editable price/quota overrides

Revision ID: 20260513_1000
Revises: 20260509_1300
Create Date: 2026-05-13 10:00:00

Plan names remain code constants in `backend/config/plans.py`. This table
stores per-plan overrides for `price` and `quota`, plus an `is_active`
flag and ordering, so admins can adjust them from the admin console
without a deploy.

Migration is idempotent: safe to re-run.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260513_1000"
down_revision: Union[str, None] = "20260509_1300"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create plans table (idempotent)
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS plans (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL UNIQUE,
            price INTEGER,
            quota INTEGER,
            display_order INTEGER NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            updated_by_admin_id INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    # Index on name (created automatically by UNIQUE, but make it explicit)
    op.execute("CREATE INDEX IF NOT EXISTS ix_plans_name ON plans (name)")

    # FK to teachers (admin who last edited). Created after table so the
    # check works even if FK already exists.
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_plans_updated_by_admin'
            ) THEN
                ALTER TABLE plans
                ADD CONSTRAINT fk_plans_updated_by_admin
                FOREIGN KEY (updated_by_admin_id)
                REFERENCES teachers(id) ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )

    # Seed default plans from config constants. ON CONFLICT keeps existing
    # rows untouched so re-running won't overwrite admin edits.
    op.execute(
        """
        INSERT INTO plans (name, price, quota, display_order, is_active)
        VALUES
            ('Free Trial', 0, 2000, 1, TRUE),
            ('Tutor Teachers', 299, 2000, 2, TRUE),
            ('School Teachers', 599, 6000, 3, TRUE),
            ('Demo Unlimited Plan', 0, 999999, 4, TRUE),
            ('VIP', 0, 0, 5, TRUE)
        ON CONFLICT (name) DO NOTHING
        """
    )


def downgrade() -> None:
    # Intentional no-op: dropping the table would lose admin-edited values
    # and break running services that read overrides via get_plan_price/quota.
    pass
