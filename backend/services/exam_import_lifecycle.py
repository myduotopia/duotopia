"""
上傳題本匯入的建立、查詢、列表、放棄（Issue #1112，C4-0 自 ``exam_import_service.py`` 拆出）。

- **每天 1 本**：一般老師以台灣時間自然日計，算當天建立、沒有放棄的匯入；``Teacher.is_admin`` 不限
  （與 ``magic_paste_quota.is_unlimited`` 同一個判斷）。不佔 magic paste 每月額度、不扣點。
- **重複匯入**：同一位老師、同一個檔案雜湊、沒有放棄的匯入 → 擋下並回那次匯入的 id。
  超過 30 天仍未完成的匯入視同過期（列表也不顯示），不擋。
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, List, Mapping, Optional

from sqlalchemy.orm import Session

from models import ExamImport, ExamImportPage, Teacher
from models.exam_import import (
    EXAM_IMPORT_STATUS_ABANDONED,
    EXAM_IMPORT_STATUS_PROCESSING,
    PAGE_STATUS_PENDING,
)
from services import exam_import_storage
from services.exam_import_common import (
    DAILY_LIMIT,
    UNFINISHED_RETENTION_DAYS,
    UNFINISHED_STATUSES,
    ExamImportError,
    _as_utc,
    _utcnow,
    lock_import,
    taipei_day_bounds,
)
from services.magic_paste_quota import is_unlimited


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
