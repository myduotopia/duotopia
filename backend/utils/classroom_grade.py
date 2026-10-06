"""
班級年級（#1097）

`classrooms.grade` 是 String(50) 欄位（建表時就存在，先前未使用），
這裡統一處理 DB 字串 ↔ API 整數的轉換，API 進出一律是 1–12 的整數。
"""
import re
from typing import Any, Optional

from models.question_bank import GRADE_MAX, GRADE_MIN


def parse_grade(raw: Any) -> Optional[int]:
    """DB 字串 → 1–12 整數。

    只有 ASCII 數字且落在 1–12 的值才回整數；空值與歷史雜值
    （例如 "Grade 5"、"國小三年級"、全形數字）一律回 None，視為「未設定」。
    """
    if raw is None or isinstance(raw, bool):
        return None
    text = str(raw).strip()
    if not text or not (text.isascii() and text.isdigit()):
        return None
    value = int(text)
    if GRADE_MIN <= value <= GRADE_MAX:
        return value
    return None


def grade_to_storage(grade: int) -> str:
    """API 整數 → DB 字串（範圍由 Pydantic schema 驗證）。"""
    return str(grade)


# 名稱含整字 grade／class（不分大小寫）時照原名；re.ASCII 讓 \b 與前端 JS 的 \b 一致
# （中文字不算單字字元，「甲Class」也算整字），"Masterclass"／"Upgrade" 不算
_ENGLISH_GRADE_CLASS_WORD = re.compile(r"\b(grade|class)\b", re.IGNORECASE | re.ASCII)


def classroom_display_name(name: Optional[str], grade: Any) -> str:
    """組合班名（中文）：年級 8＋名稱「12」→「8年12班」。

    - 沒有年級（或年級無效）→ 照原名
    - 名稱本身已含「年」或「班」→ 照原名（例如「三年甲班」）
    - 名稱含整字 grade／class（不分大小寫）→ 照原名（例如「Class A」；「Masterclass」仍組合）
    前端有對應的 formatClassroomDisplayName（含英文規則），兩邊規則需一致。
    `grade` 可傳 DB 字串或整數，內部經 parse_grade 正規化。
    """
    raw = name or ""
    text = raw.strip()
    if not text:
        return raw
    value = grade if isinstance(grade, int) else parse_grade(grade)
    if isinstance(value, bool) or value is None:
        return text
    if not (GRADE_MIN <= value <= GRADE_MAX):
        return text
    if "年" in text or "班" in text or _ENGLISH_GRADE_CLASS_WORD.search(text):
        return text
    return f"{value}年{text}班"
