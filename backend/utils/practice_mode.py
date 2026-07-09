"""Single source of truth for the set of valid ``practice_mode`` values.

Before this module the allowed-value list was duplicated and drifted across
the create/update API (no validation at all), instant_practice (Literal of 5),
the students filter (10), and the practice_sessions DB CHECK. This centralises
the canonical whitelist (= every ``PracticeMode`` enum member) plus a validator.

Scope note:
- Score derivation stays owned by ``utils/score_category.py`` (its
  ``_SPEAKING_MODES`` etc.) — do not duplicate score groupings here.
- ``AUTO_GRADED_MODES`` is intentionally NOT centralised: ``detail.py`` and
  ``students/assignments.py`` define same-named but semantically different sets
  (interim-score-eligible vs auto-graded), so merging them would change
  behaviour. Leave them as-is.
"""
from typing import Optional

from models.base import PracticeMode

# 完整合法 practice_mode 集合（等同 PracticeMode enum 全部值）。
ALLOWED_PRACTICE_MODES = frozenset(m.value for m in PracticeMode)

# 小考（quiz）變體。
QUIZ_MODES = frozenset({"word_selection_quiz", "word_spelling_quiz", "word_cloze_quiz"})


def validate_practice_mode(value: Optional[str]) -> Optional[str]:
    """驗證 practice_mode。

    None 視為「未指定」放行（建立時可不帶，後端會用 default）；其餘必須落在
    ``ALLOWED_PRACTICE_MODES`` 內，否則丟 ValueError（Pydantic 會轉成 422）。
    """
    if value is None:
        return value
    if value not in ALLOWED_PRACTICE_MODES:
        raise ValueError(
            f"Invalid practice_mode: {value!r}. "
            f"Allowed: {sorted(ALLOWED_PRACTICE_MODES)}"
        )
    return value
