"""
上傳題本匯入流程（Issue #1112 C2）：逐頁擷取、答案頁回填、用量。對外的唯一入口（``eis``）。

C4-0 拆檔（行為不變）：
- ``exam_import_common``：錯誤型別、時間、常數、頁查找、``lock_import``
- ``exam_import_lifecycle``：建立（每天 1 本、擋重複題本）、查詢、未完成列表、放棄
- ``exam_import_refresh``：口音、跨頁題組合併、答案回填、題數／狀態、重複標記
- ``exam_import_serialize``：API 輸出（剝除合併紀錄只在輸出時做）
- 本檔：搶頁、送 AI、鎖內寫入結果（擷取一頁的流程）＋用量＋考點清單，並把上面各模組的名稱
  原樣轉出，舊的 ``eis.X`` 寫法（含測試的 monkeypatch ``eis.lock_import``／
  ``eis._refresh_duplicates``）照樣有效：本檔流程與 ``exam_import_retry``／``exam_import_blank``
  都透過本檔的名稱呼叫它們。
重試單一題在 ``services/exam_import_retry.py``（本模組的 ``retry_question`` 照樣可用）。
C4 的編輯／存入在 ``exam_import_edit.py``／``exam_import_save.py``。

規則來源：docs/design/question-bank-exam-import.md、計畫檔定案 14–17。

- **處理順序由前端決定**（先最後一頁往前找答案頁、再從第 1 頁），後端任何順序都正確：
  每頁擷取時帶入已知答案；答案頁晚到時回填已處理頁中「答案來源是 AI、老師沒改過」的題。
- **跨頁題組**：某頁第一張卡標「延續上一頁題組」→ 併進前面最近一個有卡片的已處理頁的最後一張
  題組卡（跨三頁以上也接得上；克漏字空格編號接續）。中間有頁還沒處理就先留著，處理完再併。
  規則在 ``exam_paper_cards.merge_continuations``（報告腳本共用）。合併時留下紀錄；當初跨過的頁
  後來有了卡片（空白頁略過後「仍要送出這一頁」）就把那張題組卡拆回各頁、整份依頁碼重新合併，
  再套一次已知答案（C3 review 4）。合併紀錄不輸出到 API（``serialize_page``）。
- **並發**：先 ``lock_import`` 鎖住匯入列，再用條件式 UPDATE 搶 processing（同頁同時送兩次只有
  一個成功），並寫入這次請求的 ``claim_id``；送 AI 前 ``commit`` 釋放 DB 連線（AI 最多等 2 分鐘，不佔著連線）；AI 回來後
  ``lock_import`` 鎖住匯入列、讀最新資料，**確認這一頁仍是自己搶到的**（``claim_id`` 相同、仍在
  processing）才寫入，否則只記用量、丟掉結果（409 ``EXAM_IMPORT_PAGE_BUSY``）。鎖內整理出錯 →
  rollback → 標失敗並記用量。
- **逾時與重送**（定案 18）：單次 AI 呼叫最多 2 分鐘（逾時＝該頁失敗、用量照記）；卡在
  processing 超過 3 分鐘（``STALE_PROCESSING``）的頁可以重送。**整頁重送每頁最多 2 次**
  （``MAX_PAGE_RESENDS``）：第一次處理（pending → processing）不算；失敗後、或處理中超過 3 分鐘後
  再送才算一次；已經 2 次還要再送回 409 ``EXAM_IMPORT_RETRY_LIMIT``，不呼叫 AI（頁若還卡在
  processing 就順手改成失敗「處理逾時」，讓匯入能變 ready）。逾時沒有回應，用量記 0 token
  （實際花了多少不得而知，不估算；log 會標示）。
- **克漏字空格編號**：寫入草稿時每張克漏字題組都重編成 1..k（單頁、跨頁合併後都一樣）。
- **口音**：每張題目卡分配一種（勾一種＝全部同一種；多種＝平均分配：從目前用最少次的口音中隨機抽），
  抽中後固定；「延續上一頁題組」的卡不算進次數。
- **用量**：每次 AI 呼叫寫一列 ``exam_import_usage``，``exam_imports`` 同步加總；AI 回應無法解析時
  也照記（token 已經花掉）。
- **空白頁略過**（C3）：瀏覽器判斷是空白的頁不送 AI，由 ``services/exam_import_blank.py`` 標成
  done＋0 張卡＋``error=BLANK_SKIPPED``；「仍要送出這一頁」用存好的頁圖走 ``run_claimed_page``。
"""

