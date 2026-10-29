"""
上傳題本：整份設定與題庫範圍（Issue #1112 C4）。

- **整份設定**（年段、教材 ``program_links``、來源 ``source_id``、公開 ``visibility``）存在
  ``exam_imports.settings``，**存入時才逐題寫進題庫**，所以「改一次套用到所有還沒存的題目卡」＝
  改 settings 即可；已存的題不動（要個別調整到題庫編輯）。``organization_id``／``school_id``
  （存進哪個題庫）建立後不能改。
- **存入前必填**：年段上下限、來源、公開（``missing_required``）。
- **教材擁有權**（cold-read：題目建立 API 本身也沒驗）：個人題庫只能掛老師自己的教材
  （``programs.teacher_id`` 是本人、沒有機構／學校）；機構題庫只能掛該機構的教材；學校題庫只能掛
  該學校的教材。單元必須屬於該教材、未刪除。
- **來源**：必須是老師看得到的來源（平台公用＋所屬機構＋自己建的）。
- **題庫範圍**（C4 定案 A3、列表）：我的題庫＝``organization_id``、``school_id`` 都沒有；機構題庫＝
  該機構；只列自己建立的匯入。每天 1 本、同檔重複則以老師計、不分題庫。
"""

from __future__ import annotations

import uuid
from typing import Any, List, Mapping, Optional

from sqlalchemy.orm import Session

from models import Lesson, Program, Teacher
from services import question_bank_service as qbs
from services.exam_import_common import ExamImportError
from utils.permissions import has_read_org_materials_permission

REQUIRED_SETTINGS = ("grade_min", "grade_max", "source_id", "visibility")


def _uuid(value: Any) -> Optional[uuid.UUID]:
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except ValueError:
        return None


def bank_of(settings: Mapping[str, Any]) -> tuple:
    """(organization_id, school_id)，正規化成小寫字串或 None。"""
    org = _uuid(settings.get("organization_id"))
    school = _uuid(settings.get("school_id"))
    return (str(org) if org else None, str(school) if school else None)


def bank_uuids(settings: Mapping[str, Any]) -> tuple:
    """(organization_id, school_id) 的 UUID 或 None（寫進題目／題組用）。"""
    return _uuid(settings.get("organization_id")), _uuid(settings.get("school_id"))


def in_bank(
    settings: Mapping[str, Any],
    organization_id: Optional[str],
    school_id: Optional[str],
) -> bool:
    org, school = bank_of(settings)
    want_org = str(_uuid(organization_id)) if _uuid(organization_id) else None
    want_school = str(_uuid(school_id)) if _uuid(school_id) else None
    return org == want_org and school == want_school


def bank_allowed(db: Session, teacher: Teacher, settings: Mapping[str, Any]) -> bool:
    """老師仍是這個題庫的成員（不丟例外；自動存入時用）。"""
    org = _uuid(settings.get("organization_id"))
    school = _uuid(settings.get("school_id"))
    if org is not None and not has_read_org_materials_permission(teacher.id, org, db):
        return False
    if school is not None and school not in qbs.teacher_school_ids(db, teacher.id):
        return False
    return True


def missing_required(settings: Mapping[str, Any]) -> List[str]:
    return [k for k in REQUIRED_SETTINGS if settings.get(k) in (None, "")]


def require_complete(settings: Mapping[str, Any]) -> None:
    missing = missing_required(settings)
    if missing:
        raise ExamImportError(
            422,
            "EXAM_IMPORT_SETTINGS_INCOMPLETE",
            "請先填好年段、考題來源與公開設定",
            missing=missing,
        )


def validate_source(db: Session, teacher: Teacher, source_id: Optional[int]) -> None:
    if source_id is None:
        return
    visible = qbs.visible_sources_query(db, teacher).filter_by(id=source_id).first()
    if visible is None:
        raise ExamImportError(400, "EXAM_IMPORT_SOURCE_INVALID", "找不到這個考題來源")


def validate_program_links(
    db: Session,
    teacher: Teacher,
    links: List[Mapping[str, Any]],
    settings: Mapping[str, Any],
) -> None:
    """教材與單元必須屬於這個題庫（見模組說明）；不合格 422 ``EXAM_IMPORT_PROGRAM_LINK_INVALID``。"""
    if not links:
        return
    org, school = bank_of(settings)
    program_ids = {int(pl["program_id"]) for pl in links}
    programs = {
        p.id: p
        for p in db.query(Program).filter(Program.id.in_(program_ids)).all()
        if p.is_active is not False
    }

    def owned(p: Optional[Program]) -> bool:
        if p is None:
            return False
        p_org = str(_uuid(p.organization_id)) if _uuid(p.organization_id) else None
        p_school = str(_uuid(p.school_id)) if _uuid(p.school_id) else None
        if org:
            return p_org == org
        if school:
            return p_school == school
        return p.teacher_id == teacher.id and p_org is None and p_school is None

    bad = sorted(i for i in program_ids if not owned(programs.get(i)))
    lesson_ids = {int(pl["lesson_id"]) for pl in links if pl.get("lesson_id")}
    if lesson_ids:
        lessons = {
            le.id: le
            for le in db.query(Lesson).filter(Lesson.id.in_(lesson_ids)).all()
            if le.is_active is not False
        }
        for pl in links:
            lid = pl.get("lesson_id")
            if lid and (
                lid not in lessons or lessons[lid].program_id != int(pl["program_id"])
            ):
                bad.append(int(pl["program_id"]))
    if bad:
        raise ExamImportError(
            422,
            "EXAM_IMPORT_PROGRAM_LINK_INVALID",
            "選的教材或單元不在這個題庫可用的範圍，請重新選擇",
            program_ids=sorted(set(bad)),
        )
