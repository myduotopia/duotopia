"""上傳題本（#1112 C2）：exam_imports / exam_import_pages / exam_import_usage
＋ question_source_links.source_question_no

- ``exam_imports``       一份上傳的題本（匯入草稿）：老師、檔名、檔案內容雜湊（偵測重複匯入）、
                         頁數、整份設定（JSONB：年段／來源／教材／公開／歸屬）、朗讀口音選擇、
                         狀態、題數、已知答案對照（題號 → 正確選項 index）、用量加總。
- ``exam_import_pages``  題本的一頁：頁碼、狀態、頁圖 URL（GCS）、是否答案頁、這一頁的題目卡
                         JSONB（含答案來源、老師改過的欄位清單、每題在頁面上的位置）。
- ``exam_import_usage``  每次 AI 呼叫一列：類型、模型、input／output／thinking token（分開存）、
                         音檔秒數（TTS 用，語音段才寫）、估算美元。只記不扣老師額度。
- ``question_source_links.source_question_no``  原卷題號（"12"、"40"），可為空。

題組 ``tts_accent`` / ``tts_voice`` 不在本 migration（語音段才加）。
設計見 docs/design/question-bank-exam-import.md、question-bank-schema.md「上傳題本（#1112）」段。

Idempotent（遵守 CLAUDE.md Migration 鐵則）：
  - CREATE TABLE IF NOT EXISTS
  - ADD COLUMN 包在 information_schema 守衛裡（table_schema = 'public'）
  - constraint 先用 pg_constraint JOIN pg_class（以 table 鎖定）檢查後建立
  - CREATE INDEX IF NOT EXISTS
  - upgrade 沒有 DROP / RENAME / ALTER TYPE

downgrade 真的可復原：反序 DROP TABLE IF EXISTS 三張新表，守衛後 DROP 新欄位。

三張表皆為 JWT-auth 業務表，不使用 Supabase RLS（已加入 deploy-backend.yml 排除清單）。

Revision ID: 20261027_1000
Revises: 20261016_1100
Create Date: 2026-10-27
"""
from typing import Union

from alembic import op


revision: str = "20261027_1000"
down_revision: Union[str, None] = "20261016_1100"
branch_labels = None
depends_on = None


def _add_constraint(table: str, name: str, ddl: str) -> None:
    """constraint 名稱只在同一個 table 內唯一 → 以 conrelid + relname 鎖定 table 再判斷。"""
    op.execute(
        f"""
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint c
                JOIN pg_class cls ON c.conrelid = cls.oid
                WHERE c.conname = '{name}'
                  AND cls.relname = '{table}'
            ) THEN
                ALTER TABLE {table} ADD CONSTRAINT {name} {ddl};
            END IF;
        END $$;
        """
    )


def upgrade() -> None:
    # 1) 匯入草稿（一份題本一列）
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS exam_imports (
            id SERIAL PRIMARY KEY,
            teacher_id INTEGER NOT NULL
                REFERENCES teachers (id) ON DELETE CASCADE,
            file_name VARCHAR(255) NOT NULL,
            file_hash VARCHAR(64) NOT NULL,
            page_count SMALLINT NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'processing',
            settings JSONB NOT NULL DEFAULT '{}'::jsonb,
            tts_accents JSONB NOT NULL DEFAULT '[]'::jsonb,
            known_answers JSONB NOT NULL DEFAULT '{}'::jsonb,
            question_count INTEGER NOT NULL DEFAULT 0,
            ai_call_count INTEGER NOT NULL DEFAULT 0,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            thinking_tokens INTEGER NOT NULL DEFAULT 0,
            estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
            abandoned_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ
        )
        """
    )
    _add_constraint(
        "exam_imports",
        "ck_exam_imports_status",
        "CHECK (status IN ('processing', 'ready', 'saved', 'abandoned'))",
    )
    _add_constraint(
        "exam_imports",
        "ck_exam_imports_page_count",
        "CHECK (page_count BETWEEN 1 AND 20)",
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_exam_imports_teacher_created "
        "ON exam_imports (teacher_id, created_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_exam_imports_teacher_hash "
        "ON exam_imports (teacher_id, file_hash)"
    )

    # 2) 題本的每一頁
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS exam_import_pages (
            id SERIAL PRIMARY KEY,
            import_id INTEGER NOT NULL
                REFERENCES exam_imports (id) ON DELETE CASCADE,
            page_no SMALLINT NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            image_url TEXT,
            is_answer_page BOOLEAN NOT NULL DEFAULT false,
            answer_key JSONB,
            cards JSONB NOT NULL DEFAULT '[]'::jsonb,
            error TEXT,
            processed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ
        )
        """
    )
    _add_constraint(
        "exam_import_pages",
        "uq_exam_import_pages_import_page",
        "UNIQUE (import_id, page_no)",
    )
    _add_constraint(
        "exam_import_pages",
        "ck_exam_import_pages_status",
        "CHECK (status IN ('pending', 'processing', 'done', 'failed'))",
    )

    # 3) 每次 AI 呼叫一列（只記不扣）
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS exam_import_usage (
            id SERIAL PRIMARY KEY,
            import_id INTEGER
                REFERENCES exam_imports (id) ON DELETE SET NULL,
            teacher_id INTEGER
                REFERENCES teachers (id) ON DELETE SET NULL,
            page_no SMALLINT,
            call_type VARCHAR(30) NOT NULL,
            model VARCHAR(100) NOT NULL,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            thinking_tokens INTEGER NOT NULL DEFAULT 0,
            audio_seconds NUMERIC(10, 2),
            estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
            succeeded BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_exam_import_usage_import "
        "ON exam_import_usage (import_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_exam_import_usage_created "
        "ON exam_import_usage (created_at)"
    )

    # 4) 原卷題號
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'question_source_links'
                  AND column_name = 'source_question_no'
            ) THEN
                ALTER TABLE public.question_source_links
                ADD COLUMN source_question_no VARCHAR(20);
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'question_source_links'
                  AND column_name = 'source_question_no'
            ) THEN
                ALTER TABLE public.question_source_links DROP COLUMN source_question_no;
            END IF;
        END $$;
        """
    )
    op.execute("DROP TABLE IF EXISTS exam_import_usage")
    op.execute("DROP TABLE IF EXISTS exam_import_pages")
    op.execute("DROP TABLE IF EXISTS exam_imports")
