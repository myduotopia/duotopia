"""Make Content.lesson_id optional and add Content.program_id

Issue #587: Allow Content to live directly under a Program (top-level folder)
without being forced into a Lesson (sub-folder). Two-level folder structure
where the second level is optional.

Schema changes (all idempotent per project migration rules):
- contents.lesson_id: drop NOT NULL
- contents.program_id: new nullable FK to programs(id) ON DELETE CASCADE
- index on contents.program_id
- CHECK constraint: a content row must belong to at least one of lesson/program
- Backfill: populate program_id for existing rows via their lesson's program

Revision ID: 20260427_1000
Revises: 20260422_1500
Create Date: 2026-04-27
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = "20260427_1000"
down_revision = "20260422_1500"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add program_id column (nullable FK to programs)
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'contents' AND column_name = 'program_id'
            ) THEN
                ALTER TABLE contents
                    ADD COLUMN program_id INTEGER
                    REFERENCES programs(id) ON DELETE CASCADE;
            END IF;
        END $$;
        """
    )

    # 2. Index on program_id
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_contents_program_id ON contents (program_id)"
    )

    # 3. Backfill program_id from lesson.program_id for existing rows
    op.execute(
        """
        UPDATE contents AS c
        SET program_id = l.program_id
        FROM lessons AS l
        WHERE c.lesson_id = l.id
          AND c.program_id IS NULL
        """
    )

    # 4. Drop NOT NULL on lesson_id (safe to repeat)
    op.execute("ALTER TABLE contents ALTER COLUMN lesson_id DROP NOT NULL")

    # 5. CHECK constraint: must belong to a lesson OR a program
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'ck_contents_lesson_or_program'
            ) THEN
                ALTER TABLE contents
                    ADD CONSTRAINT ck_contents_lesson_or_program
                    CHECK (lesson_id IS NOT NULL OR program_id IS NOT NULL);
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # Conservative downgrade: drop the new constraint/index/column only.
    # We do NOT restore NOT NULL on lesson_id because rows created after
    # this migration may legitimately have lesson_id IS NULL, and reinstating
    # NOT NULL would fail on real data.
    op.execute(
        "ALTER TABLE contents DROP CONSTRAINT IF EXISTS ck_contents_lesson_or_program"
    )
    op.execute("DROP INDEX IF EXISTS ix_contents_program_id")
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'contents' AND column_name = 'program_id'
            ) THEN
                ALTER TABLE contents DROP COLUMN program_id;
            END IF;
        END $$;
        """
    )
