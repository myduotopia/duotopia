"""Unit tests for distractor shape helpers (Issue #631)."""

import random
from types import SimpleNamespace

from utils.distractors import (
    answer_text_for_item,
    build_answer_pool,
    distractor_text,
    make_distractor,
    normalize_distractors,
    regenerate_word_selection_distractors,
    text_field_for_show_image,
)


class TestNormalizeDistractors:
    def test_legacy_str_shape_coerced(self):
        result = normalize_distractors(["banana", "apple"])
        assert result == [
            {"text": "banana", "image_url": None},
            {"text": "apple", "image_url": None},
        ]

    def test_modern_dict_shape_passthrough(self):
        result = normalize_distractors(
            [
                {"text": "banana", "image_url": "https://x"},
                {"text": "orange", "image_url": None},
            ]
        )
        assert result == [
            {"text": "banana", "image_url": "https://x"},
            {"text": "orange", "image_url": None},
        ]

    def test_mixed_shapes_normalized(self):
        result = normalize_distractors(["legacy", {"text": "modern", "image_url": "u"}])
        assert result == [
            {"text": "legacy", "image_url": None},
            {"text": "modern", "image_url": "u"},
        ]

    def test_none_returns_empty(self):
        assert normalize_distractors(None) == []

    def test_non_list_returns_empty(self):
        assert normalize_distractors("not a list") == []
        assert normalize_distractors({}) == []

    def test_drops_empty_text_entries(self):
        result = normalize_distractors(
            ["", "  ", {"text": ""}, {"text": "  "}, {"image_url": "u"}]
        )
        assert result == []

    def test_drops_invalid_entries_keeps_valid(self):
        result = normalize_distractors(
            [42, None, "ok", {"text": "good"}, {"foo": "bar"}]
        )
        assert result == [
            {"text": "ok", "image_url": None},
            {"text": "good", "image_url": None},
        ]

    def test_strips_whitespace_in_text(self):
        result = normalize_distractors(["  spaced  "])
        assert result == [{"text": "spaced", "image_url": None}]

    def test_invalid_image_url_type_drops_to_none(self):
        result = normalize_distractors([{"text": "x", "image_url": 42}])
        assert result == [{"text": "x", "image_url": None}]


class TestMakeDistractor:
    def test_with_image(self):
        assert make_distractor("foo", "http://x") == {
            "text": "foo",
            "image_url": "http://x",
        }

    def test_without_image(self):
        assert make_distractor("foo") == {"text": "foo", "image_url": None}

    def test_empty_image_normalized_to_none(self):
        assert make_distractor("foo", "") == {"text": "foo", "image_url": None}


class TestDistractorText:
    def test_legacy_str(self):
        assert distractor_text("foo") == "foo"

    def test_dict_shape(self):
        assert distractor_text({"text": "foo", "image_url": "u"}) == "foo"

    def test_invalid(self):
        assert distractor_text(None) == ""
        assert distractor_text(42) == ""
        assert distractor_text({}) == ""

    def test_strips_whitespace(self):
        assert distractor_text("  foo  ") == "foo"


class TestTextFieldForShowImage:
    """Issue #437: show_image flips option language between text and translation."""

    def test_show_image_true_returns_text(self):
        assert text_field_for_show_image(True) == "text"

    def test_show_image_false_returns_translation(self):
        assert text_field_for_show_image(False) == "translation"


def _make_item(text=None, translation=None, image_url=None):
    """Minimal duck-type stand-in for ContentItem used by the regenerator."""
    return SimpleNamespace(
        text=text,
        translation=translation,
        image_url=image_url,
        distractors=None,
    )


