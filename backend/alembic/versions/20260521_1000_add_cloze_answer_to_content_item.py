"""add_cloze_answer_to_content_items

Revision ID: 20260521_1000
Revises: 20260518_1400
Create Date: 2026-05-21 10:00:00.000000

Issue #632: persist the word-cloze answer (the actual word/phrase form that
appears in the example sentence) on each vocabulary item. Previously the
answer was extracted at runtime from the example sentence; persisting it lets
teachers override it (per assignment copy) and lets the practice endpoint use
the teacher-confirmed answer. Nullable — existing rows stay NULL and are
backfilled lazily on next save / via the toast guard (#791).
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260521_1000"
down_revision: Union[str, None] = "20260518_1400"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE content_items
        ADD COLUMN IF NOT EXISTS cloze_answer TEXT
        """
    )


def downgrade() -> None:
    # Additive-only migration policy: do not drop columns on downgrade.
    pass