from __future__ import annotations

import logging
import random
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, case, or_
from sqlalchemy.orm import Session

from models import (  # noqa: F401  (ExamImport 供 ``eis.ExamImport`` 舊寫法)
    ExamImport,
    ExamImportPage,
    ExamImportUsage,
    ExamPoint,
)
from models.exam_import import (  # noqa: F401
    EXAM_IMPORT_STATUS_ABANDONED,
    EXAM_IMPORT_STATUS_PROCESSING,
    EXAM_IMPORT_STATUS_READY,
    PAGE_STATUS_DONE,
    PAGE_STATUS_FAILED,
    PAGE_STATUS_PENDING,
    PAGE_STATUS_PROCESSING,
    USAGE_CALL_EXTRACT_PAGE,
)
from models.question_bank import EXAM_POINT_STATUS_ACTIVE
from services import exam_import_storage
from services.exam_import_common import (  # noqa: F401  (轉出)
    DAILY_LIMIT,
    MAX_PAGE_RESENDS,
    STALE_PROCESSING,
    TAIPEI,
    UNFINISHED_RETENTION_DAYS,
    UNFINISHED_STATUSES,
    ExamImportError,
    _all_cards,
    _as_utc,
    _done_pages,
    _get_page,
    _require_open,
    _touch,
    _utcnow,
    lock_import,
    taipei_day_bounds,
)
from services.exam_import_lifecycle import (  # noqa: F401  (轉出)
    abandon_import,
    count_today_imports,
    create_import,
    find_duplicate_import,
    get_import,
    list_unfinished,
)
from services.exam_import_refresh import (  # noqa: F401  (轉出)
    _merge_continuations,
    _refresh_answers,
    _refresh_duplicates,
    _refresh_status_and_count,
    assign_accents,
    backfill_saved_questions,
)
from services.exam_import_serialize import (  # noqa: F401  (轉出)
    _max_question_retries,
    serialize_import,
    serialize_page,
)
from services.exam_paper_cards import (  # noqa: F401
    ANSWER_SOURCE_ANSWER_PAGE,
    apply_answer_key,
    renumber_cloze_cards,
)
from services.exam_paper_service import (
    CallUsage,
    ExamPaperOutputError,
    ExamPaperService,
    ExamPaperTimeoutError,
    get_exam_paper_service,
)

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# 用量
# --------------------------------------------------------------------------- #
def record_usage(
    db: Session,
    imp: ExamImport,
    *,
    call_type: str,
    usage: CallUsage,
    page_no: Optional[int] = None,
    succeeded: bool = True,
) -> ExamImportUsage:
    cost = usage.estimated_cost_usd
    row = ExamImportUsage(
        import_id=imp.id,
        teacher_id=imp.teacher_id,
        page_no=page_no,
        call_type=call_type,
        model=usage.model,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        thinking_tokens=usage.thinking_tokens,
        estimated_cost_usd=cost,
        succeeded=succeeded,
    )
    db.add(row)
    imp.ai_call_count = (imp.ai_call_count or 0) + 1
    imp.input_tokens = (imp.input_tokens or 0) + usage.input_tokens
    imp.output_tokens = (imp.output_tokens or 0) + usage.output_tokens
    imp.thinking_tokens = (imp.thinking_tokens or 0) + usage.thinking_tokens
    imp.estimated_cost_usd = float(imp.estimated_cost_usd or 0) + cost
    return row


# --------------------------------------------------------------------------- #
# 考點清單
# --------------------------------------------------------------------------- #
def exam_point_catalog(db: Session) -> Tuple[List[Dict[str, str]], Dict[str, int]]:
    """平台 active 考點（與 AI 考點分析／ExamPointPicker 同一份資料）。"""
    points = (
        db.query(ExamPoint)
        .filter(ExamPoint.status == EXAM_POINT_STATUS_ACTIVE)
        .order_by(ExamPoint.parent_id.nullsfirst(), ExamPoint.order_index)
        .all()
    )
    catalog = [
        {
            "code": ep.code,
            "name": (ep.names or {}).get("zh-TW") or (ep.names or {}).get("en") or "",
        }
        for ep in points
    ]
    return catalog, {ep.code: ep.id for ep in points}


