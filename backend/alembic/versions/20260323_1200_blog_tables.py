"""Add blog_posts, blog_categories, blog_post_categories tables.

Revision ID: 20260323_1200
Revises: 20260323_1100
Create Date: 2026-03-23
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260323_1200"
down_revision = "20260323_1100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS blog_categories (
            id SERIAL PRIMARY KEY,
            name VARCHAR(50) UNIQUE NOT NULL,
            slug VARCHAR(50) UNIQUE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS blog_posts (
            id SERIAL PRIMARY KEY,
            title VARCHAR(200) NOT NULL,
            slug VARCHAR(200) UNIQUE NOT NULL,
            summary TEXT,
            content TEXT,
            cover_image_url VARCHAR(500),
            meta_title VARCHAR(100),
            meta_description VARCHAR(300),
            og_image_url VARCHAR(500),
            is_published BOOLEAN DEFAULT false,
            published_at TIMESTAMP WITH TIME ZONE,
            author_id INTEGER REFERENCES teachers(id),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS blog_post_categories (
            post_id INTEGER REFERENCES blog_posts(id)
                ON DELETE CASCADE,
            category_id INTEGER REFERENCES blog_categories(id)
                ON DELETE CASCADE,
            PRIMARY KEY (post_id, category_id)
        )
        """
    )

    # Indexes
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_blog_posts_slug "
        "ON blog_posts (slug)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_blog_posts_published "
        "ON blog_posts (is_published, published_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_blog_posts_author "
        "ON blog_posts (author_id)"
    )


def downgrade() -> None:
    # No destructive operations per project migration rules
    pass
