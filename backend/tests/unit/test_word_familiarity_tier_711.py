"""
Tests for issue #711: 5-tier count-based familiarity classification.

The new ``calculate_assignment_mastery`` SQL function classifies each word
in a vocabulary assignment into one of five tiers based on
``user_word_progress.correct_count`` / ``incorrect_count``:

    master            (精熟)     correct >= 5 AND rate >= 0.9    (weight 1.00)
    familiar          (熟悉)     correct >= 4 AND rate >= 0.75   (weight 0.75)
    medium            (普通)     correct >= 3 AND rate >= 0.5    (weight 0.50)
    unfamiliar        (不熟悉)   correct >= 1 (other practiced)  (weight 0.25)
    very_unfamiliar   (非常不熟) correct == 0                    (weight 0.00)

    rate = correct / (correct + incorrect)

    current_mastery =
        (master + 0.75*familiar + 0.5*medium + 0.25*unfamiliar) / total_words

current_mastery == 1.0 still strictly requires every word at master tier
(non-master tiers contribute at most 0.75 each).

These tests replicate the SQL logic in pure Python so they can run without
a database. They cover the whole spec ladder plus the dogfood scenario
where a 6-word assignment with 3 rounds of all-correct lands every word
in ``medium`` (50% mastery, never 0% any more).
"""

from typing import List, Tuple


TIER_WEIGHTS = {
    "master": 1.0,
    "familiar": 0.75,
    "medium": 0.5,
    "unfamiliar": 0.25,
    "very_unfamiliar": 0.0,
}


def classify_tier(correct: int, incorrect: int) -> str:
    """Pure-Python replica of the per-row classification used by the SQL."""
    if correct == 0:
        return "very_unfamiliar"
    total = correct + incorrect
    rate = correct / total if total > 0 else 0
    if correct >= 5 and rate >= 0.9:
        return "master"
    if correct >= 4 and rate >= 0.75:
        return "familiar"
    if correct >= 3 and rate >= 0.5:
        return "medium"
    return "unfamiliar"


def assignment_mastery(
    words: List[Tuple[int, int]], total_words: int
) -> dict:
    """Replica of ``calculate_assignment_mastery`` aggregation.

    ``words`` is a list of (correct_count, incorrect_count) tuples — one per
    practiced word in ``user_word_progress``. Words without a row are
    represented by being absent from this list; ``total_words`` includes them
    and they fall into ``very_unfamiliar``.
    """
    counts = {tier: 0 for tier in TIER_WEIGHTS}
    for c, i in words:
        counts[classify_tier(c, i)] += 1
    accounted_for = sum(counts[t] for t in ("master", "familiar", "medium", "unfamiliar"))
    counts["very_unfamiliar"] = max(0, total_words - accounted_for)
    if total_words == 0:
        current = 0.0
    else:
        current = sum(TIER_WEIGHTS[t] * counts[t] for t in TIER_WEIGHTS) / total_words
    return {
        "current_mastery": current,
        **counts,
        "total_words": total_words,
    }


# ---------------------------------------------------------------------------
# Per-row classification: every spec rule
# ---------------------------------------------------------------------------


class TestClassifyTier:
    def test_no_practice_is_very_unfamiliar(self):
        # 「正確次數=0…尚未開始練習，所有單字之單字熟悉度為{不熟}」.
        # In the 5-tier scheme this is the lowest tier (very_unfamiliar).
        assert classify_tier(0, 0) == "very_unfamiliar"

    def test_only_wrong_answers_is_very_unfamiliar(self):
        # Word the student has only ever answered wrong — same tier as
        # never-practiced. Companion to the #452 invariant.
        assert classify_tier(0, 5) == "very_unfamiliar"

    def test_one_or_two_corrects_is_unfamiliar(self):
        assert classify_tier(1, 0) == "unfamiliar"
        assert classify_tier(2, 0) == "unfamiliar"

    def test_three_corrects_no_errors_is_medium(self):
        # 「正確次數>=3 → 普通」 when no errors
        assert classify_tier(3, 0) == "medium"

    def test_four_corrects_no_errors_is_familiar(self):
        assert classify_tier(4, 0) == "familiar"

    def test_five_corrects_no_errors_is_master(self):
        # 「正確次數>=5 → 熟悉/精熟」
        assert classify_tier(5, 0) == "master"

    def test_master_requires_rate_at_least_ninety(self):
        # 5/6 ≈ 83.3% < 90% → drops to familiar.
        assert classify_tier(5, 1) == "familiar"
        # 9/10 = 90% → back to master.
        assert classify_tier(9, 1) == "master"

    def test_familiar_requires_rate_at_least_seventy_five(self):
        # 4/5 = 80% ≥ 75% → familiar.
        assert classify_tier(4, 1) == "familiar"
        # 4/6 ≈ 67% < 75% but ≥ 50% → medium.
        assert classify_tier(4, 2) == "medium"

    def test_medium_requires_rate_at_least_fifty(self):
        # 3/6 = 50% → medium.
        assert classify_tier(3, 3) == "medium"
        # 3/7 ≈ 43% < 50% → unfamiliar (still has corrects).
        assert classify_tier(3, 4) == "unfamiliar"

    def test_low_rate_collapses_to_unfamiliar(self):
        assert classify_tier(2, 10) == "unfamiliar"

    def test_high_rate_low_count_falls_to_unfamiliar(self):
        # rate=100% but only 1 correct — too few attempts for medium+.
        assert classify_tier(1, 0) == "unfamiliar"