# --------------------------------------------------------------------------- #
# 搶頁、失敗、擷取一頁
# --------------------------------------------------------------------------- #
def _is_stale(page: ExamImportPage, now: datetime) -> bool:
    updated = _as_utc(page.updated_at)
    return page.status == PAGE_STATUS_PROCESSING and (
        updated is None or updated < now - STALE_PROCESSING
    )


def _expire_stale_page(db: Session, imp: ExamImport, page_no: int) -> None:
    """（鎖內）重送次數已用完、又卡在 processing 超過 3 分鐘的頁：改成失敗（「處理逾時」）並
    commit，否則它永遠卡在處理中，整份匯入也一直不會變成 ready。"""
    page = next((p for p in imp.pages if p.page_no == page_no), None)
    if page is None or not _is_stale(page, _utcnow()):
        db.rollback()
        return
    page.status = PAGE_STATUS_FAILED
    page.error = "處理逾時"
    page.claim_id = None
    _refresh_status_and_count(imp)
    db.commit()


def _claim_page(db: Session, import_id: int, page_id: int, page_no: int) -> str:
    """先 ``lock_import`` 鎖住匯入列，再用條件式 UPDATE 把頁改成 processing、寫入新的
    ``claim_id``（回傳它）並 commit。

    先拿匯入列的鎖，和寫入結果（``_write_page_result``／``_fail_page``）、放棄、重試排隊，
    不會在別人鎖內整理的中途改到頁狀態；條件式 UPDATE 再保證同一頁同時送兩次只有一個拿得到。
    可以搶的頁：
    - ``pending``：第一次處理，不算重送；
    - ``failed``，或卡在 processing 超過 ``STALE_PROCESSING``（請求中途斷掉）：算一次重送，
      ``resend_count`` 已達 ``MAX_PAGE_RESENDS`` 就不給搶（409 ``EXAM_IMPORT_RETRY_LIMIT``）；
      這時若頁還卡在 processing，順手改成失敗（``_expire_stale_page``），讓匯入能變 ready。
    其他情況（處理中、已處理完）回 409 ``EXAM_IMPORT_PAGE_BUSY``。匯入已結束回 409
    ``EXAM_IMPORT_CLOSED``。
    """
    imp = lock_import(db, import_id)
    if imp.status not in UNFINISHED_STATUSES:
        db.rollback()
        raise ExamImportError(409, "EXAM_IMPORT_CLOSED", "這次匯入已結束，不能再處理頁面")
    now = _utcnow()
    stale = and_(
        ExamImportPage.status == PAGE_STATUS_PROCESSING,
        or_(
            ExamImportPage.updated_at.is_(None),
            ExamImportPage.updated_at < now - STALE_PROCESSING,
        ),
    )
    resendable = or_(ExamImportPage.status == PAGE_STATUS_FAILED, stale)
    claimable = or_(
        ExamImportPage.status == PAGE_STATUS_PENDING,
        and_(resendable, ExamImportPage.resend_count < MAX_PAGE_RESENDS),
    )
    claim_id = uuid.uuid4().hex
    claimed = (
        db.query(ExamImportPage)
        .filter(ExamImportPage.id == page_id, claimable)
        .update(
            {
                ExamImportPage.status: PAGE_STATUS_PROCESSING,
                ExamImportPage.error: None,
                ExamImportPage.claim_id: claim_id,
                # SET 右邊讀的是更新前的 status：pending 不加、其餘（重送）加一
                ExamImportPage.resend_count: ExamImportPage.resend_count
                + case((ExamImportPage.status == PAGE_STATUS_PENDING, 0), else_=1),
                ExamImportPage.updated_at: now,
            },
            synchronize_session=False,
        )
    )
    if claimed:
        db.commit()
        return claim_id
    over_limit = (
        db.query(ExamImportPage.id)
        .filter(
            ExamImportPage.id == page_id,
            resendable,
            ExamImportPage.resend_count >= MAX_PAGE_RESENDS,
        )
        .first()
        is not None
    )
    if over_limit:
        _expire_stale_page(db, imp, page_no)
        raise ExamImportError(
            409,
            "EXAM_IMPORT_RETRY_LIMIT",
            f"第 {page_no} 頁已經重送 {MAX_PAGE_RESENDS} 次，請改用手動補題",
            retry_limit=MAX_PAGE_RESENDS,
        )
    db.rollback()
    raise ExamImportError(409, "EXAM_IMPORT_PAGE_BUSY", f"第 {page_no} 頁正在處理或已處理完")


