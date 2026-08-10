"""Add social_posts table (issue #591 — Meta 發文 API)

社群發文結果記錄表。每次透過 Meta Graph API 發文（Facebook 粉專 / Instagram），
每個「平台」寫一列，記錄發文來源（blog 轉發 / 手動貼文）、送出的內容、
Meta 回傳的貼文 id、成功或失敗與錯誤原因，供稽核與 token 過期告警使用。

發到 FB + IG 會產生 2 列（platform 各一）。

Idempotent：CREATE TABLE IF NOT EXISTS，可安全重複執行（遵守 CLAUDE.md Migration 鐵則）。
本表為 JWT-auth 業務表，不使用 Supabase RLS（已加入 deploy-backend.yml 排除清單）。

Revision ID: 20260810_1000
Revises: 20260723_1000
Create Date: 2026-08-10
"""
from typing import Union

from alembic import op


revision: str = "20260810_1000"
down_revision: Union[str, None] = "20260723_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 建表（冪等）。FK 皆 ON DELETE SET NULL：來源 blog 文章或操作者被刪時，
    # 保留發文歷史，僅將關聯清空。
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS social_posts (
            id SERIAL PRIMARY KEY,
            platform VARCHAR(20) NOT NULL,
            source VARCHAR(20) NOT NULL,
            source_blog_post_id INTEGER
                REFERENCES blog_posts (id) ON DELETE SET NULL,
            external_post_id VARCHAR(255),
            status VARCHAR(20) NOT NULL,
            message TEXT,
            image_url VARCHAR(500),
            link VARCHAR(500),
            error TEXT,
            created_by INTEGER
                REFERENCES teachers (id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ DEFAULT now()
        )
        """
    )

    # 查詢索引（冪等）：歷史列表依 created_at 排序 / 近期失敗告警；
    # 依來源 blog 文章反查發文紀錄。
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_social_posts_created_at
        ON social_posts (created_at)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_social_posts_source_blog_post_id
        ON social_posts (source_blog_post_id)
        """
    )


def downgrade() -> None:
    # 破壞性操作對其他環境不安全，依專案慣例不在 downgrade 刪表。
    pass
