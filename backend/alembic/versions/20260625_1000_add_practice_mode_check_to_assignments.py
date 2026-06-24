"""Add CHECK constraint on assignments.practice_mode (#854 Stage 5)

`assignments.practice_mode` was a free String(20) with no enum and no CHECK —
any string could be persisted. This adds a whitelist CHECK matching the
canonical PracticeMode set (utils.practice_mode.ALLOWED_PRACTICE_MODES), so the
DB is the last line of defence behind the new API validation.

Verified safe on staging: the 10 distinct existing values are exactly this set
(no NULL, no legacy listening/writing). NULL would pass a CHECK anyway.

Idempotent (CLAUDE.md 鐵則): drops the constraint if present (scoped to the
assignments table via conrelid) then re-creates it, so re-runs never fail.

Revision ID: 20260625_1000
Revises: 20260623_1000
Create Date: 2026-06-25
"""
from typing import Union

from alembic import op


revision: str = "20260625_1000"
down_revision: Union[str, None] = "20260623_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint c
                JOIN pg_class cls ON c.conrelid = cls.oid
                WHERE c.conname = 'ck_assignments_practice_mode'
                  AND cls.relname = 'assignments'
            ) THEN
                ALTER TABLE assignments
                    DROP CONSTRAINT ck_assignments_practice_mode;
            END IF;

            ALTER TABLE assignments
            ADD CONSTRAINT ck_assignments_practice_mode
            CHECK (practice_mode IN (
                'reading',
                'rearrangement',
                'word_reading',
                'word_selection',
                'word_selection_quiz',
                'word_spelling',
                'word_spelling_quiz',
                'word_cloze',
                'word_cloze_quiz',
                'tug_of_war'
            ));
        END $$;
        """
    )


def downgrade() -> None:
    """No-op: forward-only migration per project policy."""
    pass
