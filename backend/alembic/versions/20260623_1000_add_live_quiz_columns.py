"""Add live quiz columns to assignments

Issue #835: Live quiz mode — 老師主控開始/收卷 + 全班同步。
新增三欄：
    - is_live_quiz：是否為老師主控 live 模式（區分 #828 self-paced，預設 false）
    - quiz_opened_at：老師按開始的時間（開放閘門）
    - quiz_closed_at：老師按收卷的時間（鎖定閘門）

Idempotent：information_schema 守衛只在 public schema 下檢查。

Revision ID: 20260623_1000
Revises: 20260615_1100
Create Date: 2026-06-23
"""
from typing import Union

from alembic import op


revision: str = "20260623_1000"
down_revision: Union[str, None] = "20260615_1100"
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
                  AND column_name = 'is_live_quiz'
            ) THEN
                ALTER TABLE assignments
                ADD COLUMN is_live_quiz BOOLEAN NOT NULL DEFAULT false;
            END IF;
        END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'assignments'
                  AND column_name = 'quiz_opened_at'
            ) THEN
                ALTER TABLE assignments
                ADD COLUMN quiz_opened_at TIMESTAMPTZ;
            END IF;
        END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'assignments'
                  AND column_name = 'quiz_closed_at'
            ) THEN
                ALTER TABLE assignments
                ADD COLUMN quiz_closed_at TIMESTAMPTZ;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    """No-op: forward-only migration per project policy."""
    pass
