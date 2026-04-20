"""Add one_campus_uuid field to identities table

Revision ID: 20260420_1000
Revises: 20260415_1000
Create Date: 2026-04-20 10:00:00.000000

Adds one_campus_uuid for OAuth-based 1Campus SSO matching.
The uuid is returned by auth.ischool.com.tw/services/me.php.

Related: #634
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260420_1000"
down_revision = "20260415_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'identities'
                AND column_name = 'one_campus_uuid'
            ) THEN
                ALTER TABLE identities
                ADD COLUMN one_campus_uuid VARCHAR(100);
            END IF;
        END $$;
        """
    )

    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_identities_one_campus_uuid "
        "ON identities (one_campus_uuid) WHERE one_campus_uuid IS NOT NULL"
    )


def downgrade() -> None:
    pass
