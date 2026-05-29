"""Phase 2 constraint follow-ups for issue #768.

Revision ID: 20260528_1000
Revises: 20260527_1000
Create Date: 2026-05-28 10:00:00

Adds the CHECK constraint that was missing on `schools.teacher_seat_limit`
in Phase 1 (the sibling `plans.teacher_seats` got `CHECK (>0)` inline; this
field did not).

Demonstrates and uses the split-guard pattern that Round 2 of the Phase 1
review (PR #819) recommended for adding constraints to columns that already
exist: the column existence guard (information_schema, scoped to 'public')
is separate from the constraint existence guard (pg_constraint, scoped by
table OID + named constraint), so a column added without its CHECK in some
other code path will still get the CHECK installed on next migration run.

Migration is idempotent: safe to re-run.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260528_1000"
down_revision: Union[str, None] = "20260527_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # schools.teacher_seat_limit: enforce > 0
    # ------------------------------------------------------------------
    # Split-guard pattern (issue #768 PR #819 review F4):
    #   1) Column-existence guard uses information_schema scoped to 'public'.
    #   2) Constraint-existence guard uses pg_constraint scoped by table OID
    #      AND a named constraint, so it cannot be masked by a same-named
    #      constraint on a different table.
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'schools'
                  AND column_name = 'teacher_seat_limit'
            ) AND NOT EXISTS (
                SELECT 1 FROM pg_constraint c
                JOIN pg_class cls ON c.conrelid = cls.oid
                WHERE c.conname = 'ck_schools_teacher_seat_limit_positive'
                  AND cls.relname = 'schools'
            ) THEN
                ALTER TABLE schools
                ADD CONSTRAINT ck_schools_teacher_seat_limit_positive
                CHECK (teacher_seat_limit > 0);
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # Intentional no-op: dropping a CHECK could let an invalid row land
    # before re-upgrade, breaking subsequent migrations.
    pass
