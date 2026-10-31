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


# 每種內容類型可用的 practice_mode（#1158 E-4，即刻練習 create／reconfigure 用）。
# 鏡射前端 lib/practiceMode.ts 的 PRACTICE_MODE_REGISTRY.supportedDatasets（＋單字集的
# tug_of_war，見 instantPracticeModesForContentType）。前端照「是否開放派發」再過濾一次；
# 後端只管「這種內容做不做得出這個模式」—— 例如情境對話內容不能切成 reading。
_SENTENCE_MODES = frozenset({"reading", "rearrangement"})
_VOCABULARY_MODES = _SENTENCE_MODES | frozenset(
    {
        "word_reading",
        "word_selection",
        "word_selection_quiz",
        "word_spelling",
        "word_spelling_quiz",
        "word_cloze",
        "word_cloze_quiz",
        "tug_of_war",
    }
)
MODES_BY_CONTENT_TYPE = {
    "EXAMPLE_SENTENCES": _SENTENCE_MODES,
    "READING_ASSESSMENT": _SENTENCE_MODES,
    "VOCABULARY_SET": _VOCABULARY_MODES,
    "SENTENCE_MAKING": _VOCABULARY_MODES,
    "SCENARIO_DIALOGUE": frozenset({"scenario_dialogue"}),
}


def practice_mode_fits_content_type(mode: Optional[str], content_type) -> bool:
    """這種內容類型能不能用這個 practice_mode。

    ``content_type`` 可為 ``ContentType`` enum 或字串（大小寫皆可）。沒列在
    ``MODES_BY_CONTENT_TYPE`` 的類型（例如單選題庫）不在這裡把關，一律放行，
    以免擋到既有流程。
    """
    raw = getattr(content_type, "value", content_type)
    allowed = MODES_BY_CONTENT_TYPE.get(str(raw or "").upper())
    if allowed is None:
        return True
    return mode in allowed
