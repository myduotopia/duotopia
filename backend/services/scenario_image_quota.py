"""情境對話 AI 生圖的每月次數上限（issue #1024）。

生圖比文字生成貴一個量級，而且是**逐題觸發**的（一份 10 題就可能按 10 次），所以在
完整配額（#1025）做好之前，先擋一道。

規則刻意簡單：**每位老師每個自然月 FREE_MONTHLY_LIMIT 次，用完就擋，不接點數。**
與 ``magic_paste_quota`` 的差別就在這裡 —— 那邊用完會走 QuotaService waterfall
（訂閱 → 點數包）扣點。這裡不做，因為計價方式還沒定（#1025 的決策是先用硬上限換取
成本可控），等要收費再把 consume 換成 waterfall，計數表可以直接沿用。

#1025 起「每月硬上限」那段邏輯（保留 → 退還、並發處理）搬到
``services/monthly_usage_quota.py``，因為情境對話的文字 AI 要用同一套；本模組保留
原本的函式介面不變，只是改成委派。抽出來的理由與踩過的坑見那個模組的說明。
"""

from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from models import ScenarioImageUsage, Teacher
from services.monthly_usage_quota import MonthlyUsageQuota, current_year_month

# 每位老師每月免費生圖張數。
#
# 抓 30 是「夠用但不至於失控」：一份情境對話最多 10 題，等於一個月可以做三份全圖的
# 教材。實際額度等 #1025 有真實用量數據再調。
FREE_MONTHLY_LIMIT = 30

# 傳 lambda 而不是值：上限是本模組的常數，測試會 monkeypatch 它
_quota = MonthlyUsageQuota(ScenarioImageUsage, lambda: FREE_MONTHLY_LIMIT)

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
    """目前的生圖配額狀態，供前端顯示剩餘次數。"""
    return _quota.get_quota_status(db, teacher, year_month)


def consume(
    db: Session, teacher: Teacher, year_month: Optional[str] = None
) -> Dict[str, Any]:
    """**先保留**一張生圖額度（在打 Imagen 之前呼叫）。

    額度用完回 ``{"charged": None, ...}``，呼叫端要看這個值才擋得住並發
    （PR #1027 review）。
    """
    return _quota.consume(db, teacher, year_month)


def refund(
    db: Session, teacher: Teacher, year_month: Optional[str] = None
) -> Dict[str, Any]:
    """把先前保留的一張還回去（被安全過濾擋下、圖存不進去）。

    老師沒拿到圖就不該被算一次（比照 magic_paste 擷取到 0 項不扣額的產品決策）。
    """
    return _quota.refund(db, teacher, year_month)
