"""Unit tests for distractor shape helpers (Issue #631)."""

from utils.distractors import (
    normalize_distractors,
    make_distractor,
    distractor_text,
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
        result = normalize_distractors(
            ["legacy", {"text": "modern", "image_url": "u"}]
        )
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
