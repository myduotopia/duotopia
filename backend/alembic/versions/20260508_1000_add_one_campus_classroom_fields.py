"""Add 1Campus sync fields to classrooms table

Revision ID: 20260508_1000
Revises: 20260429_1200
Create Date: 2026-05-08 10:00:00.000000

Adds three nullable columns to classrooms used by the 1Campus class sync flow:
  - one_campus_class_id: marks classrooms imported from 1Campus jasmine API.
    NULL for manually-created classrooms (sync service must not touch those).
  - one_campus_school_dsns: stores the school DSNS the classroom was synced from.
  - last_synced_at: timestamp of the most recent successful sync.

Related: #635
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260508_1000"
down_revision = "20260429_1200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'classrooms'
                AND column_name = 'one_campus_class_id'
            ) THEN
                ALTER TABLE classrooms
                ADD COLUMN one_campus_class_id VARCHAR(100);
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'classrooms'
                AND column_name = 'one_campus_school_dsns'
            ) THEN
                ALTER TABLE classrooms
                ADD COLUMN one_campus_school_dsns VARCHAR(100);
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'classrooms'
                AND column_name = 'last_synced_at'
            ) THEN
                ALTER TABLE classrooms
                ADD COLUMN last_synced_at TIMESTAMP WITH TIME ZONE;
            END IF;
        END $$;
        """
    )

    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_classrooms_one_campus_class_id "
        "ON classrooms (one_campus_class_id) WHERE one_campus_class_id IS NOT NULL"
    )


def downgrade() -> None:
    pass
