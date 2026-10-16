"""情境對話文字 AI 的每月次數上限（issue #1025）。

#1021 把產題／情境文章／PDF 擷取接成真的 AI 呼叫，但**刻意沒擋配額** —— 當時沒有任何
實際用量數據可以拿來定免費額度，只先記錄用量與估算成本。這個模組補上限制。

## 規則

**每位老師每個自然月 FREE_MONTHLY_LIMIT 次，用完就擋，不接點數。**

與 ``magic_paste_quota``（#891）的差別在這裡：那邊用完會走 QuotaService waterfall
（訂閱 → 點數包）扣點。情境對話的計價還沒定，所以先用硬上限換取成本可控；要收費時
把 consume 換成 waterfall 即可，計數表沿用。

與 ``scenario_image_quota``（#1024）則是**同一套機制、不同的池**：共用
``monthly_usage_quota`` 的保留／退還實作，但各有自己的表與上限（生圖貴一個量級）。

## 三個端點一律算一次

產生情境文章、產生題目、PDF 擷取的實際成本不同（擷取要吃圖片 token，最貴），但**不做
加權**：

* 加權要維護一張「哪個端點幾點」的對照表，而真實成本本來就隨輸入長度浮動，權重只是
  另一種猜測；
* 產題吃 ``count`` 參數，一次產 10 題與重新產 1 題都算一次 —— 這會**鼓勵批次產題**，
  正好是我們想要的方向（連按重產單題才是要擋的行為）；
* 上限夠寬（50 次 ≒ 12~16 份教材）的話，端點之間的成本差異不會讓老師提早撞到牆。

真的需要加權時，`monthly_usage_quota` 的 consume 再加一個 ``units`` 參數即可，
計數表不用改。
"""

from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from models import ScenarioTextUsage, Teacher
from services.monthly_usage_quota import MonthlyUsageQuota, current_year_month

# 每位老師每月免費的文字 AI 次數。
#
# 抓 50 的理由：一份情境對話教材大約用掉 3~4 次（1 次情境文章 + 1~2 批產題 + 可能
# 1 次 PDF 擷取），50 次約等於 12~16 份教材的量 —— 夠一般老師用不到上限，又擋得住
# 連按失控。對照生圖是 30（成本貴一個量級，所以次數少）。
#
# **這是估的，不是量出來的**：prod 的情境對話入口一直是關著的（#1039），從沒對真實
# 老師開放過，所以沒有實際用量分佈可以參考。#1021 起每次呼叫都有 log
# （`scenario_dialogue_ai ... | in=… out=… | cost≈$…`），prod 開放後撈那些 log 再調
# 這個數字。單價：gemini-2.5-flash 約 $0.30/1M input、$2.50/1M output，50 次的成本
# 上限約 $0.1/人/月。
FREE_MONTHLY_LIMIT = 50

# 傳 lambda 而不是值：上限是本模組的常數，測試會 monkeypatch 它
_quota = MonthlyUsageQuota(ScenarioTextUsage, lambda: FREE_MONTHLY_LIMIT)

__all__ = [
    "FREE_MONTHLY_LIMIT",
    "current_year_month",
    "get_quota_status",
    "consume",
    "refund",
]


def get_quota_status(
    db: Session, teacher: Teacher, year_month: Optional[str] = None
) -> Dict[str, Any]:
    """目前的文字 AI 配額狀態，供前端顯示剩餘次數。"""
    return _quota.get_quota_status(db, teacher, year_month)


def consume(
    db: Session, teacher: Teacher, year_month: Optional[str] = None
) -> Dict[str, Any]:
    """**先保留**一次額度（在打 AI 之前呼叫）。

    額度用完回 ``{"charged": None, ...}``。呼叫端一定要看這個值 —— 先查再打是擋不住
    並發的（PR #1027 review）。
    """
    return _quota.consume(db, teacher, year_month)


def refund(
    db: Session, teacher: Teacher, year_month: Optional[str] = None
) -> Dict[str, Any]:
    """把先前保留的一次還回去（AI 呼叫失敗、沒產出可用的東西）。

    老師沒拿到東西就不該被算一次。``year_month`` 請傳 consume 回傳的那個值。
    """
    return _quota.refund(db, teacher, year_month)
