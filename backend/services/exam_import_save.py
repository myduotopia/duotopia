"""
上傳題本：存入題庫（Issue #1112 C4a）。全部儲存、略過核對、自動存入都走 ``save_cards``。

**不走** ``POST /questions`` 的 ``find_exact_duplicate``（那會比到別人的公開題、撞 409）：匯入只比
老師自己的題（``exam_import_dedup``）。驗證則和老師自己出題完全一樣：卡片經
``exam_import_convert.card_to_payload``（轉換唯一來源）→ ``QuestionCreate``／
``QuestionGroupCreate.model_validate``；寫入沿用 ``question_bank_service`` 的 helper（選項、考點、
教材、來源）與題組端點的對話文稿 helper。

規則（docs/design/question-bank-exam-import.md §五「存入」、計畫檔 C4 定案）
- 只存 ``card_ids`` 指定的卡（畫面一律送全部）；已存過的卡略過。
- **不存、留在草稿並回可讀原因**（``REASONS``）：處理失敗、缺答案、與我的題庫重複（完全相同／
  題目文字相同）、這份題本裡重複、克漏字空格對不上、其他驗證錯誤。
- **存前重算重複**（cold-read B10）：每張卡存之前即時查一次題庫，同一批前面剛存的也算
  （同一個交易裡已 flush）。單題「題目文字相同」是資料表唯一索引
  ``uq_questions_teacher_normalized_stem`` 會擋的情況，事先查出來當成重複；萬一仍撞到
  IntegrityError（並發），只退回這一張（SAVEPOINT），原因同「題目文字相同」（見下方 IntegrityError）。
- 成功：單題在 ``question.saved_question_id``、題組在卡上 ``saved_group_id``＋每一小題
  ``saved_question_id`` 記下題庫 id（答案頁晚到時據此更新，見 ``exam_import_refresh``）；
  原卷題號寫進 ``question_source_links.source_question_no``；考點來源 ``ai``（老師改過考點＝``manual``）。
  卡片留在草稿（API 照樣輸出、帶 saved id），畫面自己不顯示已存的卡。
- 存進機構／學校題庫：題目帶 ``organization_id``／``school_id``；權限由呼叫端
  （router ``_require_bank_membership``；自動存入用 ``bank_allowed``）檢查。
- 口音（cold-read B6）：``question_groups.tts_accent`` 欄位目前不存在 → 不寫（語音段 migration）；
  對話文稿每一句的 ``tts_voice`` 依卡片口音＋角色性別帶平台 Azure 聲音（``VOICE_MAP``）。
- **完成**（C4 定案 A2）：匯入是 ready、每頁都處理完（沒有失敗頁）、而且還沒存的卡**全部**是
  「我的題庫已有」（含題目文字相同）→ 狀態 ``saved``，回傳略過幾張／幾題。缺答案、失敗、
  這份題本內重複的卡還在 → 維持 ready（提示列「待核對」）。
- **略過核對**（``settings.auto_save``）：已處理好的頁立即存；之後每頁寫入結果（擷取、仍要送出、
  重試）後由 ``run_auto_save`` 再存一次；可能還有下一頁內容的題組（頁上最後一張、後面還有頁在
  處理中）先不存。
- **還沒定的跨頁題組**：手動存入（全部儲存）也不存，回 ``pending_continuation``（C4a 審查 5）；
  自動存入則默默等下一頁。
- **補裁圖在鎖外**（C4a 審查 3）：拿匯入鎖之前先讀草稿、從存好的頁圖裁好上傳
  （``exam_import_images.precrop``），鎖內只查表寫回卡片。
- **IntegrityError**：只有唯一索引 ``uq_questions_teacher_normalized_stem`` 擋下的單題回
  ``same_stem``，其他約束一律 ``invalid``（C4a 審查 6）。
- **題目文字相同**（``same_stem``）照 A2 算進「題庫已有而略過」：回傳的
  ``skipped_duplicate_cards``／``skipped_duplicate_questions`` 含這些卡，卡上
  ``duplicate_of.reason`` 保留 ``"same_stem"``，畫面據此顯示「這題重複」。
"""

from __future__ import annotations

