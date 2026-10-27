"""
上傳題本：重試單一題（Issue #1112 C2，從 ``exam_import_service`` 拆出）。

只重讀已處理完的一頁裡的一題（給題號或 bbox；或給 card_id 由卡片推得），取代該卡。
``exam_import_service.retry_question`` 仍可用（模組層 ``__getattr__`` 轉到這裡），舊匯入相容。

**次數上限**（定案 18）：每張題目卡最多重試 ``MAX_QUESTION_RETRIES``（2）次，次數記在卡上
（``retry_count``）。**每次為這張卡呼叫 AI 就算一次**，不論結果成功、AI 格式錯誤、逾時或比不到
題號；送 AI **之前**在匯入列的鎖內檢查並加一（同一張卡同時送兩次也不會超過上限），超過回 409
``EXAM_IMPORT_RETRY_LIMIT``，不再呼叫 AI，請老師「手動補這一題」。跨頁合併過的題組整張卡共用
同一個次數。找不到目標卡（只給 bbox、該位置原本沒有卡）時，新加的卡從 1 開始算。

**連線**：檢查與加次數後先 ``commit`` 釋放 DB 連線再等 AI（最多 2 分鐘），AI 回來後重新
``lock_import`` 寫入；鎖內整理出錯 → rollback → 重新上鎖記用量（失敗）再丟出。
"""

from __future__ import annotations

import copy
from typing import Any, Dict, List, Mapping, Optional, Tuple

from sqlalchemy.orm import Session

from models import ExamImport, ExamImportPage
from models.exam_import import PAGE_STATUS_DONE, USAGE_CALL_RETRY_QUESTION
from services import exam_import_service as eis
from services.exam_paper_cards import (
    CARD_KIND_GROUP,
    apply_answer_key,
    card_has_question,
    iter_card_questions,
    normalize_question_no,
)
from services.exam_paper_service import (
    ExamPaperOutputError,
    ExamPaperService,
    get_exam_paper_service,
)

# 每張題目卡「重試單一題」最多呼叫 AI 幾次（定案 18）
MAX_QUESTION_RETRIES = 2

ExamImportError = eis.ExamImportError


def _find_card(
    imp: ExamImport,
    page_no: int,
    card_id: Optional[str],
    question_no: Optional[str],
) -> Optional[Tuple[ExamImportPage, int]]:
    """找重試的目標卡：card_id 跨所有已處理頁找；只有題號時先找這一頁，再找其他頁
    （跨頁合併過的題組放在它開始的那一頁）。"""
    pages = eis._done_pages(imp)
    if card_id:
        for p in pages:
            for i, c in enumerate(p.cards or []):
                if c.get("card_id") == card_id:
                    return p, i
        return None
    if not question_no:
        return None
    for p in sorted(pages, key=lambda p: p.page_no != page_no):
        for i, c in enumerate(p.cards or []):
            if card_has_question(c, question_no):
                return p, i
    return None


def _is_merged_group(card: Mapping[str, Any]) -> bool:
    return card.get("kind") == CARD_KIND_GROUP and len(card.get("pages") or []) > 1


def _replace_in_merged_group(
    old: Dict[str, Any], new_card: Mapping[str, Any], question_no: Optional[str]
) -> bool:
    """跨頁合併過的題組：只換掉那一個題號的小題。比不到題號回 False。"""
    new_q = next(
        (
            q
            for q in iter_card_questions(new_card)
            if question_no and q.get("source_question_no") == question_no
        ),
        None,
    )
    questions = old["group"]["questions"]
    slot = next(
        (
            i
            for i, q in enumerate(questions)
            if question_no and q.get("source_question_no") == question_no
        ),
        None,
    )
    if new_q is None or slot is None:
        return False
    new_q["blank"] = questions[slot].get("blank")
    questions[slot] = new_q
    return True


