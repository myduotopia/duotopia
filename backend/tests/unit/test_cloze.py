"""Unit tests for word-cloze answer extraction (Issue #632).

The auto-extractor handles regular morphology (plurals, -ing, comparatives via
prefix match). Irregular forms (swim→swam, child→children, good→best) and
phrase changes (a piece of cake→two pieces of cake) cannot be derived by string
matching and are left to teacher confirmation/override per the #632 UX.
"""
from types import SimpleNamespace

from utils.cloze import (
    build_blank,
    compute_cloze_answer,
    extract_cloze,
    extract_cloze_for_item,
    find_cloze_match,
    resolve_cloze_answer_on_save,
)


class TestExtractCloze:
    def test_exact_match(self):
        blanked, answer = extract_cloze("cup", "I drink from a cup.")
        assert answer == "cup"
        assert "_" in blanked
        assert "cup" not in blanked

    def test_plural_prefix_match(self):
        blanked, answer = extract_cloze("cup", "I have two cups on the table.")
        assert answer == "cups"
        assert "cups" not in blanked

    def test_comparative_prefix_match(self):
        _blanked, answer = extract_cloze("big", "This box is bigger than that one.")
        assert answer == "bigger"

    def test_ing_prefix_match(self):
        _blanked, answer = extract_cloze("swim", "They are swimming in the lake.")
        assert answer == "swimming"

    def test_case_insensitive(self):
        _blanked, answer = extract_cloze("cup", "Cups are useful.")
        assert answer == "Cups"

    def test_child_children_prefix_match(self):
        # "children" starts with "child" → prefix match catches it
        _blanked, answer = extract_cloze("child", "The children played.")
        assert answer == "children"

    def test_irregular_returns_none(self):
        # Stem-changing irregulars cannot be matched by prefix; teacher overrides.
        assert extract_cloze("swim", "He swam across the river.") is None
        assert extract_cloze("good", "This is the best option.") is None

    def test_empty_inputs(self):
        assert extract_cloze("", "a sentence") is None
        assert extract_cloze("word", "") is None


class TestFindClozeMatch:
    def test_multiword_phrase_exact(self):
        match = find_cloze_match("two pieces of cake", "I ate two pieces of cake.")
        assert match is not None
        _start, _end, text = match
        assert text == "two pieces of cake"

    def test_multiword_no_prefix_fallback(self):
        # multi-word answers do not get prefix matching
        assert find_cloze_match("a piece of cake", "I ate two pieces of cake.") is None


class TestResolveOnSave:
    def test_client_override_wins(self):
        result = resolve_cloze_answer_on_save(
            base_word="swim",
            example_sentence="He swam across.",
            incoming_answer="swam",
            existing_answer=None,
        )
        assert result == "swam"

    def test_existing_answer_kept_when_still_present(self):
        # Teacher previously set "swam"; sentence still contains it → keep it,
        # do NOT re-extract (which would yield None).
        result = resolve_cloze_answer_on_save(
            base_word="swim",
            example_sentence="He swam across the river.",
            incoming_answer=None,
            existing_answer="swam",
        )
        assert result == "swam"

    def test_reextract_when_existing_answer_absent(self):
        # Teacher's old answer no longer appears in the new sentence → re-extract.
        result = resolve_cloze_answer_on_save(
            base_word="cup",
            example_sentence="I have two cups now.",
            incoming_answer=None,
            existing_answer="swam",
        )
        assert result == "cups"

    def test_autoextract_when_no_existing(self):
        result = resolve_cloze_answer_on_save(
            base_word="cup",
            example_sentence="Two cups please.",
            incoming_answer=None,
            existing_answer=None,
        )
        assert result == "cups"

    def test_none_when_nothing_matches(self):
        result = resolve_cloze_answer_on_save(
            base_word="swim",
            example_sentence="He swam across.",
            incoming_answer=None,
            existing_answer=None,
        )
        assert result is None

    def test_empty_incoming_falls_through(self):
        result = resolve_cloze_answer_on_save(
            base_word="cup",
            example_sentence="Two cups please.",
            incoming_answer="   ",
            existing_answer=None,
        )
        assert result == "cups"


