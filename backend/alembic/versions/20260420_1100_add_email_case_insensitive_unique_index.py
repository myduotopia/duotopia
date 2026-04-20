"""Add case-insensitive unique index on teachers.email

Prevents duplicate registrations with different email casing
(e.g. Test@email.com vs test@email.com).

Revision ID: 20260420_1100
Revises: 20260420_1000
Create Date: 2026-04-20
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260420_1100"
down_revision = "20260420_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: CREATE INDEX IF NOT EXISTS
    # Case-insensitive unique index on teachers.email
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ix_teachers_email_lower
        ON teachers (LOWER(email));
    """
    )

    # Also add case-insensitive unique index on identities.email
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ix_identities_email_lower
        ON identities (LOWER(email));
    """
    )


def downgrade() -> None:
    pass
