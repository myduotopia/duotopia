"""Add word_selection_data JSONB column to student_item_progress

Revision ID: 20260320_1000
Revises: 20260317_1000
Create Date: 2026-03-20 10:00:00.000000

Stores cumulative word selection statistics per student per content item:
- correct_count, error_count, timeout_count
- error_selections (which wrong options were picked and how often)
- last_answered_at

This data supports future analytics in #257 (作業學生表現與能力分析報告).

Related: #451
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260320_1000"
down_revision = "20260317_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'student_item_progress'
                AND column_name = 'word_selection_data'
            ) THEN
                ALTER TABLE student_item_progress
                ADD COLUMN word_selection_data JSONB;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    pass
