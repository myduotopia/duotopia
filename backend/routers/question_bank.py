"""
題庫 API（Issue #1061 / #1062）。

- GET    /api/question-bank/questions                 列表：單題 + 題組列（kind 分流；可見範圍 + filter + 分頁）
- POST   /api/question-bank/questions                 新增單題（只開放 multiple_choice）
- POST   /api/question-bank/question-groups           新增題組（整組一個交易；#1082，reading）
- GET    /api/question-bank/question-groups/{id}      題組（含小題）
- GET    /api/question-bank/questions/similar?stem=   相似題（自己的 + public）
- GET    /api/question-bank/questions/{id}            單題
- PATCH  /api/question-bank/questions/{id}            修改
- DELETE /api/question-bank/questions/{id}            軟刪除
- PUT    /api/question-bank/questions/{id}/program-links  整批覆寫教材包／單元關聯
- POST   /api/question-bank/ai/answer                 AI 作答：正確選項 + 解析（#1065，不扣點）
- POST   /api/question-bank/ai/analyze                AI 考點分析：考點 code + 年段（#1065，不扣點）
- GET    /api/question-bank/exam-points?q=            考點清單（含 alias 命中）
- GET    /api/question-bank/sources?q=                來源清單（平台公用 + 自己機構 + 自己建的）
- POST   /api/question-bank/sources                   新增來源（可打字下拉的「新增」）

可見範圍、重複偵測、考點歸一都在 services/question_bank_service.py，這裡只做
驗證、權限與序列化。列表的 filter 參數已含 P3（#1066）需要的全部欄位。

#1077：列表 eager-load source_links（避免 N+1）、來源搜尋走 ``qbs.ilike_contains``
轉義 ``%``/``_``、``POST /sources`` 已存在判斷改精確（不分大小寫）比對、
``ai_analyze`` 失敗時 rollback 已 flush 的 pending 考點。

#1082 骨架：列表回傳 ``kind: single | group``（小題不單獨出現）；題組經
``POST /question-groups`` 一次建立（group + 小題 + 選項／考點／來源同一交易）；
小題的 visibility／歸屬跟隨題組，不做重複偵測（同一篇文章的問法常重複）。
AI 作答／考點分析輸入可帶 ``passage``（題組主圖文純文字）。

#1082 第 3 段拆檔：Pydantic schemas 與可建立題型常數在 ``routers/question_bank_schemas.py``；
序列化、``_can_edit`` 權限與列表查詢輔助（含 SQL 層合併分頁）在 ``routers/question_bank_common.py``。
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models import (
    ExamPoint,
    Question,
    QuestionExamPoint,
    QuestionGroup,
    QuestionSource,
    QuestionSourceLink,
    Teacher,
)
from models.question_bank import (
    EXAM_POINT_LINK_SOURCE_MANUAL,
    GRADE_MAX,
    GRADE_MIN,
    QUESTION_TYPES,
    STIMULUS_TYPES,
)
from routers.teachers import get_current_teacher
from services import question_bank_service as qbs
from services.question_bank_ai import (
    QuestionBankAIError,
    QuestionBankAIOutputError,
    get_question_bank_ai_service,
    normalize_inputs,
)
from utils.permissions import (
    has_read_org_materials_permission,
)
from routers.question_bank_schemas import (
    AiQuestionsIn,
    GROUP_CREATABLE_TYPES,
    GroupQuestionIn,
    ProgramLinksReplace,
    QuestionCreate,
    QuestionGroupCreate,
    QuestionGroupUpdate,
    QuestionUpdate,
    SINGLE_CREATABLE_TYPES,
    SourceCreate,
    _effective_passage_text,
    _validate_options,
)
from routers.question_bank_common import (
    _can_edit,
    _exam_point_out,
    _grade_filter,
    _group_out,
    _group_row_out,
    _load_group_rows,
    _load_options,
    _merged_page_keys,
    _parse_uuid,
    _question_out,
    _require_editable,
    _scope_filter,
    _similar_out,
    _source_out,
)

router = APIRouter(prefix="/api/question-bank", tags=["question-bank"])


# ============ Endpoints ============


@router.get("/questions/similar")
def similar_questions(
    stem: str = Query(..., min_length=1),
    exclude_id: Optional[int] = Query(None),
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """邊打字邊比對：回傳相似題 + 是否已有完全相同的題目。"""
    exact = qbs.find_exact_duplicate(db, teacher, stem, exclude_id=exclude_id)
    similar = qbs.find_similar(db, teacher, stem, exclude_id=exclude_id)
    return {
        "exact_duplicate": _similar_out(exact, teacher) if exact else None,
        "similar": [_similar_out(q, teacher) for q in similar],
    }


@router.get("/questions")
def list_questions(
    question_type: Optional[str] = Query(None),
    exam_point_ids: Optional[List[int]] = Query(None),
    grade_min: Optional[int] = Query(None, ge=GRADE_MIN, le=GRADE_MAX),
    grade_max: Optional[int] = Query(None, ge=GRADE_MIN, le=GRADE_MAX),
    q: Optional[str] = Query(None, description="題幹關鍵字"),
    scope: Literal["all", "mine", "organization", "school", "platform"] = Query("all"),
    only_own: bool = Query(False, description="mine/organization 時只列自己的／機構的，不含公開題"),
    organization_id: Optional[str] = Query(None),
    school_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """題庫列表：單題 + 題組列（kind 分流）。filter 可疊加；考點以 OR 查詢；
    年級為「範圍有交集」。題組的題型／考點／來源／關鍵字看小題，年級看題組。
    分頁：兩邊各取前 page*page_size 筆後合併排序再切頁（單頁最多載 2*page*page_size 筆）。
    """
    if question_type is not None and question_type not in QUESTION_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid question_type"
        )

    singles = qbs.visible_questions_query(db, teacher).filter(
        Question.group_id.is_(None)
    )
    groups = qbs.visible_groups_query(db, teacher)
    singles = _scope_filter(
        singles, Question, scope, only_own, organization_id, school_id, teacher
    )
    groups = _scope_filter(
        groups, QuestionGroup, scope, only_own, organization_id, school_id, teacher
    )

    # 題組的小題（active）子查詢，題型／考點／關鍵字 filter 都透過它
    sub_q = db.query(Question.group_id).filter(
        Question.group_id.isnot(None), Question.is_active.is_(True)
    )
    if question_type:
        singles = singles.filter(Question.question_type == question_type)
        groups = groups.filter(
            QuestionGroup.id.in_(sub_q.filter(Question.question_type == question_type))
        )
    if exam_point_ids:
        resolved = qbs.resolve_exam_point_ids(db, exam_point_ids)
        if not resolved:
            return {"items": [], "total": 0, "page": page, "page_size": page_size}
        ep_q = db.query(QuestionExamPoint.question_id).filter(
            QuestionExamPoint.exam_point_id.in_(resolved)
        )
        singles = singles.filter(Question.id.in_(ep_q))
        groups = groups.filter(
            QuestionGroup.id.in_(sub_q.filter(Question.id.in_(ep_q)))
        )
    singles = _grade_filter(singles, Question, grade_min, grade_max)
    groups = _grade_filter(groups, QuestionGroup, grade_min, grade_max)
    if q and q.strip():
        # 題幹（正規化後子字串）或 考題來源名稱（ILIKE）任一命中；題組另看標題／文章
        raw = q.strip()
        needle = qbs.normalize_stem(raw)
        source_q = (
            db.query(QuestionSourceLink.question_id)
            .join(QuestionSource, QuestionSource.id == QuestionSourceLink.source_id)
            .filter(qbs.ilike_contains(QuestionSource.name, raw))
        )
        # 題幹也要轉義：normalize_stem 會保留 "_"（\w），不轉義會變成單字元萬用字元
        stem_hit = Question.normalized_stem.like(
            f"%{qbs.escape_like(needle)}%", escape=qbs.LIKE_ESCAPE
        )
        single_hit = (
            or_(stem_hit, Question.id.in_(source_q))
            if needle
            else Question.id.in_(source_q)
        )
        singles = singles.filter(single_hit)
        group_hit = [
            QuestionGroup.id.in_(sub_q.filter(single_hit)),
            qbs.ilike_contains(QuestionGroup.title, raw),
            qbs.ilike_contains(QuestionGroup.passage_text, raw),
        ]
        groups = groups.filter(or_(*group_hit))

    total = singles.count() + groups.count()
    # 分頁在 SQL 層合併：兩邊各投影成 (kind, id, updated_at) UNION ALL 後排序、offset/limit，
    # 只取本頁的 (kind, id)；深頁不會把前面幾頁也抓回來（#1082 第 3 段）
    merged = _merged_page_keys(db, singles, groups, page, page_size)

    # 只對本頁的列載入關聯（selectinload 批次查，不會 N+1）
    single_ids = [i for kind, i in merged if kind == "single"]
    group_ids = [i for kind, i in merged if kind == "group"]
    loaded_q = (
        {
            x.id: x
            for x in _load_options(
                db.query(Question).filter(Question.id.in_(single_ids))
            ).all()
        }
        if single_ids
        else {}
    )
    loaded_g = (
        {
            g.id: g
            for g in _load_group_rows(
                db.query(QuestionGroup).filter(QuestionGroup.id.in_(group_ids))
            ).all()
        }
        if group_ids
        else {}
    )
    perm_cache: dict = {}
    items = []
    for kind, i in merged:
        if kind == "single":
            if i not in loaded_q:
                continue
            items.append(
                {
                    "kind": "single",
                    **_question_out(db, loaded_q[i], teacher, perm_cache),
                }
            )
        elif i in loaded_g:
            items.append(_group_row_out(db, loaded_g[i], teacher, perm_cache))
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/questions", status_code=status.HTTP_201_CREATED)
def create_question(
    payload: QuestionCreate,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    if payload.question_type not in SINGLE_CREATABLE_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="此題型尚未開放")

    org_uuid = _parse_uuid(payload.organization_id, "organization_id")
    school_uuid = _parse_uuid(payload.school_id, "school_id")
    _require_bank_membership(db, teacher, org_uuid, school_uuid)

    dup = qbs.find_exact_duplicate(db, teacher, payload.stem)
    if dup is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": "題目已存在", "duplicate": _similar_out(dup, teacher)},
        )

    question = Question(
        question_type=payload.question_type,
        stem=payload.stem,
        normalized_stem=qbs.normalize_stem(payload.stem),
        explanation=payload.explanation,
        image_url=payload.image_url,
        stem_audio_url=payload.stem_audio_url,
        grade_min=payload.grade_min,
        grade_max=payload.grade_max,
        allow_multiple_answers=payload.allow_multiple_answers,
        show_stem_text=payload.show_stem_text,
        visibility=payload.visibility,
        teacher_id=teacher.id,
        organization_id=org_uuid,
        school_id=school_uuid,
    )
    qbs.enforce_platform_rules(question, teacher)
    qbs.replace_options(question, [o.model_dump() for o in payload.options])
    qbs.replace_exam_points(
        db, question, payload.exam_point_ids, source=EXAM_POINT_LINK_SOURCE_MANUAL
    )
    qbs.replace_program_links(
        question, [pl.model_dump() for pl in payload.program_links]
    )
    qbs.replace_sources(db, question, teacher, payload.source_ids)

    db.add(question)
    db.commit()
    db.refresh(question)
    return _question_out(
        db, qbs.get_visible_question(db, teacher, question.id), teacher
    )


def _require_bank_membership(
    db: Session, teacher: Teacher, org_uuid, school_uuid
) -> None:
    """新增到機構／學校題庫：active 成員即可；編輯／刪除才需要管理權限（_can_edit）。"""
    if org_uuid is not None and not has_read_org_materials_permission(
        teacher.id, org_uuid, db
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="不是此機構的成員")
    if school_uuid is not None and school_uuid not in qbs.teacher_school_ids(
        db, teacher.id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="不是此學校的成員")


@router.post("/question-groups", status_code=status.HTTP_201_CREATED)
def create_question_group(
    payload: QuestionGroupCreate,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """建立題組：group + 小題 + 選項／考點／教材／來源在同一個交易；任一步失敗整組 rollback。

    小題的 question_type／visibility／歸屬跟隨題組；小題不做重複偵測（partial unique
    index 也排除 group_id 有值的列）。
    """
    if payload.question_type not in GROUP_CREATABLE_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="此題型尚未開放")
    if payload.stimulus_type not in STIMULUS_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid stimulus_type"
        )
    org_uuid = _parse_uuid(payload.organization_id, "organization_id")
    school_uuid = _parse_uuid(payload.school_id, "school_id")
    _require_bank_membership(db, teacher, org_uuid, school_uuid)

    group = QuestionGroup(
        stimulus_type=payload.stimulus_type,
        title=payload.title,
        passage_text=_effective_passage_text(payload.passage_text, payload.layout),
        image_url=payload.image_url,
        layout=payload.layout,
        glossary=payload.glossary,
        grade_min=payload.grade_min,
        grade_max=payload.grade_max,
        visibility=payload.visibility,
        teacher_id=teacher.id,
        organization_id=org_uuid,
        school_id=school_uuid,
    )
    qbs.enforce_platform_rules(group, teacher)
    try:
        for i, qin in enumerate(payload.questions):
            question = Question(
                question_type=payload.question_type,
                stem=qin.stem,
                normalized_stem=qbs.normalize_stem(qin.stem),
                explanation=qin.explanation,
                image_url=qin.image_url,
                stem_audio_url=qin.stem_audio_url,
                grade_min=qin.grade_min
                if qin.grade_min is not None
                else group.grade_min,
                grade_max=qin.grade_max
                if qin.grade_max is not None
                else group.grade_max,
                allow_multiple_answers=qin.allow_multiple_answers,
                show_stem_text=qin.show_stem_text,
                visibility=group.visibility,
                is_platform=group.is_platform,
                teacher_id=teacher.id,
                organization_id=org_uuid,
                school_id=school_uuid,
                group_order=qin.group_order if qin.group_order is not None else i,
            )
            qbs.replace_options(question, [o.model_dump() for o in qin.options])
            qbs.replace_exam_points(
                db, question, qin.exam_point_ids, source=EXAM_POINT_LINK_SOURCE_MANUAL
            )
            qbs.replace_program_links(
                question, [pl.model_dump() for pl in qin.program_links]
            )
            qbs.replace_sources(db, question, teacher, qin.source_ids)
            group.questions.append(question)
        db.add(group)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    return _group_out(db, qbs.get_visible_group(db, teacher, group.id), teacher)


@router.get("/question-groups/{group_id}")
def get_question_group(
    group_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    g = qbs.get_visible_group(db, teacher, group_id)
    if g is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="題組不存在")
    return _group_out(db, g, teacher)


def _require_editable_group(
    db: Session, teacher: Teacher, group_id: int
) -> QuestionGroup:
    g = qbs.get_visible_group(db, teacher, group_id)
    if g is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="題組不存在")
    if not _can_edit(db, teacher, g):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="沒有修改此題組的權限")
    return g


def _apply_group_question(
    db: Session,
    teacher: Teacher,
    group: QuestionGroup,
    question: Question,
    qin: GroupQuestionIn,
    order: int,
    *,
    is_new: bool,
) -> None:
    """把小題輸入套到 Question（新建或既有）：題型／公開／歸屬跟隨題組，年段未給時繼承。"""
    question.stem = qin.stem
    question.normalized_stem = qbs.normalize_stem(qin.stem)
    question.explanation = qin.explanation
    question.image_url = qin.image_url
    question.stem_audio_url = qin.stem_audio_url
    question.grade_min = qin.grade_min if qin.grade_min is not None else group.grade_min
    question.grade_max = qin.grade_max if qin.grade_max is not None else group.grade_max
    question.allow_multiple_answers = qin.allow_multiple_answers
    question.show_stem_text = qin.show_stem_text
    question.visibility = group.visibility
    question.is_platform = group.is_platform
    question.organization_id = group.organization_id
    question.school_id = group.school_id
    question.group_order = order
    flush_db = None if is_new else db
    qbs.replace_options(question, [o.model_dump() for o in qin.options], db=flush_db)
    qbs.replace_exam_points(
        db, question, qin.exam_point_ids, source=EXAM_POINT_LINK_SOURCE_MANUAL
    )
    qbs.replace_program_links(
        question, [pl.model_dump() for pl in qin.program_links], db=flush_db
    )
    qbs.replace_sources(db, question, teacher, qin.source_ids)


@router.patch("/question-groups/{group_id}")
def update_question_group(
    group_id: int,
    payload: QuestionGroupUpdate,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """整組替換（單交易）：group 欄位只更新有給的；``questions`` 給了就整份對齊 ——
    帶 id 的更新、沒 id 的新增、清單裡沒出現的既有小題軟刪除。任一步失敗整組 rollback。
    """
    g = _require_editable_group(db, teacher, group_id)
    data = payload.model_dump(exclude_unset=True)
    now = datetime.now(timezone.utc)
    try:
        for field in (
            "stimulus_type",
            "title",
            "image_url",
            "layout",
            "glossary",
            "grade_min",
            "grade_max",
            "visibility",
        ):
            if field in data:
                setattr(g, field, data[field])
        if "passage_text" in data:
            # 老師明確給文字版（含清空 → 由 layout 重新拼）
            g.passage_text = _effective_passage_text(data["passage_text"], g.layout)
        elif "layout" in data:
            # 只改排版：舊的純文字副本已過期，由新 layout 重拼
            g.passage_text = _effective_passage_text(None, g.layout)
        if (
            g.grade_min is not None
            and g.grade_max is not None
            and g.grade_min > g.grade_max
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="grade_min 不可大於 grade_max",
            )
        if not (g.passage_text or g.image_url or g.layout):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="題組需要文章、圖片或排版內容",
            )
        qbs.enforce_platform_rules(g, teacher)

        if payload.questions is not None:
            existing = {q.id: q for q in g.questions if q.is_active}
            wanted_ids = {q.id for q in payload.questions if q.id is not None}
            unknown = wanted_ids - set(existing)
            if unknown:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"小題不屬於此題組：{sorted(unknown)}",
                )
            for order, qin in enumerate(payload.questions):
                if qin.id is not None:
                    _apply_group_question(
                        db, teacher, g, existing[qin.id], qin, order, is_new=False
                    )
                    existing[qin.id].updated_at = now
                else:
                    question = Question(
                        question_type=g.questions[0].question_type
                        if g.questions
                        else "reading",
                        teacher_id=teacher.id,
                    )
                    _apply_group_question(
                        db, teacher, g, question, qin, order, is_new=True
                    )
                    g.questions.append(question)
            for qid, q in existing.items():
                if qid not in wanted_ids:
                    q.is_active = False
                    q.deleted_at = now
        else:
            # 只改題組欄位時，小題的公開／年段（未自訂者無法區分，統一跟隨）／歸屬仍要跟著題組
            for q in g.questions:
                if q.is_active:
                    q.visibility = g.visibility
                    q.is_platform = g.is_platform
                    if "grade_min" in data:
                        q.grade_min = g.grade_min
                    if "grade_max" in data:
                        q.grade_max = g.grade_max

        g.updated_at = now
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    return _group_out(db, qbs.get_visible_group(db, teacher, g.id), teacher)


@router.delete("/question-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_question_group(
    group_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """軟刪除整組（group + 小題），保留已派發考卷的參照。"""
    g = _require_editable_group(db, teacher, group_id)
    now = datetime.now(timezone.utc)
    g.is_active = False
    g.deleted_at = now
    for q in g.questions:
        q.is_active = False
        q.deleted_at = now
    db.commit()
    return None


@router.get("/questions/{question_id}")
def get_question(
    question_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    q = qbs.get_visible_question(db, teacher, question_id)
    if q is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="題目不存在")
    return _question_out(db, q, teacher)


@router.patch("/questions/{question_id}")
def update_question(
    question_id: int,
    payload: QuestionUpdate,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    q = _require_editable(db, teacher, question_id)
    data = payload.model_dump(exclude_unset=True)

    if "stem" in data:
        dup = qbs.find_exact_duplicate(db, teacher, data["stem"], exclude_id=q.id)
        if dup is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"message": "題目已存在", "duplicate": _similar_out(dup, teacher)},
            )
        q.stem = data["stem"]
        q.normalized_stem = qbs.normalize_stem(data["stem"])

    for field in ("image_url", "stem_audio_url"):
        if field in data:
            setattr(q, field, data[field])
    if not (q.stem or q.image_url or q.stem_audio_url):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="題目需要文字或圖片",
        )

    for field in (
        "explanation",
        "grade_min",
        "grade_max",
        "allow_multiple_answers",
        "show_stem_text",
        "visibility",
    ):
        if field in data:
            setattr(q, field, data[field])

    if (
        q.grade_min is not None
        and q.grade_max is not None
        and q.grade_min > q.grade_max
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="grade_min 不可大於 grade_max",
        )

    if payload.options is not None:
        try:
            _validate_options(payload.options, q.allow_multiple_answers)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
            )
        qbs.replace_options(q, [o.model_dump() for o in payload.options], db=db)
    elif "allow_multiple_answers" in data and not q.allow_multiple_answers:
        # 關掉複選但既有選項有多個正確答案 → 擋
        if sum(1 for o in q.options if o.is_correct) > 1:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="此題有多個正確答案，需先改成單一正確答案才能關閉複選",
            )

    if payload.exam_point_ids is not None:
        qbs.replace_exam_points(
            db, q, payload.exam_point_ids, source=EXAM_POINT_LINK_SOURCE_MANUAL
        )
    if payload.program_links is not None:
        qbs.replace_program_links(
            q, [pl.model_dump() for pl in payload.program_links], db=db
        )
    if payload.source_ids is not None:
        qbs.replace_sources(db, q, teacher, payload.source_ids)

    qbs.enforce_platform_rules(q, teacher)
    q.updated_at = datetime.now(timezone.utc)
    db.commit()
    return _question_out(db, qbs.get_visible_question(db, teacher, q.id), teacher)


@router.delete("/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_question(
    question_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """軟刪除：is_active=False，保留已派發考卷的參照。"""
    q = _require_editable(db, teacher, question_id)
    q.is_active = False
    q.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return None


@router.put("/questions/{question_id}/program-links")
def replace_program_links(
    question_id: int,
    payload: ProgramLinksReplace,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    q = _require_editable(db, teacher, question_id)
    qbs.replace_program_links(
        q, [pl.model_dump() for pl in payload.program_links], db=db
    )
    db.commit()
    return _question_out(db, qbs.get_visible_question(db, teacher, q.id), teacher)


# ============ AI 工具（#1065）— 先不扣點、不記用量 ============


def _ai_inputs(payload: AiQuestionsIn):
    try:
        return normalize_inputs([q.model_dump() for q in payload.questions])
    except QuestionBankAIError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


def _ai_failed(what: str, exc: Exception) -> HTTPException:
    logging.getLogger(__name__).warning("[qb-ai] %s failed: %s", what, exc)
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY, detail="AI 產生失敗，請稍後再試"
    )


@router.post("/ai/answer")
async def ai_answer(
    payload: AiQuestionsIn,
    teacher: Teacher = Depends(get_current_teacher),
):
    """AI 作答：每題回正確選項 index（可複選）與繁中解析；判斷不了的列在 skipped。"""
    items = _ai_inputs(payload)
    try:
        results, skipped = await get_question_bank_ai_service().answer(items)
    except QuestionBankAIOutputError as e:
        raise _ai_failed("answer", e)
    except Exception as e:  # TimeoutError / provider errors
        raise _ai_failed("answer", e)
    return {
        "results": [
            {
                "key": r.key,
                "correct_indexes": r.correct_indexes,
                "explanation": r.explanation,
            }
            for r in results
        ],
        "skipped": skipped,
    }


@router.post("/ai/analyze")
async def ai_analyze(
    payload: AiQuestionsIn,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """AI 考點分析：只能從平台正式考點挑；提議的新考點存 pending、不回前端。"""
    items = _ai_inputs(payload)
    try:
        results, skipped = await get_question_bank_ai_service().analyze(db, items)
    except QuestionBankAIError as e:
        # _store_proposed 可能已 flush pending 考點；get_db 只 close 不 rollback
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except QuestionBankAIOutputError as e:
        db.rollback()
        raise _ai_failed("analyze", e)
    except Exception as e:
        db.rollback()
        raise _ai_failed("analyze", e)

    wanted = {i for r in results for i in r.exam_point_ids}
    points = (
        {
            ep.id: ep
            for ep in db.query(ExamPoint)
            .options(selectinload(ExamPoint.aliases))
            .filter(ExamPoint.id.in_(wanted))
            .all()
        }
        if wanted
        else {}
    )
    return {
        "results": [
            {
                "key": r.key,
                "exam_points": [
                    _exam_point_out(points[i]) for i in r.exam_point_ids if i in points
                ],
                "grade_min": r.grade_min,
                "grade_max": r.grade_max,
            }
            for r in results
        ],
        "skipped": skipped,
    }


@router.get("/exam-points")
def list_exam_points(
    q: Optional[str] = Query(None, description="關鍵字（正式名稱、code 或 alias）"),
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """考點清單（只回 active）。有 q 時回命中項；命中 alias 也算，回傳的是正式考點。"""
    points = qbs.search_exam_points(db, q=q, include_pending=True)
    return {"items": [_exam_point_out(ep) for ep in points]}


@router.get("/sources")
def list_sources(
    q: Optional[str] = Query(None, description="名稱關鍵字"),
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """來源清單：平台公用 + 所屬機構自建 + 自己建的。"""
    query = qbs.visible_sources_query(db, teacher)
    if q and q.strip():
        query = query.filter(qbs.ilike_contains(QuestionSource.name, q.strip()))
    rows = query.order_by(
        QuestionSource.source_type,
        QuestionSource.year.desc().nullslast(),
        QuestionSource.name,
    ).all()
    return {"items": [_source_out(s) for s in rows]}


@router.post("/sources", status_code=status.HTTP_201_CREATED)
def create_source(
    payload: SourceCreate,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """新增來源（可打字下拉的「新增」）。同名同型別已存在就回既有那筆（idempotent）。"""
    org_uuid = _parse_uuid(payload.organization_id, "organization_id")
    if org_uuid is not None and not has_read_org_materials_permission(
        teacher.id, org_uuid, db
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="不是此機構的成員")
    # 只在「平台公用 + 要建立的 scope」內去重；不能回到老師其他機構或個人的同名來源
    if org_uuid is not None:
        scope_cond = QuestionSource.organization_id == org_uuid
    else:
        scope_cond = and_(
            QuestionSource.organization_id.is_(None),
            QuestionSource.teacher_id == teacher.id,
        )
    platform_cond = and_(
        QuestionSource.organization_id.is_(None),
        QuestionSource.teacher_id.is_(None),
    )
    existing = (
        db.query(QuestionSource)
        .filter(
            or_(platform_cond, scope_cond),
            QuestionSource.source_type == payload.source_type,
            func.lower(QuestionSource.name) == payload.name.strip().lower(),
        )
        .first()
    )
    if existing is not None:
        return _source_out(existing)
    source = QuestionSource(
        source_type=payload.source_type,
        name=payload.name,
        year=payload.year,
        organization_id=org_uuid,
        teacher_id=None if org_uuid is not None else teacher.id,
    )
    db.add(source)
    db.commit()
    db.refresh(source)
    return _source_out(source)
