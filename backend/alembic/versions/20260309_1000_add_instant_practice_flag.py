"""Add is_instant_practice flag to assignments

Revision ID: 20260309_1000
Revises: 20260306_1200
Create Date: 2026-03-09 10:00:00.000000

Adds is_instant_practice boolean flag to assignments table.
Instant practice assignments are temporary, created when teachers
use the "instant practice" feature to self-practice content without
assigning to students. Lazy cleanup: old instant practice assignments
are deleted when a new one is created.

Related: #255
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260309_1000"
down_revision = "20260306_1200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add is_instant_practice column (idempotent)
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'assignments' AND column_name = 'is_instant_practice') THEN
                ALTER TABLE assignments ADD COLUMN is_instant_practice BOOLEAN NOT NULL DEFAULT FALSE;
            END IF;
        END $$;
    """
    )

    # Add index for filtering out instant practice assignments in list queries (idempotent)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_assignments_not_instant_practice"
        " ON assignments (teacher_id, classroom_id)"
        " WHERE is_instant_practice = FALSE"
    )


def downgrade() -> None:
    # No-op: follows idempotent-only migration approach (see CLAUDE.md)
    pass
