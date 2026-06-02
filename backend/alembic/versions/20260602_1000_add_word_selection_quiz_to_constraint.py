"""Add word_selection_quiz to check_practice_mode

Issue #833: extend the 小考 (quiz) variants to word_selection. Adds
``word_selection_quiz`` to the practice_sessions.check_practice_mode
whitelist so the upcoming application-layer changes can persist it.

Idempotent: drops the constraint if it exists and re-creates it with
the full known whitelist.

Revision ID: 20260602_1000
Revises: 20260601_1000
Create Date: 2026-06-02
"""
from typing import Union

from alembic import op


revision: str = "20260602_1000"
down_revision: Union[str, None] = "20260601_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'check_practice_mode'
                  AND conrelid = 'practice_sessions'::regclass
            ) THEN
                ALTER TABLE practice_sessions
                    DROP CONSTRAINT check_practice_mode;
            END IF;

            ALTER TABLE practice_sessions
            ADD CONSTRAINT check_practice_mode
            CHECK (practice_mode IN (
                'listening',
                'writing',
                'word_selection',
                'word_selection_quiz',
                'word_reading',
                'word_spelling',
                'word_cloze',
                'word_spelling_quiz',
                'word_cloze_quiz',
                'rearrangement',
                'tug_of_war'
            ));
        END $$;
        """
    )


def downgrade() -> None:
    """No-op: forward-only migration per project policy."""
    pass
