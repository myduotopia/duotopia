"""Add student identity consolidation system

Creates student_identities table and adds identity-related columns to students.
Supports merging multiple student accounts under one unified identity.

Revision ID: 20260225_1600
Revises: 20260225_1000
Create Date: 2026-02-25 16:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260225_1600"
down_revision = "20260225_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create student_identities table
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS student_identities (
            id SERIAL PRIMARY KEY,
            primary_student_id INTEGER,
            verified_email VARCHAR(255) NOT NULL,
            national_id_hash VARCHAR(64),
            one_campus_student_id VARCHAR(100),
            password_hash VARCHAR(255) NOT NULL,
            password_changed BOOLEAN DEFAULT FALSE,
            last_password_change TIMESTAMPTZ,
            merged_at TIMESTAMPTZ DEFAULT NOW(),
            merge_source VARCHAR(50) DEFAULT 'email_verification',
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ
        )
    """
    )

    # 2. Add unique constraint on verified_email
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_student_identities_verified_email') THEN
                ALTER TABLE student_identities ADD CONSTRAINT uq_student_identities_verified_email UNIQUE (verified_email);
            END IF;
        END $$;
    """
    )

    # 3. Add unique constraint on national_id_hash (allowing nulls)
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_student_identities_national_id_hash') THEN
                ALTER TABLE student_identities ADD CONSTRAINT uq_student_identities_national_id_hash UNIQUE (national_id_hash);
            END IF;
        END $$;
    """
    )

    # 4. Add FK from student_identities.primary_student_id -> students.id
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_student_identities_primary_student') THEN
                ALTER TABLE student_identities
                ADD CONSTRAINT fk_student_identities_primary_student
                FOREIGN KEY (primary_student_id) REFERENCES students(id) ON DELETE SET NULL;
            END IF;
        END $$;
    """
    )

    # 5. Add indexes
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_student_identities_primary_student_id ON student_identities (primary_student_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_student_identities_verified_email ON student_identities (verified_email)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_student_identities_one_campus_student_id ON student_identities (one_campus_student_id)"
    )

    # 6. Add identity_id column to students
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'students' AND column_name = 'identity_id') THEN
                ALTER TABLE students ADD COLUMN identity_id INTEGER;
            END IF;
        END $$;
    """
    )

    # 7. Add is_primary_account column to students
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'students' AND column_name = 'is_primary_account') THEN
                ALTER TABLE students ADD COLUMN is_primary_account BOOLEAN;
            END IF;
        END $$;
    """
    )

    # 8. Add password_migrated_to_identity column to students
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'students' AND column_name = 'password_migrated_to_identity') THEN
                ALTER TABLE students ADD COLUMN password_migrated_to_identity BOOLEAN DEFAULT FALSE;
            END IF;
        END $$;
    """
    )

    # 9. Add FK from students.identity_id -> student_identities.id
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_students_identity') THEN
                ALTER TABLE students
                ADD CONSTRAINT fk_students_identity
                FOREIGN KEY (identity_id) REFERENCES student_identities(id) ON DELETE SET NULL;
            END IF;
        END $$;
    """
    )

    # 10. Add index on students.identity_id
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_students_identity_id ON students (identity_id)"
    )


def downgrade() -> None:
    # Note: downgrade is provided for development only.
    # In production, we follow the idempotent-only approach.
    pass