class TestRegenerateWordSelectionDistractors:
    """Issue #437: rebuild distractors after show_image toggle so option
    language matches the new mode."""

    def setup_method(self):
        # Deterministic ordering — the function shuffles internally.
        random.seed(0)

    def test_show_image_true_uses_text_field(self):
        items = [
            _make_item(text="apple", translation="蘋果", image_url="a.png"),
            _make_item(text="banana", translation="香蕉", image_url="b.png"),
            _make_item(text="cherry", translation="櫻桃", image_url="c.png"),
            _make_item(text="date", translation="椰棗", image_url="d.png"),
        ]

        updated = regenerate_word_selection_distractors(items, show_image=True)

        assert updated == 4
        # First item's distractors should be drawn from the other three's text
        first_texts = {d["text"] for d in items[0].distractors}
        assert first_texts.issubset({"banana", "cherry", "date"})
        assert len(items[0].distractors) == 3
        # image_url is paired with each distractor's source item
        for d in items[0].distractors:
            assert d["image_url"] in {"b.png", "c.png", "d.png"}

    def test_show_image_false_uses_translation_field(self):
        items = [
            _make_item(text="apple", translation="蘋果", image_url=None),
            _make_item(text="banana", translation="香蕉", image_url=None),
            _make_item(text="cherry", translation="櫻桃", image_url=None),
            _make_item(text="date", translation="椰棗", image_url=None),
        ]

        regenerate_word_selection_distractors(items, show_image=False)

        first_texts = {d["text"] for d in items[0].distractors}
        assert first_texts.issubset({"香蕉", "櫻桃", "椰棗"})

    def test_fewer_than_three_candidates_returns_short_list(self):
        # Only 2 items total → each item can only pull 1 distractor
        items = [
            _make_item(text="apple", translation="蘋果"),
            _make_item(text="banana", translation="香蕉"),
        ]

        updated = regenerate_word_selection_distractors(items, show_image=True)

        assert updated == 2
        assert len(items[0].distractors) == 1
        assert items[0].distractors[0]["text"] == "banana"
        assert len(items[1].distractors) == 1
        assert items[1].distractors[0]["text"] == "apple"

    def test_skips_items_missing_target_field(self):
        # show_image=True needs text; items with empty text are skipped entirely
        items = [
            _make_item(text="apple", translation="蘋果"),
            _make_item(text="", translation="空"),
            _make_item(text=None, translation="無"),
            _make_item(text="cherry", translation="櫻桃"),
        ]

        updated = regenerate_word_selection_distractors(items, show_image=True)

        # Only 2 items had non-empty text → 2 updated
        assert updated == 2
        # And the empty-text items did not contribute to the candidate pool
        for d in items[0].distractors:
            assert d["text"] != ""

    def test_all_same_text_yields_empty_distractors(self):
        items = [
            _make_item(text="apple", translation="蘋果"),
            _make_item(text="APPLE", translation="蘋果"),
            _make_item(text="  apple  ", translation="蘋果"),
        ]

        updated = regenerate_word_selection_distractors(items, show_image=True)

        # All items processed, but the candidate pool collapses (case/whitespace
        # normalized) so no distractors remain.
        assert updated == 3
        for item in items:
            assert item.distractors == []

    def test_caps_distractors_at_three(self):
        items = [_make_item(text=f"word{i}") for i in range(10)]

        regenerate_word_selection_distractors(items, show_image=True)

        for item in items:
            assert len(item.distractors) == 3


