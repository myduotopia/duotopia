"""Add magic_paste_usage table (issue #891)

「教材內容魔術貼上」每位老師每月免費額度計數表。每位老師每個自然月一列，
year_month 以 'YYYY-MM' 字串表示，跨月自然重置；唯一約束
(teacher_id, year_month) 供後續 UPSERT 累加使用。

Idempotent：CREATE TABLE / CONSTRAINT / INDEX 皆 IF NOT EXISTS 或先檢查後建立，
可安全重複執行（遵守 CLAUDE.md Migration 鐵則）。

本表為 JWT-auth 業務表，不使用 Supabase RLS（已加入 deploy-backend.yml 排除清單）。

Revision ID: 20260710_1000
Revises: 20260706_1000
Create Date: 2026-07-10
"""
from typing import Union

from alembic import op


revision: str = "20260710_1000"
down_revision: Union[str, None] = "20260706_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) 建表（冪等）
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS magic_paste_usage (
            id SERIAL PRIMARY KEY,
            teacher_id INTEGER NOT NULL
                REFERENCES teachers (id) ON DELETE CASCADE,
            year_month VARCHAR(7) NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ
        )
        """
    )

    # 2) 唯一約束（先檢查後建立，pg_constraint 依 table OID 鎖定）
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint c
                JOIN pg_class cls ON c.conrelid = cls.oid
                WHERE c.conname = 'uq_magic_paste_usage_teacher_month'
                  AND cls.relname = 'magic_paste_usage'
            ) THEN
                ALTER TABLE magic_paste_usage
                ADD CONSTRAINT uq_magic_paste_usage_teacher_month
                UNIQUE (teacher_id, year_month);
            END IF;
        END $$;
        """
    )

    # 3) 查詢索引（冪等）
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_magic_paste_usage_teacher_month
        ON magic_paste_usage (teacher_id, year_month)
        """
    )


def downgrade() -> None:
    # 破壞性操作對其他環境不安全，依專案慣例不在 downgrade 刪表。
    pass