import copy
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Set

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from models import ExamImport, ExamPoint, Question, QuestionGroup, Teacher
from models.exam_import import (
    EXAM_IMPORT_STATUS_READY,
    EXAM_IMPORT_STATUS_SAVED,
    PAGE_STATUS_DONE,
    PAGE_STATUS_PENDING,
    PAGE_STATUS_PROCESSING,
)
from models.question_bank import (
    EXAM_POINT_LINK_SOURCE_AI,
    EXAM_POINT_LINK_SOURCE_MANUAL,
)
from services import exam_import_service as eis
from services import question_bank_service as qbs
from services.exam_import_common import UNFINISHED_STATUSES, ExamImportError
from services.exam_import_convert import apply_settings, card_to_payload
from services.exam_import_dedup import find_bank_duplicates, mark_duplicates
from services.exam_import_images import (
    CropTable,
    apply_crops,
    card_needs_crops,
    precrop,
)
from services.exam_import_settings import (
    bank_allowed,
    bank_uuids,
    require_complete,
    validate_program_links,
    validate_source,
)
from services.exam_paper_cards import (
    CARD_KIND_GROUP,
    STATUS_FAILED,
    card_is_saved,
    iter_card_questions,
)
from utils.ttsVoiceResolver import VOICE_MAP

logger = logging.getLogger(__name__)

# 不存的原因（``reason`` 代碼 → 畫面文字；前端可依代碼換成 i18n）
REASONS = {
    "failed": "這一題處理失敗，請重試或手動補這一題",
    "missing_answer": "還沒有正確答案，請指定答案",
    "duplicate": "你的題庫（個人或機構）已有這題",
    "same_stem": "題目文字與我的題庫某題相同，請修改題目文字",
    "duplicate_in_import": "這份題本裡已有相同的題目，請刪除其中一題",
    "cloze_blanks": "克漏字空格與小題對不上",
    "invalid": "內容不完整",
    "pending_continuation": "這個題組可能還有下一頁的內容，等下一頁處理完再存",
}
# 資料表唯一索引（同一位老師、單題、normalized_stem 相同）；撞到這個才算「題目文字相同」
STEM_UNIQUE_INDEX = "uq_questions_teacher_normalized_stem"
BANK_DUPLICATE_REASONS = ("duplicate", "same_stem")


def _fail(card_id: str, reason: str, detail: Optional[str] = None) -> Dict[str, Any]:
    message = REASONS[reason] + (f"：{detail}" if detail else "")
    return {"card_id": card_id, "reason": reason, "message": message}


# --------------------------------------------------------------------------- #
# 判斷
# --------------------------------------------------------------------------- #
def blocking_reason(card: Dict[str, Any]) -> Optional[str]:
    """不用查 DB 就知道不能存的原因：處理失敗、缺答案。"""
    questions = list(iter_card_questions(card))
    if (
        card.get("kind") != CARD_KIND_GROUP and card.get("status") == STATUS_FAILED
    ) or any(q.get("status") == STATUS_FAILED for q in questions):
        return "failed"
    if not questions:
        return "failed"
    for q in questions:
        n = len(q.get("options") or [])
        if not [i for i in q.get("correct_indexes") or [] if 0 <= i < n]:
            return "missing_answer"
    return None


def dup_reason(dup: Optional[Dict[str, Any]]) -> Optional[str]:
    if not dup:
        return None
    if dup.get("type") == "import":
        return "duplicate_in_import"
    return "same_stem" if dup.get("reason") == "same_stem" else "duplicate"


def unsettled_card_ids(imp: ExamImport, cards_by_page: Dict[int, List[Dict]]) -> Set:
    """可能還會併入下一頁內容的題組卡：頁上最後一張是題組，往後找到下一個有卡片的頁之前，
    遇到還在 pending／processing 的頁。"""
    status = {p.page_no: p.status for p in imp.pages}
    out: Set[str] = set()
    for no, cards in cards_by_page.items():
        if not cards or cards[-1].get("kind") != CARD_KIND_GROUP:
            continue
        for later in range(no + 1, (imp.page_count or 0) + 1):
            st = status.get(later)
            if st in (PAGE_STATUS_PENDING, PAGE_STATUS_PROCESSING):
                out.add(cards[-1].get("card_id"))
                break
            if st != PAGE_STATUS_DONE or cards_by_page.get(later):
                break
    return out


