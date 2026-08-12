"""Add blog_post_images table (issue #993 階段一：資料層)

部落格多圖上傳 / 圖庫功能的資料層。一篇文章可掛多張圖，圖庫為「文章的素材清單」，
與內文 markdown 中實際插入的圖片解耦 —— 一張圖可以只躺在圖庫、也可以被插進內文、
也可以被指定為封面。

本 migration **只建表**，不改動任何既有欄位、不回填、不影響任何讀寫路徑
（API 與前端 UI 在階段二實作）。

建立內容：
  表 blog_post_images
    - id           SERIAL PRIMARY KEY
    - post_id      INTEGER NOT NULL → blog_posts(id) ON DELETE CASCADE
                   （刪文章時圖庫關聯一併消失；GCS 上的圖檔不受影響）
    - image_url    VARCHAR(500) NOT NULL   GCS 公開網址
    - alt_text     VARCHAR(200) NULL       插入內文時的 ![alt]
    - order_index  INTEGER NOT NULL DEFAULT 0  圖庫排序（前端可拖拉調整）
    - created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  索引 ix_blog_post_images_post_id ON (post_id)
  約束 uq_blog_post_images_post_order UNIQUE (post_id, order_index)

設計說明：
  - 封面不在此表用旗標記錄，沿用既有 BlogPost.cover_image_url 為單一真相來源，
    避免兩處狀態不一致（公開頁 / OG tag / 列表頁都已讀該欄位）。
  - (post_id, order_index) 唯一約束比照 ContentItem 的 _content_item_order_uc。
    因此後端寫入採「先整批 DELETE、flush 後再依序 INSERT」，不做逐列 UPDATE，
    以免中途撞到唯一約束。
  - 不回填既有文章（不去 parse 舊 markdown 內文），舊文章圖庫初始為空。

Idempotent（遵守 CLAUDE.md Migration 鐵則）：
  CREATE TABLE / CREATE INDEX 皆 IF NOT EXISTS；唯一約束以 pg_constraint
  JOIN pg_class（conrelid + relname）鎖定本表後才建立，避免其他表的同名約束誤判。
  upgrade() 與 downgrade() 皆可重複執行。

Rollback 影響範圍：
  downgrade() 會移除整張 blog_post_images（本 migration 全新建立的表），
  等於清空所有文章的圖庫關聯。因為是新表，不會動到任何既有資料 ——
  文章本身、cover_image_url、內文 markdown、GCS 上的圖檔全部保留不變，
  回退後部落格功能回到「單張封面 + 內文手動插圖」的原狀。

本表為 JWT-auth 業務表，不使用 Supabase RLS
（已加入 .github/workflows/deploy-backend.yml 的 RLS 排除清單）。

Revision ID: 20260811_1000
Revises: 20260810_1000
Create Date: 2026-08-11
"""
from typing import Union

from alembic import op


revision: str = "20260811_1000"
down_revision: Union[str, None] = "20260810_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1) blog_post_images（冪等建表，FK 直接寫在 CREATE TABLE 內）
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS blog_post_images (
            id SERIAL PRIMARY KEY,
            post_id INTEGER NOT NULL
                REFERENCES blog_posts (id) ON DELETE CASCADE,
            image_url VARCHAR(500) NOT NULL,
            alt_text VARCHAR(200),
            order_index INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    # ------------------------------------------------------------------
    # 2) 索引：以 post_id 撈整篇圖庫是唯一的查詢型態
    # ------------------------------------------------------------------
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_blog_post_images_post_id "
        "ON blog_post_images (post_id)"
    )

    # ------------------------------------------------------------------
    # 3) 唯一約束（pg_constraint 依 table OID 鎖定，避免同名 constraint 誤判）
    # ------------------------------------------------------------------
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint c
                JOIN pg_class cls ON c.conrelid = cls.oid
                WHERE c.conname = 'uq_blog_post_images_post_order'
                  AND cls.relname = 'blog_post_images'
            ) THEN
                ALTER TABLE blog_post_images
                ADD CONSTRAINT uq_blog_post_images_post_order
                UNIQUE (post_id, order_index);
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    """回退本 migration：整表移除。

    blog_post_images 是本 migration 全新建立的表，移除它不會動到任何既有資料
    （文章、封面、內文 markdown、GCS 圖檔皆不受影響），因此與「禁止破壞性變更」
    的鐵則不衝突 —— 該鐵則針對的是改動既有欄位 / 既有表。

    順序：先移除約束與索引，最後 DROP TABLE（FK 隨表一併消失）。
    全部加 IF EXISTS，讓 downgrade 同樣可重複執行。
    """
    # 1) 唯一約束（表若已不存在則整段跳過，避免 ALTER 對不存在的表報錯）
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_class
                WHERE relname = 'blog_post_images' AND relkind = 'r'
            ) THEN
                ALTER TABLE blog_post_images
                DROP CONSTRAINT IF EXISTS uq_blog_post_images_post_order;
            END IF;
        END $$;
        """
    )

    # 2) 索引
    op.execute("DROP INDEX IF EXISTS ix_blog_post_images_post_id")

    # 3) 表本體（post_id → blog_posts 的 FK 隨表一併移除）
    op.execute("DROP TABLE IF EXISTS blog_post_images")
