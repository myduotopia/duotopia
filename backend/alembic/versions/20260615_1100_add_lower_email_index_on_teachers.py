"""Add functional index on lower(teachers.email).

Revision ID: 20260615_1100
Revises: 20260615_1000
Create Date: 2026-06-15 11:00:00

Issue #768 PR #851 review round 6 — `_classify_team_emails` in
`backend/routers/credit_packages.py` queries the teachers table with
``func.lower(Teacher.email).in_(<lowercased emails>)`` so that legacy
mixed-case Teacher rows resolve correctly. Without an index on
``lower(email)``, PostgreSQL falls back to a sequential scan; at the
100-email roster cap this is a real cost on every roster-blur tick.

The index covers any other read path that does the same case-insensitive
lookup (the auth login at `routers/auth.py` L114 already does, and
typing-tolerant lookups are likely to spread).

Idempotent:
  - ``CREATE INDEX IF NOT EXISTS`` is safe to re-run.
  - PostgreSQL functional index syntax is portable; SQLite test path
    skips the statement (functional indexes are partially supported
    but unnecessary in tests because conftest uses small in-memory
    fixtures).
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260615_1100"
down_revision: Union[str, None] = "20260615_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PostgreSQL only — SQLite tests don't need it (small fixtures, no
    # perf gap), and the syntax isn't 100% portable across dialects.
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_teachers_email_lower
        ON teachers (lower(email));
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("DROP INDEX IF EXISTS ix_teachers_email_lower;")
