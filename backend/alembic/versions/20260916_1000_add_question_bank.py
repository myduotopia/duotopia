"""Add question bank tables (Issue #1061 / #1062)

題庫：老師／機構／平台可重複使用的題目池，與教材階層（Program → Lesson →
Content → ContentItem）是多對多，所以不塞進 ContentItem，另開一組表。
設計討論與欄位說明見 docs/design/question-bank-schema.md。

本期 UI 只做「單題選擇題」，但表一次建齊所有題型需要的結構（題組、對話分段、
填充題答案、聽力欄位），避免之後每加一種題型就改一次 migration。

表與依賴順序（建表順序 = 此順序；downgrade 反序）：

1. ``exam_points``            考點（平台維護、有階層、多語 names JSONB）
2. ``exam_point_aliases``     考點異名 → 正式考點（「現完式」→「現在完成式」）
3. ``question_sources``       來源（歷屆考題／出版社版本）
4. ``question_groups``        題組（一份素材配多題：文章／音檔／對話／圖片）
5. ``question_group_segments`` 題組素材分段（對話聽力：每句一段、各自音檔與角色）
6. ``questions``              題目主表（全題型共用）
7. ``question_options``       選項（獨立表，為誘答統計）
8. ``question_exam_points``   題目 ↔ 考點
9. ``question_source_links``  題目 ↔ 來源
10. ``question_program_links`` 題目 ↔ 教材包／單元

關鍵約束：
- ``questions.is_platform = true`` 時 ``visibility`` 必須是 ``public``（CHECK），
  平台題庫恆公開。
- ``UNIQUE (teacher_id, normalized_stem) WHERE is_active AND group_id IS NULL``
  擋同一老師完全重複的單題；題組內的小題（克漏字空格題幹常是空的）不套用。
- ``pg_trgm`` 供相似題查詢（``GIN (normalized_stem gin_trgm_ops)``）。
  Supabase 允許 ``CREATE EXTENSION IF NOT EXISTS``。

Idempotent：全部 ``CREATE TABLE / INDEX IF NOT EXISTS``；CHECK 與 partial unique
index 都是 inline 或 IF NOT EXISTS，重跑不會重複加。

downgrade 寫成真的可復原：反序 ``DROP TABLE IF EXISTS``，只刪本 migration 建的
表，**不刪 pg_trgm extension**（其他物件可能已依賴）。

Revision ID: 20260916_1000
Revises: 20260912_1000
Create Date: 2026-09-16
"""
from typing import Union

from alembic import op


revision: str = "20260916_1000"
down_revision: Union[str, None] = "20260912_1000"
branch_labels = None
depends_on = None


