"""Add (student_assignment_id, practice_mode) index on practice_sessions

Issue #835 後續優化（PR #881）：監考看板 ``/quiz/live-progress`` 的子查詢以
``student_assignment_id IN (...)`` + ``practice_mode`` 過濾並 group by
``student_assignment_id`` 取每生最新 session。現有索引
``idx_practice_sessions_student`` 前導欄是 ``student_id``，此查詢未帶 student_id
故用不上，會退化為 seq scan，答題量成長時拖慢即時排行。

新增 ``(student_assignment_id, practice_mode)`` 複合索引精準對應該過濾條件。
``practice_answers(practice_session_id)`` 已有 ``idx_practice_answers_session``，無需補。

Idempotent：CREATE INDEX IF NOT EXISTS，可安全重複執行。

Revision ID: 20260624_1000
Revises: 20260623_1000
Create Date: 2026-06-24
"""
from typing import Union

from alembic import op


revision: str = "20260624_1000"
down_revision: Union[str, None] = "20260623_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_practice_sessions_sa_mode
        ON practice_sessions (student_assignment_id, practice_mode)
        """
    )


def downgrade() -> None:
    # 破壞性操作對其他環境不安全，依專案慣例不在 downgrade 刪索引。
    pass
