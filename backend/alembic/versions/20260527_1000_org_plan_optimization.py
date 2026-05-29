"""Org plan optimization: group-buy + institution per-student billing (issue #768)

Revision ID: 20260527_1000
Revises: 20260525_1000
Create Date: 2026-05-27 10:00:00

Phase 1 (DB only) of issue #768. Adds:
  - organizations.org_type, organizations.per_student_price
  - schools.plan_id (FK->plans), schools.teacher_seat_limit  (group-buy only)
  - plans.teacher_seats, plans.annual_fee (PER-TEACHER), plans.topup_discount
    + seeds 3 group-buy plans
  - new table student_status_history (per-head monthly billing trail)

Backend logic (topup discount recompute, group-buy open API, monthly billing
query) and the institution per-student-price frontend page are out of scope
here and land in follow-up PRs.

Migration is idempotent: safe to re-run.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260527_1000"
down_revision: Union[str, None] = "20260525_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. organizations: org_type + per_student_price
    # ------------------------------------------------------------------
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'organizations' AND column_name = 'org_type'
            ) THEN
                ALTER TABLE organizations
                ADD COLUMN org_type VARCHAR(20) NOT NULL DEFAULT 'institution';
            END IF;
        END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'organizations'
                  AND column_name = 'per_student_price'
            ) THEN
                ALTER TABLE organizations ADD COLUMN per_student_price INTEGER;
            END IF;
        END $$;
        """
    )
    op.execute(
        "COMMENT ON COLUMN organizations.per_student_price IS "
        "'Institution-only: monthly fee (NT$) charged per active student.'"
    )

    # ------------------------------------------------------------------
    # 2. schools: plan_id (FK->plans) + teacher_seat_limit (group-buy only)
    # ------------------------------------------------------------------
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'schools' AND column_name = 'plan_id'
            ) THEN
                ALTER TABLE schools ADD COLUMN plan_id INTEGER;
            END IF;
        END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'schools'
                  AND column_name = 'teacher_seat_limit'
            ) THEN
                ALTER TABLE schools ADD COLUMN teacher_seat_limit INTEGER;
            END IF;
        END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_schools_plan_id'
            ) THEN
                ALTER TABLE schools
                ADD CONSTRAINT fk_schools_plan_id
                FOREIGN KEY (plan_id)
                REFERENCES plans(id) ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_schools_plan_id ON schools (plan_id)")

    # ------------------------------------------------------------------
    # 3. plans: teacher_seats + annual_fee (PER-TEACHER) + topup_discount
    # ------------------------------------------------------------------
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'plans' AND column_name = 'teacher_seats'
            ) THEN
                ALTER TABLE plans ADD COLUMN teacher_seats INTEGER;
            END IF;
        END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'plans' AND column_name = 'annual_fee'
            ) THEN
                ALTER TABLE plans ADD COLUMN annual_fee INTEGER;
            END IF;
        END $$;
        """
    )
    op.execute(
        "COMMENT ON COLUMN plans.annual_fee IS "
        "'Group-buy plans: annual fee PER TEACHER (NT$), not the team total. "
        "Team total = annual_fee * teacher_seats, computed at checkout.'"
    )
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'plans' AND column_name = 'topup_discount'
            ) THEN
                ALTER TABLE plans ADD COLUMN topup_discount NUMERIC(3,2);
            END IF;
        END $$;
        """
    )

    # Seed group-buy plans. ON CONFLICT keeps existing rows untouched.
    op.execute(
        """
        INSERT INTO plans
            (name, price, quota, teacher_seats, annual_fee, topup_discount,
             display_order, is_active)
        VALUES
            ('團購-10席', NULL, 1000, 10, 1500, 0.95, 10, TRUE),
            ('團購-30席', NULL, 1000, 30, 1300, 0.90, 11, TRUE),
            ('團購-50席', NULL, 1000, 50, 1000, 0.85, 12, TRUE)
        ON CONFLICT (name) DO NOTHING
        """
    )

    # ------------------------------------------------------------------
    # 4. student_status_history: per-head monthly billing trail
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS student_status_history (
            id SERIAL PRIMARY KEY,
            student_id INTEGER NOT NULL,
            school_id UUID,
            status VARCHAR(20) NOT NULL,
            changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            changed_by INTEGER,
            note TEXT
        )
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'fk_student_status_history_student'
            ) THEN
                ALTER TABLE student_status_history
                ADD CONSTRAINT fk_student_status_history_student
                FOREIGN KEY (student_id)
                REFERENCES students(id) ON DELETE CASCADE;
            END IF;
        END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'fk_student_status_history_school'
            ) THEN
                ALTER TABLE student_status_history
                ADD CONSTRAINT fk_student_status_history_school
                FOREIGN KEY (school_id)
                REFERENCES schools(id) ON DELETE CASCADE;
            END IF;
        END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'fk_student_status_history_changed_by'
            ) THEN
                ALTER TABLE student_status_history
                ADD CONSTRAINT fk_student_status_history_changed_by
                FOREIGN KEY (changed_by)
                REFERENCES teachers(id) ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_student_status_history_student "
        "ON student_status_history (student_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_student_status_history_school "
        "ON student_status_history (school_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_student_status_history_changed_at "
        "ON student_status_history (changed_at)"
    )
    # Composite index for monthly billing-period headcount queries.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_student_status_history_student_changed "
        "ON student_status_history (student_id, changed_at)"
    )


def downgrade() -> None:
    # Intentional no-op: dropping columns/tables would lose data and break
    # services reading these fields across shared environments.
    pass
