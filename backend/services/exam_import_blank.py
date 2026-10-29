"""
上傳題本：空白頁略過（Issue #1112 C3）。

瀏覽器拆頁後判斷是空白的頁（保守門檻，寧可多送；算法見 docs/design/question-bank-exam-import.md
「空白頁」）**不送 AI**，改呼叫 ``mark_blank_page``：

- 存頁圖（續做、整頁對照、「仍要送出這一頁」都用它），頁狀態 ``done``、0 張卡、
  ``error = PAGE_ERROR_BLANK_SKIPPED``（狀態 CHECK 只允許四種，不加 migration）。
- 不呼叫 AI、不記用量；算進「共 N 頁」與已完成頁數（GET 帶 ``blank_skipped``／``pages_blank``）。
- 只有 ``pending`` 的頁可以標；已經是空白頁略過的再標一次直接回傳（冪等）。

老師看縮圖覺得不是空白，按「仍要送出這一頁」→ ``send_blank_page``：讀回存好的頁圖（不必重選
檔案），把頁從「空白頁略過」搶回 processing，之後與一般擷取同一條路（``run_claimed_page``）。
**不算整頁重送次數**（``resend_count`` 不加）；送出後失敗就和一般失敗頁一樣，再送才算重送。

並發同 ``exam_import_service``：先 ``lock_import`` 再寫入；同一頁同時送兩次只有一個搶得到
（條件式 UPDATE），另一個 409 ``EXAM_IMPORT_PAGE_BUSY``。
"""

from __future__ import annotations

import random
import uuid
from typing import Optional

from sqlalchemy.orm import Session

from models import ExamImport, ExamImportPage
from models.exam_import import (
    PAGE_ERROR_BLANK_SKIPPED,
    PAGE_STATUS_DONE,
    PAGE_STATUS_PENDING,
    PAGE_STATUS_PROCESSING,
)
from services import exam_import_service as eis
from services import exam_import_storage
from services.exam_paper_service import (
    ExamPaperService,
    get_exam_paper_service,
)

ExamImportError = eis.ExamImportError


def _not_pending(page_no: int) -> ExamImportError:
    return ExamImportError(
        409, "EXAM_IMPORT_PAGE_BUSY", f"第 {page_no} 頁正在處理或已處理完，不能標為空白頁"
    )


def mark_blank_page(
    db: Session,
    imp: ExamImport,
    page_no: int,
    image_bytes: bytes,
    mime_type: str,
) -> ExamImportPage:
    """把還沒處理的頁標成「空白頁略過」：存頁圖、done、0 張卡，不呼叫 AI、不記用量。"""
    eis._require_open(imp)
    page = eis._get_page(imp, page_no)
    if page.blank_skipped:
        return page
    if page.status != PAGE_STATUS_PENDING:
        raise _not_pending(page_no)
    mime = ExamPaperService.validate_page_image(image_bytes, mime_type)
    import_id = imp.id
    image_url = exam_import_storage.store_page_image(
        import_id, page_no, image_bytes, mime
    )

    imp = eis.lock_import(db, import_id)
    page = next((p for p in imp.pages if p.page_no == page_no), None)
    if imp.status not in eis.UNFINISHED_STATUSES:
        db.rollback()
        raise ExamImportError(409, "EXAM_IMPORT_CLOSED", "這次匯入已結束，不能再處理頁面")
    if page is None or page.status != PAGE_STATUS_PENDING:
        db.rollback()
        if page is not None and page.blank_skipped:
            return page
        raise _not_pending(page_no)
    page.status = PAGE_STATUS_DONE
    page.error = PAGE_ERROR_BLANK_SKIPPED
    page.image_url = image_url
    page.cards = []
    page.is_answer_page = False
    page.answer_key = None
    page.claim_id = None
    page.processed_at = eis._utcnow()
    eis._touch(page)
    # 空白頁變成「已處理」：前後頁的跨頁題組可能因此接得上
    eis._merge_continuations(imp)
    eis._refresh_duplicates(db, imp)
    eis._refresh_status_and_count(imp)
    db.commit()
    db.refresh(page)
    eis.after_page_write(db, import_id)  # 略過核對：最後一頁是空白頁時也要收尾（C4a）
    return page


def _claim_blank_page(db: Session, import_id: int, page_id: int, page_no: int) -> str:
    """鎖內把「空白頁略過」的頁搶回 processing（``resend_count`` 不加）。回傳 ``claim_id``。"""
    imp = eis.lock_import(db, import_id)
    if imp.status not in eis.UNFINISHED_STATUSES:
        db.rollback()
        raise ExamImportError(409, "EXAM_IMPORT_CLOSED", "這次匯入已結束，不能再處理頁面")
    claim_id = uuid.uuid4().hex
    claimed = (
        db.query(ExamImportPage)
        .filter(
            ExamImportPage.id == page_id,
            ExamImportPage.status == PAGE_STATUS_DONE,
            ExamImportPage.error == PAGE_ERROR_BLANK_SKIPPED,
        )
        .update(
            {
                ExamImportPage.status: PAGE_STATUS_PROCESSING,
                ExamImportPage.error: None,
                ExamImportPage.claim_id: claim_id,
                ExamImportPage.updated_at: eis._utcnow(),
            },
            synchronize_session=False,
        )
    )
    if not claimed:
        db.rollback()
        raise ExamImportError(409, "EXAM_IMPORT_PAGE_BUSY", f"第 {page_no} 頁正在處理或已處理完")
    # 這一頁暫時不算「已處理」，匯入要回到處理中（ready 之後老師才按「仍要送出」也一樣）
    db.expire_all()
    imp = db.get(ExamImport, import_id)
    imp.status = eis.EXAM_IMPORT_STATUS_PROCESSING
    eis._refresh_status_and_count(imp)
    db.commit()
    return claim_id


async def send_blank_page(
    db: Session,
    imp: ExamImport,
    page_no: int,
    *,
    service: Optional[ExamPaperService] = None,
    rng: Optional[random.Random] = None,
) -> ExamImportPage:
    """「仍要送出這一頁」：用存好的頁圖送 AI，不算重送次數。只接受「空白頁略過」的頁。"""
    eis._require_open(imp)
    page = eis._get_page(imp, page_no)
    if not page.blank_skipped:
        raise ExamImportError(409, "EXAM_IMPORT_NOT_BLANK", f"第 {page_no} 頁不是略過的空白頁")
    stored = exam_import_storage.read_page_image(imp.id, page.image_url or "")
    if stored is None:
        raise ExamImportError(
            409,
            "EXAM_IMPORT_PAGE_IMAGE_MISSING",
            f"找不到第 {page_no} 頁的圖片，請放棄這次匯入後重新上傳",
        )
    image_bytes, mime = stored
    service = service or get_exam_paper_service()
    import_id, page_id = imp.id, page.id
    claim_id = _claim_blank_page(db, import_id, page_id, page_no)
    return await eis.run_claimed_page(
        db,
        import_id,
        page_id,
        page_no,
        claim_id,
        image_bytes,
        mime,
        service,
        rng,
        store_image=False,
    )


__all__ = ["mark_blank_page", "send_blank_page"]
