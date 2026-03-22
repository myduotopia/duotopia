"""Add start_date column to assignments table

Revision ID: 20260321_1000
Revises: 20260320_1100
Create Date: 2026-03-21
"""

from alembic import op

revision = "20260321_1000"
down_revision = "20260320_1100"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'assignments' AND column_name = 'start_date') THEN
                ALTER TABLE assignments ADD COLUMN start_date TIMESTAMPTZ NULL;
            END IF;
        END $$;
    """
    )


def downgrade():
    # Intentional no-op: column is nullable and harmless to keep
    pass