# ---------------------------------------------------------------------------
# Aggregate / mastery formula
# ---------------------------------------------------------------------------


class TestAssignmentMastery:
    def test_unpracticed_assignment_has_zero_mastery_and_all_very_unfamiliar(self):
        result = assignment_mastery([], total_words=10)
        assert result["current_mastery"] == 0.0
        assert result["very_unfamiliar"] == 10
        assert result["master"] == 0
        assert result["familiar"] == 0
        assert result["medium"] == 0
        assert result["unfamiliar"] == 0

    def test_six_words_three_rounds_all_correct_lands_in_medium(self):
        """
        Dogfood scenario from issue thread: 6-word assignment, 3 rounds,
        every answer correct. Used to display 0% under the 3-tier scheme;
        now displays 50% (every word at medium tier).
        """
        result = assignment_mastery([(3, 0)] * 6, total_words=6)
        assert result["medium"] == 6
        assert result["master"] == 0
        assert result["familiar"] == 0
        assert result["unfamiliar"] == 0
        assert result["very_unfamiliar"] == 0
        assert abs(result["current_mastery"] - 0.5) < 1e-9

    def test_six_words_four_rounds_all_correct_lands_in_familiar(self):
        result = assignment_mastery([(4, 0)] * 6, total_words=6)
        assert result["familiar"] == 6
        assert abs(result["current_mastery"] - 0.75) < 1e-9

    def test_six_words_five_rounds_all_correct_is_full_mastery(self):
        result = assignment_mastery([(5, 0)] * 6, total_words=6)
        assert result["master"] == 6
        assert result["current_mastery"] == 1.0

    def test_mixed_distribution_weights_correctly(self):
        # 1 master + 1 familiar + 1 medium + 1 unfamiliar + 1 unpracticed
        # = (1 + 0.75 + 0.5 + 0.25 + 0) / 5 = 0.5
        result = assignment_mastery(
            [(5, 0), (4, 0), (3, 0), (1, 0)],
            total_words=5,
        )
        assert result["master"] == 1
        assert result["familiar"] == 1
        assert result["medium"] == 1
        assert result["unfamiliar"] == 1
        assert result["very_unfamiliar"] == 1
        assert abs(result["current_mastery"] - 0.5) < 1e-9

    def test_full_mastery_is_unreachable_below_master_tier(self):
        # All-familiar tops out at 0.75 — 1.0 strictly requires every word
        # to be at master tier.
        result = assignment_mastery([(4, 0)] * 4, total_words=4)
        assert result["familiar"] == 4
        assert abs(result["current_mastery"] - 0.75) < 1e-9
        # Drop one to medium — mastery falls correspondingly.
        result2 = assignment_mastery([(4, 0), (4, 0), (4, 0), (3, 0)], total_words=4)
        assert abs(result2["current_mastery"] - (0.75 * 3 + 0.5) / 4) < 1e-9


# ---------------------------------------------------------------------------
# Regression companion for #452
# ---------------------------------------------------------------------------


class TestRegressionCompanionToBug452:
    def test_first_wrong_answer_does_not_increase_mastery(self):
        """A single wrong answer on a fresh word must not raise the
        assignment's familiarity above the unpracticed baseline."""
        before = assignment_mastery([], total_words=5)
        after = assignment_mastery([(0, 1)], total_words=5)
        assert after["current_mastery"] == before["current_mastery"]
        # Still classified at the lowest tier.
        assert classify_tier(0, 1) == "very_unfamiliar"
