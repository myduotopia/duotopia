"""Add ON DELETE CASCADE to practice_answers.content_item_id FK

Fixes issue #578: editing a content copy fails when practice_answers
reference the content_items being replaced.

Revision ID: 20260415_1000
Revises: 20260403_1000
Create Date: 2026-04-15
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260415_1000"
down_revision = "20260403_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: drop old FK if exists, then add with CASCADE
    op.execute(
        """
        DO $$ BEGIN
            -- Drop existing FK constraint (name may vary)
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'practice_answers_content_item_id_fkey'
            ) THEN
                ALTER TABLE practice_answers
                    DROP CONSTRAINT practice_answers_content_item_id_fkey;
            END IF;

            -- Re-add with ON DELETE CASCADE
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'practice_answers_content_item_id_fkey'
            ) THEN
                ALTER TABLE practice_answers
                    ADD CONSTRAINT practice_answers_content_item_id_fkey
                    FOREIGN KEY (content_item_id)
                    REFERENCES content_items(id)
                    ON DELETE CASCADE;
            END IF;
        END $$;
    """
    )


def downgrade() -> None:
    pass
