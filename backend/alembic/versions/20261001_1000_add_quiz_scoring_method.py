"""assignments 加打字類小考評分設定（Issue #1092）

拼寫小考／克漏字小考（``word_spelling_quiz`` / ``word_cloze_quiz``）可選評分方式：

- ``quiz_scoring_method``  VARCHAR(30)：whole_question / per_word / per_word_lenient /
                           fixed_per_word / fixed_per_letter；NULL ＝ 舊作業 ＝ 整題計分
- ``quiz_scoring_points``  NUMERIC(5,2)：fixed_per_word / fixed_per_letter 每錯一個
                           單字／字母扣幾分
- ``quiz_case_sensitive``  BOOLEAN：NULL / false ＝ 不分大小寫（現行行為）

三欄皆 nullable、無 DEFAULT、不 backfill：算分一律在算分當下由作業設定 ＋
answer_data 推導，舊作業 method=NULL 算出來與現在完全相同，不追溯。
規則見 backend/utils/quiz_scoring.py。

Idempotent：information_schema 守衛（table_schema = 'public'）後才 ADD COLUMN。
downgrade 真的可復原：同守衛後 DROP COLUMN，只刪本 migration 加的三欄。

Revision ID: 20261001_1000
Revises: 20260924_1000
Create Date: 2026-10-01
"""
from typing import Union

from alembic import op


revision: str = "20261001_1000"
down_revision: Union[str, None] = "20260924_1000"
branch_labels = None
depends_on = None


_COLUMNS = (
    ("quiz_scoring_method", "VARCHAR(30)"),
    ("quiz_scoring_points", "NUMERIC(5,2)"),
    ("quiz_case_sensitive", "BOOLEAN"),
)


def upgrade() -> None:
    for col, col_type in _COLUMNS:
        op.execute(
            f"""
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'assignments'
                      AND column_name = '{col}'
                ) THEN
                    ALTER TABLE public.assignments ADD COLUMN {col} {col_type};
                END IF;
            END $$;
            """
        )


def downgrade() -> None:
    for col, _col_type in reversed(_COLUMNS):
        op.execute(
            f"""
            DO $$ BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'assignments'
                      AND column_name = '{col}'
                ) THEN
                    ALTER TABLE public.assignments DROP COLUMN {col};
                END IF;
            END $$;
            """
        )
