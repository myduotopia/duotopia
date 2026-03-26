"""
Blog models: BlogPost, BlogCategory, BlogPostCategory
"""

from sqlalchemy import (
    Column,
    ForeignKey,
    Integer,
    String,
    DateTime,
    Boolean,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class BlogCategory(Base):
    """部落格分類"""

    __tablename__ = "blog_categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)
    slug = Column(String(50), unique=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    posts = relationship(
        "BlogPost",
        secondary="blog_post_categories",
        back_populates="categories",
    )

    def __repr__(self):
        return f"<BlogCategory {self.name}>"


class BlogPost(Base):
    """部落格文章"""

    __tablename__ = "blog_posts"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    slug = Column(String(200), unique=True, nullable=False, index=True)
    summary = Column(Text, nullable=True)
    content = Column(Text, nullable=True)
    cover_image_url = Column(String(500), nullable=True)

    # SEO fields
    meta_title = Column(String(100), nullable=True)
    meta_description = Column(String(300), nullable=True)
    og_image_url = Column(String(500), nullable=True)

    # Publishing
    is_published = Column(Boolean, default=False)
    published_at = Column(DateTime(timezone=True), nullable=True)

    # i18n
    locale = Column(String(10), nullable=False, default="zh-TW")
    linked_post_id = Column(
        Integer, ForeignKey("blog_posts.id", ondelete="SET NULL"), nullable=True
    )

    # Author
    author_id = Column(Integer, ForeignKey("teachers.id"), nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    linked_post = relationship(
        "BlogPost", remote_side=[id], foreign_keys=[linked_post_id]
    )
    author = relationship("Teacher", foreign_keys=[author_id])
    categories = relationship(
        "BlogCategory",
        secondary="blog_post_categories",
        back_populates="posts",
    )

    def __repr__(self):
        return f"<BlogPost {self.title}>"


class BlogPostCategory(Base):
    """部落格文章與分類的多對多關聯表"""

    __tablename__ = "blog_post_categories"

    post_id = Column(
        Integer,
        ForeignKey("blog_posts.id", ondelete="CASCADE"),
        primary_key=True,
    )
    category_id = Column(
        Integer,
        ForeignKey("blog_categories.id", ondelete="CASCADE"),
        primary_key=True,
    )