class TestAnswerTextForItem:
    """Issue #1088: 開例句時正解／選項改用例句中的實際字形。"""

    def _item(self, **kw):
        base = dict(
            text="tell",
            translation="告訴",
            example_sentence="He told me her name.",
            cloze_answer="told me",
            image_url=None,
        )
        base.update(kw)
        return SimpleNamespace(**base)

    def test_show_example_uses_persisted_cloze_form(self):
        assert answer_text_for_item(self._item(), True, True) == "told me"
        assert answer_text_for_item(self._item(), False, True) == "told me"

    def test_show_example_persisted_not_in_sentence_falls_back_to_text(self):
        item = self._item(cloze_answer="spoke", example_sentence="He said hi.")
        # 存的字形不在句中、原形也不在句中 → 退回 text
        assert answer_text_for_item(item, True, True) == "tell"

    def test_show_example_empty_cloze_finds_inflected_form(self):
        item = self._item(
            text="cup", cloze_answer="", example_sentence="I have two cups."
        )
        assert answer_text_for_item(item, True, True) == "cups"

    def test_show_example_off_is_unchanged(self):
        assert answer_text_for_item(self._item(), True, False) == "tell"
        assert answer_text_for_item(self._item(), False, False) == "告訴"

    def test_build_answer_pool_dedupes_case_insensitively(self):
        items = [
            # 老師存大寫 "Told me" → 照存（不還原）→ pool 內是 "Told me"
            self._item(
                text="tell", cloze_answer="Told me", example_sentence="Told me now."
            ),
            # 句中小寫 "told me"
            self._item(text="say", cloze_answer="told me"),
            self._item(text="run", cloze_answer="ran", example_sentence="I ran."),
        ]
        assert answer_text_for_item(items[0], True, True) == "Told me"
        assert answer_text_for_item(items[1], True, True) == "told me"
        pool = build_answer_pool(items, True, True)
        # 大小寫不同的同字形只留第一個
        assert [p["text"] for p in pool] == ["Told me", "ran"]

    def test_build_answer_pool_off_matches_legacy_fields(self):
        items = [
            self._item(text="a", translation="甲"),
            self._item(text="b", translation="乙"),
        ]
        assert [p["text"] for p in build_answer_pool(items, False, False)] == ["甲", "乙"]
        assert [p["text"] for p in build_answer_pool(items, True, False)] == ["a", "b"]

    def test_show_example_sentence_initial_capital_is_lowercased(self):
        # 句首 "Told me" → 選項應顯示 "told me"（原形小寫開頭）
        item = self._item(example_sentence="Told me her name, he did.")
        assert answer_text_for_item(item, True, True) == "told me"
        # 第二句句首（前面是 ". "）也算句首
        item2 = self._item(example_sentence="Yes. Told me twice.")
        assert answer_text_for_item(item2, True, True) == "told me"

    def test_capitalized_match_mid_sentence_is_kept(self):
        # 句中的大寫（專有名詞）保留，即使原形小寫
        paris = self._item(
            text="paris", cloze_answer="", example_sentence="I love Paris."
        )
        assert answer_text_for_item(paris, True, True) == "Paris"
        # "Paris" 原形大寫 + 句中 → 保留
        paris2 = self._item(
            text="Paris", cloze_answer="Paris", example_sentence="I love Paris."
        )
        assert answer_text_for_item(paris2, True, True) == "Paris"

    def test_monday_only_lowercased_at_sentence_start(self):
        start = self._item(
            text="monday", cloze_answer="", example_sentence="Monday is busy."
        )
        assert answer_text_for_item(start, True, True) == "monday"
        mid = self._item(
            text="monday", cloze_answer="", example_sentence="See you Monday."
        )
        assert answer_text_for_item(mid, True, True) == "Monday"

    def test_persisted_uppercase_cloze_answer_is_kept_at_start(self):
        item = self._item(
            text="monday", cloze_answer="Monday", example_sentence="Monday is busy."
        )
        assert answer_text_for_item(item, True, True) == "Monday"

    def test_the_cup_matches_cup(self):
        item = self._item(
            text="cup", cloze_answer="", example_sentence="The cup is red."
        )
        assert answer_text_for_item(item, True, True) == "cup"

    def test_show_example_keeps_capitalized_base_word(self):
        # 專有名詞／原形本身大寫開頭 → 保留
        item = self._item(
            text="Paris", cloze_answer="Paris", example_sentence="Paris is big."
        )
        assert answer_text_for_item(item, True, True) == "Paris"

    def test_build_answer_pool_reuses_answer_by_id(self):
        items = [self._item(text="tell", cloze_answer="told me")]
        items[0].id = 7
        pool = build_answer_pool(items, True, True, {7: "precomputed"})
        assert [p["text"] for p in pool] == ["precomputed"]
