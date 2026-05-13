"""Unit tests for score_category resolution (Issue #708 PR-1).

Mapping under test (see docs/design/score-category-mapping.md):
  word_reading / reading           -> speaking (any audio)
  word_cloze                       -> reading  (any audio)
  rearrangement + audio off        -> reading
  rearrangement + audio on         -> listening (falls through to general rule)
  anything else + audio off        -> writing
  anything else + audio on         -> listening
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


class TestAlwaysReading:
    """word_cloze is 'reading' regardless of audio."""

    @pytest.mark.parametrize("audio", [False, True])
    def test_word_cloze(self, audio):
        assert resolve_score_category("word_cloze", audio) == "reading"


class TestRearrangement:
    """rearrangement: reading when silent, listening when audio on."""

    def test_silent(self):
        assert resolve_score_category("rearrangement", False) == "reading"

    def test_with_audio(self):
        assert resolve_score_category("rearrangement", True) == "listening"


class TestGeneralRule:
    """Other modes: writing when silent, listening when audio on."""

    @pytest.mark.parametrize(
        "mode", ["word_selection", "word_spelling", "tug_of_war", "future_mode"]
    )
    def test_silent_is_writing(self, mode):
        assert resolve_score_category(mode, False) == "writing"

    @pytest.mark.parametrize(
        "mode", ["word_selection", "word_spelling", "tug_of_war", "future_mode"]
    )
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
