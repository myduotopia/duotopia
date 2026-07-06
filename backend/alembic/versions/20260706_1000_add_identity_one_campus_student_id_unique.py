"""Add UNIQUE index on identities.one_campus_student_id

Revision ID: 20260706_1000
Revises: 20260626_1000
Create Date: 2026-07-06 10:00:00.000000

Issue #730: one_campus_class_sync_service._upsert_student did a
query-then-insert on Identity by one_campus_student_id with no lock or unique
constraint. Two concurrent syncs (e.g. a teacher's manual sync overlapping the
OAuth-login background sync) could both read "identity is None" and both insert
a row with the same one_campus_student_id, silently splitting a student's
history.

Enforce uniqueness at the DB level with a partial unique index (mirrors
ix_identities_one_campus_uuid). Idempotent — safe to re-run across
develop/staging/prod.

Related: #730, #722
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260706_1000"
down_revision = "20260626_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_identities_one_campus_student_id "
        "ON identities (one_campus_student_id) "
        "WHERE one_campus_student_id IS NOT NULL"
    )


def downgrade() -> None:
    pass
