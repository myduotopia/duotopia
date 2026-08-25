"""
更新公告 model（issue #804 — LINE 官方帳號 / 官網自動發布更新）。

每次 release 進 staging 或 production，CI 會呼叫 webhook 產生一列草稿，
內含「LINE broadcast 文案」與「官網雙語文章」兩份彼此獨立的內容。
管理者在後台編輯後，可選擇發布到 LINE、官網或兩者；兩個通道各自有狀態，
所以能先發官網、之後再補發 LINE。

未發布的舊草稿可被併入新草稿一起發（merged_into_id），避免每次 release
都消耗一次 LINE broadcast 訊息量（免費方案每月 200 則、每位好友計 1 則）。

欄位對照 alembic migration 20260824_1000_add_release_announcements.py，
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

# status（整體）
STATUS_DRAFT = "draft"
STATUS_PARTIALLY_PUBLISHED = "partially_published"
STATUS_PUBLISHED = "published"
STATUS_DISCARDED = "discarded"
STATUS_MERGED = "merged"

# line_status / website_status（單一通道）
CHANNEL_PENDING = "pending"
CHANNEL_PUBLISHED = "published"
CHANNEL_FAILED = "failed"

CHANNEL_LINE = "line"
CHANNEL_WEBSITE = "website"


class ReleaseAnnouncement(Base):
    """一次 release 對應的更新公告草稿與發布結果。"""

    __tablename__ = "release_announcements"
    __table_args__ = (
        # 同一環境的同一個 commit 只產生一次草稿（CI 重跑不會重複建立）
        Index(
            "uq_release_announcements_env_ref",
            "environment",
            "source_ref",
            unique=True,
        ),
        Index("ix_release_announcements_status", "status"),
        Index("ix_release_announcements_created_at", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)

    # 來源 release
    # 'staging' | 'production'（草稿產生於哪個環境）
    environment = Column(String(20), nullable=False)
    source_ref = Column(String(100), nullable=False)  # commit sha
    source_branch = Column(String(100), nullable=True)
    pr_number = Column(Integer, nullable=True)
    issue_numbers = Column(String(200), nullable=True)  # 逗號分隔，如 "804,591"
    release_title = Column(Text, nullable=True)  # 原始 commit / PR 標題
    change_type = Column(String(20), nullable=True)  # 'feature' | 'bugfix' | 'other'

    # LINE broadcast 草稿（與文章分開，後台可各自編輯）
    line_message_zh = Column(Text, nullable=True)
    line_message_en = Column(Text, nullable=True)

    # 官網雙語文章草稿
    article_title_zh = Column(String(200), nullable=True)
    article_body_zh = Column(Text, nullable=True)
    article_title_en = Column(String(200), nullable=True)
    article_body_en = Column(Text, nullable=True)

    image_url = Column(String(500), nullable=True)

    # 狀態
    status = Column(String(20), nullable=False, default=STATUS_DRAFT)
    line_status = Column(String(20), nullable=False, default=CHANNEL_PENDING)
    line_request_id = Column(String(100), nullable=True)  # LINE x-line-request-id
    line_error = Column(Text, nullable=True)
    line_published_at = Column(DateTime(timezone=True), nullable=True)

    website_status = Column(String(20), nullable=False, default=CHANNEL_PENDING)
    website_error = Column(Text, nullable=True)
    website_published_at = Column(DateTime(timezone=True), nullable=True)
    # 發布後產生的雙語文章；文章被刪時設為 NULL 但保留公告歷史
    published_blog_post_id = Column(
        Integer, ForeignKey("blog_posts.id", ondelete="SET NULL"), nullable=True
    )
    published_blog_post_en_id = Column(
        Integer, ForeignKey("blog_posts.id", ondelete="SET NULL"), nullable=True
    )

    # AI 產生草稿失敗時的原因（此時退回用 release 標題當草稿，仍可人工編輯）
    generation_error = Column(Text, nullable=True)

    # 被併入哪一則公告（併入後本則不再單獨發布）
    merged_into_id = Column(
        Integer,
        ForeignKey("release_announcements.id", ondelete="SET NULL"),
        nullable=True,
    )

    created_by = Column(
        Integer, ForeignKey("teachers.id", ondelete="SET NULL"), nullable=True
    )
    published_by = Column(
        Integer, ForeignKey("teachers.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    blog_post = relationship("BlogPost", foreign_keys=[published_blog_post_id])
    blog_post_en = relationship("BlogPost", foreign_keys=[published_blog_post_en_id])
    merged_into = relationship("ReleaseAnnouncement", remote_side=[id])
    creator = relationship("Teacher", foreign_keys=[created_by])
    publisher = relationship("Teacher", foreign_keys=[published_by])

    def __repr__(self):
        return (
            f"<ReleaseAnnouncement id={self.id} env={self.environment} "
            f"status={self.status}>"
        )
