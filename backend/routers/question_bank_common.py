"""
題庫 API 的序列化、權限與查詢輔助（自 routers/question_bank.py 拆出，#1082）。

- Serializers：_question_out／_group_out（含對話文稿 segments，#1083）／_group_row_out／_source_out／_exam_point_out／
  _program_link_out（教材關聯帶教材包／單元名稱）
- 權限：_can_edit（建立者本人；機構／學校題庫別人的題只有擁有人／教材管理者）
- 查詢：_load_options／_load_group_rows（selectinload，避免 N+1）、_scope_filter、
  _grade_filter、_merged_page_keys（單題／題組 SQL 層合併分頁）
"""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import and_, literal, or_, union_all
from sqlalchemy.orm import Session, selectinload

from models import (
    ExamPoint,
    Question,
    QuestionExamPoint,
    QuestionGroup,
    QuestionProgramLink,
    QuestionSource,
    QuestionSourceLink,
    Teacher,
)
from services import question_bank_service as qbs
from utils.permissions import (
    has_manage_materials_permission,
    has_school_materials_permission,
)


# ============ Serializers ============


def _exam_point_out(ep: ExamPoint) -> dict:
    return {
        "id": ep.id,
        "code": ep.code,
        "parent_id": ep.parent_id,
        "names": ep.names or {},
        "status": ep.status,
        "order_index": ep.order_index,
        "aliases": [a.alias for a in (ep.aliases or [])],
    }


def _program_link_out(pl: QuestionProgramLink) -> dict:
    """教材關聯：帶教材包／單元名稱供列表「教材」欄顯示（lesson 可為 None）。"""
    return {
        "program_id": pl.program_id,
        "lesson_id": pl.lesson_id,
        "program_name": pl.program.name if pl.program is not None else None,
        "lesson_name": pl.lesson.name if pl.lesson is not None else None,
    }


def _source_out(s: QuestionSource) -> dict:
    return {
        "id": s.id,
        "source_type": s.source_type,
        "name": s.name,
        "year": s.year,
        "organization_id": str(s.organization_id) if s.organization_id else None,
        "teacher_id": s.teacher_id,
    }


def _question_out(
    db: Session, q: Question, teacher: Teacher, perm_cache: dict | None = None
) -> dict:
    return {
        "id": q.id,
        "question_type": q.question_type,
        "stem": q.stem,
        "explanation": q.explanation,
        "image_url": q.image_url,
        "stem_audio_url": q.stem_audio_url,
        "grade_min": q.grade_min,
        "grade_max": q.grade_max,
        "allow_multiple_answers": q.allow_multiple_answers,
        "show_stem_text": q.show_stem_text,
        "visibility": q.visibility,
        "is_platform": q.is_platform,
        "teacher_id": q.teacher_id,
        "organization_id": str(q.organization_id) if q.organization_id else None,
        "school_id": str(q.school_id) if q.school_id else None,
        "group_id": q.group_id,
        "group_order": q.group_order,
        "blank_index": q.blank_index,
        "is_owner": q.teacher_id == teacher.id,
        "can_edit": _can_edit(db, teacher, q, perm_cache),
        "options": [
            {
                "id": o.id,
                "order_index": o.order_index,
                "text": o.text,
                "is_correct": o.is_correct,
                "audio_url": o.audio_url,
                "image_url": o.image_url,
            }
            for o in q.options
        ],
        "exam_points": [
            {
                "id": link.exam_point.id,
                "code": link.exam_point.code,
                "names": link.exam_point.names or {},
                "source": link.source,
            }
            for link in q.exam_point_links
            if link.exam_point is not None
        ],
        "program_links": [_program_link_out(pl) for pl in q.program_links],
        "sources": [
            _source_out(link.source)
            for link in q.source_links
            if link.source is not None
        ],
        "created_at": q.created_at.isoformat() if q.created_at else None,
        "updated_at": q.updated_at.isoformat() if q.updated_at else None,
    }


