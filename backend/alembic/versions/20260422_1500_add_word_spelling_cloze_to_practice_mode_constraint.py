"""Add word_spelling and word_cloze to check_practice_mode constraint

The practice_sessions table has a CHECK constraint on practice_mode.
Issue #262 introduces two new modes (word_spelling, word_cloze) that
must be allowed by the constraint.

Idempotent: safely re-creates the constraint with the full set of
known practice modes regardless of current state.

Revision ID: 20260422_1500
Revises: 20260422_1200
Create Date: 2026-04-22
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = "20260422_1500"
down_revision = "20260422_1200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Re-create check_practice_mode with word_spelling/word_cloze included."""
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
                'word_reading',
                'word_spelling',
                'word_cloze',
                'rearrangement',
                'tug_of_war'
            ));
        END $$;
        """
    )


def downgrade() -> None:
    """Revert to the previous set (all modes minus word_spelling/word_cloze).

    The pre-migration set already included word_reading, rearrangement, and
    tug_of_war (rows with those values exist in staging/prod), so reverting
    to a narrower set would fail the ADD CONSTRAINT check.
    """
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
                'word_reading',
                'rearrangement',
                'tug_of_war'
            ));
        END $$;
        """
    )
