"""Add credit_package_definitions table for admin-editable overrides

Revision ID: 20260518_1000
Revises: 20260513_1700
Create Date: 2026-05-18 10:00:00

Package IDs (pkg-1000 / pkg-2000 / pkg-5000 / pkg-10000 / pkg-20000)
remain code constants in `backend/config/plans.py::CREDIT_PACKAGES`.
This table stores per-package overrides for `points`, `bonus`, `price`,
plus `is_active`, `org_allowed`, and ordering, so admins can adjust
them from the admin console without a deploy.

`org_allowed` replaces the legacy `ORG_ALLOWED_PACKAGES` constant
(currently `["pkg-20000"]`); seed accordingly.

Validity period intentionally stays a single global constant
(`CREDIT_PACKAGE_VALIDITY_DAYS`); per-package validity is out of scope.

Migration is idempotent: safe to re-run.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260518_1000"
down_revision: Union[str, None] = "20260513_1700"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create table (idempotent)
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS credit_package_definitions (
            id SERIAL PRIMARY KEY,
            package_id VARCHAR(50) NOT NULL UNIQUE,
            points INTEGER,
            bonus INTEGER,
            price INTEGER,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            org_allowed BOOLEAN NOT NULL DEFAULT FALSE,
            display_order INTEGER NOT NULL DEFAULT 0,
            updated_by_admin_id INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    # NOTE: no explicit index on package_id — the UNIQUE constraint above
    # already creates one. Adding a second would be redundant.

    # FK to teachers (admin who last edited). Add after table creation so
    # re-running detects existing constraint.
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'fk_credit_package_definitions_updated_by_admin'
            ) THEN
                ALTER TABLE credit_package_definitions
                ADD CONSTRAINT fk_credit_package_definitions_updated_by_admin
                FOREIGN KEY (updated_by_admin_id)
                REFERENCES teachers(id) ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )

    # Index on the FK column. Postgres doesn't auto-index FK columns, so
    # admin-audit joins (CreditPackageDefinition → Teacher) would otherwise
    # seq-scan. Partial index keeps it tight given most rows have NULL here.
    op.execute(
        "CREATE INDEX IF NOT EXISTS "
        "idx_credit_package_definitions_updated_by_admin_id "
        "ON credit_package_definitions (updated_by_admin_id) "
        "WHERE updated_by_admin_id IS NOT NULL"
    )

    # DB-level trigger to refresh updated_at on every UPDATE, including
    # raw-SQL writes (e.g. Supabase dashboard) that bypass SQLAlchemy's
    # ORM-only `onupdate=func.now()`. Function uses CREATE OR REPLACE;
    # trigger is dropped + re-created so the migration stays idempotent.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION set_credit_package_definitions_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = now();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        "DROP TRIGGER IF EXISTS trg_credit_package_definitions_updated_at "
        "ON credit_package_definitions"
    )
    op.execute(
        """
        CREATE TRIGGER trg_credit_package_definitions_updated_at
        BEFORE UPDATE ON credit_package_definitions
        FOR EACH ROW
        EXECUTE FUNCTION set_credit_package_definitions_updated_at();
        """
    )

    # Seed default packages from config constants. ON CONFLICT keeps
    # existing rows untouched so re-running won't overwrite admin edits.
    # `org_allowed = TRUE` only for pkg-20000 (matches legacy
    # ORG_ALLOWED_PACKAGES = ["pkg-20000"]).
    op.execute(
        """
        INSERT INTO credit_package_definitions
            (package_id, points, bonus, price, is_active, org_allowed, display_order)
        VALUES
            ('pkg-1000',   1000,  0,   180,  TRUE, FALSE, 1),
            ('pkg-2000',   2000,  0,   320,  TRUE, FALSE, 2),
            ('pkg-5000',   5000,  200, 700,  TRUE, FALSE, 3),
            ('pkg-10000',  10000, 500, 1200, TRUE, FALSE, 4),
            ('pkg-20000',  20000, 800, 2000, TRUE, TRUE,  5)
        ON CONFLICT (package_id) DO NOTHING
        """
    )


def downgrade() -> None:
    # Intentional no-op: dropping the table would lose admin-edited values
    # and break running services that read overrides via
    # get_credit_package_config().
    pass
