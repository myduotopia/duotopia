"""question_groups 加 layout / glossary（Issue #1079 / #1081 閱讀題組）

閱讀題組的主圖文需要「段落間插圖、左右並排、兩篇並列」等排版，原本一個
``passage_text`` + 一張 ``image_url`` 表達不了，因此加兩個 JSONB 欄位：

- ``layout``   排版樹：rows → columns（``span`` 固定比例）→ blocks
              （heading / paragraph / image / dialogue）；``section`` 可框起一組 rows。
              手機寬度時同一 row 的欄位依序上下堆疊，不做自由拉寬度。
              paragraph 內 ``{{n}}`` 為克漏字空格，對應小題 ``blank_index``。
- ``glossary`` 單字註解：``[{"word": "...", "zh": "..."}]``（會考題組底部的註解框）。

格式定義與驗收樣本見 docs/design/question-bank-layout-samples/README.md，
欄位語意見 docs/design/question-bank-schema.md。

兩欄皆 nullable：既有題組（及單題）完全不受影響；``passage_text`` 保留，
之後改為 layout 文字副本供搜尋／重複偵測／AI 考點分析。

Idempotent：information_schema 守衛（table_schema = 'public'）後才 ADD COLUMN。
downgrade 真的可復原：同守衛後 DROP COLUMN，只刪本 migration 加的兩欄。

Revision ID: 20260924_1000
Revises: 20260916_1000
Create Date: 2026-09-24
"""
from typing import Union

from alembic import op


revision: str = "20260924_1000"
down_revision: Union[str, None] = "20260916_1000"
branch_labels = None
depends_on = None


_COLUMNS = ("layout", "glossary")


def upgrade() -> None:
    for col in _COLUMNS:
        op.execute(
            f"""
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'question_groups'
                      AND column_name = '{col}'
                ) THEN
                    ALTER TABLE public.question_groups ADD COLUMN {col} JSONB;
                END IF;
            END $$;
            """
        )


def downgrade() -> None:
    for col in reversed(_COLUMNS):
        op.execute(
            f"""
            DO $$ BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'question_groups'
                      AND column_name = '{col}'
                ) THEN
                    ALTER TABLE public.question_groups DROP COLUMN {col};
                END IF;
            END $$;
            """
        )
