"""Make assignment classroom_id nullable for instant practice without classroom

Revision ID: 20260320_1100
Revises: 20260320_1000
Create Date: 2026-03-20
"""

from alembic import op

revision = "20260320_1100"
down_revision = "20260320_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Make classroom_id nullable so instant practice can work without a classroom
    op.execute(
        """
        DO $$ BEGIN
            ALTER TABLE assignments ALTER COLUMN classroom_id DROP NOT NULL;
        EXCEPTION
            WHEN others THEN NULL;
        END $$;
    """
    )


def downgrade() -> None:
    pass
