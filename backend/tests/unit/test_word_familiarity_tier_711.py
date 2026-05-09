"""
Tests for issue #711: redefine word familiarity using count-based 3-tier
classification.

The new ``calculate_assignment_mastery`` SQL function classifies each word in
a student's vocabulary assignment into one of three tiers from
``user_word_progress.correct_count`` and ``user_word_progress.incorrect_count``:

    high   (已熟悉)   : correct/total >= 0.9 AND correct >= 5
    medium (普通熟悉) : correct/total >= 0.5 AND correct >= 3   (and not high)
    low    (不熟)     : everything else, including unpracticed words

Single-assignment familiarity weights medium tier at 0.5 of high:

    current_mastery = (words_high + 0.5 * words_medium) / total_words

This replaces the prior ``AVG(memory_strength)`` behaviour. The weight makes
partial progress visible (4 medium / 6 total → 33.3% rather than 0%) while
still requiring every word to reach 已熟悉 for current_mastery == 1.0
(since 0.5 * medium ≤ 0.5 * total < total when medium < total).

These tests replicate the SQL logic in pure Python so they can run without a
database. They intentionally exercise every spec example given in the issue.
"""

MEDIUM_WEIGHT = 0.5

from typing import List, Tuple


def classify_tier(correct: int, incorrect: int) -> str:
    """Pure-Python replica of the per-row classification used by the SQL."""
    total = correct + incorrect
    if total <= 0:
        return "low"
    rate = correct / total
    if correct >= 5 and rate >= 0.9:
        return "high"
    if correct >= 3 and rate >= 0.5:
        return "medium"
    return "low"


def assignment_mastery(
    words: List[Tuple[int, int]], total_words: int
) -> dict:
    """Replica of ``calculate_assignment_mastery`` aggregation.

    ``words`` is a list of (correct_count, incorrect_count) tuples — one per
    practiced word in ``user_word_progress``. Words without a row are
    represented by being absent from this list; ``total_words`` includes them.
    """
    high = sum(1 for c, i in words if classify_tier(c, i) == "high")
    medium = sum(1 for c, i in words if classify_tier(c, i) == "medium")
    low = max(0, total_words - high - medium)
    current = (
        (high + MEDIUM_WEIGHT * medium) / total_words if total_words > 0 else 0.0
    )
    return {
        "current_mastery": current,
        "words_high": high,
        "words_medium": medium,
        "words_low": low,
        "total_words": total_words,
    }


class TestTierFromSpec:
    """Each case is one row from the issue #711 spec table."""

    def test_no_practice_is_low(self):
        # 「正確次數=0 不須，尚未開始練習，所有單字之單字熟悉度為{不熟}」
        assert classify_tier(0, 0) == "low"

    def test_correct_one_no_errors_is_low(self):
        # 「正確次數>=1 → 不熟」 when no errors
        assert classify_tier(1, 0) == "low"

    def test_correct_three_no_errors_is_medium(self):
        # 「正確次數>=3 → 普通」 when no errors
        assert classify_tier(3, 0) == "medium"

    def test_correct_five_no_errors_is_high(self):
        # 「正確次數>=5 → 熟悉」 when no errors
        assert classify_tier(5, 0) == "high"

    def test_high_rate_but_not_enough_correct_is_low(self):
        # rate = 100% but only 2 correct → 不熟
        assert classify_tier(2, 0) == "low"

    def test_medium_rate_with_enough_correct(self):
        # rate = 60%, correct = 3 → 普通熟悉
        assert classify_tier(3, 2) == "medium"

    def test_high_rate_just_below_ninety_is_medium(self):
        # 5 correct / 6 total ≈ 83.3% < 90% → 普通熟悉
        assert classify_tier(5, 1) == "medium"

    def test_high_rate_at_or_above_ninety_with_enough_correct_is_high(self):
        # 10 / 11 ≈ 90.9% >= 90% AND correct >= 5 → 已熟悉
        assert classify_tier(10, 1) == "high"

    def test_low_correct_rate_is_low_regardless_of_attempts(self):
        # rate = 9% → 不熟
        assert classify_tier(1, 10) == "low"

    def test_first_incorrect_answer_is_low(self):
        # Companion to #452: first wrong answer must not yield a higher tier.
        assert classify_tier(0, 1) == "low"


