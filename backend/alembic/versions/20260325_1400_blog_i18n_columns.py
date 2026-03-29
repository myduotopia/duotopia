"""Add locale and linked_post_id to blog_posts for i18n support

Revision ID: 20260325_1400
Revises: 20260323_1200
Create Date: 2026-03-25
"""

from alembic import op

revision = "20260325_1400"
down_revision = "20260323_1200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add locale column with default 'zh-TW'
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'blog_posts' AND column_name = 'locale') THEN
                ALTER TABLE blog_posts ADD COLUMN locale VARCHAR(10) NOT NULL DEFAULT 'zh-TW';
            END IF;
        END $$;
        """
    )

    # Add linked_post_id column (FK to self)
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'blog_posts' AND column_name = 'linked_post_id') THEN
                ALTER TABLE blog_posts ADD COLUMN linked_post_id INTEGER;
            END IF;
        END $$;
        """
    )

    # Add FK constraint
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_blog_posts_linked_post') THEN
                ALTER TABLE blog_posts
                    ADD CONSTRAINT fk_blog_posts_linked_post
                    FOREIGN KEY (linked_post_id) REFERENCES blog_posts(id) ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )

    # Add index on locale for filtering
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_blog_posts_locale ON blog_posts (locale)"
    )

    # Add index on linked_post_id
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_blog_posts_linked_post ON blog_posts (linked_post_id)"
    )


def downgrade() -> None:
    pass
