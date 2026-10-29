"""
上傳題本草稿的卡片整理：口音、跨頁題組、答案回填、題數與狀態、重複標記
（Issue #1112，C4-0 自 ``exam_import_service.py`` 拆出，行為不變）。

全部在呼叫端拿到 ``lock_import`` 的鎖之後呼叫（見 ``exam_import_common.lock_import``）。
"""

from __future__ import annotations

import copy
import random
from typing import Any, Dict, List, Mapping, Optional

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from models import ExamImport, Question
from models.exam_import import (
    EXAM_IMPORT_STATUS_PROCESSING,
    EXAM_IMPORT_STATUS_READY,
    PAGE_STATUS_DONE,
    PAGE_STATUS_FAILED,
)
from services.exam_import_common import _all_cards, _done_pages, _touch
from services.exam_import_dedup import mark_duplicates
from services.exam_paper_cards import (
    ANSWER_SOURCE_AI,
    answer_is_locked,
    apply_answer_key,
    iter_card_questions,
    merge_continuations,
    unmerge_invalid_continuations,
)


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
    """答案頁晚到時，更新**已存入題庫**、而且老師沒改過答案的題（定案 15 工程預設、C4 B3）。

    存入（``exam_import_save``）時在題目卡的每一題寫 ``saved_question_id``；本函式只處理有這個
    欄位、答案來源仍是 AI、而且題庫裡目前的正確選項仍等於卡片上的 AI 答案（＝老師在題庫裡也沒
    改過）的題。必須在 ``apply_answer_key`` 之前呼叫（要比對的是更新前的 AI 答案）。
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
            question.allow_multiple_answers = len(wanted) > 1
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
