"""Enable RLS on blog tables.

Revision ID: 20260324_1000
Revises: 20260323_1200
Create Date: 2026-03-24
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260324_1000"
down_revision = "20260323_1200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enable RLS on blog tables
    op.execute("ALTER TABLE blog_categories ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE blog_post_categories ENABLE ROW LEVEL SECURITY")

    # Blog posts and categories are public content (read by anyone)
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies WHERE policyname = 'blog_categories_select_all'
            ) THEN
                CREATE POLICY blog_categories_select_all ON blog_categories
                    FOR SELECT USING (true);
            END IF;
        END $$
        """
    )

    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies WHERE policyname = 'blog_posts_select_published'
            ) THEN
                CREATE POLICY blog_posts_select_published ON blog_posts
                    FOR SELECT USING (true);
            END IF;
        END $$
        """
    )

    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies WHERE policyname = 'blog_post_categories_select_all'
            ) THEN
                CREATE POLICY blog_post_categories_select_all ON blog_post_categories
                    FOR SELECT USING (true);
            END IF;
        END $$
        """
    )

    # Blog management by author (teachers)
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies WHERE policyname = 'blog_posts_insert_author'
            ) THEN
                CREATE POLICY blog_posts_insert_author ON blog_posts
                    FOR INSERT WITH CHECK (author_id::text = auth.uid()::text);
            END IF;
        END $$
        """
    )

    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies WHERE policyname = 'blog_posts_update_author'
            ) THEN
                CREATE POLICY blog_posts_update_author ON blog_posts
                    FOR UPDATE USING (author_id::text = auth.uid()::text);
            END IF;
        END $$
        """
    )

    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies WHERE policyname = 'blog_posts_delete_author'
            ) THEN
                CREATE POLICY blog_posts_delete_author ON blog_posts
                    FOR DELETE USING (author_id::text = auth.uid()::text);
            END IF;
        END $$
        """
    )


def downgrade() -> None:
    # No destructive operations per project migration rules
    pass
