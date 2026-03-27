"""Make student_assignments compatible with instant practice (teacher as answerer)

Revision ID: 20260327_1000
Revises: 20260326_1100
Create Date: 2026-03-27

- Make student_id nullable (teacher instant practice has no student)
- Make classroom_id nullable (instant practice without classroom)
- Add teacher_id column (tracks which teacher answered)

Related: #256
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260327_1000"
down_revision = "20260326_1100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Make student_id nullable for instant practice (teacher as answerer)
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'student_assignments'
                AND column_name = 'student_id'
                AND is_nullable = 'NO'
            ) THEN
                ALTER TABLE student_assignments ALTER COLUMN student_id DROP NOT NULL;
            END IF;
        END $$;
    """
    )

    # Make classroom_id nullable for instant practice without classroom
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'student_assignments'
                AND column_name = 'classroom_id'
                AND is_nullable = 'NO'
            ) THEN
                ALTER TABLE student_assignments ALTER COLUMN classroom_id DROP NOT NULL;
            END IF;
        END $$;
    """
    )

    # Make title nullable for instant practice (title comes from assignment)
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'student_assignments'
                AND column_name = 'title'
                AND is_nullable = 'NO'
            ) THEN
                ALTER TABLE student_assignments ALTER COLUMN title DROP NOT NULL;
            END IF;
        END $$;
    """
    )

    # Add teacher_id column to track teacher as answerer in instant practice
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public'
                          AND table_name = 'student_assignments'
                          AND column_name = 'teacher_id') THEN
                ALTER TABLE student_assignments
                ADD COLUMN teacher_id INTEGER REFERENCES teachers(id) DEFAULT NULL;
            END IF;
        END $$;
    """
    )

    # Index for querying teacher's instant practice assignments
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_student_assignments_teacher_id"
        " ON student_assignments (teacher_id)"
        " WHERE teacher_id IS NOT NULL"
    )


def downgrade() -> None:
    # No-op: follows idempotent-only migration approach (see CLAUDE.md)
    pass
