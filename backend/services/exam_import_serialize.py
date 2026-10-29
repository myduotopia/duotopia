"""
上傳題本匯入的 API 輸出（Issue #1112，C4-0 自 ``exam_import_service.py`` 拆出，行為不變）。

跨頁合併紀錄（``_merge_pre``／``_merge_parts``）只在輸出時用 ``strip_merge_records`` 拿掉，
**草稿裡永遠保留**（之後拆回重算要用），不要把剝除後的卡片寫回 DB。
"""

from __future__ import annotations

from typing import Any, Dict

from models import ExamImport, ExamImportPage
from models.exam_import import PAGE_STATUS_DONE, PAGE_STATUS_FAILED
from services.exam_import_common import MAX_PAGE_RESENDS
from services.exam_paper_cards import strip_merge_records


def serialize_import(imp: ExamImport, include_pages: bool = False) -> Dict[str, Any]:
    pages = sorted(imp.pages, key=lambda p: p.page_no)
    done = sum(1 for p in pages if p.status == PAGE_STATUS_DONE)
    out: Dict[str, Any] = {
        "id": imp.id,
        "file_name": imp.file_name,
        # 繼續未完成的匯入時，前端請老師重選檔案、比對雜湊相符才接著送（C3）
        "file_hash": imp.file_hash,
        "page_count": imp.page_count,
        "status": imp.status,
        "settings": imp.settings or {},
        "tts_accents": imp.tts_accents or [],
        "question_count": imp.question_count or 0,
        "pages_done": done,
        "pages_failed": sum(1 for p in pages if p.status == PAGE_STATUS_FAILED),
        # 空白頁略過（瀏覽器判斷、沒送 AI）也算在 pages_done 裡；前端顯示「含 N 頁空白」
        "pages_blank": sum(1 for p in pages if p.blank_skipped),
        "created_at": imp.created_at.isoformat() if imp.created_at else None,
        "updated_at": imp.updated_at.isoformat() if imp.updated_at else None,
    }
    if include_pages:
        out["known_answers"] = imp.known_answers or {}
        # 前端用來判斷還能不能「重送整頁」／「重試」，用完就只剩「手動補這一題」
        out["retry_limits"] = {
            "page_resends": MAX_PAGE_RESENDS,
            "question_retries": _max_question_retries(),
        }
        out["pages"] = [serialize_page(p) for p in pages]
    return out


def serialize_page(page: ExamImportPage) -> Dict[str, Any]:
    return {
        "page_no": page.page_no,
        "status": page.status,
        "image_url": page.image_url,
        "is_answer_page": bool(page.is_answer_page),
        "answer_key": page.answer_key or {},
        "cards": strip_merge_records(page.cards or []),
        "error": page.error,
        "blank_skipped": page.blank_skipped,  # 空白頁略過（見 exam_import_blank）
        "resend_count": page.resend_count or 0,
        "processed_at": page.processed_at.isoformat() if page.processed_at else None,
    }


def _max_question_retries() -> int:
    from services.exam_import_retry import MAX_QUESTION_RETRIES

    return MAX_QUESTION_RETRIES
