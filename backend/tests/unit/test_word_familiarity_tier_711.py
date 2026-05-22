"""
Tests for issue #800: relaxed tier classification with repetition-count
fallback and half-weight error penalty.

Replaces the diff-based rules from issue #711. Each word is still classified
into one of five tiers, but the rules now look at *two* fields and use a
softer "diff" (errors only -0.5):

    diff = correct_count - 0.5 * incorrect_count

    T5 master           diff >= 3  OR  repetition_count >= 3   weight 1.0
    T4 familiar         diff >= 2  OR  repetition_count >= 2   weight 0.8   (not T5)
    T3 medium           diff >= 1                              weight 0.6   (not T4/T5)
    T2 unfamiliar       practiced (total_attempts > 0)         weight 0.4   (not T3+)
    T1 very_unfamiliar  never practiced                        weight 0.0

    current_mastery =
        (T5 + 0.8*T4 + 0.6*T3 + 0.4*T2) / total_words

Why the change (from issue #800):
- Old "diff >= 4 -> master" required 4 consecutive corrects with no errors;
  teachers/students reported targets were unreachable in a 5-day window.
- 0.5 penalty for errors lets one mistake cost only half a step, not a
  whole one — students who recover are not permanently penalised.
- The OR-on-repetition_count short-circuit means "answered correctly 3
  times in a row, regardless of past mistakes" is enough to count as
  master. This is the intuitive teacher mental model.
- New weights mean "every word at T4 (連對 2 次)" reaches 80%, which is
  the default target proficiency. The previous 0.75 weight at T4 fell
  short of the default threshold.

These tests replicate the SQL logic in pure Python so they run without a
database.
"""

from typing import List, Tuple


TIER_WEIGHTS = {
    "master": 1.0,
    "familiar": 0.8,
    "medium": 0.6,
    "unfamiliar": 0.4,
    "very_unfamiliar": 0.0,
}


def classify_tier(correct: int, incorrect: int, repetition: int) -> str:
    """Pure-Python replica of the SQL tier classification (issue #800).

    diff = correct - 0.5 * incorrect
    """
    diff = correct - 0.5 * incorrect
    # T5 / T4 use OR with repetition_count
    if diff >= 3 or repetition >= 3:
        return "master"
    if diff >= 2 or repetition >= 2:
        return "familiar"
    if diff >= 1:
        return "medium"
    if correct + incorrect > 0:
        return "unfamiliar"
    return "very_unfamiliar"


def assignment_mastery(
    words: List[Tuple[int, int, int]], total_words: int
) -> dict:
    """Replica of ``calculate_assignment_mastery`` aggregation.

    ``words`` is a list of (correct_count, incorrect_count, repetition_count)
    tuples — one per practiced word. Words without a row fall into
    ``very_unfamiliar`` by subtraction.
    """
    counts = {tier: 0 for tier in TIER_WEIGHTS}
    for c, i, r in words:
        counts[classify_tier(c, i, r)] += 1
    accounted = sum(
        counts[t] for t in ("master", "familiar", "medium", "unfamiliar")
    )
    counts["very_unfamiliar"] = max(0, total_words - accounted)
    if total_words == 0:
        current = 0.0
    else:
        current = (
            sum(TIER_WEIGHTS[t] * counts[t] for t in TIER_WEIGHTS)
            / total_words
        )
    return {
        "current_mastery": current,
        **counts,
        "total_words": total_words,
    }


class TestClassifyTierDiffPath:
    def test_no_practice_is_very_unfamiliar(self):
        assert classify_tier(0, 0, 0) == "very_unfamiliar"

    def test_practiced_only_wrong_is_unfamiliar_not_very(self):
        assert classify_tier(0, 5, 0) == "unfamiliar"

    def test_diff_one_is_medium(self):
        assert classify_tier(1, 0, 1) == "medium"
        assert classify_tier(3, 4, 0) == "medium"  # 3 - 2.0 = 1.0

    def test_diff_two_is_familiar(self):
        assert classify_tier(2, 0, 2) == "familiar"
        assert classify_tier(3, 2, 0) == "familiar"  # 3 - 1.0 = 2.0

    def test_diff_three_is_master(self):
        assert classify_tier(3, 0, 3) == "master"
        assert classify_tier(5, 4, 0) == "master"  # 5 - 2.0 = 3.0

    def test_higher_diff_stays_master(self):
        assert classify_tier(10, 0, 10) == "master"
        assert classify_tier(20, 30, 0) == "master"  # 20 - 15 = 5

    def test_half_penalty_keeps_word_at_t4(self):
        # 3 correct + 1 wrong: diff = 2.5 → T4 familiar
        # (Old #711 diff=2 → T3 medium; new is more forgiving.)
        assert classify_tier(3, 1, 0) == "familiar"

    def test_one_slip_after_three_corrects_stays_master(self):
        # 4 correct + 1 wrong: diff = 3.5 → T5 master
        # (Old #711: diff=3 → T4; new keeps the master label.)
        assert classify_tier(4, 1, 0) == "master"