class TestComputeClozeAnswer:
    def test_returns_only_answer(self):
        assert compute_cloze_answer("cup", "Two cups please.") == "cups"
        assert compute_cloze_answer("swim", "He swam.") is None


class TestExtractClozeForItem:
    def test_persisted_answer_preferred(self):
        item = SimpleNamespace(
            text="swim",
            example_sentence="He swam across the river.",
            cloze_answer="swam",
        )
        blanked, answer = extract_cloze_for_item(item)
        assert answer == "swam"
        assert "swam" not in blanked

    def test_persisted_answer_ignored_when_absent_from_sentence(self):
        # cloze_answer stale (sentence changed) → fall back to auto-extract
        item = SimpleNamespace(
            text="cup",
            example_sentence="I have two cups.",
            cloze_answer="swam",
        )
        _blanked, answer = extract_cloze_for_item(item)
        assert answer == "cups"

    def test_autoextract_when_no_persisted(self):
        item = SimpleNamespace(
            text="cup",
            example_sentence="Two cups please.",
            cloze_answer=None,
        )
        _blanked, answer = extract_cloze_for_item(item)
        assert answer == "cups"

    def test_example_sentences_shape(self):
        # No base word vocab; text itself is the sentence
        item = SimpleNamespace(
            text="The elephant is enormous today.",
            example_sentence=None,
            cloze_answer=None,
        )
        blanked, answer = extract_cloze_for_item(item)
        # longest content word picked
        assert answer == "elephant"
        # 單字答案 → 單一挖空格（不透露字母數）
        assert "_" in blanked
        assert "elephant" not in blanked


class TestBuildBlank:
    """#880: 挖空格數等於答案的「單字數量」（不是字母數）。"""

    def test_single_word_is_one_blank(self):
        assert build_blank("cup") == "_"
        assert build_blank("elephant") == "_"

    def test_multiword_one_blank_per_word(self):
        assert build_blank("two pieces of cake") == "_ _ _ _"

    def test_empty_falls_back_to_single_blank(self):
        assert build_blank("") == "_"
        assert build_blank("   ") == "_"


class TestBlankIsWordCount:
    """挖空格數跟著答案的單字數量走，與字母數無關。"""

    def test_single_word_blank_regardless_of_length(self):
        blanked, answer = extract_cloze("cup", "I have two cups on the table.")
        assert answer == "cups"
        # "cups" 是一個單字 → 一個挖空格
        assert blanked == "I have two _ on the table."

    def test_multiword_persisted_answer(self):
        item = SimpleNamespace(
            text="cake",
            example_sentence="I ate two pieces of cake.",
            cloze_answer="two pieces of cake",
        )
        blanked, answer = extract_cloze_for_item(item)
        assert answer == "two pieces of cake"
        # 四個單字 → 四個挖空格
        assert blanked == "I ate _ _ _ _."


# --- Issue #860: 單字選擇例句題的單一格收合 -------------------------------


def test_collapse_to_single_blank_merges_phrase_blanks():
    """片語答案的多格挖空要收合成一格 —— 選擇題顯示格數等於洩漏答案字數。"""
    from utils.cloze import collapse_to_single_blank

    assert (
        collapse_to_single_blank("I love to _ _ of landscapes.")
        == "I love to _ of landscapes."
    )
    assert collapse_to_single_blank("Give me _ _ _ _ please.") == "Give me _ please."


def test_collapse_to_single_blank_leaves_single_blank_untouched():
    from utils.cloze import collapse_to_single_blank

    assert collapse_to_single_blank("I eat an _.") == "I eat an _."
    assert collapse_to_single_blank("") == ""


def test_build_blank_still_per_word_for_word_cloze():
    """word_cloze（打字作答）維持一字一格 —— #880 的刻意設計，不受 #860 影響。"""
    from utils.cloze import build_blank

    assert build_blank("cake") == "_"
    assert build_blank("two pieces of cake") == "_ _ _ _"
