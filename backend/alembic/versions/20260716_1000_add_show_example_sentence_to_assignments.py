"""add_show_example_sentence_to_assignments

Revision ID: 20260716_1000
Revises: 20260710_1000
Create Date: 2026-07-16 10:00:00.000000

Issue #860: 單字選擇小考／艾賓浩斯新增「顯示例句（答案挖空）」派發條件。
題目改為顯示該單字的例句、單字本身挖空，作答維持四選一（不需打字）。
與既有的 show_word / play_audio 為互斥的「題目呈現方式」；預設 FALSE
以保留現有作業行為（顯示單字 / 播放音檔）。

本 PR 僅新增欄位；串接 API 與前端渲染於後續 PR 進行。
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260716_1000"
down_revision: Union[str, None] = "20260710_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE assignments
        ADD COLUMN IF NOT EXISTS show_example_sentence BOOLEAN DEFAULT FALSE
        """
    )


def downgrade() -> None:
    # Additive-only migration policy: do not drop columns on downgrade.
    pass
