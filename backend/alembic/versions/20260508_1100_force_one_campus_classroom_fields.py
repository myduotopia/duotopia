"""Force re-apply 1Campus classroom fields with explicit public schema scope

Revision ID: 20260508_1100
Revises: 20260508_1000
Create Date: 2026-05-08 11:00:00.000000

The earlier `20260508_1000` migration was recorded as applied in
`alembic_version`, but on staging the DDL did not actually create the
columns (root cause TBD — possibly an ambiguous information_schema match
across schemas). This migration explicitly scopes the existence check to
`table_schema = 'public'` and re-applies the same idempotent additions.
Safe to run on any DB state because every step uses IF NOT EXISTS.

Related: #635
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260508_1100"
down_revision = "20260508_1000"
branch_labels = None
depends_on = None


def _add_column_if_missing(column_name: str, column_def: str) -> None:
    # Both args are interpolated into PL/pgSQL; only safe because every caller
    # in this migration passes hardcoded literals. Reject anything that
    # doesn't look like a plain SQL identifier / type to make accidental
    # reuse of this helper with dynamic input loud rather than silently
    # injectable.
    import re

    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", column_name):
        raise ValueError(
            f"Unsafe column_name for PL/pgSQL interpolation: {column_name!r}"
        )
    if not re.fullmatch(r"[A-Za-z0-9_ ()]+", column_def):
        raise ValueError(
            f"Unsafe column_def for PL/pgSQL interpolation: {column_def!r}"
        )

    op.execute(
        f"""
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                AND table_name = 'classrooms'
                AND column_name = '{column_name}'
            ) THEN
                EXECUTE 'ALTER TABLE public.classrooms ADD COLUMN {column_name} {column_def}';
                RAISE NOTICE '[20260508_1100] added classrooms.{column_name}';
            ELSE
                RAISE NOTICE '[20260508_1100] classrooms.{column_name} already exists, skipping';
            END IF;
        END $$;
        """
    )


def upgrade() -> None:
    _add_column_if_missing("one_campus_class_id", "VARCHAR(100)")
    _add_column_if_missing("one_campus_school_dsns", "VARCHAR(100)")
    _add_column_if_missing("last_synced_at", "TIMESTAMP WITH TIME ZONE")

    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_classrooms_one_campus_class_id "
        "ON public.classrooms (one_campus_class_id) "
        "WHERE one_campus_class_id IS NOT NULL"
    )


def downgrade() -> None:
    # Intentionally empty: project rule is no destructive migrations
    # (CLAUDE.md "Database Migration 鐵則"). Dropping these columns would
    # destroy linked roster data on rollback. Rollbacks are handled by
    # redeploying an older application image, not by reversing schema.
    pass