def _check_retry_target(
    imp: ExamImport,
    page_no: int,
    card_id: Optional[str],
    question_no: Optional[str],
    bbox: Optional[List[int]],
) -> Tuple[Optional[str], Optional[List[int]], Optional[Tuple[ExamImportPage, int]]]:
    """送 AI 前先確認目標卡、補出題號／位置、檢查次數上限。回傳 (題號, bbox, 目標卡位置)。"""
    found = _find_card(imp, page_no, card_id, question_no)
    if card_id and found is None:
        raise ExamImportError(404, "EXAM_IMPORT_CARD_NOT_FOUND", "找不到這張題目卡")
    if found is not None:
        old = found[0].cards[found[1]]
        if page_no not in (old.get("pages") or [old.get("page_no")]):
            raise ExamImportError(
                422, "EXAM_IMPORT_RETRY_TARGET", f"這張題目卡不在第 {page_no} 頁"
            )
        if question_no and not card_has_question(old, question_no):
            raise ExamImportError(
                422, "EXAM_IMPORT_RETRY_TARGET", f"這張題目卡沒有第 {question_no} 題"
            )
        if not question_no:
            question_no = next(
                (
                    q.get("source_question_no")
                    for q in iter_card_questions(old)
                    if q.get("source_question_no") and q.get("page_no") == page_no
                ),
                None,
            )
        if not bbox and old.get("page_no") == page_no:
            bbox = old.get("bbox")
        if _is_merged_group(old) and not question_no:
            raise ExamImportError(
                422, "EXAM_IMPORT_RETRY_MERGED", "跨頁題組請指定要重讀的題號，或手動補這一題"
            )
        if int(old.get("retry_count") or 0) >= MAX_QUESTION_RETRIES:
            raise ExamImportError(
                409,
                "EXAM_IMPORT_RETRY_LIMIT",
                f"這一題已經重試 {MAX_QUESTION_RETRIES} 次，請手動補這一題",
                retry_limit=MAX_QUESTION_RETRIES,
            )
    if not question_no and not bbox:
        raise ExamImportError(422, "EXAM_IMPORT_RETRY_TARGET", "請指定題號或位置")
    return question_no, bbox, found


def _bump_retry_count(found: Tuple[ExamImportPage, int]) -> None:
    owner, index = found
    cards = copy.deepcopy(owner.cards or [])
    cards[index]["retry_count"] = int(cards[index].get("retry_count") or 0) + 1
    owner.cards = cards
    eis._touch(owner)


def _pick_new_card(
    cards: List[Dict[str, Any]], question_no: Optional[str]
) -> Optional[Dict[str, Any]]:
    """有題號時只接受含這個題號的卡（AI 沒讀到就是沒讀到，不拿別題頂替）；
    只給位置（bbox）時取第一張。"""
    if question_no:
        return next((c for c in cards if card_has_question(c, question_no)), None)
    return cards[0] if cards else None


def _record_failed_retry(db: Session, import_id: int, page_no: int, usage) -> None:
    db.rollback()
    imp = eis.lock_import(db, import_id)
    eis.record_usage(
        db,
        imp,
        call_type=USAGE_CALL_RETRY_QUESTION,
        usage=usage,
        page_no=page_no,
        succeeded=False,
    )
    db.commit()


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
    """只重讀一頁裡的一題，取代該卡。回傳新卡。

    目標卡跨所有已處理頁找（跨頁合併過的題組放在它開始的那一頁）。合併題組（``pages`` 不只
    一頁）只換掉那一個題號的小題，其他頁併進來的素材與小題保留；比不到題號回 422（請老師手動補），
    不會用單頁的局部題組蓋掉整個合併題組。指定了題號、AI 回傳卻沒有這個題號 → 422
    ``EXAM_IMPORT_RETRY_EMPTY``。
    """
    eis._require_open(imp)
    page = eis._get_page(imp, page_no)
    if page.status != PAGE_STATUS_DONE:
        raise ExamImportError(409, "EXAM_IMPORT_PAGE_NOT_DONE", "這一頁還沒處理完，請重送整頁")
    service = service or get_exam_paper_service()
    mime = service.validate_page_image(image_bytes, mime_type)
    import_id = imp.id
    question_no = normalize_question_no(question_no)

    # 送 AI 前：鎖住匯入列確認目標卡、檢查並加一次重試次數，commit 釋放連線後才等 AI
    imp = eis.lock_import(db, import_id)
    try:
        eis._require_open(imp)
        question_no, bbox, found = _check_retry_target(
            imp, page_no, card_id, question_no, bbox
        )
        if found is not None:
            _bump_retry_count(found)
        catalog, code_to_id = eis.exam_point_catalog(db)
        known = dict(imp.known_answers or {})
        db.commit()
    except Exception:
        db.rollback()
        raise

    try:
        result = await service.extract_page(
            image_bytes,
            mime,
            page_no=page_no,
            known_answers=known,
            exam_point_catalog=catalog,
            code_to_id=code_to_id,
            focus_question_no=question_no,
            focus_box=bbox,
        )
    except ExamPaperOutputError as e:  # 含逾時
        _record_failed_retry(db, import_id, page_no, e.usage)
        raise

    imp = eis.lock_import(db, import_id)
    try:
        return _apply_retry_result(
            db, imp, page_no, result, card_id=card_id, question_no=question_no
        )
    except ExamImportError:
        raise
    except Exception:
        _record_failed_retry(db, import_id, page_no, result.usage)
        raise


