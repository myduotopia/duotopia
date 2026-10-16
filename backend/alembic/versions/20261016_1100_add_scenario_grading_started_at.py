"""Add student_item_progress.scenario_grading_started_at (issue #1025)

情境對話逐題 AI 評分的「正在進行中」標記。

PR #1036 review 指出老師雙擊會打兩次 Gemini。只把額度改成「先扣再打」擋不住：計數
還在 0/3 時兩個並發請求都滿足 count < 3，兩個都扣成功、兩個都打了 AI。要擋的是
「同一題同時有兩個分析在跑」，那需要一個在進行中的標記，不是計數上限。

NULL = 沒人在跑。搶鎖＝一次原子 UPDATE（條件含「沒人在跑或上次跑到一半死了」），
放鎖＝清回 NULL。唯一判定在 services/scenario_grading_claim.py。

Idempotent（遵守 CLAUDE.md Migration 鐵則）：
  - ADD COLUMN 包在 information_schema 守衛裡（scoped to table_schema='public'）
  - 欄位 nullable，既有資料列不受影響
  - 沒有 DROP / RENAME / ALTER TYPE

Revision ID: 20261016_1100
Revises: 20261016_1000
Create Date: 2026-10-16
"""
from typing import Union

from alembic import op


revision: str = "20261016_1100"
down_revision: Union[str, None] = "20261016_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'student_item_progress'
                  AND column_name = 'scenario_grading_started_at'
            ) THEN
                ALTER TABLE student_item_progress
                ADD COLUMN scenario_grading_started_at TIMESTAMPTZ;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # 破壞性操作對其他環境不安全，依專案慣例不在 downgrade 刪欄位。
    pass
