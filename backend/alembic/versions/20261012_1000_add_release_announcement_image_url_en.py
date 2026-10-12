"""release_announcements 加 image_url_en：英文文章另用英文介面的主圖

原本只有 ``image_url`` 一張主圖，LINE 卡片與中英兩篇官網文章共用，英文文章的
封面／分享縮圖因此是中文介面截圖。新增選填的 ``image_url_en``：
- 有值 → 英文文章的 cover_image_url / og_image_url 用它
- NULL → 英文文章沿用 ``image_url``（舊草稿行為不變，無需回填）
LINE 卡片仍只用 ``image_url``（卡片中文在前）。

Idempotent：ADD COLUMN 走 information_schema 守衛（table_schema = 'public'），nullable、無回填。
Lock：``SET LOCAL lock_timeout = '5s'`` — 表很小，但拿不到鎖時寧可失敗重試也不要卡住。

downgrade：同守衛 DROP COLUMN（英文主圖網址會遺失，英文文章回到沿用主圖）。

Revision ID: 20261012_1000
Revises: 20261004_1000
Create Date: 2026-10-12
"""
from typing import Union

from alembic import op


revision: str = "20261012_1000"
down_revision: Union[str, None] = "20261004_1000"
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
                  AND table_name = 'release_announcements'
                  AND column_name = 'image_url_en'
            ) THEN
                ALTER TABLE release_announcements
                ADD COLUMN image_url_en VARCHAR(500);
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
                  AND table_name = 'release_announcements'
                  AND column_name = 'image_url_en'
            ) THEN
                ALTER TABLE release_announcements DROP COLUMN image_url_en;
            END IF;
        END $$;
        """
    )