def _owns_page(page: Optional[ExamImportPage], claim_id: str) -> bool:
    return (
        page is not None
        and page.status == PAGE_STATUS_PROCESSING
        and page.claim_id == claim_id
    )


def _fail_page(
    db: Session,
    import_id: int,
    page_no: int,
    claim_id: str,
    error: str,
    usage: Optional[CallUsage] = None,
) -> None:
    """AI 失敗或整理結果出錯：鎖內記用量（若有）；這一頁**仍是自己搶到的**才標成失敗
    （已被別的請求重搶就不動它）。"""
    db.rollback()
    imp = lock_import(db, import_id)
    if usage is not None:
        record_usage(
            db,
            imp,
            call_type=USAGE_CALL_EXTRACT_PAGE,
            usage=usage,
            page_no=page_no,
            succeeded=False,
        )
    page = next((p for p in imp.pages if p.page_no == page_no), None)
    if _owns_page(page, claim_id):
        page.status = PAGE_STATUS_FAILED
        page.error = error
        page.claim_id = None
        _refresh_status_and_count(imp)
    db.commit()


# --------------------------------------------------------------------------- #
# 擷取一頁／重試單一題
# --------------------------------------------------------------------------- #
async def process_page(
    db: Session,
    imp: ExamImport,
    page_no: int,
    image_bytes: bytes,
    mime_type: str,
    *,
    service: Optional[ExamPaperService] = None,
    rng: Optional[random.Random] = None,
) -> ExamImportPage:
    """擷取一頁並寫進草稿。

    只有還沒處理完（pending／failed，或卡在 processing 超過 3 分鐘）的頁可以送：整頁失敗才重送
    整頁（重送上限見 ``_claim_page``）；已處理完的頁改用 ``retry_question`` 以題為單位重讀（處理完
    的頁可能已和下一頁合併跨頁題組，整頁重來會弄亂）。送 AI 前 commit 釋放連線；AI 回來後在
    ``lock_import`` 的鎖內確認仍持有這一頁（``claim_id``）才寫入（見模組說明）。
    """
    _require_open(imp)
    page = _get_page(imp, page_no)
    if page.status == PAGE_STATUS_DONE:
        raise ExamImportError(
            409, "EXAM_IMPORT_PAGE_DONE", f"第 {page_no} 頁已處理完，請改用重試單一題"
        )
    service = service or get_exam_paper_service()
    mime = service.validate_page_image(image_bytes, mime_type)
    import_id, page_id = imp.id, page.id
    claim_id = _claim_page(db, import_id, page_id, page_no)
    return await run_claimed_page(
        db, import_id, page_id, page_no, claim_id, image_bytes, mime, service, rng
    )


async def run_claimed_page(
    db: Session,
    import_id: int,
    page_id: int,
    page_no: int,
    claim_id: str,
    image_bytes: bytes,
    mime: str,
    service: ExamPaperService,
    rng: Optional[random.Random] = None,
    *,
    store_image: bool = True,
) -> ExamImportPage:
    """已搶到 processing 之後：存頁圖、送 AI、鎖內寫入。空白頁「仍要送出」也走這裡（頁圖已存好，
    ``store_image=False``；見 ``exam_import_blank``）。"""
    try:
        if store_image:
            image_url = exam_import_storage.store_page_image(
                import_id, page_no, image_bytes, mime
            )
            db.query(ExamImportPage).filter(
                ExamImportPage.id == page_id, ExamImportPage.claim_id == claim_id
            ).update({ExamImportPage.image_url: image_url}, synchronize_session=False)
        catalog, code_to_id = exam_point_catalog(db)
        imp = db.get(ExamImport, import_id)
        known = dict(imp.known_answers or {})
        db.commit()  # 送 AI 前結束交易、把連線還給連線池（AI 最多等 2 分鐘）
        result = await service.extract_page(
            image_bytes,
            mime,
            page_no=page_no,
            known_answers=known,
            exam_point_catalog=catalog,
            code_to_id=code_to_id,
        )
    except ExamPaperTimeoutError as e:
        _fail_page(db, import_id, page_no, claim_id, "AI 處理逾時", usage=e.usage)
        raise
    except ExamPaperOutputError as e:
        _fail_page(db, import_id, page_no, claim_id, "AI 回傳格式錯誤", usage=e.usage)
        raise
    except Exception:
        _fail_page(db, import_id, page_no, claim_id, "AI 擷取失敗")
        raise

    imp = lock_import(db, import_id)
    try:
        return _write_page_result(db, imp, page_no, claim_id, result, rng)
    except ExamImportError:
        raise
    except Exception:
        logger.exception("[exam-import] import=%s page=%s 整理結果失敗", import_id, page_no)
        _fail_page(db, import_id, page_no, claim_id, "整理擷取結果失敗", usage=result.usage)
        raise


