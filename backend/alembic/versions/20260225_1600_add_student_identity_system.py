"""Add unified identities system

Creates identities table as a unified identity layer for both teachers and students.
Supports account consolidation via email verification and future OAuth integration.

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
    # 1. Create identities table (unified for teachers and students)
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS identities (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            password_hash VARCHAR(255),
            email_verified BOOLEAN NOT NULL DEFAULT FALSE,
            email_verified_at TIMESTAMPTZ,
            password_changed BOOLEAN DEFAULT FALSE,
            last_password_change TIMESTAMPTZ,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ
        )
    """
    )

    # 2. Add unique constraint on email
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_identities_email') THEN
                ALTER TABLE identities ADD CONSTRAINT uq_identities_email UNIQUE (email);
            END IF;
        END $$;
    """
    )

    # 3. Add index on email
    op.execute("CREATE INDEX IF NOT EXISTS idx_identities_email ON identities (email)")

    # 4. Add identity_id column to students
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

    # 5. Add is_primary_account column to students
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

    # 6. Add password_migrated_to_identity column to students
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

    # 7. Add FK from students.identity_id -> identities.id
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_students_identity') THEN
                ALTER TABLE students
                ADD CONSTRAINT fk_students_identity
                FOREIGN KEY (identity_id) REFERENCES identities(id) ON DELETE SET NULL;
            END IF;
        END $$;
    """
    )

    # 8. Add index on students.identity_id
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_students_identity_id ON students (identity_id)"
    )

    # 9. Add identity_id column to teachers
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'teachers' AND column_name = 'identity_id') THEN
                ALTER TABLE teachers ADD COLUMN identity_id INTEGER;
            END IF;
        END $$;
    """
    )

    # 10. Add FK from teachers.identity_id -> identities.id
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_teachers_identity') THEN
                ALTER TABLE teachers
                ADD CONSTRAINT fk_teachers_identity
                FOREIGN KEY (identity_id) REFERENCES identities(id) ON DELETE SET NULL;
            END IF;
        END $$;
    """
    )

    # 11. Add index on teachers.identity_id
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_teachers_identity_id ON teachers (identity_id)"
    )


def downgrade() -> None:
    # Note: downgrade is provided for development only.
    # In production, we follow the idempotent-only approach.
    pass