# 共用的歸屬欄位：與 programs 相同的三選一歸屬 + 公開範圍。
_OWNERSHIP_COLUMNS = """
    teacher_id INTEGER NOT NULL
        REFERENCES public.teachers (id) ON DELETE CASCADE,
    organization_id UUID
        REFERENCES public.organizations (id) ON DELETE CASCADE,
    school_id UUID
        REFERENCES public.schools (id) ON DELETE CASCADE,
    visibility VARCHAR(20) NOT NULL DEFAULT 'private',
    is_platform BOOLEAN NOT NULL DEFAULT FALSE,
"""


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # ---- 1) exam_points ----
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.exam_points (
            id SERIAL PRIMARY KEY,
            code VARCHAR(100) NOT NULL,
            parent_id INTEGER
                REFERENCES public.exam_points (id) ON DELETE SET NULL,
            names JSONB NOT NULL DEFAULT '{}'::jsonb,
            description JSONB,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            merged_into_id INTEGER
                REFERENCES public.exam_points (id) ON DELETE SET NULL,
            order_index INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ,
            CONSTRAINT uq_exam_points_code UNIQUE (code),
            CONSTRAINT ck_exam_points_status
                CHECK (status IN ('active', 'pending', 'merged'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_exam_points_parent_id "
        "ON public.exam_points (parent_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_exam_points_status "
        "ON public.exam_points (status)"
    )

    # ---- 2) exam_point_aliases ----
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.exam_point_aliases (
            id SERIAL PRIMARY KEY,
            exam_point_id INTEGER NOT NULL
                REFERENCES public.exam_points (id) ON DELETE CASCADE,
            alias TEXT NOT NULL,
            lang VARCHAR(10),
            created_at TIMESTAMPTZ DEFAULT now()
        )
        """
    )
    # 一個異名只能對到一個考點（不分大小寫）
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_exam_point_aliases_alias_lower "
        "ON public.exam_point_aliases (lower(alias))"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_exam_point_aliases_exam_point_id "
        "ON public.exam_point_aliases (exam_point_id)"
    )

    # ---- 3) question_sources ----
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.question_sources (
            id SERIAL PRIMARY KEY,
            source_type VARCHAR(20) NOT NULL,
            name VARCHAR(200) NOT NULL,
            year SMALLINT,
            organization_id UUID
                REFERENCES public.organizations (id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ,
            CONSTRAINT ck_question_sources_type
                CHECK (source_type IN ('exam', 'publisher'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_question_sources_organization_id "
        "ON public.question_sources (organization_id)"
    )

    # ---- 4) question_groups ----
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS public.question_groups (
            id SERIAL PRIMARY KEY,
            stimulus_type VARCHAR(20) NOT NULL,
            title VARCHAR(200),
            passage_text TEXT,
            audio_url TEXT,
            image_url TEXT,
            grade_min SMALLINT,
            grade_max SMALLINT,
            {_OWNERSHIP_COLUMNS}
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            deleted_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ,
            CONSTRAINT ck_question_groups_stimulus_type CHECK (
                stimulus_type IN ('passage', 'audio', 'dialogue', 'image', 'mixed')
            ),
            CONSTRAINT ck_question_groups_grade_range CHECK (
                grade_min IS NULL OR grade_max IS NULL OR grade_min <= grade_max
            ),
            CONSTRAINT ck_question_groups_platform_public CHECK (
                NOT is_platform OR visibility = 'public'
            )
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_question_groups_teacher_id "
        "ON public.question_groups (teacher_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_question_groups_organization_id "
        "ON public.question_groups (organization_id)"
    )

    # ---- 5) question_group_segments ----
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.question_group_segments (
            id SERIAL PRIMARY KEY,
            group_id INTEGER NOT NULL
                REFERENCES public.question_groups (id) ON DELETE CASCADE,
            order_index SMALLINT NOT NULL,
            speaker_label VARCHAR(50),
            transcript TEXT NOT NULL,
            audio_url TEXT,
            tts_voice VARCHAR(100),
            pause_after_ms INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ,
            CONSTRAINT uq_question_group_segments_order
                UNIQUE (group_id, order_index)
        )
        """
    )

    # ---- 6) questions ----
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS public.questions (
            id SERIAL PRIMARY KEY,
            question_type VARCHAR(30) NOT NULL,
            stem TEXT NOT NULL,
            normalized_stem TEXT NOT NULL,
            stem_audio_url TEXT,
            image_url TEXT,
            explanation TEXT,
            grade_min SMALLINT,
            grade_max SMALLINT,
            allow_multiple_answers BOOLEAN NOT NULL DEFAULT FALSE,
            show_stem_text BOOLEAN NOT NULL DEFAULT TRUE,
            accepted_answers JSONB,
            answer_match_mode VARCHAR(20),
            group_id INTEGER
                REFERENCES public.question_groups (id) ON DELETE CASCADE,
            group_order SMALLINT,
            blank_index SMALLINT,
            segment_id INTEGER
                REFERENCES public.question_group_segments (id) ON DELETE SET NULL,
            {_OWNERSHIP_COLUMNS}
            source_question_id INTEGER
                REFERENCES public.questions (id) ON DELETE SET NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            deleted_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ,
            CONSTRAINT ck_questions_grade_range CHECK (
                grade_min IS NULL OR grade_max IS NULL OR grade_min <= grade_max
            ),
            CONSTRAINT ck_questions_platform_public CHECK (
                NOT is_platform OR visibility = 'public'
            ),
            CONSTRAINT ck_questions_answer_match_mode CHECK (
                answer_match_mode IS NULL OR answer_match_mode IN
                    ('exact', 'case_insensitive', 'ignore_punctuation')
            )
        )
        """
    )
    # 同一老師的單題不可完全重複（題組小題不套用）
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_questions_teacher_normalized_stem
            ON public.questions (teacher_id, normalized_stem)
            WHERE is_active AND group_id IS NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_questions_normalized_stem_trgm
            ON public.questions USING GIN (normalized_stem gin_trgm_ops)
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_questions_type_visibility "
        "ON public.questions (question_type, visibility)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_questions_teacher_id "
        "ON public.questions (teacher_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_questions_organization_id "
        "ON public.questions (organization_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_questions_school_id "
        "ON public.questions (school_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_questions_group_id "
        "ON public.questions (group_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_questions_grade "
        "ON public.questions (grade_min, grade_max)"
    )

    # ---- 7) question_options ----
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.question_options (
            id SERIAL PRIMARY KEY,
            question_id INTEGER NOT NULL
                REFERENCES public.questions (id) ON DELETE CASCADE,
            order_index SMALLINT NOT NULL,
            text TEXT NOT NULL,
            is_correct BOOLEAN NOT NULL DEFAULT FALSE,
            audio_url TEXT,
            image_url TEXT,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ,
            CONSTRAINT uq_question_options_order UNIQUE (question_id, order_index)
        )
        """
    )

    # ---- 8) question_exam_points ----
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.question_exam_points (
            question_id INTEGER NOT NULL
                REFERENCES public.questions (id) ON DELETE CASCADE,
            exam_point_id INTEGER NOT NULL
                REFERENCES public.exam_points (id) ON DELETE CASCADE,
            source VARCHAR(10) NOT NULL DEFAULT 'manual',
            created_at TIMESTAMPTZ DEFAULT now(),
            PRIMARY KEY (question_id, exam_point_id),
            CONSTRAINT ck_question_exam_points_source
                CHECK (source IN ('manual', 'ai'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_question_exam_points_exam_point_id "
        "ON public.question_exam_points (exam_point_id)"
    )

    # ---- 9) question_source_links ----
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.question_source_links (
            question_id INTEGER NOT NULL
                REFERENCES public.questions (id) ON DELETE CASCADE,
            source_id INTEGER NOT NULL
                REFERENCES public.question_sources (id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ DEFAULT now(),
            PRIMARY KEY (question_id, source_id)
        )
        """
    )

    # ---- 10) question_program_links ----
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.question_program_links (
            id SERIAL PRIMARY KEY,
            question_id INTEGER NOT NULL
                REFERENCES public.questions (id) ON DELETE CASCADE,
            program_id INTEGER NOT NULL
                REFERENCES public.programs (id) ON DELETE CASCADE,
            lesson_id INTEGER
                REFERENCES public.lessons (id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ DEFAULT now()
        )
        """
    )
    # lesson_id 可為 NULL，UNIQUE 對 NULL 不生效，所以用 COALESCE 的唯一索引
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_question_program_links
            ON public.question_program_links
            (question_id, program_id, COALESCE(lesson_id, 0))
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_question_program_links_program_id "
        "ON public.question_program_links (program_id)"
    )


def downgrade() -> None:
    """反序刪除本 migration 建的表；不動 pg_trgm extension。"""
    op.execute("DROP TABLE IF EXISTS public.question_program_links")
    op.execute("DROP TABLE IF EXISTS public.question_source_links")
    op.execute("DROP TABLE IF EXISTS public.question_exam_points")
    op.execute("DROP TABLE IF EXISTS public.question_options")
    op.execute("DROP TABLE IF EXISTS public.questions")
    op.execute("DROP TABLE IF EXISTS public.question_group_segments")
    op.execute("DROP TABLE IF EXISTS public.question_groups")
    op.execute("DROP TABLE IF EXISTS public.question_sources")
    op.execute("DROP TABLE IF EXISTS public.exam_point_aliases")
    op.execute("DROP TABLE IF EXISTS public.exam_points")
