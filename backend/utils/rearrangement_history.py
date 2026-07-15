"""例句重組（rearrangement）作答歷程封存工具。

批改頁要看到學生每次嘗試的完整選字歷程（#679）。核心不變量：
**永不遺失先前的 attempts，只有在當次真的有選字時才封存。**

歷史 bug：`rearrangement-retry` 直接把 `rearrangement_data` 覆寫成
`{"selections": []}`，學生一按「重新挑戰」前一輪歷程就消失。這裡把封存邏輯
抽成純函式，讓 endpoint 呼叫、並可在無 DB 環境下單元測試。
"""

from typing import Any, Dict, List, Optional


def archive_current_attempt(
    data: Optional[Dict[str, Any]],
    *,
    error_count: int,
    expected_score: float,
    ended_reason: str,
    ended_at: str,
    selections: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """回傳 attempts[] 清單，並把「當次」封存進去。

    Args:
        data: 現有的 ``rearrangement_data``（可為 None）。既有的 ``attempts``
            一定會被保留。
        error_count: 當次錯誤次數。
        expected_score: 當次分數（會轉成 float）。
        ended_reason: ``"completed"`` / ``"timeout"`` / ``"force_retry"``。
        ended_at: 結束時間（ISO 8601 字串）。
        selections: 當次選字歷程；未提供時退回 ``data["selections"]``。

    Returns:
        新的 attempts list（既有 + 當次）。若當次沒有任何選字（None 或空），
        則原樣回傳既有 attempts，不新增空白列。
    """
    data = data or {}
    attempts: List[Dict[str, Any]] = list(data.get("attempts", []))

    sel = selections if selections is not None else data.get("selections")
    if sel:
        attempts.append(
            {
                "selections": sel,
                "error_count": error_count or 0,
                "expected_score": float(expected_score or 0),
                "ended_reason": ended_reason,
                "ended_at": ended_at,
            }
        )

    return attempts
