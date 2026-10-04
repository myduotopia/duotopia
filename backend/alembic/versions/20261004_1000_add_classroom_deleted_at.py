"""classrooms 加 deleted_at：停用與刪除分離（Issue #1097）

語意：
- ``deleted_at IS NOT NULL`` ＝ 已刪除（任何地方都不出現）
- ``is_active = false`` 且 ``deleted_at IS NULL`` ＝ 停用（老師／機構列表可見、學生不可見）

在此之前，老師按「刪除」只是把 ``is_active`` 設成 false（soft delete），
所以要回填：**沒有任何啟用中的學校連結**、``is_active IS NOT TRUE``（含歷史 NULL，
舊列表同樣把它們藏起來）的班級視為「以前被老師刪除的」，
``deleted_at = COALESCE(updated_at, created_at, now())``。
有啟用中學校連結的停用班級是機構後台的「停用」，不回填。

Idempotent：
- ADD COLUMN 走 information_schema 守衛（table_schema = 'public'）
- 回填與 ADD COLUMN 放在**同一個守衛分支**，只在第一次建立欄位時執行一次。
  上線後老師「停用」的班級（is_active=false、無學校連結）與舊的已刪除班長得一樣，
  若重跑 upgrade 再回填就會把停用班誤標成已刪除，所以重跑絕不能再回填。

Lock：``SET LOCAL lock_timeout = '5s'`` — ADD COLUMN 需要 ACCESS EXCLUSIVE 鎖，
classrooms 是熱表；拿不到鎖就 5 秒後失敗（交易整個 rollback，可安全重試），
避免卡在長交易後面時把所有讀寫一起排隊卡住。SET LOCAL 只影響本 migration 交易。

downgrade：同守衛內清掉「符合回填條件」的 deleted_at 後 DROP COLUMN。
限制：因為最後整欄會被 DROP，清值本身只是保險；真正的語意復原是
「回到只用 is_active 判斷」— 已刪除的班 is_active 仍為 false，舊程式照樣隱藏，
所以 downgrade 後行為與 migration 前一致（停用過的班在舊程式裡也會被當成已刪除隱藏，
這是舊程式本來就無法區分的）。

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
    op.execute("SET LOCAL lock_timeout = '5s'")
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

                -- 回填：以前老師按「刪除」的個人班級（無啟用中的學校連結＋未啟用）
                -- 只在首次建立欄位時執行，重跑不會再標記
                UPDATE public.classrooms c
                SET deleted_at = COALESCE(c.updated_at, c.created_at, now())
                WHERE c.is_active IS NOT TRUE
                  AND c.deleted_at IS NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM public.classroom_schools cs
                      WHERE cs.classroom_id = c.id
                        AND cs.is_active = true
                  );
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
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
                WHERE c.is_active IS NOT TRUE
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
