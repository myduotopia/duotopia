"""Widen scenario_image_usage.year_month to VARCHAR(10) (issue #1158)

#1158 情境生圖額度：未付費、非機構老師每天 3 張（台灣時區），訂閱老師每月 60 張。
兩種計數共用 ``scenario_image_usage`` 這張表，``year_month`` 改當「計數期間的鍵」：

  - 'YYYY-MM'     訂閱老師的月計數（UTC，沿用原本格式）
  - 'YYYY-MM-DD'  未付費老師的日計數（台灣時區）

原欄位是 VARCHAR(7)，放不下日期，所以放寬成 VARCHAR(10)，欄位名稱不變。

⚠️ CLAUDE.md Migration 鐵則禁止 ALTER TYPE —— **本 migration 是使用者同意的例外**
（2026-10-29）。理由：VARCHAR(7) → VARCHAR(10) 只放寬長度，PostgreSQL 不需要重寫資料、
既有資料完全不受影響，也不會破壞其他還在跑舊程式的環境（舊程式只寫 7 字元的鍵）。

Idempotent：
  - 先查 information_schema.columns（限定 table_schema = 'public'），
    character_maximum_length < 10 才 ALTER；已放寬過就什麼都不做，可重複執行。
  - 表不存在（極早期環境）時同樣什麼都不做。

downgrade 真的可復原：
  - 先 DELETE 長度大於 7 的列（日計數，舊 schema 放不下），再縮回 VARCHAR(7)。
    日計數只影響「今天還能生幾張」，刪掉的代價是未付費老師當天的額度重置，可接受。
  - 同樣有守衛：character_maximum_length > 7 才執行，可重複執行。

Revision ID: 20261029_1000
Revises: 20261027_1000
Create Date: 2026-10-29
"""
from typing import Union

from alembic import op


revision: str = "20261029_1000"
down_revision: Union[str, None] = "20261027_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'scenario_image_usage'
                  AND column_name = 'year_month'
                  AND character_maximum_length < 10
            ) THEN
                -- 使用者同意的 ALTER TYPE 例外：只放寬長度，不重寫資料（見檔頭說明）
                ALTER TABLE scenario_image_usage
                    ALTER COLUMN year_month TYPE VARCHAR(10);
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'scenario_image_usage'
                  AND column_name = 'year_month'
                  AND character_maximum_length > 7
            ) THEN
                -- 日計數（'YYYY-MM-DD'）在舊 schema 放不下，先刪掉才能縮回
                DELETE FROM scenario_image_usage WHERE char_length(year_month) > 7;
                ALTER TABLE scenario_image_usage
                    ALTER COLUMN year_month TYPE VARCHAR(7);
            END IF;
        END $$;
        """
    )
