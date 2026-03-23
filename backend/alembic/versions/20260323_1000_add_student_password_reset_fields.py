"""Add password reset fields to students table

Revision ID: 20260323_1000
Revises: 20260322_1000
Create Date: 2026-03-23 10:00:00.000000

Adds fields for student password reset:
- students.password_reset_token: Token for password reset
- students.password_reset_sent_at: Timestamp when reset email was sent
- students.password_reset_expires_at: Token expiry timestamp

Related: #486
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260323_1000"
down_revision = "20260322_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- students table: add password reset fields ---
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'students'
                AND column_name = 'password_reset_token'
            ) THEN
                ALTER TABLE students ADD COLUMN password_reset_token VARCHAR(100) DEFAULT NULL;
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'students'
                AND column_name = 'password_reset_sent_at'
            ) THEN
                ALTER TABLE students ADD COLUMN password_reset_sent_at TIMESTAMPTZ DEFAULT NULL;
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'students'
                AND column_name = 'password_reset_expires_at'
            ) THEN
                ALTER TABLE students ADD COLUMN password_reset_expires_at TIMESTAMPTZ DEFAULT NULL;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    pass
