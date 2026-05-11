"""add_recording_duration_seconds_to_student_item_progress

Revision ID: 20260429_1200
Revises: 20260428_1100
Create Date: 2026-04-29 12:00:00.000000

Issue #703: 學生錄音檔問題 (Phase A - migration only)
Add recording_duration_seconds column to student_item_progress table.
This allows the playback UI to display the recorded duration without relying on
<audio>.duration, which is broken on iOS Safari fMP4 streams.
Phase B will read/write this column from the upload endpoint and playback UI.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260429_1200"
down_revision: Union[str, None] = "20260428_1100"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'student_item_progress'
                  AND column_name = 'recording_duration_seconds'
            ) THEN
                ALTER TABLE student_item_progress
                    ADD COLUMN recording_duration_seconds INTEGER;
            END IF;
        END $$;
    """
    )


def downgrade() -> None:
    # No destructive operations per CLAUDE.md database migration rules.
    pass
