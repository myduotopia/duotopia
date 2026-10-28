"""
上傳題本匯入流程（Issue #1112 C2）：建立匯入、逐頁擷取、答案頁回填、放棄、用量。
重試單一題在 ``services/exam_import_retry.py``（本模組的 ``retry_question`` 照樣可用）。

規則來源：docs/design/question-bank-exam-import.md、計畫檔定案 14–17。

- **每天 1 本**：一般老師以台灣時間自然日計，算當天建立、沒有放棄的匯入；``Teacher.is_admin`` 不限
  （與 ``magic_paste_quota.is_unlimited`` 同一個判斷）。不佔 magic paste 每月額度、不扣點。
- **重複匯入**：同一位老師、同一個檔案雜湊、沒有放棄的匯入 → 擋下並回那次匯入的 id。
  超過 30 天仍未完成的匯入視同過期（列表也不顯示），不擋。
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
- **存入題庫（全部儲存／略過核對）不在 C2**：見 ``backfill_saved_questions`` 的 TODO（C4）。
"""

from __future__ import annotations

import copy
import logging
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Mapping, Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import and_, case, or_
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from models import (
    ExamImport,
    ExamImportPage,
    ExamImportUsage,
    ExamPoint,
    Question,
    Teacher,
)
from models.exam_import import (
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
from services.exam_import_dedup import mark_duplicates
from services.exam_paper_cards import (
    ANSWER_SOURCE_AI,
    ANSWER_SOURCE_ANSWER_PAGE,
    CARD_KIND_GROUP,
    answer_is_locked,
    apply_answer_key,
    iter_card_questions,
    merge_continuations,
    renumber_cloze_cards,
    strip_merge_records,
    unmerge_invalid_continuations,
)
from services.exam_paper_service import (
    CallUsage,
    ExamPaperOutputError,
    ExamPaperService,
    ExamPaperTimeoutError,
    get_exam_paper_service,
)
from services.magic_paste_quota import is_unlimited

logger = logging.getLogger(__name__)

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


# --------------------------------------------------------------------------- #
# 建立匯入
# --------------------------------------------------------------------------- #
def count_today_imports(
    db: Session, teacher_id: int, now: Optional[datetime] = None
) -> int:
    start, end = taipei_day_bounds(now)
    return (
        db.query(ExamImport)
        .filter(
            ExamImport.teacher_id == teacher_id,
            ExamImport.status != EXAM_IMPORT_STATUS_ABANDONED,
            ExamImport.created_at >= start,
            ExamImport.created_at < end,
        )
        .count()
    )


def find_duplicate_import(
    db: Session, teacher_id: int, file_hash: str, now: Optional[datetime] = None
) -> Optional[ExamImport]:
    cutoff = (_as_utc(now) or _utcnow()) - timedelta(days=UNFINISHED_RETENTION_DAYS)
    rows = (
        db.query(ExamImport)
        .filter(
            ExamImport.teacher_id == teacher_id,
            ExamImport.file_hash == file_hash.lower(),
            ExamImport.status != EXAM_IMPORT_STATUS_ABANDONED,
        )
        .order_by(ExamImport.id.desc())
        .all()
    )
    for row in rows:
        expired = row.status in UNFINISHED_STATUSES and (
            _as_utc(row.created_at) is not None and _as_utc(row.created_at) < cutoff
        )
        if not expired:
            return row
    return None


def create_import(
    db: Session,
    teacher: Teacher,
    *,
    file_name: str,
    file_hash: str,
    page_count: int,
    tts_accents: List[str],
    settings: Mapping[str, Any],
    now: Optional[datetime] = None,
) -> ExamImport:
    now = _as_utc(now) or _utcnow()
    # 同一位老師的建立序列化，避免兩個並發請求都通過「今天還沒上傳」的檢查
    db.query(Teacher).filter(Teacher.id == teacher.id).with_for_update().first()

    existing = find_duplicate_import(db, teacher.id, file_hash, now)
    if existing is not None:
        raise ExamImportError(
            409,
            "EXAM_IMPORT_DUPLICATE",
            "這個題本已經匯入過",
            existing_import_id=existing.id,
        )
    if (
        not is_unlimited(teacher)
        and count_today_imports(db, teacher.id, now) >= DAILY_LIMIT
    ):
        raise ExamImportError(
            429,
            "EXAM_IMPORT_DAILY_LIMIT",
            f"每天最多上傳 {DAILY_LIMIT} 本題本，請明天再上傳",
            daily_limit=DAILY_LIMIT,
        )

    imp = ExamImport(
        teacher_id=teacher.id,
        file_name=file_name,
        file_hash=file_hash.lower(),
        page_count=page_count,
        status=EXAM_IMPORT_STATUS_PROCESSING,
        settings=dict(settings),
        tts_accents=list(dict.fromkeys(tts_accents)),
        known_answers={},
        created_at=now,
    )
    imp.pages = [
        ExamImportPage(page_no=n, status=PAGE_STATUS_PENDING, cards=[])
        for n in range(1, page_count + 1)
    ]
    db.add(imp)
    db.commit()
    db.refresh(imp)
    return imp


def get_import(db: Session, teacher: Teacher, import_id: int) -> ExamImport:
    imp = (
        db.query(ExamImport)
        .filter(ExamImport.id == import_id, ExamImport.teacher_id == teacher.id)
        .first()
    )
    if imp is None or imp.status == EXAM_IMPORT_STATUS_ABANDONED:
        raise ExamImportError(404, "EXAM_IMPORT_NOT_FOUND", "找不到這次匯入")
    return imp


def list_unfinished(
    db: Session, teacher: Teacher, now: Optional[datetime] = None
) -> List[ExamImport]:
    cutoff = (_as_utc(now) or _utcnow()) - timedelta(days=UNFINISHED_RETENTION_DAYS)
    return (
        db.query(ExamImport)
        .filter(
            ExamImport.teacher_id == teacher.id,
            ExamImport.status.in_(UNFINISHED_STATUSES),
            ExamImport.created_at >= cutoff,
        )
        .order_by(ExamImport.created_at.desc(), ExamImport.id.desc())
        .all()
    )


def abandon_import(db: Session, imp: ExamImport) -> None:
    """放棄：刪草稿頁（含題目卡）與該匯入的頁圖；匯入列留著（狀態 abandoned，用量照留）。

    只有還沒存入的匯入（processing／ready）可以放棄；已全部存入（saved）回 409。
    """
    imp = lock_import(db, imp.id)
    if imp.status not in UNFINISHED_STATUSES:
        db.rollback()
        raise ExamImportError(409, "EXAM_IMPORT_NOT_ABANDONABLE", "這次匯入已存入題庫，不能放棄")
    imp.status = EXAM_IMPORT_STATUS_ABANDONED
    imp.abandoned_at = _utcnow()
    imp.known_answers = {}
    for page in list(imp.pages):
        db.delete(page)
    db.commit()
    exam_import_storage.delete_import_images(imp.id)


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
# 卡片整理：口音、跨頁題組、答案回填、題數
# --------------------------------------------------------------------------- #
def _done_pages(imp: ExamImport) -> List[ExamImportPage]:
    return sorted(
        (p for p in imp.pages if p.status == PAGE_STATUS_DONE), key=lambda p: p.page_no
    )


def _all_cards(imp: ExamImport) -> List[Dict[str, Any]]:
    return [c for p in _done_pages(imp) for c in (p.cards or [])]


def _touch(page: ExamImportPage) -> None:
    flag_modified(page, "cards")


def assign_accents(
    accents: List[str],
    existing_cards: List[Mapping[str, Any]],
    new_cards: List[Dict[str, Any]],
    rng: Optional[random.Random] = None,
) -> None:
    """平均分配口音：每張還沒有口音的新卡，從「目前用最少次」的口音裡隨機抽一種。

    「延續上一頁題組」的卡之後會併進前一張題組卡（沿用那張的口音），所以**不算進次數**；
    它自己仍抽一種，萬一一直沒併到也有口音可用。
    """
    if not accents:
        return
    rng = rng or random.Random()
    counts = {a: 0 for a in accents}
    for c in existing_cards:
        if c.get("tts_accent") in counts and not c.get("continues_previous"):
            counts[c["tts_accent"]] += 1
    for card in new_cards:
        counted = not card.get("continues_previous")
        if card.get("tts_accent") in counts:
            if counted:
                counts[card["tts_accent"]] += 1
            continue
        least = min(counts.values())
        choice = rng.choice([a for a in accents if counts[a] == least])
        card["tts_accent"] = choice
        if counted:
            counts[choice] += 1


def _merge_continuations(imp: ExamImport) -> None:
    """跨頁題組合併（規則在 ``exam_paper_cards.merge_continuations``，報告腳本共用）。

    先把「跨過的頁現在有卡片」的合併拆回各頁（``unmerge_invalid_continuations``），再整份依頁碼
    合併；有拆過就再套一次已知答案（拆回來的是合併當時的樣子，之後到的答案頁要補上）。
    """
    pages = {
        p.page_no: (
            copy.deepcopy(p.cards or []) if p.status == PAGE_STATUS_DONE else None
        )
        for p in imp.pages
    }
    unmerged = unmerge_invalid_continuations(pages)
    changed = unmerged | merge_continuations(pages, record=True)
    if unmerged and imp.known_answers:
        for n in changed:
            apply_answer_key(pages[n] or [], imp.known_answers)
    for p in imp.pages:
        if p.page_no in changed:
            p.cards = pages[p.page_no]
            _touch(p)


def backfill_saved_questions(
    db: Session, imp: ExamImport, answer_key: Mapping[str, List[int]]
) -> int:
    """答案頁晚到時，更新**已存入題庫**、而且老師沒改過答案的題（定案 15 工程預設）。

    TODO(C4)：存入題庫（全部儲存／略過核對）尚未實作。C4 存入時要在題目卡的 question 寫
    ``saved_question_id``；本函式只處理有這個欄位、答案來源仍是 AI、而且題庫裡目前的正確選項
    仍等於卡片上的 AI 答案（＝老師在題庫裡也沒改過）的題。必須在 ``apply_answer_key`` 之前呼叫
    （要比對的是更新前的 AI 答案）。
    """
    if not answer_key:
        return 0
    updated = 0
    for card in _all_cards(imp):
        for q in iter_card_questions(card):
            qid = q.get("saved_question_id")
            no = q.get("source_question_no")
            if not qid or not no or no not in answer_key or answer_is_locked(q):
                continue
            if q.get("answer_source") != ANSWER_SOURCE_AI:
                continue
            question = (
                db.query(Question)
                .filter(Question.id == qid, Question.teacher_id == imp.teacher_id)
                .first()
            )
            if question is None or question.deleted_at is not None:
                continue
            options = sorted(question.options, key=lambda o: o.order_index)
            current = [i for i, o in enumerate(options) if o.is_correct]
            wanted = [i for i in answer_key[no] if 0 <= i < len(options)]
            if not wanted or current != list(q.get("correct_indexes") or []):
                continue
            for i, o in enumerate(options):
                o.is_correct = i in wanted
            updated += 1
    return updated


def _refresh_answers(
    db: Session, imp: ExamImport, new_key: Mapping[str, List[int]]
) -> None:
    if not new_key:
        return
    merged = {**(imp.known_answers or {}), **new_key}
    imp.known_answers = merged
    flag_modified(imp, "known_answers")
    backfill_saved_questions(db, imp, new_key)
    for page in _done_pages(imp):
        cards = copy.deepcopy(page.cards or [])
        if apply_answer_key(cards, merged):
            page.cards = cards
            _touch(page)


def _refresh_status_and_count(imp: ExamImport) -> None:
    imp.question_count = sum(1 for c in _all_cards(imp) for _ in iter_card_questions(c))
    if imp.status == EXAM_IMPORT_STATUS_PROCESSING and all(
        p.status in (PAGE_STATUS_DONE, PAGE_STATUS_FAILED) for p in imp.pages
    ):
        imp.status = EXAM_IMPORT_STATUS_READY


def _refresh_duplicates(db: Session, imp: ExamImport) -> None:
    """整份重新標記重複（題庫＋同一份匯入）。跨頁合併、答案回填都可能改變卡片內容，所以每次全查：
    最多 20 頁；題庫端先用 SQL 依題目比對鍵篩候選，不載入老師全部的題目／題組。"""
    pages = _done_pages(imp)
    cards = [copy.deepcopy(p.cards or []) for p in pages]
    flat = [c for page_cards in cards for c in page_cards]
    mark_duplicates(db, imp.teacher_id, flat)
    for page, page_cards in zip(pages, cards):
        page.cards = page_cards
        _touch(page)


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
    合併、回填、比對、計數、用量加總都在鎖內做。寫題目卡的路徑（擷取一頁、重試單一題、放棄）
    都先拿這把鎖，所以同一份匯入的寫入會排隊。SQLite（測試）沒有列鎖，只驗證邏輯。
    """
    db.expire_all()
    return (
        db.query(ExamImport)
        .filter(ExamImport.id == import_id)
        .with_for_update()
        .populate_existing()
        .one()
    )


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


# --------------------------------------------------------------------------- #
# 序列化
# --------------------------------------------------------------------------- #
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
