"""Add scenario_text_usage table (issue #1025)

情境對話文字 AI（產題／情境文章／PDF 擷取）的每月免費次數計數表。

#1021 把這三個端點接成真的 AI 呼叫，但當時刻意沒擋配額 —— 沒有實際用量數據可以拿來
定免費額度。這張表補上限制（每位老師每個自然月 50 次，用完就擋，不接點數）。

與 scenario_image_usage（#1024）同形狀但**刻意分成兩張表**：生圖的成本貴一個量級，
合理上限差很多（30 vs 50）。共用一張表就得共用一個數字。

Idempotent（遵守 CLAUDE.md Migration 鐵則）：
  - CREATE TABLE IF NOT EXISTS
  - constraint 先用 pg_constraint + conrelid（以表 OID 鎖定，不會被其他表的同名
    constraint 誤判）檢查後建立
  - CREATE INDEX IF NOT EXISTS
  - 沒有 DROP / RENAME / ALTER TYPE

本表為 JWT-auth 業務表，不使用 Supabase RLS（已加入 deploy-backend.yml 排除清單）。

Revision ID: 20261016_1000
Revises: 20261012_1000
Create Date: 2026-10-16
"""
from typing import Union

from alembic import op


revision: str = "20261016_1000"
down_revision: Union[str, None] = "20261012_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) 建表（冪等）
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS scenario_text_usage (
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
                WHERE c.conname = 'uq_scenario_text_usage_teacher_month'
                  AND cls.relname = 'scenario_text_usage'
            ) THEN
                ALTER TABLE scenario_text_usage
                ADD CONSTRAINT uq_scenario_text_usage_teacher_month
                UNIQUE (teacher_id, year_month);
            END IF;
        END $$;
        """
    )

    # 3) 查詢索引（冪等）
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_scenario_text_usage_teacher_month
        ON scenario_text_usage (teacher_id, year_month)
        """
    )


def downgrade() -> None:
    # 破壞性操作對其他環境不安全，依專案慣例不在 downgrade 刪表。
    pass
