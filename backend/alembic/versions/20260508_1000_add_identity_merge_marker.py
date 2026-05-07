"""Add merge marker fields to identities table

Revision ID: 20260508_1000
Revises: 20260429_1200
Create Date: 2026-05-08 10:00:00.000000

Adds merged_into_identity_id and merged_at to Identity for tracking bind/merge
of 1Campus SSO accounts with existing Duotopia accounts (Phase 1 of #719).

These fields allow:
1. Marking source Identities as merged (so we can find them for future migration)
2. Re-login redirect: when a uuid points to a deactivated merged Identity,
   we follow merged_into_identity_id to return the surviving user.

Related: #719
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260508_1000"
down_revision = "20260429_1200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add merged_into_identity_id column (FK to identities.id)
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'identities'
                AND column_name = 'merged_into_identity_id'
            ) THEN
                ALTER TABLE identities
                ADD COLUMN merged_into_identity_id INTEGER;
            END IF;
        END $$;
        """
    )

    # Add index on merged_into_identity_id for forward lookup
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_identities_merged_into_identity_id "
        "ON identities (merged_into_identity_id) WHERE merged_into_identity_id IS NOT NULL"
    )

    # Add FK constraint (checked first to ensure idempotency)
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'fk_identities_merged_into_identity_id'
            ) THEN
                ALTER TABLE identities
                ADD CONSTRAINT fk_identities_merged_into_identity_id
                FOREIGN KEY (merged_into_identity_id)
                REFERENCES identities(id)
                ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )

    # Add merged_at column
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'identities'
                AND column_name = 'merged_at'
            ) THEN
                ALTER TABLE identities
                ADD COLUMN merged_at TIMESTAMP WITH TIME ZONE;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # Intentionally a no-op: do not drop columns to preserve data.
    pass
