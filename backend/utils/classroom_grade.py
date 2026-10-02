"""
班級年級（#1097）

`classrooms.grade` 是 String(50) 欄位（建表時就存在，先前未使用），
這裡統一處理 DB 字串 ↔ API 整數的轉換，API 進出一律是 1–12 的整數。
"""
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
