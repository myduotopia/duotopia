"""Widen email_verification_token from VARCHAR(100) to TEXT

Revision ID: 20260403_1000
Revises: 20260327_1100
Create Date: 2026-04-03
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260403_1000"
down_revision = "20260327_1100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: ALTER TYPE to TEXT is safe even if already TEXT
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'teachers'
                  AND column_name = 'email_verification_token'
                  AND data_type = 'character varying'
            ) THEN
                ALTER TABLE teachers
                    ALTER COLUMN email_verification_token TYPE TEXT;
            END IF;
        END $$;
    """
    )

    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'students'
                  AND column_name = 'email_verification_token'
                  AND data_type = 'character varying'
            ) THEN
                ALTER TABLE students
                    ALTER COLUMN email_verification_token TYPE TEXT;
            END IF;
        END $$;
    """
    )


def downgrade() -> None:
    pass
