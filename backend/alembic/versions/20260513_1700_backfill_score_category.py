"""Backfill assignments.score_category from (practice_mode, play_audio).

Issue #708 PR-1 (migration-only split).

Previously score_category was an optional column callers could pass in
(but almost no UI did), so most rows are NULL or wrong. From issue #708
onwards the backend always sets it via
utils.score_category.resolve_score_category(); this migration retro-fits
every existing row to the same rule so the grade-report feature (PR-2)
sees correct historical data.

The migration is idempotent: re-running it yields the same result. It
performs no schema change — only a data UPDATE — so it is safe to run on
any environment that already has the score_category column (added by
e263ed443762).

Mapping (see docs/design/score-category-mapping.md, landing alongside the
helper in the companion PR):
  word_reading / reading        -> speaking (any audio)
  word_cloze                    -> reading  (any audio)
  rearrangement + audio off     -> reading
  anything else + audio off     -> writing
  anything else + audio on      -> listening

Revision ID: 20260513_1700
Revises: 20260513_1000
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260513_1700"
down_revision: Union[str, None] = "20260513_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Single UPDATE — PostgreSQL evaluates the CASE per row. We touch every
    # row (not just NULLs) because existing non-NULL values include legacy
    # 'vocabulary' and possibly stale manual choices that don't match the
    # new rules. Running twice produces the same result.
    op.execute(
        """
        UPDATE assignments
        SET score_category = CASE
            WHEN practice_mode IN ('word_reading', 'reading') THEN 'speaking'
            WHEN practice_mode = 'word_cloze' THEN 'reading'
            WHEN practice_mode = 'rearrangement' AND COALESCE(play_audio, FALSE) = FALSE THEN 'reading'
            WHEN COALESCE(play_audio, FALSE) = TRUE THEN 'listening'
            ELSE 'writing'
        END
        WHERE score_category IS DISTINCT FROM (
            CASE
                WHEN practice_mode IN ('word_reading', 'reading') THEN 'speaking'
                WHEN practice_mode = 'word_cloze' THEN 'reading'
                WHEN practice_mode = 'rearrangement' AND COALESCE(play_audio, FALSE) = FALSE THEN 'reading'
                WHEN COALESCE(play_audio, FALSE) = TRUE THEN 'listening'
                ELSE 'writing'
            END
        );
        """
    )


def downgrade() -> None:
    # Data-only migration; no schema to revert. Reverting the data would
    # require knowing the prior per-row value, which we don't store.
    pass
