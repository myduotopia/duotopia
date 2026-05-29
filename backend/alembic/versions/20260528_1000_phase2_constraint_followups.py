"""Phase 2 constraint follow-ups for issue #768.

Revision ID: 20260528_1000
Revises: 20260527_1000
Create Date: 2026-05-28 10:00:00

Adds:
  1. CHECK on schools.teacher_seat_limit (missing in Phase 1 — sibling
     plans.teacher_seats had it inline, this one didn't).
  2. NAMED CHECK constraints for 5 fields that had inline (auto-named)
     CHECKs in Phase 1. The auto-named ones (e.g. organizations_org_type_check)
     stay in place; these add named ck_<table>_<col>_<rule> versions that
     match the ORM CheckConstraint names in the model layer. Redundant in
     terms of validation rules but ensures the model's claim is also
     reality in Postgres (otherwise the named constraint only existed in
     SQLite tests via Base.metadata.create_all).

Uses the split-guard pattern recommended by Round 2 of the Phase 1 review
(PR #819): column-existence guard (information_schema, scoped to 'public')
is separate from constraint-existence guard (pg_constraint, scoped by
table OID + named constraint), so a column added without its CHECK
elsewhere still gets the CHECK installed on next migration run.

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

    # ------------------------------------------------------------------
    # Named-CHECK mirrors for 5 fields that got inline (auto-named) CHECKs
    # in Phase 1. Adding the named versions so the ORM model layer's
    # `CheckConstraint(name='ck_...')` claims match reality in Postgres
    # (the auto-named ones — e.g. organizations_org_type_check — also
    # remain; predicates are identical so the AND combination is a no-op).
    # All use the split-guard pattern.
    # ------------------------------------------------------------------
    _NAMED_CHECKS = [
        (
            "organizations",
            "org_type",
            "ck_organizations_org_type_valid",
            "org_type IN ('institution', 'group_buy')",
        ),
        (
            "organizations",
            "per_student_price",
            "ck_organizations_per_student_price_positive",
            "per_student_price IS NULL OR per_student_price > 0",
        ),
        (
            "plans",
            "teacher_seats",
            "ck_plans_teacher_seats_positive",
            "teacher_seats IS NULL OR teacher_seats > 0",
        ),
        (
            "plans",
            "annual_fee",
            "ck_plans_annual_fee_positive",
            "annual_fee IS NULL OR annual_fee > 0",
        ),
        (
            "plans",
            "topup_discount",
            "ck_plans_topup_discount_range",
            "topup_discount IS NULL OR (topup_discount >= 0 AND topup_discount <= 1)",
        ),
        (
            "student_status_history",
            "status",
            "ck_student_status_history_status_valid",
            "status IN ('active', 'inactive')",
        ),
    ]
    for table, column, constraint, predicate in _NAMED_CHECKS:
        op.execute(
            f"""
            DO $$ BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = '{table}'
                      AND column_name = '{column}'
                ) AND NOT EXISTS (
                    SELECT 1 FROM pg_constraint c
                    JOIN pg_class cls ON c.conrelid = cls.oid
                    WHERE c.conname = '{constraint}'
                      AND cls.relname = '{table}'
                ) THEN
                    ALTER TABLE {table}
                    ADD CONSTRAINT {constraint}
                    CHECK ({predicate});
                END IF;
            END $$;
            """
        )


def downgrade() -> None:
    # Intentional no-op: dropping a CHECK could let an invalid row land
    # before re-upgrade, breaking subsequent migrations.
    pass
