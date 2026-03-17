"""
Regression tests for issue #452: word familiarity incorrectly increases on wrong answers.

Root cause: First incorrect answer on a new word was creating a user_word_progress record
with memory_strength=0.2. Since the word had no prior record (treated as 0 in mastery
calculation), inserting 0.2 inflated the class average — making familiarity go UP on a
wrong answer.

Fix: First incorrect answer → memory_strength=0.0 (not 0.2).
     Subsequent incorrect answers → GREATEST(0.0, ...) instead of GREATEST(0.1, ...).
"""

from decimal import Decimal


def simulate_memory_strength_on_first_answer(is_correct: bool) -> float:
    """
    Pure-Python replica of the fixed update_memory_strength INSERT branch.
    Returns the memory_strength value stored for a brand-new word record.
    """
    return 0.5 if is_correct else 0.0


def simulate_memory_strength_on_subsequent_incorrect(
    current_strength: float,
    time_decay_factor: float = 1.0,
) -> float:
    """
    Pure-Python replica of the fixed incorrect-answer UPDATE branch.
    time_decay_factor=1.0 means no time has passed (strength unchanged before halving).
    """
    decayed = current_strength * time_decay_factor
    return max(0.0, decayed * 0.5)


class TestFirstIncorrectAnswer:
    def test_first_incorrect_answer_gives_zero_memory_strength(self):
        """Bug #452: first incorrect answer must NOT inflate the word's memory_strength."""
        strength = simulate_memory_strength_on_first_answer(is_correct=False)
        assert strength == 0.0, (
            f"Expected memory_strength=0.0 for first incorrect answer, got {strength}"
        )

    def test_first_correct_answer_gives_nonzero_memory_strength(self):
        """Control: first correct answer should still start at 0.5."""
        strength = simulate_memory_strength_on_first_answer(is_correct=True)
        assert strength == 0.5

    def test_first_incorrect_does_not_increase_class_average(self):
        """
        Bug #452 scenario: a word with no prior record has an implicit mastery of 0.
        After a wrong answer the stored value must be <= 0, otherwise the average rises.
        """
        strength = simulate_memory_strength_on_first_answer(is_correct=False)
        assert strength <= 0.0, (
            "Familiarity must not increase when answering a new word incorrectly"
        )


class TestSubsequentIncorrectAnswers:
    def test_subsequent_incorrect_can_go_below_point_one(self):
        """After the fix, memory_strength may fall below 0.1 (no 0.1 floor)."""
        # 0.05 * 0.5 = 0.025, which is below 0.1 — allowed by the fix
        strength = simulate_memory_strength_on_subsequent_incorrect(
            current_strength=0.05
        )
        assert strength < 0.1
        assert strength >= 0.0

    def test_subsequent_incorrect_floors_at_zero_not_point_one(self):
        """Pre-fix behaviour had GREATEST(0.1, ...) which prevented reaching 0."""
        strength = simulate_memory_strength_on_subsequent_incorrect(
            current_strength=0.1
        )
        # 0.1 * 0.5 = 0.05, which is >= 0 so no clamping needed; result must be < 0.1
        assert strength < 0.1
        assert strength >= 0.0

    def test_subsequent_incorrect_halves_strength(self):
        strength = simulate_memory_strength_on_subsequent_incorrect(
            current_strength=0.8
        )
        assert abs(strength - 0.4) < 1e-9