def _apply_retry_result(
    db: Session,
    imp: ExamImport,
    page_no: int,
    result,
    *,
    card_id: Optional[str],
    question_no: Optional[str],
) -> Dict[str, Any]:
    """鎖內：記用量、把重讀結果換進目標卡。業務錯誤先 commit 用量再丟出。"""
    eis.record_usage(
        db,
        imp,
        call_type=USAGE_CALL_RETRY_QUESTION,
        usage=result.usage,
        page_no=page_no,
    )

    def fail(status_code: int, code: str, message: str) -> ExamImportError:
        db.commit()  # 用量照記
        return ExamImportError(status_code, code, message)

    if imp.status not in eis.UNFINISHED_STATUSES:
        raise fail(409, "EXAM_IMPORT_CLOSED", "這次匯入已結束，不能再處理頁面")
    new_card = _pick_new_card(result.cards, question_no)
    if new_card is None:
        raise fail(422, "EXAM_IMPORT_RETRY_EMPTY", "AI 沒有讀到這一題，請手動補這一題")

    known = imp.known_answers or {}
    # AI 處理期間卡片可能被合併／移動：鎖內重新找一次
    found = _find_card(imp, page_no, card_id, question_no)
    if card_id and found is None:
        raise fail(404, "EXAM_IMPORT_CARD_NOT_FOUND", "找不到這張題目卡")
    if found is not None:
        owner, index = found
        cards = copy.deepcopy(owner.cards or [])
        old = cards[index]
        if _is_merged_group(old):
            if not _replace_in_merged_group(old, new_card, question_no):
                raise fail(422, "EXAM_IMPORT_RETRY_MERGED", "跨頁題組裡比不到這個題號，請手動補這一題")
            target = old
        else:
            new_card["card_id"] = old.get("card_id") or new_card["card_id"]
            new_card["tts_accent"] = old.get("tts_accent")
            new_card["continues_previous"] = bool(old.get("continues_previous"))
            new_card["retry_count"] = int(old.get("retry_count") or 0)
            cards[index] = new_card
            target = new_card
    else:
        owner = eis._get_page(imp, page_no)
        cards = copy.deepcopy(owner.cards or [])
        new_card["retry_count"] = 1
        cards.append(new_card)
        eis.assign_accents(list(imp.tts_accents or []), eis._all_cards(imp), [new_card])
        target = new_card
    apply_answer_key([target], known)
    owner.cards = cards
    eis._touch(owner)
    target_id = target["card_id"]
    eis._refresh_duplicates(db, imp)
    eis._refresh_status_and_count(imp)
    db.commit()
    for c in eis._all_cards(imp):
        if c.get("card_id") == target_id:
            return copy.deepcopy(c)
    raise ExamImportError(404, "EXAM_IMPORT_CARD_NOT_FOUND", "找不到這張題目卡")


__all__ = ["MAX_QUESTION_RETRIES", "retry_question"]
