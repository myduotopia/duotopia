"""
上傳題本匯入流程（Issue #1112 C2）：建立匯入、逐頁擷取、答案頁回填、重試單一題、放棄、用量。

規則來源：docs/design/question-bank-exam-import.md、計畫檔定案 14–17。

- **每天 1 本**：一般老師以台灣時間自然日計，算當天建立、沒有放棄的匯入；``Teacher.is_admin`` 不限
  （與 ``magic_paste_quota.is_unlimited`` 同一個判斷）。不佔 magic paste 每月額度、不扣點。
- **重複匯入**：同一位老師、同一個檔案雜湊、沒有放棄的匯入 → 擋下並回那次匯入的 id。
  超過 30 天仍未完成的匯入視同過期（列表也不顯示），不擋。
- **處理順序由前端決定**（先最後一頁往前找答案頁、再從第 1 頁），後端任何順序都正確：
  每頁擷取時帶入已知答案；答案頁晚到時回填已處理頁中「答案來源是 AI、老師沒改過」的題。
- **跨頁題組**：某頁第一張卡標「延續上一頁題組」且上一頁已處理 → 併進上一頁最後一張題組卡
  （克漏字空格編號接續）。上一頁還沒處理就先留著，等上一頁處理完再併。
- **口音**：每張題目卡分配一種（勾一種＝全部同一種；多種＝平均分配：從目前用最少次的口音中隨機抽），
  抽中後固定。
- **用量**：每次 AI 呼叫寫一列 ``exam_import_usage``，``exam_imports`` 同步加總；AI 回應無法解析時
  也照記（token 已經花掉）。
- **存入題庫（全部儲存／略過核對）不在 C2**：見 ``backfill_saved_questions`` 的 TODO（C4）。
"""

from __future__ import annotations

import copy
import logging
import random
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Mapping, Optional, Tuple
from zoneinfo import ZoneInfo

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
    USAGE_CALL_RETRY_QUESTION,
)
from models.question_bank import EXAM_POINT_STATUS_ACTIVE
from services import exam_import_storage
from services.exam_import_dedup import mark_duplicates
from services.exam_paper_service import (
    ANSWER_SOURCE_AI,
    ANSWER_SOURCE_ANSWER_PAGE,
    CARD_KIND_GROUP,
    CallUsage,
    ExamPaperOutputError,
    ExamPaperService,
    answer_is_locked,
    apply_answer_key,
    get_exam_paper_service,
    iter_card_questions,
    merge_group_cards,
    normalize_question_no,
)
from services.magic_paste_quota import is_unlimited

logger = logging.getLogger(__name__)

TAIPEI = ZoneInfo("Asia/Taipei")
DAILY_LIMIT = 1
UNFINISHED_RETENTION_DAYS = 30
UNFINISHED_STATUSES = (EXAM_IMPORT_STATUS_PROCESSING, EXAM_IMPORT_STATUS_READY)


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
    """放棄：刪草稿頁（含題目卡）與該匯入的頁圖；匯入列留著（狀態 abandoned，用量照留）。"""
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
    """平均分配口音：每張還沒有口音的新卡，從「目前用最少次」的口音裡隨機抽一種。"""
    if not accents:
        return
    rng = rng or random.Random()
    counts = {a: 0 for a in accents}
    for c in existing_cards:
        if c.get("tts_accent") in counts:
            counts[c["tts_accent"]] += 1
    for card in new_cards:
        if card.get("tts_accent") in counts:
            counts[card["tts_accent"]] += 1
            continue
        least = min(counts.values())
        choice = rng.choice([a for a in accents if counts[a] == least])
        card["tts_accent"] = choice
        counts[choice] += 1


