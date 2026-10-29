"""
題庫 API：上傳題本「核對畫面」端點（Issue #1112 C4a）。

- PATCH  /api/question-bank/exam-imports/{id}/settings              改整份設定（年段、教材、來源、公開）
- POST   /api/question-bank/exam-imports/{id}/cards                 手動補一張題目卡（先選題型，原卷題號選填）
- PATCH  /api/question-bank/exam-imports/{id}/cards/{card_id}       改一張題目卡（卡片格式欄位）
- DELETE /api/question-bank/exam-imports/{id}/cards/{card_id}       刪除這一題
- POST   /api/question-bank/exam-imports/{id}/save                  全部儲存（存進題庫；回每張卡的結果）
- POST   /api/question-bank/exam-imports/{id}/skip-review           略過核對，直接存入（之後每頁做完自動存）

本檔的 ``router`` 不帶 prefix／tags，由 ``routers/question_bank_exam_imports.py`` ``include_router``
（外層再由 ``routers/question_bank.py`` 掛上 ``/api/question-bank``）。業務規則在
``services/exam_import_edit.py``（編輯）、``services/exam_import_save.py``（存入）、
``services/exam_import_settings.py``（設定與題庫範圍）。

錯誤（``detail.error``）：``EXAM_IMPORT_NOT_FOUND`` 404、``EXAM_IMPORT_CARD_NOT_FOUND`` 404、
``EXAM_IMPORT_CLOSED`` 409（已存完或放棄）、``EXAM_IMPORT_CARD_SAVED`` 409（已存進題庫的卡）、
``EXAM_IMPORT_PAGE_NOT_DONE`` 409（手動補題的頁還在處理）、``EXAM_IMPORT_SETTINGS_INCOMPLETE`` 422
（``missing``：缺哪些設定）、``EXAM_IMPORT_SETTINGS_INVALID`` 422、``EXAM_IMPORT_PROGRAM_LINK_INVALID``
422、``EXAM_IMPORT_SOURCE_INVALID`` 400。存進機構／學校題庫但已不是成員 → 403。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import ExamImport, Teacher
from routers.question_bank_common import _parse_uuid, _require_bank_membership
from routers.question_bank_exam_import_schemas import (
    CardCreate,
    CardPatch,
    ExamImportSettingsPatch,
    SaveRequest,
)
from routers.teachers import get_current_teacher
from services import exam_import_edit as edit
from services import exam_import_save as save
from services import exam_import_service as eis

router = APIRouter()


def _load(db: Session, teacher: Teacher, import_id: int) -> ExamImport:
    try:
        return eis.get_import(db, teacher, import_id)
    except eis.ExamImportError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)


def _run(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except eis.ExamImportError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)


def _require_bank(db: Session, teacher: Teacher, imp: ExamImport) -> None:
    s = imp.settings or {}
    _require_bank_membership(
        db,
        teacher,
        _parse_uuid(s.get("organization_id"), "organization_id"),
        _parse_uuid(s.get("school_id"), "school_id"),
    )


def _summary(db: Session, import_id: int) -> dict:
    db.expire_all()
    return eis.serialize_import(db.get(ExamImport, import_id))


@router.patch("/exam-imports/{import_id}/settings")
def patch_exam_import_settings(
    import_id: int,
    payload: ExamImportSettingsPatch,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """改整份設定，套用到所有還沒存的題目卡（存入時才寫進題庫）。回整份匯入摘要（含 ``settings``）。
    存進機構／學校題庫的匯入：老師須仍是該題庫成員（同 ``/save``），否則 403。"""
    imp = _load(db, teacher, import_id)
    _require_bank(db, teacher, imp)
    changes = payload.model_dump(exclude_unset=True)
    imp = _run(edit.update_settings, db, teacher, import_id, changes)
    return eis.serialize_import(imp)


@router.post("/exam-imports/{import_id}/cards", status_code=201)
def add_exam_import_card(
    import_id: int,
    payload: CardCreate,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """手動補這一題：在第 ``page_no`` 頁（``after_card_id`` 之後，沒給放最後）加一張空白或帶內容的卡。
    整頁失敗的頁補上第一張卡後改成已處理。回 ``{card, import}``。"""
    _load(db, teacher, import_id)
    content = payload.model_dump(
        exclude_unset=True,
        exclude={"kind", "page_no", "after_card_id", "source_question_no", "rev"},
    )
    card = _run(
        edit.add_card,
        db,
        import_id,
        kind=payload.kind,
        page_no=payload.page_no,
        after_card_id=payload.after_card_id,
        source_question_no=payload.source_question_no,
        content=content or None,
    )
    return {"card": card, "import": _summary(db, import_id)}


@router.patch("/exam-imports/{import_id}/cards/{card_id}")
def patch_exam_import_card(
    import_id: int,
    card_id: str,
    payload: CardPatch,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """改一張題目卡（老師編輯完收合時送）。後端比對新舊記 ``teacher_edited``；改了答案
    ``answer_source`` 變 ``teacher``；改完重算重複。回 ``{card, import}``。"""
    _load(db, teacher, import_id)
    patch = payload.model_dump(exclude_unset=True)
    card = _run(edit.patch_card, db, import_id, card_id, patch)
    return {"card": card, "import": _summary(db, import_id)}


@router.delete("/exam-imports/{import_id}/cards/{card_id}")
def delete_exam_import_card(
    import_id: int,
    card_id: str,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """刪除這一題（草稿裡的卡；已存進題庫的卡 409）。回整份匯入摘要。"""
    _load(db, teacher, import_id)
    _run(edit.delete_card, db, import_id, card_id)
    return {"import": _summary(db, import_id)}


@router.post("/exam-imports/{import_id}/save")
def save_exam_import(
    import_id: int,
    payload: SaveRequest,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """全部儲存：把指定的卡存進題庫。

    回傳 ``{saved: [{card_id, question_ids, group_id?}], failed: [{card_id, reason, message}],
    skipped_duplicate_cards, skipped_duplicate_questions, completed, status, import}``。
    ``reason``：``failed``／``missing_answer``／``duplicate``／``same_stem``／
    ``duplicate_in_import``／``cloze_blanks``／``invalid``。只剩題庫已有的卡時 ``completed``＝true、
    ``status``＝``saved``（畫面提示「N 題因題庫已有而略過」）。
    """
    imp = _load(db, teacher, import_id)
    _require_bank(db, teacher, imp)
    result = _run(save.save_cards, db, teacher, import_id, payload.card_ids)
    return {**result, "import": _summary(db, import_id)}


@router.post("/exam-imports/{import_id}/skip-review")
def skip_exam_import_review(
    import_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """略過核對，直接存入：打開自動存入，已處理好的頁立即存；之後每頁做完自動存。
    缺答案、處理失敗、重複的題不存（留在草稿）。回傳格式同 ``/save``。"""
    imp = _load(db, teacher, import_id)
    _require_bank(db, teacher, imp)
    result = _run(save.skip_review, db, teacher, import_id)
    return {**result, "import": _summary(db, import_id)}