def _group_out(
    db: Session, g: QuestionGroup, teacher: Teacher, perm_cache: dict | None = None
) -> dict:
    questions = [q for q in g.questions if q.is_active]
    return {
        "id": g.id,
        "question_type": questions[0].question_type if questions else "reading",
        "stimulus_type": g.stimulus_type,
        "title": g.title,
        "passage_text": g.passage_text,
        "image_url": g.image_url,
        "audio_url": g.audio_url,
        "layout": g.layout,
        "glossary": g.glossary,
        "grade_min": g.grade_min,
        "grade_max": g.grade_max,
        "visibility": g.visibility,
        "is_platform": g.is_platform,
        "teacher_id": g.teacher_id,
        "organization_id": str(g.organization_id) if g.organization_id else None,
        "school_id": str(g.school_id) if g.school_id else None,
        "is_owner": g.teacher_id == teacher.id,
        "can_edit": _can_edit(db, teacher, g, perm_cache),
        "questions": [_question_out(db, q, teacher, perm_cache) for q in questions],
        # 對話文稿（#1083）：前端文字版分頁以唯讀對話樣式顯示
        "segments": [
            {
                "order_index": seg.order_index,
                "speaker_label": seg.speaker_label,
                "transcript": seg.transcript,
            }
            for seg in g.segments
        ],
        "created_at": g.created_at.isoformat() if g.created_at else None,
        "updated_at": g.updated_at.isoformat() if g.updated_at else None,
    }


def _group_row_out(
    db: Session, g: QuestionGroup, teacher: Teacher, perm_cache: dict | None = None
) -> dict:
    """列表的題組列：不帶小題內容，帶小題數與來源／考點聯集。

    教材聯集依 ``(program_id, 有無 lesson, lesson_id)`` 排序，
    避免輸出順序受小題順序／關聯建立順序影響。
    """
    questions = [q for q in g.questions if q.is_active]
    sources: dict = {}
    exam_points: dict = {}
    program_links: dict = {}
    for q in questions:
        for link in q.source_links:
            if link.source is not None:
                sources.setdefault(link.source.id, link.source)
        for link in q.exam_point_links:
            if link.exam_point is not None:
                exam_points.setdefault(link.exam_point.id, link.exam_point)
        for pl in q.program_links:
            program_links.setdefault((pl.program_id, pl.lesson_id), pl)
    preview = (g.passage_text or "").strip()[:200]
    return {
        "kind": "group",
        "id": g.id,
        "question_type": questions[0].question_type if questions else "reading",
        "stimulus_type": g.stimulus_type,
        "title": g.title,
        "preview": preview,
        "question_count": len(questions),
        "grade_min": g.grade_min,
        "grade_max": g.grade_max,
        "visibility": g.visibility,
        "is_platform": g.is_platform,
        "teacher_id": g.teacher_id,
        "organization_id": str(g.organization_id) if g.organization_id else None,
        "school_id": str(g.school_id) if g.school_id else None,
        "is_owner": g.teacher_id == teacher.id,
        "can_edit": _can_edit(db, teacher, g, perm_cache),
        "sources": [_source_out(x) for x in sources.values()],
        "exam_points": [_exam_point_out(x) for x in exam_points.values()],
        "program_links": [
            _program_link_out(x)
            for x in sorted(
                program_links.values(),
                key=lambda pl: (
                    pl.program_id,
                    pl.lesson_id is None,
                    pl.lesson_id or 0,
                ),
            )
        ],
        "created_at": g.created_at.isoformat() if g.created_at else None,
        "updated_at": g.updated_at.isoformat() if g.updated_at else None,
    }


def _similar_out(q: Question, teacher: Teacher) -> dict:
    return {
        "id": q.id,
        "stem": q.stem,
        "visibility": q.visibility,
        "is_platform": q.is_platform,
        "is_owner": q.teacher_id == teacher.id,
    }


# ============ Permission helpers ============


def _parse_uuid(value: Optional[str], field: str) -> Optional[uuid.UUID]:
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid {field}"
        )


