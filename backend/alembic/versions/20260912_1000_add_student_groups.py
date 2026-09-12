"""Add student groups within a classroom (Issue #1046)

班級學生分組：老師把一個班拆成小組（第一組、第二組…）做競賽、加分、分工。

新增兩張表，不動任何既有結構：

1. ``student_groups`` —— 組別本身。掛在 ``classroom_id`` 底下（屬於班級而非
   個別老師），所以同班的協同老師看到同一份分組。
   - ``color`` 存色票 key（amber / rose / sky / emerald / violet / slate）而非
     hex：前端把 key 映射成固定的 Tailwind class，Tailwind 只認得完整字面的
     class name，無法從樣板字串組出 ``bg-${color}-500``。欄位仍留 20 字元，
     日後若改成自選 hex 也塞得下，不必再動表。
   - ``leader_student_id`` 用 ON DELETE **SET NULL**（不是 CASCADE）：組長轉學
     只該讓這組沒有組長，不該把整組刪掉。
2. ``student_group_members`` —— 組員。``sort_order`` 就是組內序號（拖曳排序後
   由後端整批重寫）。

**刻意不對 (classroom, student) 設唯一約束**：一個學生可以同時屬於多個組別，
這是 issue #1046 明訂的需求（英文分組、打掃分組可以並存）。唯一約束只下在
``(group_id, student_id)``，擋同一組內重複收同一人。

座號沿用既有的 ``students.student_number``，本 migration 不新增座號欄位。

Idempotent（可重複執行）:
  - 建表用 ``CREATE TABLE IF NOT EXISTS``（含 inline 的 FK 與 UNIQUE，表不存在
    才會建，存在則整段跳過，不會重複加約束）。
  - Index 用 ``CREATE INDEX IF NOT EXISTS``。

downgrade 為何是實作而非本專案慣例的 no-op:
  本專案 migration 慣例是 forward-only（downgrade 留 pass），因為多數 migration
  會改既有欄位，回滾等於丟資料。本次 upgrade 全是「新增新表」，回滾就是把這兩張
  表刪掉、回到乾淨的原狀，表裡只有本功能自己的資料，沒有既有資料遺失風險。
  又因為 develop DB 目前關閉，這個 migration 會直接套用到 staging 而沒有前置的
  驗證環境，出問題時 downgrade 是唯一的復原手段，所以這裡必須寫成真的可執行。

  刪除順序為先子表（student_group_members）後父表（student_groups），顛倒會被
  FK 擋下。不使用 ``CASCADE``，避免連帶刪掉非本 migration 建立的物件。

Revision ID: 20260912_1000
Revises: 20260908_1000
Create Date: 2026-09-12
"""
from typing import Union

from alembic import op


revision: str = "20260912_1000"
down_revision: Union[str, None] = "20260908_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- 1) student_groups ----
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.student_groups (
            id SERIAL PRIMARY KEY,
            classroom_id INTEGER NOT NULL
                REFERENCES public.classrooms (id) ON DELETE CASCADE,
            name VARCHAR(100) NOT NULL,
            color VARCHAR(20),
            leader_student_id INTEGER
                REFERENCES public.students (id) ON DELETE SET NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ,
            CONSTRAINT uq_student_group_classroom_name
                UNIQUE (classroom_id, name)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_student_groups_classroom_id
            ON public.student_groups (classroom_id)
        """
    )

    # ---- 2) student_group_members ----
    # 沒有 (classroom, student) 唯一約束是刻意的 —— 一個學生可屬多組。
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.student_group_members (
            id SERIAL PRIMARY KEY,
            group_id INTEGER NOT NULL
                REFERENCES public.student_groups (id) ON DELETE CASCADE,
            student_id INTEGER NOT NULL
                REFERENCES public.students (id) ON DELETE CASCADE,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ,
            CONSTRAINT uq_student_group_member UNIQUE (group_id, student_id)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_student_group_members_group_id
            ON public.student_group_members (group_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_student_group_members_student_id
            ON public.student_group_members (student_id)
        """
    )


def downgrade() -> None:
    """Drop both tables, child first so the FK does not block it."""
    op.execute("DROP TABLE IF EXISTS public.student_group_members")
    op.execute("DROP TABLE IF EXISTS public.student_groups")
