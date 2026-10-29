"""
上傳題本：核對畫面的編輯（Issue #1112 C4a）—— 改一張卡、刪一張卡、手動補一張卡、改整份設定。

全部在 ``lock_import`` 的鎖內做（cold-read B8：和寫入頁結果、重試、存入同一把鎖，不會互相蓋掉）。

**卡片格式**（cold-read B2）：PATCH／POST 只收卡片格式的內容欄位（前端收合編輯時把草稿轉回卡片
格式），存入時一律由 ``exam_import_convert`` 轉成題庫格式。可改的欄位：
- 卡片：``tts_accent``
- 單題 ``question``／題組小題：``stem``、``options``、``correct_indexes``、``explanation``、
  ``exam_point_codes``、``exam_point_ids``、``image_url``（題幹圖，null＝沒有圖）、
  ``option_image_urls``、``source_question_no``、``blank``（克漏字空格編號）
- 題組 ``group``：``group_type``、``title``、``stimulus``（只合併內容子欄位，位置框保留）、
  ``glossary``、``speakers``、``layout``／``passage_text``／``segments``（老師編輯過排版時給，
  存入時原樣採用）、``questions``（整份小題；有原卷題號的依題號對回原本的小題，沒有的依位置）
其他欄位（``card_id``、``pages``、``bbox``、``duplicate_of``、``retry_count``、存入 id、合併紀錄
``_merge_*``…）一律由後端維護，送了也不採用。

**老師改過的欄位**（cold-read B8／B9）：後端比對新舊值，有變的才記進 ``teacher_edited``
（卡片層記題組欄位、每題記自己的欄位），只合併有改的欄位。改了答案 → ``answer_source = "teacher"``，
之後答案頁晚到也不覆蓋、畫面不顯示答案來源。處理失敗的題補上兩個以上選項後改回 ``ok``。

合併紀錄（``_merge_pre``／``_merge_parts``）照樣留在草稿；老師改過的題組之後不會被拆回重算
（``exam_paper_cards.unmerge_invalid_continuations``），以免蓋掉修改。

已存進題庫的卡不能改、刪、重試（409 ``EXAM_IMPORT_CARD_SAVED``，請到題庫編輯）。
"""

from __future__ import annotations

import copy
import uuid
from typing import Any, Dict, List, Mapping, Optional, Tuple

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from models import ExamImport, ExamImportPage, Teacher
from models.exam_import import PAGE_STATUS_DONE, PAGE_STATUS_FAILED
from services import exam_import_service as eis
from services.exam_import_common import ExamImportError
from services.exam_import_refresh import assign_accents
from services.exam_import_settings import validate_program_links, validate_source
from services.exam_paper_cards import (
    ANSWER_SOURCE_TEACHER,
    CARD_KIND_GROUP,
    CARD_KIND_SINGLE,
    STATUS_FAILED,
    STATUS_OK,
    card_is_saved,
    card_rev,
    normalize_question_no,
    strip_merge_records,
)

QUESTION_FIELDS = (
    "stem",
    "options",
    "correct_indexes",
    "explanation",
    "exam_point_codes",
    "exam_point_ids",
    "image_url",
    "option_image_urls",
    "source_question_no",
    "blank",
)
GROUP_FIELDS = (
    "group_type",
    "title",
    "stimulus",
    "glossary",
    "speakers",
    "layout",
    "passage_text",
    "segments",
)
STIMULUS_FIELDS = (
    "kind",
    "paragraphs",
    "text",
    "dialogue",
    "framed",
    "figures",
    "image_url",
)
SETTINGS_FIELDS = ("grade_min", "grade_max", "source_id", "program_links", "visibility")


def _saved_error() -> ExamImportError:
    return ExamImportError(409, "EXAM_IMPORT_CARD_SAVED", "這一題已存進題庫，請到題庫編輯")


def _locate(imp: ExamImport, card_id: str) -> Tuple[ExamImportPage, int]:
    for page in imp.pages:
        for i, c in enumerate(page.cards or []):
            if c.get("card_id") == card_id:
                return page, i
    raise ExamImportError(404, "EXAM_IMPORT_CARD_NOT_FOUND", "找不到這張題目卡")


def empty_question(page_no: int, source_question_no: Optional[str] = None) -> Dict:
    return {
        "source_question_no": normalize_question_no(source_question_no),
        "bbox": None,
        "page_no": page_no,
        "stem": "",
        "blank": None,
        "stem_box_2d": None,
        "options": [],
        "option_boxes": [],
        "correct_indexes": [],
        "answer_source": None,
        "explanation": "",
        "exam_point_codes": [],
        "exam_point_ids": [],
        "status": STATUS_OK,
        "teacher_edited": [],
    }


def _clean(key: str, value: Any) -> Any:
    if key == "source_question_no":
        return normalize_question_no(value)
    if key in ("stem", "explanation", "title"):
        return (value or "").strip()
    return value