def merge_continuations(imp: ExamImport) -> None:
    """依頁碼掃一遍：第一張卡延續上一頁題組、且上一頁已處理且最後一張是題組 → 合併。"""
    by_no = {p.page_no: p for p in _done_pages(imp)}
    for page in sorted(by_no.values(), key=lambda p: p.page_no):
        cards = page.cards or []
        if not cards:
            continue
        first = cards[0]
        if first.get("kind") != CARD_KIND_GROUP or not first.get("continues_previous"):
            continue
        prev = by_no.get(page.page_no - 1)
        if (
            prev is None
            or not prev.cards
            or prev.cards[-1].get("kind") != CARD_KIND_GROUP
        ):
            continue
        prev_cards = copy.deepcopy(prev.cards)
        merge_group_cards(prev_cards[-1], copy.deepcopy(first))
        prev.cards = prev_cards
        page.cards = copy.deepcopy(cards[1:])
        _touch(prev)
        _touch(page)


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
    最多 20 頁，題庫查詢是一次單題查詢＋一次載入老師自己的題組。"""
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

    只有還沒處理完（pending／processing／failed）的頁可以送：整頁失敗才重送整頁；已處理完的頁
    改用 ``retry_question`` 以題為單位重讀（處理完的頁可能已和下一頁合併跨頁題組，整頁重來會弄亂）。
    """
    _require_open(imp)
    page = _get_page(imp, page_no)
    if page.status == PAGE_STATUS_DONE:
        raise ExamImportError(
            409, "EXAM_IMPORT_PAGE_DONE", f"第 {page_no} 頁已處理完，請改用重試單一題"
        )
    service = service or get_exam_paper_service()
    mime = service.validate_page_image(image_bytes, mime_type)

    page.image_url = exam_import_storage.store_page_image(
        imp.id, page_no, image_bytes, mime
    )
    page.status = PAGE_STATUS_PROCESSING
    page.error = None
    db.commit()

    catalog, code_to_id = exam_point_catalog(db)
    try:
        result = await service.extract_page(
            image_bytes,
            mime,
            page_no=page_no,
            known_answers=imp.known_answers or {},
            exam_point_catalog=catalog,
            code_to_id=code_to_id,
        )
    except ExamPaperOutputError as e:
        record_usage(
            db,
            imp,
            call_type=USAGE_CALL_EXTRACT_PAGE,
            usage=e.usage,
            page_no=page_no,
            succeeded=False,
        )
        page.status = PAGE_STATUS_FAILED
        page.error = "AI 回傳格式錯誤"
        _refresh_status_and_count(imp)
        db.commit()
        raise
    except Exception:
        page.status = PAGE_STATUS_FAILED
        page.error = "AI 擷取失敗"
        _refresh_status_and_count(imp)
        db.commit()
        raise

    record_usage(
        db, imp, call_type=USAGE_CALL_EXTRACT_PAGE, usage=result.usage, page_no=page_no
    )
    others = [
        c for p in _done_pages(imp) if p.page_no != page_no for c in (p.cards or [])
    ]
    assign_accents(list(imp.tts_accents or []), others, result.cards, rng)
    page.cards = result.cards
    page.is_answer_page = result.is_answer_page
    page.answer_key = result.answer_key or None
    page.status = PAGE_STATUS_DONE
    page.processed_at = _utcnow()
    _touch(page)

    _refresh_answers(db, imp, result.answer_key)
    merge_continuations(imp)
    _refresh_duplicates(db, imp)
    _refresh_status_and_count(imp)
    db.commit()
    db.refresh(page)
    return page


def _card_has_question(card: Mapping[str, Any], question_no: str) -> bool:
    return any(
        q.get("source_question_no") == question_no for q in iter_card_questions(card)
    )


