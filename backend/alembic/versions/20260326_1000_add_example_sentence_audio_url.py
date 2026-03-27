"""Add example_sentence_audio_url to content_items

Revision ID: 20260326_1000
"""

from alembic import op

revision = "20260326_1000"
down_revision = "20260325_1400"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add example_sentence_audio_url column (idempotent)
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'content_items'
                          AND column_name = 'example_sentence_audio_url') THEN
                ALTER TABLE content_items ADD COLUMN example_sentence_audio_url TEXT;
            END IF;
        END $$;
    """
    )


def downgrade() -> None:
    pass