def merge_question(
    old: Optional[Mapping[str, Any]], new: Mapping[str, Any], page_no: int
) -> Dict[str, Any]:
    """把老師送來的題目欄位合併進原本的題目；只記有變的欄位（B8）。"""
    q = copy.deepcopy(dict(old)) if old else empty_question(page_no)
    edited: List[str] = list(q.get("teacher_edited") or [])
    changed = False
    for key in QUESTION_FIELDS:
        if key not in new:
            continue
        value = _clean(key, new[key])
        if key in q and q.get(key) == value:
            continue
        q[key] = value
        changed = True
        if key not in edited:
            edited.append(key)
        if key == "correct_indexes":
            q["answer_source"] = ANSWER_SOURCE_TEACHER  # B9
    n = len(q.get("options") or [])
    q["correct_indexes"] = sorted(
        {i for i in q.get("correct_indexes") or [] if isinstance(i, int) and 0 <= i < n}
    )
    urls = q.get("option_image_urls")
    if isinstance(urls, list) and len(urls) != n:
        q["option_image_urls"] = (urls + [None] * n)[:n]
    if changed and q.get("status") == STATUS_FAILED and n >= 2:
        q["status"] = STATUS_OK
    q["teacher_edited"] = edited
    return q


def _match_questions(
    old: List[Dict[str, Any]], new: List[Mapping[str, Any]]
) -> List[Optional[Dict[str, Any]]]:
    """新小題對回原本的小題：有原卷題號依題號，沒有的依位置（該位置原本也沒題號才算）。"""
    by_no = {q.get("source_question_no"): q for q in old if q.get("source_question_no")}
    used: set = set()
    out: List[Optional[Dict[str, Any]]] = []
    for i, nq in enumerate(new):
        no = normalize_question_no(nq.get("source_question_no"))
        match = by_no.get(no) if no else None
        if match is None and i < len(old) and not old[i].get("source_question_no"):
            match = old[i]
        if match is not None and id(match) in used:
            match = None
        if match is not None:
            used.add(id(match))
        out.append(match)
    return out


def apply_card_patch(card: Dict[str, Any], patch: Mapping[str, Any]) -> None:
    """就地把 PATCH 內容合併進卡片（卡片層 ``teacher_edited`` 記題組欄位與口音）。"""
    edited: List[str] = list(card.get("teacher_edited") or [])

    def mark(key: str) -> None:
        if key not in edited:
            edited.append(key)

    if "tts_accent" in patch and patch["tts_accent"] != card.get("tts_accent"):
        card["tts_accent"] = patch["tts_accent"]
        mark("tts_accent")
    if card.get("kind") == CARD_KIND_SINGLE and patch.get("question") is not None:
        card["question"] = merge_question(
            card.get("question"), patch["question"], card.get("page_no")
        )
        card["status"] = card["question"].get("status", STATUS_OK)
    if card.get("kind") == CARD_KIND_GROUP and patch.get("group") is not None:
        g_new = patch["group"]
        group = card.setdefault("group", {})
        for key in GROUP_FIELDS:
            if key not in g_new:
                continue
            value = _clean(key, g_new[key])
            if key == "stimulus":
                value = {
                    **(group.get("stimulus") or {}),
                    **{k: v for k, v in (value or {}).items() if k in STIMULUS_FIELDS},
                }
            if key in group and group.get(key) == value:
                continue
            group[key] = value
            mark(key)
        if "questions" in g_new:
            old_qs = group.get("questions") or []
            matches = _match_questions(old_qs, g_new["questions"])
            new_qs = [
                merge_question(m, nq, card.get("page_no"))
                for m, nq in zip(matches, g_new["questions"])
            ]
            if len(new_qs) != len(old_qs) or any(m is None for m in matches):
                mark("questions")
            group["questions"] = new_qs
        if all(q.get("status") != STATUS_FAILED for q in group.get("questions") or []):
            card["status"] = STATUS_OK
    card["teacher_edited"] = edited


def _after_edit(db: Session, imp: ExamImport) -> None:
    eis._refresh_duplicates(db, imp)
    eis._refresh_status_and_count(imp)


def _card_out(imp: ExamImport, card_id: str) -> Dict[str, Any]:
    for page in imp.pages:
        for c in page.cards or []:
            if c.get("card_id") == card_id:
                return copy.deepcopy(strip_merge_records([c])[0])
    raise ExamImportError(404, "EXAM_IMPORT_CARD_NOT_FOUND", "找不到這張題目卡")


def _locked_open(db: Session, import_id: int) -> ExamImport:
    imp = eis.lock_import(db, import_id)
    try:
        eis._require_open(imp)
    except ExamImportError:
        db.rollback()
        raise
    return imp


