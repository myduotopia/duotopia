"""
題庫 API（Issue #1061 / #1062）。

- GET    /api/question-bank/questions                 列表：單題 + 題組列（kind 分流；可見範圍 + filter + 分頁）
- POST   /api/question-bank/questions                 新增單題（只開放 multiple_choice）
- POST   /api/question-bank/question-groups           新增題組（整組一個交易；reading #1082、cloze #1085；實作在 question_bank_groups.py）
- GET    /api/question-bank/question-groups/{id}      題組（含小題）
- GET    /api/question-bank/questions/similar?stem=   相似題（自己的 + public）
- GET    /api/question-bank/questions/{id}            單題
- PATCH  /api/question-bank/questions/{id}            修改
- DELETE /api/question-bank/questions/{id}            軟刪除
- PUT    /api/question-bank/questions/{id}/program-links  整批覆寫教材包／單元關聯
- POST   /api/question-bank/ai/answer                 AI 作答：正確選項 + 解析（#1065，不扣點）
- POST   /api/question-bank/ai/analyze                AI 考點分析：考點 code + 年段（#1065，不扣點）
- POST   /api/question-bank/ai/group-title            AI 題組標題：依文章／小題下短標題（#1084，不扣點）
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
序列化、``_can_edit``／``_require_bank_membership`` 權限與列表查詢輔助（含 SQL 層合併分頁）在 ``routers/question_bank_common.py``。

#1082 拆檔（第二次）：題組端點（POST/GET/PATCH/DELETE ``/question-groups``）在
``routers/question_bank_groups.py``；AI 端點（``/ai/answer``、``/ai/analyze``、``/ai/group-title``）在
``routers/question_bank_ai_routes.py``。兩者各自是不帶 prefix／tags 的 ``APIRouter``，
由本檔在原本段落位置 ``router.include_router(...)`` 掛上，prefix 與 tags 由本檔 ``router`` 套用 ——
``main.py`` 只 include 本檔 ``router``，網址、權限、回應與路由順序都與拆檔前相同。
``_require_bank_membership``（單題與題組新增共用）移到 ``routers/question_bank_common.py``。

#1083（2026-10-06）：題組可帶 ``segments``（圖片對話逐句「說話者：台詞」）寫進
``question_group_segments``；建立時依序寫入、PATCH 有帶就整組替換；有 segments 時
``passage_text`` 一律由 segments 推導（對話文稿唯一來源是 segments，見
``question_bank_groups._sync_dialogue``）。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from database import get_db
from models import (
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
)
from routers.teachers import get_current_teacher
from services import question_bank_service as qbs
from utils.permissions import (
    has_read_org_materials_permission,
)
from routers.question_bank_schemas import (
    ProgramLinksReplace,
    QuestionCreate,
    QuestionUpdate,
    SINGLE_CREATABLE_TYPES,
    SourceCreate,
    _validate_options,
)
from routers import question_bank_ai_routes, question_bank_groups
from routers.question_bank_common import (
    _exam_point_out,
    _grade_filter,
    _group_row_out,
    _load_group_rows,
    _load_options,
    _merged_page_keys,
    _parse_uuid,
    _question_out,
    _require_bank_membership,
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


# ============ 題組（#1082；端點在 routers/question_bank_groups.py）============

router.include_router(question_bank_groups.router)


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
    if q.group_id is not None:
        # 小題的公開／年段／歸屬跟隨題組，克漏字小題題幹可空 —— 單題端點會破壞這些規則
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="題組小題請在題組內編輯",
        )
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
    """軟刪除：is_active=False，保留已派發考卷的參照。

    題組小題不能從這裡刪：克漏字小題與文章裡的 ``{{n}}`` 一一對應，單獨刪掉會讓題組
    永遠驗證失敗（#1085）；閱讀小題刪光會留下沒有小題的題組。要刪請在題組編輯器裡刪。
    """
    q = _require_editable(db, teacher, question_id)
    if q.group_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="克漏字小題請在題組內刪除" if q.blank_index is not None else "題組小題請在題組內刪除",
        )
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


# ============ AI 工具（#1065；端點在 routers/question_bank_ai_routes.py）============

router.include_router(question_bank_ai_routes.router)


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
