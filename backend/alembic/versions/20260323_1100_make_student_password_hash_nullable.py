"""Make students.password_hash nullable for SSO-only accounts.

Revision ID: 20260323_1100
Revises: 20260323_1000
Create Date: 2026-03-23
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260323_1100"
down_revision = "20260323_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: ALTER COLUMN ... DROP NOT NULL is safe to repeat
    op.execute(
        """
        ALTER TABLE students ALTER COLUMN password_hash DROP NOT NULL;
    """
    )


def downgrade() -> None:
    # Intentional no-op: making nullable→not-null could fail if NULLs exist
    pass
