"""Unit tests for score_category resolution (Issue #708 PR-1).

Mapping under test (see docs/design/score-category-mapping.md):
  word_reading / reading                            -> speaking (any audio)
  rearrangement / word_selection(_quiz) + audio off -> reading
  rearrangement / word_selection(_quiz) + audio on  -> listening (general rule)
  anything else + audio off                         -> writing
  anything else + audio on                          -> listening
"""
import pytest

from utils.score_category import resolve_score_category


class TestSpeakingModes:
    """Reading-aloud modes are always 'speaking', regardless of audio."""

    @pytest.mark.parametrize("audio", [False, True])
    def test_word_reading(self, audio):
        assert resolve_score_category("word_reading", audio) == "speaking"

    @pytest.mark.parametrize("audio", [False, True])
    def test_reading(self, audio):
        assert resolve_score_category("reading", audio) == "speaking"


class TestReadingWhenSilent:
    """rearrangement / word_selection(_quiz): reading when silent, listening with audio.

    word_selection(_quiz) moved here in #878 (was writing-when-silent). No backfill
    migration: existing rows keep their stored value, only new/updated assignments
    follow the new rule.
    """

    @pytest.mark.parametrize(
        "mode", ["rearrangement", "word_selection", "word_selection_quiz"]
    )
    def test_silent_is_reading(self, mode):
        assert resolve_score_category(mode, False) == "reading"

    @pytest.mark.parametrize(
        "mode", ["rearrangement", "word_selection", "word_selection_quiz"]
    )
    def test_audio_is_listening(self, mode):
        assert resolve_score_category(mode, True) == "listening"


class TestGeneralRule:
    """Typed-output / other modes: writing when silent, listening when audio on.

    word_cloze(_quiz) moved here in #878 (was always-reading): typing to fill the
    blank is producing text -> writing. No backfill; existing rows keep stored value.
    """

    _MODES = [
        "word_cloze",
        "word_cloze_quiz",
        "word_spelling",
        "word_spelling_quiz",
        "tug_of_war",
        "future_mode",
    ]

    @pytest.mark.parametrize("mode", _MODES)
    def test_silent_is_writing(self, mode):
        assert resolve_score_category(mode, False) == "writing"

    @pytest.mark.parametrize("mode", _MODES)
    def test_audio_is_listening(self, mode):
        assert resolve_score_category(mode, True) == "listening"


class TestEdgeCases:
    """None / empty inputs fall through to the general rule, never crash."""

    def test_none_mode_silent_is_writing(self):
        assert resolve_score_category(None, False) == "writing"

    def test_none_mode_audio_is_listening(self):
        assert resolve_score_category(None, True) == "listening"

    def test_empty_mode(self):
        assert resolve_score_category("", False) == "writing"

    def test_uppercase_mode_is_normalized(self):
        # Defensive: callers shouldn't send uppercase, but if they do we
        # still match the lowercase rule rather than fall through silently.
        assert resolve_score_category("WORD_READING", False) == "speaking"

    def test_none_audio_treated_as_off(self):
        assert resolve_score_category("rearrangement", None) == "reading"
