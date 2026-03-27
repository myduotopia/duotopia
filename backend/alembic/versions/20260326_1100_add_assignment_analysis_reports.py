"""Add assignment_analysis_reports table

Revision ID: 20260326_1100
Revises: 20260326_1000
Create Date: 2026-03-26 10:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260326_1100"
down_revision = "20260326_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create assignment_analysis_reports table (idempotent)
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS assignment_analysis_reports (
            id SERIAL PRIMARY KEY,
            assignment_id INTEGER NOT NULL REFERENCES assignments(id),
            teacher_id INTEGER NOT NULL REFERENCES teachers(id),
            practice_mode VARCHAR(50) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            report_data JSONB,
            summary TEXT,
            student_count INTEGER NOT NULL DEFAULT 0,
            tokens_used INTEGER NOT NULL DEFAULT 0,
            points_deducted INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            error_message TEXT
        )
        """
    )

    # Indexes (idempotent)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_analysis_reports_assignment_id"
        " ON assignment_analysis_reports (assignment_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_analysis_reports_teacher_id"
        " ON assignment_analysis_reports (teacher_id)"
    )


def downgrade() -> None:
    # No-op: follows idempotent-only migration approach (see CLAUDE.md)
    pass