def _write_page_result(
    db: Session,
    imp: ExamImport,
    page_no: int,
    claim_id: str,
    result: Any,
    rng: Optional[random.Random],
) -> ExamImportPage:
    """鎖內：確認仍持有這一頁、記用量、套答案／合併／比對／計數後 commit。

    匯入已結束（AI 處理期間被放棄：頁已被刪掉，所以先判斷匯入狀態、頁用 ``next(..., None)`` 找，
    找不到視為不再持有）或這一頁已被別的請求重搶：用量照記（失敗），結果丟掉、回 409
    （``EXAM_IMPORT_CLOSED``／``EXAM_IMPORT_PAGE_BUSY``）。
    """
    closed = imp.status not in UNFINISHED_STATUSES
    page = next((p for p in imp.pages if p.page_no == page_no), None)
    if closed or not _owns_page(page, claim_id):
        record_usage(
            db,
            imp,
            call_type=USAGE_CALL_EXTRACT_PAGE,
            usage=result.usage,
            page_no=page_no,
            succeeded=False,
        )
        db.commit()
        if closed:
            raise ExamImportError(409, "EXAM_IMPORT_CLOSED", "這次匯入已結束，不能再處理頁面")
        raise ExamImportError(409, "EXAM_IMPORT_PAGE_BUSY", f"第 {page_no} 頁已由另一次送出接手處理")
    record_usage(
        db, imp, call_type=USAGE_CALL_EXTRACT_PAGE, usage=result.usage, page_no=page_no
    )

    # 用鎖內最新的已知答案（等待 AI 期間別頁可能已存好答案頁）＋本頁答案表套到新卡
    latest_known = {**(imp.known_answers or {}), **result.answer_key}
    apply_answer_key(result.cards, latest_known)
    # 單頁克漏字也統一重編成 1..k（跨頁合併時 merge_group_cards 會再整組重編）
    renumber_cloze_cards(result.cards)
    others = [
        c for p in _done_pages(imp) if p.page_no != page_no for c in (p.cards or [])
    ]
    assign_accents(list(imp.tts_accents or []), others, result.cards, rng)
    page.cards = result.cards
    page.is_answer_page = result.is_answer_page
    page.answer_key = result.answer_key or None
    page.status = PAGE_STATUS_DONE
    page.error = None
    page.claim_id = None
    page.processed_at = _utcnow()
    _touch(page)

    _refresh_answers(db, imp, result.answer_key)
    _merge_continuations(imp)
    _refresh_duplicates(db, imp)
    _refresh_status_and_count(imp)
    db.commit()
    db.refresh(page)
    return page


def __getattr__(name: str) -> Any:
    """舊匯入相容：``retry_question`` 已拆到 ``services/exam_import_retry.py``（它反過來匯入本模組，
    所以延遲載入，避免循環匯入）。"""
    if name in ("retry_question", "MAX_QUESTION_RETRIES"):
        from services import exam_import_retry

        return getattr(exam_import_retry, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "ANSWER_SOURCE_ANSWER_PAGE",
    "DAILY_LIMIT",
    "MAX_PAGE_RESENDS",
    "STALE_PROCESSING",
    "ExamImportError",
    "abandon_import",
    "assign_accents",
    "backfill_saved_questions",
    "count_today_imports",
    "create_import",
    "exam_point_catalog",
    "find_duplicate_import",
    "get_import",
    "list_unfinished",
    "lock_import",
    "process_page",
    "run_claimed_page",
    "record_usage",
    "serialize_import",
    "serialize_page",
    "taipei_day_bounds",
]
