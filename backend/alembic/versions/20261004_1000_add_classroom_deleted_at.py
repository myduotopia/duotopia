"""classrooms 加 deleted_at：停用與刪除分離（Issue #1097）

語意：
- ``deleted_at IS NOT NULL`` ＝ 已刪除（任何地方都不出現）
- ``is_active = false`` 且 ``deleted_at IS NULL`` ＝ 停用（老師／機構列表可見、學生不可見）

在此之前，老師按「刪除」只是把 ``is_active`` 設成 false（soft delete），
所以要回填：**沒有任何啟用中的學校連結**、``is_active = false``、``deleted_at IS NULL``
的班級視為「以前被老師刪除的」，``deleted_at = COALESCE(updated_at, created_at, now())``。
有啟用中學校連結的停用班級是機構後台的「停用」，不回填。

Idempotent：
- ADD COLUMN 走 information_schema 守衛（table_schema = 'public'）
- 回填只動 ``deleted_at IS NULL`` 的列，重跑不會改到已回填或新刪除的值

downgrade：清掉「符合回填條件」的 deleted_at 後 DROP COLUMN（同守衛）。
限制：因為最後整欄會被 DROP，清值本身只是保險；真正的語意復原是
「回到只用 is_active 判斷」— 已刪除的班 is_active 仍為 false，舊程式照樣隱藏，
所以 downgrade 後行為與 migration 前一致。

Revision ID: 20261004_1000
Revises: 20261001_1000
Create Date: 2026-10-04
"""
from typing import Union

from alembic import op


revision: str = "20261004_1000"
down_revision: Union[str, None] = "20261001_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'classrooms'
                  AND column_name = 'deleted_at'
            ) THEN
                ALTER TABLE public.classrooms
                ADD COLUMN deleted_at TIMESTAMPTZ NULL;
            END IF;
        END $$;
        """
    )

    # 回填：以前老師按「刪除」的個人班級（無啟用中的學校連結＋已停用）
    op.execute(
        """
        UPDATE public.classrooms c
        SET deleted_at = COALESCE(c.updated_at, c.created_at, now())
        WHERE c.is_active = false
          AND c.deleted_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.classroom_schools cs
              WHERE cs.classroom_id = c.id
                AND cs.is_active = true
          );
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'classrooms'
                  AND column_name = 'deleted_at'
            ) THEN
                UPDATE public.classrooms c
                SET deleted_at = NULL
                WHERE c.is_active = false
                  AND c.deleted_at IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM public.classroom_schools cs
                      WHERE cs.classroom_id = c.id
                        AND cs.is_active = true
                  );
                ALTER TABLE public.classrooms DROP COLUMN deleted_at;
            END IF;
        END $$;
        """
    )