async def retry_question(
    db: Session,
    imp: ExamImport,
    page_no: int,
    image_bytes: bytes,
    mime_type: str,
    *,
    card_id: Optional[str] = None,
    question_no: Optional[str] = None,
    bbox: Optional[List[int]] = None,
    service: Optional[ExamPaperService] = None,
) -> Dict[str, Any]:
    """只重讀一頁裡的一題（給題號或 bbox；或給 card_id 由卡片推得），取代該卡。回傳新卡。"""
    _require_open(imp)
    page = _get_page(imp, page_no)
    if page.status != PAGE_STATUS_DONE:
        raise ExamImportError(409, "EXAM_IMPORT_PAGE_NOT_DONE", "這一頁還沒處理完，請重送整頁")
    service = service or get_exam_paper_service()
    mime = service.validate_page_image(image_bytes, mime_type)

    cards = copy.deepcopy(page.cards or [])
    question_no = normalize_question_no(question_no)
    index = None
    if card_id:
        index = next(
            (i for i, c in enumerate(cards) if c.get("card_id") == card_id), None
        )
        if index is None:
            raise ExamImportError(404, "EXAM_IMPORT_CARD_NOT_FOUND", "找不到這張題目卡")
        old = cards[index]
        if not question_no:
            first_no = next(
                (
                    q.get("source_question_no")
                    for q in iter_card_questions(old)
                    if q.get("source_question_no")
                ),
                None,
            )
            question_no = first_no
        bbox = bbox or old.get("bbox")
    if not question_no and not bbox:
        raise ExamImportError(422, "EXAM_IMPORT_RETRY_TARGET", "請指定題號或位置")
    if index is None and question_no:
        index = next(
            (i for i, c in enumerate(cards) if _card_has_question(c, question_no)), None
        )

    catalog, code_to_id = exam_point_catalog(db)
    try:
        result = await service.extract_page(
            image_bytes,
            mime,
            page_no=page_no,
            known_answers=imp.known_answers or {},
            exam_point_catalog=catalog,
            code_to_id=code_to_id,
            focus_question_no=question_no,
            focus_box=bbox,
        )
    except ExamPaperOutputError as e:
        record_usage(
            db,
            imp,
            call_type=USAGE_CALL_RETRY_QUESTION,
            usage=e.usage,
            page_no=page_no,
            succeeded=False,
        )
        db.commit()
        raise
    record_usage(
        db,
        imp,
        call_type=USAGE_CALL_RETRY_QUESTION,
        usage=result.usage,
        page_no=page_no,
    )

    new_card = None
    if question_no:
        new_card = next(
            (c for c in result.cards if _card_has_question(c, question_no)), None
        )
    if new_card is None and result.cards:
        new_card = result.cards[0]
    if new_card is None:
        db.commit()
        raise ExamImportError(422, "EXAM_IMPORT_RETRY_EMPTY", "AI 沒有讀到這一題，請手動補這一題")

    if index is not None:
        old = cards[index]
        new_q = (
            next(
                (
                    q
                    for q in iter_card_questions(new_card)
                    if q.get("source_question_no") == question_no
                ),
                None,
            )
            if question_no
            else None
        )
        if (
            old.get("kind") == CARD_KIND_GROUP
            and len(old.get("pages") or []) > 1
            and new_q is not None
        ):
            # 跨頁合併過的題組：只換掉那一題，其他頁併進來的素材與小題保留
            questions = old["group"]["questions"]
            for i, q in enumerate(questions):
                if q.get("source_question_no") == question_no:
                    new_q["blank"] = q.get("blank")
                    questions[i] = new_q
                    break
            new_card = old
        else:
            new_card["tts_accent"] = old.get("tts_accent")
            new_card["card_id"] = old.get("card_id") or new_card["card_id"]
            cards[index] = new_card
    else:
        cards.append(new_card)
        others = [c for c in _all_cards(imp) if c.get("card_id") != new_card["card_id"]]
        assign_accents(list(imp.tts_accents or []), others, [new_card])
    apply_answer_key([new_card], imp.known_answers or {})
    page.cards = cards
    _touch(page)
    _refresh_duplicates(db, imp)
    _refresh_status_and_count(imp)
    db.commit()
    db.refresh(page)
    return next(c for c in page.cards if c.get("card_id") == new_card["card_id"])


# --------------------------------------------------------------------------- #
# 序列化
# --------------------------------------------------------------------------- #
def serialize_import(imp: ExamImport, include_pages: bool = False) -> Dict[str, Any]:
    pages = sorted(imp.pages, key=lambda p: p.page_no)
    done = sum(1 for p in pages if p.status == PAGE_STATUS_DONE)
    out: Dict[str, Any] = {
        "id": imp.id,
        "file_name": imp.file_name,
        "page_count": imp.page_count,
        "status": imp.status,
        "settings": imp.settings or {},
        "tts_accents": imp.tts_accents or [],
        "question_count": imp.question_count or 0,
        "pages_done": done,
        "pages_failed": sum(1 for p in pages if p.status == PAGE_STATUS_FAILED),
        "created_at": imp.created_at.isoformat() if imp.created_at else None,
        "updated_at": imp.updated_at.isoformat() if imp.updated_at else None,
    }
    if include_pages:
        out["known_answers"] = imp.known_answers or {}
        out["pages"] = [serialize_page(p) for p in pages]
    return out


def serialize_page(page: ExamImportPage) -> Dict[str, Any]:
    return {
        "page_no": page.page_no,
        "status": page.status,
        "image_url": page.image_url,
        "is_answer_page": bool(page.is_answer_page),
        "answer_key": page.answer_key or {},
        "cards": page.cards or [],
        "error": page.error,
        "processed_at": page.processed_at.isoformat() if page.processed_at else None,
    }


__all__ = [
    "ANSWER_SOURCE_ANSWER_PAGE",
    "DAILY_LIMIT",
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
    "merge_continuations",
    "process_page",
    "record_usage",
    "retry_question",
    "serialize_import",
    "serialize_page",
    "taipei_day_bounds",
]
