"""Backfill display_name + teacher_limit on existing group-buy Organizations.

Revision ID: 20260608_1000
Revises: 20260603_1000
Create Date: 2026-06-08 10:00:00

Issue #768 comment #2: group-buy orgs created via
`POST /api/credit-packages/group-buy-open` before this fix had NULL
`display_name` and NULL `teacher_limit`, so the admin "編輯組織" modal
showed both fields as blank.

This migration backfills the two fields from each group-buy org's
linked School → Plan (teacher_seats) so existing rows on staging /
develop / prod are correct. The create flow is also fixed in the same
PR (services/group_buy.py).

Idempotent:
  - WHERE clauses skip rows where the values are already correct
  - Uses ON CONFLICT-free UPDATE with explicit WHERE-not-set guards
  - Safe to re-run; second run touches zero rows
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260608_1000"
down_revision: Union[str, None] = "20260603_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Backfill display_name on group-buy orgs that don't have one yet.
    # Source: the org's School's Plan.teacher_seats.
    # If a group-buy org has multiple schools (not the current design but
    # possible in the future), this uses the school created earliest.
    op.execute(
        """
        UPDATE organizations
        SET display_name = (
            SELECT organizations.name || '-' || p.teacher_seats || '位'
            FROM schools s
            JOIN plans p ON p.id = s.plan_id
            WHERE s.organization_id = organizations.id
              AND s.is_active = TRUE
              AND p.teacher_seats IS NOT NULL
            ORDER BY s.created_at ASC
            LIMIT 1
        )
        WHERE organizations.org_type = 'group_buy'
          AND organizations.display_name IS NULL
          AND EXISTS (
              SELECT 1 FROM schools s
              JOIN plans p ON p.id = s.plan_id
              WHERE s.organization_id = organizations.id
                AND s.is_active = TRUE
                AND p.teacher_seats IS NOT NULL
          );
        """
    )

    # Backfill teacher_limit on group-buy orgs that don't have one yet.
    op.execute(
        """
        UPDATE organizations
        SET teacher_limit = (
            SELECT p.teacher_seats
            FROM schools s
            JOIN plans p ON p.id = s.plan_id
            WHERE s.organization_id = organizations.id
              AND s.is_active = TRUE
              AND p.teacher_seats IS NOT NULL
            ORDER BY s.created_at ASC
            LIMIT 1
        )
        WHERE organizations.org_type = 'group_buy'
          AND organizations.teacher_limit IS NULL
          AND EXISTS (
              SELECT 1 FROM schools s
              JOIN plans p ON p.id = s.plan_id
              WHERE s.organization_id = organizations.id
                AND s.is_active = TRUE
                AND p.teacher_seats IS NOT NULL
          );
        """
    )


def downgrade() -> None:
    # Intentional no-op: dropping the backfilled values would re-introduce
    # the admin-modal blank-field bug. The create flow itself populates
    # them going forward.
    pass
