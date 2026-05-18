"""Add admin audit columns to credit_packages

Revision ID: 20260518_1400
Revises: 20260518_1000
Create Date: 2026-05-18 14:00:00

Adds `admin_id`, `admin_reason`, `admin_metadata` to `credit_packages`
so the upcoming admin CRUD endpoints (edit / refund per-teacher credit
package instances, issue #723) can record who changed what and why.

Mirrors the audit pattern already present on `subscription_periods`.

Migration is idempotent: safe to re-run.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260518_1400"
down_revision: Union[str, None] = "20260518_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # admin_id: FK to teachers, SET NULL on teacher delete so audit row
    # outlives a deleted admin account.
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'credit_packages' AND column_name = 'admin_id'
            ) THEN
                ALTER TABLE credit_packages ADD COLUMN admin_id INTEGER;
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'fk_credit_packages_admin_id'
            ) THEN
                ALTER TABLE credit_packages
                ADD CONSTRAINT fk_credit_packages_admin_id
                FOREIGN KEY (admin_id)
                REFERENCES teachers(id) ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )

    # Partial index on the FK so admin-audit joins don't seq-scan. Most
    # rows have NULL admin_id (purchases without admin involvement), so
    # the partial index stays compact.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_credit_packages_admin_id "
        "ON credit_packages (admin_id) "
        "WHERE admin_id IS NOT NULL"
    )

    # admin_reason: free-text note attached to the most recent admin write
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'credit_packages'
                AND column_name = 'admin_reason'
            ) THEN
                ALTER TABLE credit_packages ADD COLUMN admin_reason TEXT;
            END IF;
        END $$;
        """
    )

    # admin_metadata: JSONB accumulating full change history. Use JSONB
    # (not JSON) to match the SubscriptionPeriod pattern and to allow
    # future indexed lookups inside the JSON.
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'credit_packages'
                AND column_name = 'admin_metadata'
            ) THEN
                ALTER TABLE credit_packages ADD COLUMN admin_metadata JSONB;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # Intentional no-op: dropping these columns would lose admin audit
    # history (the whole reason they exist). If we ever need to rollback,
    # leaving the columns in place is harmless — downstream code tolerates
    # NULLs for all three.
    pass
