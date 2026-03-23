"""Add 1Campus SSO fields to identities and oauth_identities tables

Revision ID: 20260322_1000
Revises: 20260320_1000
Create Date: 2026-03-22 10:00:00.000000

Adds fields for 1Campus SSO integration:
- identities.one_campus_student_id: 1Campus studentID for identity matching
- identities.one_campus_account: 1Campus account (e.g. dev.j.s20101@1campus.net)
- identities.national_id_hash: SHA256 hash of national ID for cross-school matching
- identities.email nullable: Allow SSO-only accounts without email
- oauth_identities.identity_id: Extend OAuth to support Identity-level linking

Related: #341
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260322_1000"
down_revision = "20260320_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- identities table: make email nullable for SSO-only accounts ---
    op.execute(
        """
        DO $$ BEGIN
            -- Allow null email for SSO-only accounts (1Campus students may not have email)
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'identities'
                AND column_name = 'email'
                AND is_nullable = 'NO'
            ) THEN
                ALTER TABLE identities ALTER COLUMN email DROP NOT NULL;
            END IF;
        END $$;
        """
    )

    # --- identities table: add 1Campus fields ---
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'identities'
                AND column_name = 'one_campus_student_id'
            ) THEN
                ALTER TABLE identities
                ADD COLUMN one_campus_student_id VARCHAR(100);
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'identities'
                AND column_name = 'one_campus_account'
            ) THEN
                ALTER TABLE identities
                ADD COLUMN one_campus_account VARCHAR(255);
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'identities'
                AND column_name = 'national_id_hash'
            ) THEN
                ALTER TABLE identities
                ADD COLUMN national_id_hash VARCHAR(64);
            END IF;
        END $$;
        """
    )

    # --- identities table: indexes ---
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_identities_one_campus_student_id "
        "ON identities (one_campus_student_id)"
    )

    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_identities_national_id_hash "
        "ON identities (national_id_hash)"
    )

    # --- oauth_identities table: add identity_id FK ---
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'oauth_identities'
                AND column_name = 'identity_id'
            ) THEN
                ALTER TABLE oauth_identities
                ADD COLUMN identity_id INTEGER;
            END IF;
        END $$;
        """
    )

    # Add FK constraint for identity_id
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'fk_oauth_identities_identity_id'
            ) THEN
                ALTER TABLE oauth_identities
                ADD CONSTRAINT fk_oauth_identities_identity_id
                FOREIGN KEY (identity_id) REFERENCES identities(id)
                ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )

    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_oauth_identity_identity "
        "ON oauth_identities (identity_id)"
    )


def downgrade() -> None:
    pass
