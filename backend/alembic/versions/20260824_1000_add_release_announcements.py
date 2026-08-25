"""Add release_announcements table (issue #804 — LINE / 官網自動發布更新公告)

每次 release 進 staging 或 production，CI webhook 產生一列草稿，內含
「LINE broadcast 文案」與「官網雙語文章」兩份獨立內容；管理者在後台編輯後，
可選擇發布到 LINE、官網或兩者，兩個通道各自有狀態欄位（可先發官網、之後補發 LINE）。
未發布的舊草稿可併入新草稿（merged_into_id）一起發，節省 LINE 訊息量。

Idempotent：CREATE TABLE / INDEX IF NOT EXISTS，可安全重複執行
（遵守 CLAUDE.md Migration 鐵則）。
本表為 JWT-auth 業務表，不使用 Supabase RLS。

Revision ID: 20260824_1000
Revises: 20260811_1000
Create Date: 2026-08-24
"""
from typing import Union

from alembic import op


revision: str = "20260824_1000"
down_revision: Union[str, None] = "20260811_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 建表（冪等）。FK 皆 ON DELETE SET NULL：文章或操作者被刪時保留公告歷史。
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS release_announcements (
            id SERIAL PRIMARY KEY,
            environment VARCHAR(20) NOT NULL,
            source_ref VARCHAR(100) NOT NULL,
            source_branch VARCHAR(100),
            pr_number INTEGER,
            issue_numbers VARCHAR(200),
            release_title TEXT,
            change_type VARCHAR(20),
            line_message_zh TEXT,
            line_message_en TEXT,
            article_title_zh VARCHAR(200),
            article_body_zh TEXT,
            article_title_en VARCHAR(200),
            article_body_en TEXT,
            image_url VARCHAR(500),
            status VARCHAR(20) NOT NULL DEFAULT 'draft',
            line_status VARCHAR(20) NOT NULL DEFAULT 'pending',
            line_request_id VARCHAR(100),
            line_error TEXT,
            line_published_at TIMESTAMPTZ,
            website_status VARCHAR(20) NOT NULL DEFAULT 'pending',
            website_error TEXT,
            website_published_at TIMESTAMPTZ,
            published_blog_post_id INTEGER
                REFERENCES blog_posts (id) ON DELETE SET NULL,
            published_blog_post_en_id INTEGER
                REFERENCES blog_posts (id) ON DELETE SET NULL,
            generation_error TEXT,
            merged_into_id INTEGER
                REFERENCES release_announcements (id) ON DELETE SET NULL,
            created_by INTEGER
                REFERENCES teachers (id) ON DELETE SET NULL,
            published_by INTEGER
                REFERENCES teachers (id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ
        )
        """
    )

    # 同一環境的同一個 commit 只會有一則草稿：CI 重跑 / 重新部署不會重複建立。
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_release_announcements_env_ref
        ON release_announcements (environment, source_ref)
        """
    )
    # 後台清單：待發布草稿過濾 + 時間排序。
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_release_announcements_status
        ON release_announcements (status)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_release_announcements_created_at
        ON release_announcements (created_at)
        """
    )


def downgrade() -> None:
    # 破壞性操作對其他環境不安全，依專案慣例不在 downgrade 刪表。
    pass
