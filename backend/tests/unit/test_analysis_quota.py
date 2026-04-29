"""Unit tests for analysis_quota service — pure-Python rules only.

DB-backed behavior (atomic increment, bulk reset) lives in
tests/integration/api/test_quota_increment_atomic.py and
tests/integration/api/test_grading_returned_reset.py — those need a
real session because they exercise SQL semantics (UPDATE WHERE,
synchronize_session="fetch").
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

from services.analysis_quota import (  # noqa: E402
    MAX_AI_ANALYSIS_ATTEMPTS,
    check_can_analyze,
)


class _FakeProgress:
    """Stand-in for StudentItemProgress that does not need a DB session."""

    def __init__(self, *, ai_analysis_count=0, teacher_passed=None):
        self.ai_analysis_count = ai_analysis_count
        self.teacher_passed = teacher_passed


class TestMaxConstant:
    def test_default_is_three(self):
        assert MAX_AI_ANALYSIS_ATTEMPTS == 3


class TestCheckCanAnalyze:
    def test_passes_when_count_zero(self):
        check_can_analyze(_FakeProgress(ai_analysis_count=0))

    def test_passes_when_count_below_max(self):
        check_can_analyze(_FakeProgress(ai_analysis_count=2))

    def test_blocks_when_count_at_max_with_429(self):
        with pytest.raises(HTTPException) as exc:
            check_can_analyze(_FakeProgress(ai_analysis_count=3))
        assert exc.value.status_code == 429
        assert exc.value.detail["code"] == "AI_ANALYSIS_QUOTA_EXCEEDED"
        assert exc.value.detail["ai_analysis_remaining"] == 0
        assert exc.value.detail["max_attempts"] == 3

    def test_blocks_when_count_above_max_with_429(self):
        with pytest.raises(HTTPException) as exc:
            check_can_analyze(_FakeProgress(ai_analysis_count=99))
        assert exc.value.status_code == 429

    def test_blocks_when_teacher_passed_true_with_403(self):
        with pytest.raises(HTTPException) as exc:
            check_can_analyze(_FakeProgress(ai_analysis_count=0, teacher_passed=True))
        assert exc.value.status_code == 403
        assert exc.value.detail["code"] == "ITEM_ALREADY_PASSED"

    def test_403_takes_precedence_over_429(self):
        # When teacher already passed AND quota maxed, the 403 reason is
        # clearer to surface (item is locked, not just out of attempts).
        with pytest.raises(HTTPException) as exc:
            check_can_analyze(_FakeProgress(ai_analysis_count=3, teacher_passed=True))
        assert exc.value.status_code == 403

    def test_teacher_passed_false_does_not_block(self):
        check_can_analyze(_FakeProgress(ai_analysis_count=0, teacher_passed=False))

    def test_teacher_passed_none_does_not_block(self):
        check_can_analyze(_FakeProgress(ai_analysis_count=0, teacher_passed=None))

    def test_handles_null_count_as_zero(self):
        # Legacy rows may surface NULL despite the NOT NULL constraint
        # (e.g. mocked tests, raw-SQL inserts pre-default).
        check_can_analyze(_FakeProgress(ai_analysis_count=None))
