"""
社群發文結果記錄 model（issue #591 — Meta 發文 API）。

每次透過 Meta Graph API 發文，每個平台寫一列（發到 FB + IG → 2 列）。
記錄發文來源、送出的內容、Meta 回傳的貼文 id、成功/失敗與錯誤原因，
供稽核與 token 過期告警使用。

欄位對照 alembic migration 20260810_1000_add_social_posts.py，
型別與 nullability 必須一致（deploy 會跑 alembic check 擋 drift）。
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    DateTime,
    ForeignKey,
    Index,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class SocialPost(Base):
    """一次發文中，單一平台的發文結果紀錄。"""

    __tablename__ = "social_posts"
    __table_args__ = (
        Index("ix_social_posts_created_at", "created_at"),
        Index("ix_social_posts_source_blog_post_id", "source_blog_post_id"),
    )

    id = Column(Integer, primary_key=True, index=True)

    # 'facebook' | 'instagram'
    platform = Column(String(20), nullable=False)
    # 'blog'（轉發部落格文章）| 'manual'（後台自由貼文）
    source = Column(String(20), nullable=False)
    # 轉發來源文章；文章被刪時設為 NULL 但保留發文歷史
    source_blog_post_id = Column(
        Integer, ForeignKey("blog_posts.id", ondelete="SET NULL"), nullable=True
    )

    # Meta 回傳的貼文 id（成功時；FB feed/photo id 或 IG media id）
    external_post_id = Column(String(255), nullable=True)
    # 'success' | 'failed'
    status = Column(String(20), nullable=False)

    # 實際送出的內容
    message = Column(Text, nullable=True)
    image_url = Column(String(500), nullable=True)
    link = Column(String(500), nullable=True)

    # 失敗原因（token 過期、缺圖、rate limit、Graph API error 等）
    error = Column(Text, nullable=True)

    # 觸發發文的 admin；帳號被刪時設為 NULL
    created_by = Column(
        Integer, ForeignKey("teachers.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    source_blog_post = relationship("BlogPost", foreign_keys=[source_blog_post_id])
    creator = relationship("Teacher", foreign_keys=[created_by])

    def __repr__(self):
        return (
            f"<SocialPost id={self.id} platform={self.platform} "
            f"status={self.status}>"
        )