def patch_card(
    db: Session, import_id: int, card_id: str, patch: Mapping[str, Any]
) -> Dict[str, Any]:
    imp = _locked_open(db, import_id)
    try:
        page, index = _locate(imp, card_id)
        cards = copy.deepcopy(page.cards or [])
        if card_is_saved(cards[index]):
            raise _saved_error()
        expected = patch.get("rev")
        if expected is not None and expected != card_rev(cards[index]):
            raise ExamImportError(
                409,
                "EXAM_IMPORT_CARD_CHANGED",
                "這一題在你編輯時被更新了（例如併入下一頁或對上答案頁），請看過最新內容再改",
                card=copy.deepcopy(strip_merge_records([cards[index]])[0]),
            )
        apply_card_patch(cards[index], {k: v for k, v in patch.items() if k != "rev"})
        page.cards = cards
        eis._touch(page)
        _after_edit(db, imp)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _card_out(imp, card_id)


def delete_card(db: Session, import_id: int, card_id: str) -> None:
    imp = _locked_open(db, import_id)
    try:
        page, index = _locate(imp, card_id)
        cards = copy.deepcopy(page.cards or [])
        if card_is_saved(cards[index]):
            raise _saved_error()
        del cards[index]
        page.cards = cards
        eis._touch(page)
        _after_edit(db, imp)
        db.commit()
    except Exception:
        db.rollback()
        raise


def _new_card(kind: str, page_no: int, source_question_no: Optional[str]) -> Dict:
    card: Dict[str, Any] = {
        "card_id": f"m{page_no}-{uuid.uuid4().hex[:8]}",
        "kind": kind,
        "page_no": page_no,
        "pages": [page_no],
        "bbox": None,
        "continues_previous": False,
        "status": STATUS_OK,
        "duplicate_of": None,
        "tts_accent": None,
        "teacher_edited": [],
        "retry_count": 0,
        "manual": True,  # 手動補的卡（不能重試，沒有原卷位置）
    }
    question = empty_question(page_no, source_question_no)
    if kind == CARD_KIND_GROUP:
        card["group"] = {
            "group_type": "reading",
            "title": "",
            "stimulus": {
                "kind": "text",
                "paragraphs": [],
                "text": "",
                "box_2d": None,
                "page": None,
                "figures": [],
                "blanks_renumbered": False,
                "framed": False,
                "dialogue": [],
            },
            "glossary": [],
            "speakers": [],
            "questions": [question],
        }
    else:
        card["question"] = question
    return card


def add_card(
    db: Session,
    import_id: int,
    *,
    kind: str,
    page_no: int,
    after_card_id: Optional[str] = None,
    source_question_no: Optional[str] = None,
    content: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """「手動補這一題」（cold-read B5／A6）：先選題型，原卷題號選填。整頁讀不出來（失敗）的頁
    補上第一張卡時，那一頁改成已處理（不再提供整頁重送）。"""
    imp = _locked_open(db, import_id)
    try:
        page = eis._get_page(imp, page_no)
        if page.status not in (PAGE_STATUS_DONE, PAGE_STATUS_FAILED):
            raise ExamImportError(
                409, "EXAM_IMPORT_PAGE_NOT_DONE", f"第 {page_no} 頁還在處理，處理完再補題"
            )
        card = _new_card(kind, page_no, source_question_no)
        if content:
            apply_card_patch(card, content)
        assign_accents(list(imp.tts_accents or []), eis._all_cards(imp), [card])
        cards = (
            copy.deepcopy(page.cards or []) if page.status == PAGE_STATUS_DONE else []
        )
        pos = next(
            (i + 1 for i, c in enumerate(cards) if c.get("card_id") == after_card_id),
            len(cards),
        )
        cards.insert(pos, card)
        if page.status == PAGE_STATUS_FAILED:
            page.status = PAGE_STATUS_DONE
            page.error = None
            page.claim_id = None
            page.processed_at = eis._utcnow()
        page.cards = cards
        eis._touch(page)
        _after_edit(db, imp)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _card_out(imp, card["card_id"])


def update_settings(
    db: Session, teacher: Teacher, import_id: int, changes: Mapping[str, Any]
) -> ExamImport:
    """改整份設定（年段、教材、來源、公開）：套用到所有還沒存的題目卡（存入時才寫進題庫）。
    存進哪個題庫（``organization_id``／``school_id``）不能改。"""
    imp = _locked_open(db, import_id)
    try:
        merged = {**(imp.settings or {})}
        merged.update({k: v for k, v in changes.items() if k in SETTINGS_FIELDS})
        gmin, gmax = merged.get("grade_min"), merged.get("grade_max")
        if gmin is not None and gmax is not None and gmin > gmax:
            raise ExamImportError(422, "EXAM_IMPORT_SETTINGS_INVALID", "最低年級不可高於最高年級")
        if "source_id" in changes:
            validate_source(db, teacher, merged.get("source_id"))
        if "program_links" in changes:
            validate_program_links(
                db, teacher, merged.get("program_links") or [], merged
            )
        imp.settings = merged
        flag_modified(imp, "settings")
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(imp)
    return imp


__all__ = [
    "add_card",
    "apply_card_patch",
    "delete_card",
    "merge_question",
    "patch_card",
    "update_settings",
]
