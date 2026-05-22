"""add_rls_to_credit_package_definitions

Revision ID: 20260522_0900
Revises: 20260521_1000
Create Date: 2026-05-22 09:00:00

The credit_package_definitions table (added in 20260518_1000) shipped
without Row Level Security. The backend deploy workflow's RLS gate
(.github/workflows/deploy-backend.yml) rejects any public table without
RLS, which blocked every staging backend deploy after the table merged —
freezing the backend image and surfacing as 404s on the #708 grade-report
endpoints (frontend deployed independently and called routes the stale
backend never had).

Like the other JWT-auth business tables, RLS here is enabled with no
policies: the backend connects as the table owner and bypasses RLS, while
the anon/authenticated Supabase roles get no access. This mirrors
20260203_1600_add_rls_to_organization_points_log.

Idempotent — safe to re-run.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260522_0900"
down_revision = "20260521_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name = 'credit_package_definitions'
                  AND table_schema = 'public'
            ) THEN
                IF NOT (
                    SELECT relrowsecurity
                    FROM pg_class
                    WHERE relname = 'credit_package_definitions'
                      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
                ) THEN
                    ALTER TABLE credit_package_definitions ENABLE ROW LEVEL SECURITY;
                END IF;
            END IF;
        END $$;
    """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name = 'credit_package_definitions'
                  AND table_schema = 'public'
            ) THEN
                ALTER TABLE credit_package_definitions DISABLE ROW LEVEL SECURITY;
            END IF;
        END $$;
    """
    )
