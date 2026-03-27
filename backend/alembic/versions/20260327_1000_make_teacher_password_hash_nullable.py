"""Make teacher password_hash nullable and add index on identities.one_campus_account.

Revision ID: 20260327_1000
Revises: 20260326_1100
Create Date: 2026-03-27
"""

from alembic import op

revision = "20260327_1000"
down_revision = "20260326_1100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Make teacher password_hash nullable for SSO-only accounts
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'teachers'
                AND column_name = 'password_hash'
                AND is_nullable = 'NO'
            ) THEN
                ALTER TABLE teachers ALTER COLUMN password_hash DROP NOT NULL;
            END IF;
        END $$;
    """
    )

    # Add index on identities.one_campus_account for teacher SSO lookup
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_identities_one_campus_account "
        "ON identities (one_campus_account)"
    )


def downgrade() -> None:
    pass