def _can_edit(
    db: Session,
    teacher: Teacher,
    q: Question | QuestionGroup,
    perm_cache: dict | None = None,
) -> bool:
    """建立者本人一律可編輯／刪除自己建的題／題組（含建到機構／學校題庫的）。

    機構／學校題庫裡別人建的題：只有機構擁有人或有教材管理權限的管理者可以
    （使用者定案：成員可刪改自建題，擁有人／管理者權限不變）。
    perm_cache 由列表傳入，同一 request 內依 (kind, id) 快取，避免每題重查 Casbin。
    """
    if q.teacher_id == teacher.id:
        return True
    if q.organization_id is not None:
        key = ("org", q.organization_id)
        checker = has_manage_materials_permission
        target = q.organization_id
    elif q.school_id is not None:
        key = ("school", q.school_id)
        checker = has_school_materials_permission
        target = q.school_id
    else:
        return False
    if perm_cache is not None and key in perm_cache:
        return perm_cache[key]
    ok = checker(teacher.id, target, db)
    if perm_cache is not None:
        perm_cache[key] = ok
    return ok


def _require_editable(db: Session, teacher: Teacher, question_id: int) -> Question:
    q = qbs.get_visible_question(db, teacher, question_id)
    if q is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="題目不存在")
    if not _can_edit(db, teacher, q):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="沒有修改此題目的權限")
    return q


def _load_options(query):
    return query.options(
        selectinload(Question.options),
        selectinload(Question.exam_point_links).selectinload(
            QuestionExamPoint.exam_point
        ),
        selectinload(Question.program_links).selectinload(QuestionProgramLink.program),
        selectinload(Question.program_links).selectinload(QuestionProgramLink.lesson),
        selectinload(Question.source_links).selectinload(QuestionSourceLink.source),
    )


def _load_group_rows(query):
    """列表題組列只需要小題的題型／來源／考點／教材關聯（不載選項）。"""
    return query.options(
        selectinload(QuestionGroup.questions)
        .selectinload(Question.source_links)
        .selectinload(QuestionSourceLink.source),
        selectinload(QuestionGroup.questions)
        .selectinload(Question.exam_point_links)
        .selectinload(QuestionExamPoint.exam_point),
        selectinload(QuestionGroup.questions)
        .selectinload(Question.program_links)
        .selectinload(QuestionProgramLink.program),
        selectinload(QuestionGroup.questions)
        .selectinload(Question.program_links)
        .selectinload(QuestionProgramLink.lesson),
    )


def _scope_filter(query, model, scope, only_own, organization_id, school_id, teacher):
    """列表 scope：questions / question_groups 欄位同名，共用。"""
    if scope == "mine":
        own = and_(
            model.teacher_id == teacher.id,
            model.organization_id.is_(None),
            model.school_id.is_(None),
        )
        return query.filter(own if only_own else or_(own, model.visibility == "public"))
    if scope == "organization":
        org_uuid = _parse_uuid(organization_id, "organization_id")
        if org_uuid is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="organization_id required for organization scope",
            )
        org_own = model.organization_id == org_uuid
        return query.filter(
            org_own if only_own else or_(org_own, model.visibility == "public")
        )
    if scope == "school":
        school_uuid = _parse_uuid(school_id, "school_id")
        if school_uuid is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="school_id required for school scope",
            )
        return query.filter(model.school_id == school_uuid)
    if scope == "platform":
        return query.filter(model.is_platform.is_(True))
    return query


def _grade_filter(query, model, grade_min, grade_max):
    """年級：範圍有交集（沒設年級的不會被排除）。"""
    if grade_min is not None:
        query = query.filter(
            or_(model.grade_max.is_(None), model.grade_max >= grade_min)
        )
    if grade_max is not None:
        query = query.filter(
            or_(model.grade_min.is_(None), model.grade_min <= grade_max)
        )
    return query


def _merged_page_keys(db: Session, singles, groups, page: int, page_size: int):
    """單題與題組在 SQL 層合併分頁：回傳本頁的 [(kind, id)]，順序即顯示順序。

    排序：updated_at desc（null 最後）、id desc、kind（同 updated_at／id 時單題在前）。
    """
    s_sel = singles.with_entities(
        literal("single").label("kind"),
        Question.id.label("id"),
        Question.updated_at.label("updated_at"),
    )
    g_sel = groups.with_entities(
        literal("group").label("kind"),
        QuestionGroup.id.label("id"),
        QuestionGroup.updated_at.label("updated_at"),
    )
    u = union_all(s_sel.statement, g_sel.statement).subquery("merged")
    rows = (
        db.query(u.c.kind, u.c.id)
        .order_by(u.c.updated_at.desc().nullslast(), u.c.id.desc(), u.c.kind.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [(kind, i) for kind, i in rows]
