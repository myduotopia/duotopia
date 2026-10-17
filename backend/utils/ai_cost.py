"""AI 成本估算（Issue #1119 / PR #1122 review）。

為什麼抽出來
------------
`scenario_grading_ai`、`scenario_dialogue_ai`、`magic_paste_service` 三個服務
各有一份完全相同的查表 + 換算 + 警告。重複的常數與邏輯會各自飄 —— 模型 ID
原本就是散在 4 個檔案，所以 gemini-2.5 退役前完全沒人發現。

單價來源是 `core/config.py` 的 `VERTEX_AI_PRICING_USD_PER_1M`，以模型名為 key。

查不到單價時為什麼只警告不丟錯
------------------------------
成本是**觀測用**，不是計費用。算不出來不該讓老師的請求失敗。但也不能靜默
回 0 —— 那會讓成本統計看起來「沒花錢」而沒有人發現（PR #1122 review 第 1 點）。
所以回 0 並留 warning。

警告只發一次
------------
最可能的情境是某環境用 `VERTEX_AI_FLASH_MODEL` 覆寫了模型卻沒補單價 ——
那會是**每一個請求**都走到這條路徑。每次都 log 會洗版，所以同一個模型名
只警告一次（PR #1122 review 第 3 點）。
"""

import logging
from typing import Dict, Mapping, Optional, Set

from core.config import settings

logger = logging.getLogger(__name__)

# 已警告過的模型名，避免每個請求都洗一次 log
_warned_models: Set[str] = set()


def pricing_for(model: str) -> Optional[Mapping[str, float]]:
    """取得單價；查不到回 None 並留一次 warning。"""
    pricing = settings.VERTEX_AI_PRICING_USD_PER_1M.get(model)
    if pricing is None and model not in _warned_models:
        _warned_models.add(model)
        logger.warning(
            "成本估算略過：價格表沒有 %s 的單價，成本以 0 計"
            "（本訊息每個模型只出現一次）。"
            "請在 core/config.py 的 VERTEX_AI_PRICING_USD_PER_1M 補上",
            model,
        )
    return pricing


def estimate_cost_usd(model: str, usage: Dict[str, int]) -> float:
    """依 token 用量估算美元成本。

    `usage` 用 `input_tokens` / `output_tokens` 兩個 key。呼叫端要負責把
    thinking token 併進 `output_tokens` —— thinking 以輸出價計費（Issue #1119）。
    """
    pricing = pricing_for(model)
    if not pricing:
        return 0.0
    return round(
        usage.get("input_tokens", 0) / 1_000_000 * pricing["input"]
        + usage.get("output_tokens", 0) / 1_000_000 * pricing["output"],
        6,
    )


def _reset_warning_state_for_tests() -> None:
    """清掉「已警告過」的記錄，讓測試之間不互相影響。"""
    _warned_models.clear()
