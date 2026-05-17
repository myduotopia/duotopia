"""Score category resolution.

Single source of truth for mapping (practice_mode, play_audio) -> ScoreCategory.
See docs/design/score-category-mapping.md for the full table.
"""
from typing import Optional

from models.base import ScoreCategory


# practice_mode values that are inherently "speaking" (student reads aloud)
_SPEAKING_MODES = frozenset({"reading", "word_reading"})

# practice_mode values that are inherently "reading" regardless of audio
_ALWAYS_READING_MODES = frozenset({"word_cloze"})

# practice_mode values that go to "reading" only when audio is off
_READING_WHEN_SILENT_MODES = frozenset({"rearrangement"})


def resolve_score_category(
    practice_mode: Optional[str], play_audio: Optional[bool]
) -> str:
    """Return the score_category string for an assignment.

    Rules (see docs/design/score-category-mapping.md):
      1. word_reading / reading           -> speaking (any audio)
      2. word_cloze                       -> reading  (any audio)
      3. rearrangement + audio off        -> reading
      4. anything else + audio off        -> writing
      5. anything else + audio on         -> listening

    Always returns a value from ScoreCategory (never None). For an unknown
    practice_mode we fall through to the audio-based default, which gives
    sane behavior for future modes without code changes.
    """
    mode = (practice_mode or "").strip().lower()
    audio_on = bool(play_audio)

    if mode in _SPEAKING_MODES:
        return ScoreCategory.SPEAKING.value
    if mode in _ALWAYS_READING_MODES:
        return ScoreCategory.READING.value
    if mode in _READING_WHEN_SILENT_MODES and not audio_on:
        return ScoreCategory.READING.value
    return ScoreCategory.LISTENING.value if audio_on else ScoreCategory.WRITING.value
