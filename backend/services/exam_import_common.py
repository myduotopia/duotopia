"""
上傳題本匯入的共用小工具（Issue #1112，C4-0 自 ``exam_import_service.py`` 拆出，行為不變）。

錯誤型別、時間、常數、頁／卡片查找、``lock_import``。其他 ``exam_import_*`` 模組都從這裡取；
``exam_import_service`` 把這些名稱原樣轉出（舊的 ``eis.X`` 寫法照樣能用）。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from models import ExamImport, ExamImportPage
from models.exam_import import (
    EXAM_IMPORT_STATUS_PROCESSING,
    EXAM_IMPORT_STATUS_READY,
    PAGE_STATUS_DONE,
)

TAIPEI = ZoneInfo("Asia/Taipei")
DAILY_LIMIT = 1
UNFINISHED_RETENTION_DAYS = 30
UNFINISHED_STATUSES = (EXAM_IMPORT_STATUS_PROCESSING, EXAM_IMPORT_STATUS_READY)
# 頁卡在 processing 超過這段時間（請求中途斷掉）就視同失敗，可以重送整頁。
# 比 AI 逾時（exam_paper_service.AI_CALL_TIMEOUT_SECONDS＝2 分鐘）多留一分鐘給上傳頁圖與寫入。
STALE_PROCESSING = timedelta(minutes=3)
# 整頁重送上限（第一次處理不算；失敗後或過期後再送才算）
MAX_PAGE_RESENDS = 2


class ExamImportError(Exception):
    """可預期的業務錯誤；router 轉成 HTTPException(status_code, detail)。"""

    def __init__(self, status_code: int, code: str, message: str, **extra: Any):
        super().__init__(message)
        self.status_code = status_code
        self.detail = {"error": code, "message": message, **extra}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def taipei_day_bounds(now: Optional[datetime] = None) -> Tuple[datetime, datetime]:
    """台灣時間自然日（00:00–24:00）的起訖，換成 UTC。"""
    local = (_as_utc(now) or _utcnow()).astimezone(TAIPEI)
    start_local = local.replace(hour=0, minute=0, second=0, microsecond=0)
    start = start_local.astimezone(timezone.utc)
    return start, start + timedelta(days=1)


def _done_pages(imp: ExamImport) -> List[ExamImportPage]:
    return sorted(
        (p for p in imp.pages if p.status == PAGE_STATUS_DONE), key=lambda p: p.page_no
    )


def _all_cards(imp: ExamImport) -> List[Dict[str, Any]]:
    return [c for p in _done_pages(imp) for c in (p.cards or [])]


def _touch(page: ExamImportPage) -> None:
    flag_modified(page, "cards")


def _require_open(imp: ExamImport) -> None:
    if imp.status not in UNFINISHED_STATUSES:
        raise ExamImportError(409, "EXAM_IMPORT_CLOSED", "這次匯入已結束，不能再處理頁面")


def _get_page(imp: ExamImport, page_no: int) -> ExamImportPage:
    for p in imp.pages:
        if p.page_no == page_no:
            return p
    raise ExamImportError(404, "EXAM_IMPORT_PAGE_NOT_FOUND", f"沒有第 {page_no} 頁")


def lock_import(db: Session, import_id: int) -> ExamImport:
    """重新讀取並鎖住匯入列（``SELECT ... FOR UPDATE``），到 commit／rollback 才放開。

    AI 呼叫要好幾秒，期間別的請求可能已處理完其他頁（例如答案頁先存好、用量已加總）。所以 AI
    回來後一律先丟掉 session 裡的舊資料、鎖住匯入列再讀最新的 ``known_answers``／各頁題目卡，
    合併、回填、比對、計數、用量加總都在鎖內做。寫題目卡的路徑（擷取一頁、重試單一題、放棄、
    C4 的編輯／刪除／新增題目卡、存入）都先拿這把鎖，所以同一份匯入的寫入會排隊。SQLite（測試）
    沒有列鎖，只驗證邏輯。
    """
    db.expire_all()
    return (
        db.query(ExamImport)
        .filter(ExamImport.id == import_id)
        .with_for_update()
        .populate_existing()
        .one()
    )
