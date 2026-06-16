"""Add quiz_time_limit_seconds to assignments

Issue #828: 小考模式整卷限時 — 取代單題限時。教師選擇 3/5/10/15/20/30 分鐘，
時間到 quiz Activity 會自動呼叫 complete endpoint 提交，不允許繼續修改。

Idempotent：information_schema 守衛只在 public schema 下檢查。

Revision ID: 20260603_1000
Revises: 20260602_1000
Create Date: 2026-06-03
"""
from typing import Union

from alembic import op


revision: str = "20260603_1000"
down_revision: Union[str, None] = "20260602_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'assignments'
                  AND column_name = 'quiz_time_limit_seconds'
            ) THEN
                ALTER TABLE assignments
                ADD COLUMN quiz_time_limit_seconds INTEGER;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    """No-op: forward-only migration per project policy."""
    pass
