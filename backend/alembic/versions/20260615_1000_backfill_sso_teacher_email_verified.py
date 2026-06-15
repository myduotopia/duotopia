"""Backfill email_verified on existing 1Campus SSO teachers.

Revision ID: 20260615_1000
Revises: 20260608_1000
Create Date: 2026-06-15 10:00:00

Issue #850: teachers created via 1Campus/ischool SSO never had
`teachers.email_verified` set, so it kept the model default `False`. The
admin subscription dashboard's "Unverified" badge reads
`teachers.email_verified`, so verified SSO teachers showed up as
Unverified — even though their linked Identity was correctly marked
`email_verified=True` (and one teacher had been manually patched on the
*Identity* row, which the admin never reads).

The service is fixed in the same PR so new SSO teachers land verified.
This migration repairs existing rows: any teacher whose linked Identity
is a verified 1Campus identity but whose own `email_verified` is not TRUE
is set to verified, timestamped from the Identity (falling back to NOW()).

Idempotent:
  - `t.email_verified IS DISTINCT FROM TRUE` skips already-verified rows
    (covers both FALSE and NULL); a second run touches zero rows.
  - Scoped to 1Campus-linked identities only — never touches non-SSO
    teachers (e.g. email/password accounts pending real verification).
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260615_1000"
down_revision: Union[str, None] = "20260608_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE teachers t
        SET email_verified = TRUE,
            email_verified_at = COALESCE(i.email_verified_at, NOW())
        FROM identities i
        WHERE t.identity_id = i.id
          AND i.email_verified = TRUE
          AND (
              i.one_campus_account IS NOT NULL
              OR i.one_campus_uuid IS NOT NULL
          )
          AND t.email_verified IS DISTINCT FROM TRUE;
        """
    )


def downgrade() -> None:
    # Intentional no-op: reverting would re-introduce the admin "Unverified"
    # badge bug for legitimately-verified SSO teachers. The service fix keeps
    # new rows correct going forward.
    pass