class TestAssignmentMastery:
    def test_unpracticed_assignment_has_zero_mastery_and_all_low(self):
        result = assignment_mastery([], total_words=10)
        assert result["current_mastery"] == 0.0
        assert result["words_high"] == 0
        assert result["words_medium"] == 0
        assert result["words_low"] == 10

    def test_one_word_high_out_of_three_total(self):
        # 1 word fully mastered, 2 unpracticed → 33.3% mastery
        result = assignment_mastery([(5, 0)], total_words=3)
        assert result["words_high"] == 1
        assert result["words_medium"] == 0
        assert result["words_low"] == 2
        assert abs(result["current_mastery"] - 1 / 3) < 1e-9

    def test_weighted_mastery_combines_high_and_medium(self):
        """
        Issue #711 root cause: previously current_mastery was AVG(memory_strength)
        and "已熟悉" required memory_strength >= 0.64 separately, so percentage
        could rise while the mastered count stayed at 0.
        New behaviour: percentage = (high + 0.5 * medium) / total — high counts
        fully, medium counts as half, so the displayed % and the tier counts
        no longer disagree.
        """
        # 2 high, 1 medium, 1 low → (2 + 0.5) / 4 = 0.625
        result = assignment_mastery(
            [(5, 0), (10, 1), (3, 0), (1, 5)],
            total_words=4,
        )
        assert result["words_high"] == 2
        assert result["words_medium"] == 1
        assert result["words_low"] == 1
        assert abs(result["current_mastery"] - 0.625) < 1e-9

    def test_medium_only_now_contributes_to_mastery(self):
        """
        Spec follow-up scenario observed during dogfooding: 4 medium / 0 high
        used to display 0% even though students had clearly made progress.
        Weighted formula: (0 + 0.5 * 4) / 6 = 0.333...
        """
        result = assignment_mastery(
            [(3, 0), (3, 0), (3, 0), (3, 0)],
            total_words=6,
        )
        assert result["words_high"] == 0
        assert result["words_medium"] == 4
        assert result["words_low"] == 2
        assert abs(result["current_mastery"] - (2.0 / 6.0)) < 1e-9

    def test_full_mastery_still_requires_all_words_at_high_tier(self):
        """
        Boundary check: even with the 0.5 medium weight, current_mastery == 1.0
        is only reachable when every word is at high tier (since the maximum
        contribution of medium is 0.5 each).
        """
        # All medium → 0.5 * total / total = 0.5, NOT 1.0
        all_medium = assignment_mastery(
            [(3, 0)] * 4,
            total_words=4,
        )
        assert all_medium["words_high"] == 0
        assert all_medium["words_medium"] == 4
        assert abs(all_medium["current_mastery"] - 0.5) < 1e-9
        # All high → 1.0
        all_high = assignment_mastery(
            [(5, 0)] * 4,
            total_words=4,
        )
        assert all_high["words_high"] == 4
        assert all_high["current_mastery"] == 1.0

    def test_full_mastery(self):
        result = assignment_mastery([(5, 0), (5, 0), (5, 0)], total_words=3)
        assert result["current_mastery"] == 1.0
        assert result["words_high"] == 3
        assert result["words_low"] == 0

    def test_unpracticed_words_count_as_low(self):
        # Spec: 尚未開始練習的單字熟悉度為「不熟」.
        # Aggregation: total - high - medium → low includes unpracticed.
        result = assignment_mastery([(5, 0)], total_words=10)
        assert result["words_high"] == 1
        assert result["words_medium"] == 0
        assert result["words_low"] == 9


class TestRegressionCompanionToBug452:
    """
    Issue #711 must not regress #452's invariant: a single wrong answer on a
    fresh word must not raise the assignment's familiarity.
    """

    def test_first_wrong_answer_does_not_increase_mastery(self):
        before = assignment_mastery([], total_words=5)
        after = assignment_mastery([(0, 1)], total_words=5)
        assert after["current_mastery"] == before["current_mastery"]
        assert after["words_high"] == 0
        assert after["words_medium"] == 0
