"""Fix fk_students_identity to reference identities (not legacy student_identities)

Migration 20260225_1600 intended to add `students.identity_id -> identities.id`
but prod had a pre-existing `fk_students_identity` constraint pointing to the
legacy `student_identities` table. The `IF NOT EXISTS (... conname = 'fk_students_identity')`
idempotency check passed on the existing (wrong) constraint, so the migration
silently skipped creating the correct FK.

Symptom: all email-bind / 1Campus SSO identity flows failed with
    Key (identity_id)=(N) is not present in table "student_identities"
after `identity_service.py` inserted into `identities` (returning id=N) and
tried to set `students.identity_id = N`.

Data safety: verified in prod before writing this migration —
    identities:         0 rows
    student_identities: 0 rows
    students with non-null identity_id:  0
    teachers with non-null identity_id:  0
No identity data exists yet; swapping the FK affects no live bindings.

Revision ID: 20260422_1200
Revises: 20260420_1100
Create Date: 2026-04-22
"""

from alembic import op

revision = "20260422_1200"
down_revision = "20260420_1100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the constraint only if it points to the WRONG table (student_identities).
    # If it's already correct (identities), or doesn't exist, leave it alone.
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1
                  FROM pg_constraint c
                  JOIN pg_class cls_from ON c.conrelid = cls_from.oid
                  JOIN pg_class cls_to   ON c.confrelid = cls_to.oid
                 WHERE c.conname = 'fk_students_identity'
                   AND cls_from.relname = 'students'
                   AND cls_to.relname = 'student_identities'
            ) THEN
                ALTER TABLE students DROP CONSTRAINT fk_students_identity;
            END IF;
        END $$;
        """
    )

    # Create the correct FK if it's not already in place.
    # Scoped to the `students` table — PostgreSQL constraint names are unique
    # per-table, not globally, so `conname` alone could miss.
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1
                  FROM pg_constraint c
                  JOIN pg_class cls ON c.conrelid = cls.oid
                 WHERE c.conname = 'fk_students_identity'
                   AND cls.relname = 'students'
            ) THEN
                ALTER TABLE students
                    ADD CONSTRAINT fk_students_identity
                    FOREIGN KEY (identity_id) REFERENCES identities(id)
                    ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # Intentionally no-op: restoring the wrong FK would reintroduce the bug.
    pass