class TestClassifyTierRepetitionPath:
    def test_three_consecutive_correct_qualifies_master(self):
        # 4 correct, 2 wrong, rep=3 — diff = 4 - 1 = 3 also qualifies,
        # but the OR short-circuit means rep alone would be enough.
        assert classify_tier(4, 2, 3) == "master"

    def test_repetition_can_lift_above_diff_tier(self):
        # diff = 3 - 0.5 = 2.5 → would be T4 by diff alone.
        # rep>=3 short-circuits to T5.
        assert classify_tier(3, 1, 3) == "master"

    def test_repetition_two_qualifies_t4(self):
        assert classify_tier(2, 0, 2) == "familiar"

    def test_repetition_one_does_not_lift_to_t4(self):
        # rep=1 doesn't trigger the OR. Falls through to diff path.
        # 1 correct + 0 wrong + rep=1 → diff=1 → T3.
        assert classify_tier(1, 0, 1) == "medium"

    def test_lost_repetition_after_error_falls_back_to_diff(self):
        # 4 correct, 1 wrong, rep=0 (error was last).
        # diff = 4 - 0.5 = 3.5 → T5 still (via diff path).
        assert classify_tier(4, 1, 0) == "master"


class TestAssignmentMastery:
    def test_unpracticed_assignment_has_zero_mastery(self):
        result = assignment_mastery([], total_words=10)
        assert result["current_mastery"] == 0.0
        assert result["very_unfamiliar"] == 10

    def test_all_t4_reaches_default_target_proficiency(self):
        # Key behaviour: every word T4 = mastery 0.8 = default 80% target.
        result = assignment_mastery([(2, 0, 2)] * 10, total_words=10)
        assert result["familiar"] == 10
        assert abs(result["current_mastery"] - 0.8) < 1e-9

    def test_all_t5_gives_full_mastery(self):
        result = assignment_mastery([(3, 0, 3)] * 6, total_words=6)
        assert result["master"] == 6
        assert result["current_mastery"] == 1.0

    def test_mixed_distribution_weights_correctly(self):
        # 1 T5 + 1 T4 + 1 T3 + 1 T2 + 1 T1
        # = (1 + 0.8 + 0.6 + 0.4 + 0) / 5 = 2.8 / 5 = 0.56
        result = assignment_mastery(
            [
                (3, 0, 3),  # T5
                (2, 0, 2),  # T4
                (1, 0, 1),  # T3
                (1, 2, 0),  # T2 (practiced, diff=0)
            ],
            total_words=5,  # 5th word never practiced → T1
        )
        assert result["master"] == 1
        assert result["familiar"] == 1
        assert result["medium"] == 1
        assert result["unfamiliar"] == 1
        assert result["very_unfamiliar"] == 1
        assert abs(result["current_mastery"] - 0.56) < 1e-9

    def test_one_master_raises_mastery_by_one_over_total(self):
        result = assignment_mastery([(3, 0, 3)], total_words=6)
        assert result["master"] == 1
        assert abs(result["current_mastery"] - 1 / 6) < 1e-9

    def test_recovered_student_reaches_t5_via_repetition(self):
        # 3 right, 2 wrong, then 3 in a row right (rep=3).
        # diff = 3 - 1 = 2 → T4 by diff alone, but rep>=3 → T5.
        result = assignment_mastery([(3, 2, 3)] * 4, total_words=4)
        assert result["master"] == 4
        assert result["current_mastery"] == 1.0


class TestHalfPenaltyMakesProgressEasier:
    def test_equal_corrects_and_errors_no_longer_zero_tier(self):
        # Old #711: 4 right + 4 wrong = diff=0 = T1.
        # New #800: diff = 4 - 2 = 2 = T4. Practice quantity matters again.
        assert classify_tier(4, 4, 0) == "familiar"

    def test_two_errors_still_recoverable_to_master(self):
        # 5 correct, 2 wrong, rep=0: diff = 5 - 1 = 4 → T5.
        assert classify_tier(5, 2, 0) == "master"
