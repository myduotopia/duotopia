"""Unit tests for distractor shape helpers (Issue #631)."""

import random
from types import SimpleNamespace

from utils.distractors import (
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
