"""add_show_option_images_to_assignments

Revision ID: 20260428_1000
Revises: 20260427_1000
Create Date: 2026-04-28 10:00:00.000000

Issue #631: 單字選擇作業新增「是否顯示選項圖片」欄位。
與既有 show_image（題目單字圖片）為兩個獨立 toggle。
預設 FALSE 以保留現有作業的純文字選項行為。
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260428_1000"
down_revision: Union[str, None] = "20260427_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE assignments
        ADD COLUMN IF NOT EXISTS show_option_images BOOLEAN DEFAULT FALSE
        """
    )


def downgrade() -> None:
    # Additive-only migration policy: do not drop columns on downgrade.
    pass
