"""
Tests for issue #711: diff-based 5-tier familiarity classification.

The new ``calculate_assignment_mastery`` SQL function classifies each word in
a vocabulary assignment into one of five tiers based on the *net* number of
correct answers. Errors directly cancel out previous correct answers:

    diff = correct_count - incorrect_count

    master           (精熟)    diff >= 4   weight 1.00
    familiar         (熟悉)    diff == 3   weight 0.75
    medium           (普通)    diff == 2   weight 0.50
    unfamiliar       (不熟悉)  diff == 1   weight 0.25
    very_unfamiliar  (非常不熟) diff <= 0   weight 0.00 (incl. unpracticed)

    current_mastery =
        (master + 0.75*familiar + 0.5*medium + 0.25*unfamiliar) / total_words

So one master word raises mastery by exactly 1/total_words; one familiar
by 0.75/total_words; etc. current_mastery == 1.0 still strictly requires
every word at master tier (other tiers contribute at most 0.75 each).

These tests replicate the SQL logic in pure Python so they run without a
database. They cover every spec point and the dogfood scenario where a 6-word
assignment with N rounds of all-correct lands every word in the matching
tier (1 round → unfamiliar 25%, 2 → medium 50%, 3 → familiar 75%, 4 → master 100%).
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
    """Pure-Python replica of the SQL diff-based classification."""
    diff = correct - incorrect
    if diff >= 4:
        return "master"
    if diff == 3:
        return "familiar"
    if diff == 2:
        return "medium"
    if diff == 1:
        return "unfamiliar"
    return "very_unfamiliar"


def assignment_mastery(words: List[Tuple[int, int]], total_words: int) -> dict:
    """Replica of ``calculate_assignment_mastery`` aggregation.

    ``words`` is a list of (correct_count, incorrect_count) tuples — one per
    practiced word. Words without a row are absent; ``total_words`` includes
    them and they fall into ``very_unfamiliar``.
    """
    counts = {tier: 0 for tier in TIER_WEIGHTS}
    for c, i in words:
        counts[classify_tier(c, i)] += 1
    accounted = sum(counts[t] for t in ("master", "familiar", "medium", "unfamiliar"))
    counts["very_unfamiliar"] = max(0, total_words - accounted)
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
# Per-row classification: every diff value
# ---------------------------------------------------------------------------


class TestClassifyTier:
    def test_no_practice_is_very_unfamiliar(self):
        # diff = 0 - 0 = 0 → T1.
        assert classify_tier(0, 0) == "very_unfamiliar"

    def test_only_wrong_answers_is_very_unfamiliar(self):
        # Companion to #452: a word the student has only ever answered
        # wrong is treated the same as never-practiced.
        assert classify_tier(0, 5) == "very_unfamiliar"

    def test_diff_zero_with_practice_is_very_unfamiliar(self):
        # 5 right + 5 wrong → diff = 0. Practice quantity does not save
        # the tier — only the *net* matters.
        assert classify_tier(5, 5) == "very_unfamiliar"

    def test_diff_one_is_unfamiliar(self):
        assert classify_tier(1, 0) == "unfamiliar"
        assert classify_tier(2, 1) == "unfamiliar"
        assert classify_tier(10, 9) == "unfamiliar"

    def test_diff_two_is_medium(self):
        assert classify_tier(2, 0) == "medium"
        assert classify_tier(3, 1) == "medium"

    def test_diff_three_is_familiar(self):
        assert classify_tier(3, 0) == "familiar"
        assert classify_tier(4, 1) == "familiar"

    def test_diff_four_is_master(self):
        assert classify_tier(4, 0) == "master"

    def test_diff_above_four_stays_master(self):
        assert classify_tier(5, 0) == "master"
        assert classify_tier(10, 6) == "master"  # diff=4 even with 6 errors

    def test_negative_diff_is_very_unfamiliar(self):
        # More wrong than right ⇒ effectively no progress.
        assert classify_tier(2, 5) == "very_unfamiliar"


# ---------------------------------------------------------------------------
# Aggregate / mastery formula
# ---------------------------------------------------------------------------


class TestAssignmentMastery:
    def test_unpracticed_assignment_has_zero_mastery_and_all_very_unfamiliar(self):
        result = assignment_mastery([], total_words=10)
        assert result["current_mastery"] == 0.0
        assert result["very_unfamiliar"] == 10

    def test_six_words_one_round_correct_is_25_percent(self):
        # diff = 1 → T2 → weight 0.25 → 0.25 * 6 / 6 = 0.25
        result = assignment_mastery([(1, 0)] * 6, total_words=6)
        assert result["unfamiliar"] == 6
        assert abs(result["current_mastery"] - 0.25) < 1e-9

    def test_six_words_two_rounds_correct_is_50_percent(self):
        # diff = 2 → T3 → 0.5 * 6 / 6 = 0.5
        result = assignment_mastery([(2, 0)] * 6, total_words=6)
        assert result["medium"] == 6
        assert abs(result["current_mastery"] - 0.5) < 1e-9

    def test_six_words_three_rounds_correct_is_75_percent(self):
        # diff = 3 → T4 → 0.75 * 6 / 6 = 0.75
        result = assignment_mastery([(3, 0)] * 6, total_words=6)
        assert result["familiar"] == 6
        assert abs(result["current_mastery"] - 0.75) < 1e-9

    def test_six_words_four_rounds_correct_is_full_mastery(self):
        # diff = 4 → T5 → 1.0
        result = assignment_mastery([(4, 0)] * 6, total_words=6)
        assert result["master"] == 6
        assert result["current_mastery"] == 1.0

    def test_one_master_raises_mastery_by_one_over_total(self):
        result = assignment_mastery([(4, 0)], total_words=6)
        assert result["master"] == 1
        assert abs(result["current_mastery"] - 1 / 6) < 1e-9

    def test_mixed_distribution_weights_correctly(self):
        # diff: 4 → T5, 3 → T4, 2 → T3, 1 → T2, 0 → T1
        # mastery = (1 + 0.75 + 0.5 + 0.25 + 0) / 5 = 0.5
        result = assignment_mastery(
            [(4, 0), (3, 0), (2, 0), (1, 0)],
            total_words=5,
        )
        assert result["master"] == 1
        assert result["familiar"] == 1
        assert result["medium"] == 1
        assert result["unfamiliar"] == 1
        assert result["very_unfamiliar"] == 1
        assert abs(result["current_mastery"] - 0.5) < 1e-9

    def test_full_mastery_strictly_requires_every_word_at_master(self):
        # All-familiar tops out at 0.75 — diff=3 isn't enough.
        result = assignment_mastery([(3, 0)] * 4, total_words=4)
        assert result["familiar"] == 4
        assert abs(result["current_mastery"] - 0.75) < 1e-9

    def test_high_practice_with_balanced_errors_collapses_to_very_unfamiliar(self):
        # Diff-based ladder is unforgiving when errors keep up with corrects:
        # 10 right + 10 wrong ⇒ diff=0 ⇒ T1.
        result = assignment_mastery([(10, 10)] * 6, total_words=6)
        assert result["very_unfamiliar"] == 6
        assert result["current_mastery"] == 0.0


# ---------------------------------------------------------------------------
# Regression companion for #452
# ---------------------------------------------------------------------------


class TestRegressionCompanionToBug452:
    def test_first_wrong_answer_does_not_increase_mastery(self):
        before = assignment_mastery([], total_words=5)
        after = assignment_mastery([(0, 1)], total_words=5)
        assert after["current_mastery"] == before["current_mastery"]
        assert classify_tier(0, 1) == "very_unfamiliar"
