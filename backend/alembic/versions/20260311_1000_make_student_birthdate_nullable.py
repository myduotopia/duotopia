"""Make student birthdate nullable

Revision ID: 20260311_1000
Revises: 20260309_1000
Create Date: 2026-03-11 10:00:00.000000

Default password is now based on join date (today's date), not birthdate.
Birthdate becomes optional - verified students can set it in their profile.

Related: #408
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260311_1000"
down_revision = "20260309_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Make birthdate column nullable (idempotent - safe to run multiple times)
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'students'
                  AND column_name = 'birthdate'
                  AND is_nullable = 'NO'
            ) THEN
                ALTER TABLE students ALTER COLUMN birthdate DROP NOT NULL;
            END IF;
        END $$;
    """
    )


def downgrade() -> None:
    pass
