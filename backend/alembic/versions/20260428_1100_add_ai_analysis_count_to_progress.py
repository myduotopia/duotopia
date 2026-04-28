"""add_ai_analysis_count_to_student_item_progress

Revision ID: 20260428_1100
Revises: 20260428_1000
Create Date: 2026-04-28 11:00:00.000000

Issue #676 Phase 2: server-authoritative AI analysis attempt counter.
Phase 1 (issue #689) gates 3 attempts per item via localStorage on the
frontend; this column adds the same counter on the backend so DevTools
cannot bypass the limit. Default 0 — students mid-flight start fresh on
the server side; the frontend takes max(server, local) when reconciling.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260428_1100"
down_revision: Union[str, None] = "20260428_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE student_item_progress
        ADD COLUMN IF NOT EXISTS ai_analysis_count INTEGER DEFAULT 0
        """
    )


def downgrade() -> None:
    # Additive-only migration policy: do not drop columns on downgrade.
    pass