# --------------------------------------------------------------------------- #
# 寫入題庫
# --------------------------------------------------------------------------- #
def _code_to_id(db: Session, cards: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    codes = {
        c
        for card in cards
        for q in iter_card_questions(card)
        for c in q.get("exam_point_codes") or []
    }
    if not codes:
        return {}
    rows = db.query(ExamPoint.code, ExamPoint.id).filter(ExamPoint.code.in_(codes))
    return {code: i for code, i in rows.all()}


def _point_source(q: Dict[str, Any]) -> str:
    edited = set(q.get("teacher_edited") or [])
    if edited & {"exam_point_codes", "exam_point_ids"}:
        return EXAM_POINT_LINK_SOURCE_MANUAL
    return EXAM_POINT_LINK_SOURCE_AI


def _new_question(teacher: Teacher, qin, org, school, **extra) -> Question:
    q = Question(
        stem=qin.stem,
        normalized_stem=qbs.normalize_stem(qin.stem),
        explanation=qin.explanation,
        image_url=qin.image_url,
        stem_audio_url=qin.stem_audio_url,
        grade_min=qin.grade_min,
        grade_max=qin.grade_max,
        allow_multiple_answers=qin.allow_multiple_answers,
        show_stem_text=qin.show_stem_text,
        teacher_id=teacher.id,
        organization_id=org,
        school_id=school,
        **extra,
    )
    return q


def _fill_links(
    db: Session,
    teacher: Teacher,
    question: Question,
    qin,
    card_q: Dict[str, Any],
) -> None:
    qbs.replace_options(question, [o.model_dump() for o in qin.options])
    qbs.replace_exam_points(
        db, question, qin.exam_point_ids, source=_point_source(card_q)
    )
    qbs.replace_program_links(question, [pl.model_dump() for pl in qin.program_links])
    qbs.replace_sources(db, question, teacher, qin.source_ids)
    for link in question.source_links:
        link.source_question_no = card_q.get("source_question_no")


def _create_single(db, teacher, card, payload, org, school) -> Dict[str, Any]:
    from routers.question_bank_schemas import QuestionCreate

    p = QuestionCreate.model_validate(payload)
    question = _new_question(
        teacher,
        p,
        org,
        school,
        question_type=p.question_type,
        visibility=p.visibility,
    )
    qbs.enforce_platform_rules(question, teacher)
    _fill_links(db, teacher, question, p, card["question"])
    db.add(question)
    db.flush()
    card["question"]["saved_question_id"] = question.id
    return {"card_id": card["card_id"], "question_ids": [question.id]}


def _speaker_voice(card: Dict[str, Any], speaker: str) -> Optional[str]:
    accent = card.get("tts_accent")
    voices = VOICE_MAP.get(accent or "")
    if not voices:
        return None
    for s in (card.get("group") or {}).get("speakers") or []:
        if str(s.get("speaker") or "").lower() == speaker.lower():
            gender = "Male" if s.get("gender") == "male" else "Female"
            return voices.get(gender)
    return None


def _create_group(db, teacher, card, payload, org, school) -> Dict[str, Any]:
    from routers.question_bank_groups import (
        _check_question_grades,
        _replace_segments,
        _sync_dialogue,
    )
    from routers.question_bank_schemas import (
        QuestionGroupCreate,
        _effective_passage_text,
    )

    p = QuestionGroupCreate.model_validate(payload)
    group = QuestionGroup(
        stimulus_type=p.stimulus_type,
        title=p.title,
        passage_text=_effective_passage_text(p.passage_text, p.layout),
        image_url=p.image_url,
        layout=p.layout,
        glossary=p.glossary,
        grade_min=p.grade_min,
        grade_max=p.grade_max,
        visibility=p.visibility,
        teacher_id=teacher.id,
        organization_id=org,
        school_id=school,
    )
    if hasattr(QuestionGroup, "tts_accent"):  # 語音段 migration 之後才有（B6）
        group.tts_accent = card.get("tts_accent")
    qbs.enforce_platform_rules(group, teacher)
    if p.segments:
        _replace_segments(db, group, p.segments)
        _sync_dialogue(group)
        for seg in group.segments:
            seg.tts_voice = _speaker_voice(card, seg.speaker_label or "")
    card_questions = card["group"]["questions"]
    for i, qin in enumerate(p.questions):
        question = _new_question(
            teacher,
            qin,
            org,
            school,
            question_type=p.question_type,
            visibility=group.visibility,
            is_platform=group.is_platform,
            group_order=qin.group_order if qin.group_order is not None else i,
            blank_index=qin.blank_index,
        )
        question.grade_min = qin.grade_min if qin.grade_min is not None else p.grade_min
        question.grade_max = qin.grade_max if qin.grade_max is not None else p.grade_max
        _check_question_grades([question])
        _fill_links(db, teacher, question, qin, card_questions[i])
        group.questions.append(question)
    db.add(group)
    db.flush()
    card["saved_group_id"] = group.id
    ids = [q.id for q in group.questions]
    for cq, qid in zip(card_questions, ids):
        cq["saved_question_id"] = qid
    return {"card_id": card["card_id"], "group_id": group.id, "question_ids": ids}


def is_stem_unique_violation(e: IntegrityError) -> bool:
    """這個 IntegrityError 是不是唯一索引 ``uq_questions_teacher_normalized_stem`` 擋下的。

    PostgreSQL（psycopg2）：看 ``diag.constraint_name``，沒有再看錯誤訊息裡的名稱。SQLite（測試）
    的訊息不帶索引名稱，只列欄位（``UNIQUE constraint failed: questions.teacher_id,
    questions.normalized_stem``），以欄位判斷。其他約束（外鍵、別的唯一索引）一律不是。
    """
    orig = getattr(e, "orig", None)
    name = getattr(getattr(orig, "diag", None), "constraint_name", None)
    if name:
        return name == STEM_UNIQUE_INDEX
    msg = str(orig or e)
    if STEM_UNIQUE_INDEX in msg:
        return True
    return "UNIQUE constraint failed" in msg and "questions.normalized_stem" in msg


def _validation_message(e: ValidationError) -> str:
    err = (e.errors() or [{}])[0]
    msg = str(err.get("msg") or "").replace("Value error, ", "")
    loc = ".".join(str(x) for x in err.get("loc") or ())
    return f"{loc} {msg}".strip() if err.get("type") != "value_error" else msg


def _save_one(
    db: Session,
    teacher: Teacher,
    card: Dict[str, Any],
    settings: Dict[str, Any],
    code_to_id: Dict[str, int],
) -> Dict[str, Any]:
    """存一張卡（呼叫端已排除失敗／缺答案／重複）。成功回 saved 項目；失敗回 ``_fail``。"""
    from routers.question_bank_schemas import check_group_blanks

    kind, payload = card_to_payload(card, code_to_id)
    payload = apply_settings(kind, payload, settings)
    if kind == "group":
        try:
            check_group_blanks(
                payload["question_type"],
                payload["layout"],
                [q.get("blank_index") for q in payload["questions"]],
            )
        except ValueError as e:
            return _fail(card["card_id"], "cloze_blanks", str(e).split(": ", 1)[-1])
    org, school = bank_uuids(settings)
    create = _create_group if kind == "group" else _create_single
    work = copy.deepcopy(card)
    try:
        with db.begin_nested():
            done = create(db, teacher, work, payload, org, school)
    except ValidationError as e:
        return _fail(card["card_id"], "invalid", _validation_message(e))
    except HTTPException as e:
        return _fail(card["card_id"], "invalid", str(e.detail))
    except IntegrityError as e:
        stem_clash = kind == "single" and is_stem_unique_violation(e)
        logger.info(
            "[exam-import] integrity error card=%s stem_clash=%s",
            card["card_id"],
            stem_clash,
        )
        return _fail(card["card_id"], "same_stem" if stem_clash else "invalid")
    card.clear()
    card.update(work)
    card["saved_at"] = datetime.now(timezone.utc).isoformat()
    card["duplicate_of"] = None
    return done


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
def _check_settings(db: Session, teacher: Teacher, settings: Dict[str, Any]) -> None:
    require_complete(settings)
    validate_source(db, teacher, settings.get("source_id"))
    validate_program_links(db, teacher, settings.get("program_links") or [], settings)


def _bank_duplicate_cards(cards: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        c
        for c in cards
        if not card_is_saved(c) and (c.get("duplicate_of") or {}).get("type") == "bank"
    ]


def _maybe_complete(imp: ExamImport, cards: List[Dict[str, Any]]) -> bool:
    """C4 定案 A2：還沒存的卡全部是「我的題庫已有」→ saved。"""
    if imp.status != EXAM_IMPORT_STATUS_READY:
        return False
    if any(p.status != PAGE_STATUS_DONE for p in imp.pages):
        return False
    unsaved = [c for c in cards if not card_is_saved(c)]
    if len(_bank_duplicate_cards(unsaved)) != len(unsaved):
        return False
    imp.status = EXAM_IMPORT_STATUS_SAVED
    return True


def _precrop_outside_lock(
    db: Session, import_id: int, wanted: Optional[Set[str]]
) -> CropTable:
    """匯入鎖之前：讀一次草稿（不上鎖），把要存的卡還沒裁的圖先從頁圖裁好、上傳（C4a 審查 3：
    鎖內不碰 GCS）。只裁看得出可以存的卡（沒失敗、有答案）；重複與否鎖內才知道，多裁幾張無妨。
    讀完先結束交易（沒有待寫入的資料），裁圖期間不佔著連線上的交易。"""
    imp = db.get(ExamImport, import_id)
    if imp is None:
        return {}
    cards = [
        copy.deepcopy(c)
        for c in eis._all_cards(imp)
        if not card_is_saved(c)
        and (wanted is None or c.get("card_id") in wanted)
        and blocking_reason(c) is None
        and card_needs_crops(c)
    ]
    image_urls = {p.page_no: p.image_url for p in imp.pages}
    db.commit()
    if not cards:
        return {}
    return precrop(import_id, cards, image_urls)


def save_cards(
    db: Session,
    teacher: Teacher,
    import_id: int,
    card_ids: Optional[List[str]] = None,
    *,
    auto: bool = False,
) -> Dict[str, Any]:
    """鎖內批次存入。回傳 ``{"saved": [...], "failed": [...], "skipped_duplicate_cards",
    "skipped_duplicate_questions", "completed", "status"}``。設定不完整／教材無效 → 422（不存任何卡）。"""
    wanted = set(card_ids) if card_ids is not None else None
    crops = _precrop_outside_lock(db, import_id, wanted)
    imp = eis.lock_import(db, import_id)
    try:
        if imp.status not in UNFINISHED_STATUSES:
            raise ExamImportError(409, "EXAM_IMPORT_CLOSED", "這次匯入已結束，不能再存入")
        settings = dict(imp.settings or {})
        _check_settings(db, teacher, settings)
    except Exception:
        db.rollback()
        raise
    pages = eis._done_pages(imp)
    by_page = {p.page_no: copy.deepcopy(p.cards or []) for p in pages}
    ordered = [c for p in pages for c in by_page[p.page_no]]
    mark_duplicates(db, imp.teacher_id, ordered)  # 存前重算（B10）
    code_to_id = _code_to_id(db, ordered)
    # 可能還會併入下一頁內容的題組：自動存入默默等下一頁；手動存入回報原因（C4a 審查 5）
    unsettled = unsettled_card_ids(imp, by_page)
    saved: List[Dict[str, Any]] = []
    failed: List[Dict[str, Any]] = []

    for card in ordered:
        cid = card.get("card_id")
        if card_is_saved(card) or (wanted is not None and cid not in wanted):
            continue
        if cid in unsettled:
            if not auto:
                failed.append(_fail(cid, "pending_continuation"))
            continue
        reason = blocking_reason(card)
        if reason is None:
            fresh = find_bank_duplicates(db, imp.teacher_id, [card]).get(cid)
            if fresh:
                card["duplicate_of"] = fresh
            reason = dup_reason(card.get("duplicate_of"))
        if reason:
            failed.append(_fail(cid, reason))
            continue
        apply_crops(card, crops)
        result = _save_one(db, teacher, card, settings, code_to_id)
        (failed if "reason" in result else saved).append(result)

    for page in pages:
        page.cards = by_page[page.page_no]
        eis._touch(page)
    eis._refresh_duplicates(db, imp)
    eis._refresh_status_and_count(imp)
    cards_now = eis._all_cards(imp)
    completed = _maybe_complete(imp, cards_now)
    dup_cards = _bank_duplicate_cards(cards_now)
    out = {
        "saved": saved,
        "failed": failed,
        "skipped_duplicate_cards": len(dup_cards),
        "skipped_duplicate_questions": sum(
            1 for c in dup_cards for _ in iter_card_questions(c)
        ),
        "completed": completed,
        "status": imp.status,
    }
    db.commit()
    return out


def skip_review(db: Session, teacher: Teacher, import_id: int) -> Dict[str, Any]:
    """「略過核對，直接存入」：打開 ``settings.auto_save``，已處理好的頁立即存。"""
    imp = eis.lock_import(db, import_id)
    try:
        if imp.status not in UNFINISHED_STATUSES:
            raise ExamImportError(409, "EXAM_IMPORT_CLOSED", "這次匯入已結束，不能再存入")
        _check_settings(db, teacher, dict(imp.settings or {}))
        imp.settings = {**(imp.settings or {}), "auto_save": True}
        flag_modified(imp, "settings")
        db.commit()
    except Exception:
        db.rollback()
        raise
    return save_cards(db, teacher, import_id, auto=True)


def run_auto_save(db: Session, import_id: int) -> Optional[Dict[str, Any]]:
    """每頁寫入結果之後呼叫：開了略過核對就把能存的存掉。失敗只記 log，不影響那一頁的回應。"""
    try:
        imp = db.get(ExamImport, import_id)
        if (
            imp is None
            or not (imp.settings or {}).get("auto_save")
            or imp.status not in UNFINISHED_STATUSES
        ):
            return None
        teacher = db.get(Teacher, imp.teacher_id)
        if teacher is None or not bank_allowed(db, teacher, imp.settings or {}):
            return None
        return save_cards(db, teacher, import_id, auto=True)
    except Exception:
        logger.exception("[exam-import] auto save failed import=%s", import_id)
        db.rollback()
        return None
