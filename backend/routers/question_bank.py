"""
題庫 API（Issue #1061 / #1062）。

- GET    /api/question-bank/questions                 列表（可見範圍 + filter + 分頁）
- POST   /api/question-bank/questions                 新增（本期只開放 multiple_choice）
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
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models import (
    ExamPoint,
    Question,
    QuestionExamPoint,
    QuestionSource,
    QuestionSourceLink,
    Teacher,
)
from models.question_bank import (
    EXAM_POINT_LINK_SOURCE_MANUAL,
    GRADE_MAX,
    GRADE_MIN,
    QUESTION_TYPE_MULTIPLE_CHOICE,
    QUESTION_TYPES,
)
from routers.teachers import get_current_teacher
from services import question_bank_service as qbs
from services.question_bank_ai import (
    MAX_QUESTIONS_PER_CALL,
    QuestionBankAIError,
    QuestionBankAIOutputError,
    get_question_bank_ai_service,
    normalize_inputs,
)
from utils.permissions import (
    has_manage_materials_permission,
    has_read_org_materials_permission,
    has_school_materials_permission,
)

router = APIRouter(prefix="/api/question-bank", tags=["question-bank"])

# 本期只開放建立的題型（其餘表已建好，UI 尚未做）
CREATABLE_TYPES = (QUESTION_TYPE_MULTIPLE_CHOICE,)
MIN_OPTIONS = 2
MAX_OPTIONS = 6


# ============ Schemas ============


class OptionIn(BaseModel):
    """選項：文字可空（純圖選項），但文字／圖片／語音至少一個。"""

    text: str = Field("", max_length=1000)
    is_correct: bool = False
    audio_url: Optional[str] = None
    image_url: Optional[str] = None

    @field_validator("text")
    @classmethod
    def _strip(cls, v: str) -> str:
        return (v or "").strip()

    @model_validator(mode="after")
    def _has_content(self):
        if not (self.text or self.image_url or self.audio_url):
            raise ValueError("選項需要文字或圖片")
        return self


class ProgramLinkIn(BaseModel):
    program_id: int
    lesson_id: Optional[int] = None


class QuestionBase(BaseModel):
    # 題幹可空（純圖題），但 stem / image_url / stem_audio_url 至少一個
    stem: str = Field("", max_length=5000)
    explanation: Optional[str] = Field(None, max_length=5000)
    image_url: Optional[str] = None
    stem_audio_url: Optional[str] = None
    grade_min: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    grade_max: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    allow_multiple_answers: bool = False
    show_stem_text: bool = True
    visibility: Literal[
        "private", "public", "organization_only", "individual_only"
    ] = "private"
    exam_point_ids: List[int] = Field(default_factory=list)
    program_links: List[ProgramLinkIn] = Field(default_factory=list)
    source_ids: List[int] = Field(default_factory=list)

    @field_validator("stem")
    @classmethod
    def _strip_stem(cls, v: str) -> str:
        return (v or "").strip()

    @model_validator(mode="after")
    def _grade_range(self):
        if (
            self.grade_min is not None
            and self.grade_max is not None
            and self.grade_min > self.grade_max
        ):
            raise ValueError("grade_min 不可大於 grade_max")
        if not (self.stem or self.image_url or self.stem_audio_url):
            raise ValueError("題目需要文字或圖片")
        return self


class QuestionCreate(QuestionBase):
    question_type: Literal["multiple_choice"] = QUESTION_TYPE_MULTIPLE_CHOICE
    options: List[OptionIn] = Field(..., min_length=MIN_OPTIONS, max_length=MAX_OPTIONS)
    # 歸屬：都不給 = 自己的題庫；給 organization_id = 機構題庫；給 school_id = 學校題庫
    organization_id: Optional[str] = None
    school_id: Optional[str] = None

    @model_validator(mode="after")
    def _answers(self):
        _validate_options(self.options, self.allow_multiple_answers)
        if self.organization_id and self.school_id:
            raise ValueError("organization_id 與 school_id 只能擇一")
        return self


class QuestionUpdate(BaseModel):
    """PATCH：全部選填；有給 options 就整批覆寫。"""

    stem: Optional[str] = Field(None, max_length=5000)
    explanation: Optional[str] = Field(None, max_length=5000)
    image_url: Optional[str] = None
    stem_audio_url: Optional[str] = None
    grade_min: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    grade_max: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    allow_multiple_answers: Optional[bool] = None
    show_stem_text: Optional[bool] = None
    visibility: Optional[
        Literal["private", "public", "organization_only", "individual_only"]
    ] = None
    options: Optional[List[OptionIn]] = Field(
        None, min_length=MIN_OPTIONS, max_length=MAX_OPTIONS
    )
    exam_point_ids: Optional[List[int]] = None
    program_links: Optional[List[ProgramLinkIn]] = None
    source_ids: Optional[List[int]] = None

    @field_validator("stem")
    @classmethod
    def _strip_stem(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else v.strip()


class ProgramLinksReplace(BaseModel):
    program_links: List[ProgramLinkIn]


class AiQuestionIn(BaseModel):
    """AI 作答／考點分析的單題輸入；key 由前端給，回傳時帶回對應。"""

    key: str = Field(..., min_length=1, max_length=64)
    stem: str = Field(..., min_length=1, max_length=2000)
    options: List[str] = Field(..., min_length=2, max_length=6)


class AiQuestionsIn(BaseModel):
    questions: List[AiQuestionIn] = Field(
        ..., min_length=1, max_length=MAX_QUESTIONS_PER_CALL
    )


class SourceCreate(BaseModel):
    """老師在可打字下拉直接新增來源。"""

    source_type: Literal["exam", "publisher"]
    name: str = Field(..., min_length=1, max_length=200)
    year: Optional[int] = Field(None, ge=1900, le=2200)
    # 給 organization_id = 建成機構來源（需為該機構 active 成員）；不給 = 個人來源
    organization_id: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("來源名稱不可為空")
        return v


def _validate_options(options: List[OptionIn], allow_multiple: bool) -> None:
    correct = sum(1 for o in options if o.is_correct)
    if correct == 0:
        raise ValueError("至少要勾選一個正確答案")
    if not allow_multiple and correct > 1:
        raise ValueError("單選題只能有一個正確答案（或開啟允許複選）")


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
        "program_links": [
            {"program_id": pl.program_id, "lesson_id": pl.lesson_id}
            for pl in q.program_links
        ],
        "sources": [
            _source_out(link.source)
            for link in q.source_links
            if link.source is not None
        ],
        "created_at": q.created_at.isoformat() if q.created_at else None,
        "updated_at": q.updated_at.isoformat() if q.updated_at else None,
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
    db: Session, teacher: Teacher, q: Question, perm_cache: dict | None = None
) -> bool:
    """建立者本人一律可編輯／刪除自己建的題（含建到機構／學校題庫的）。

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
        selectinload(Question.program_links),
        selectinload(Question.source_links).selectinload(QuestionSourceLink.source),
    )


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
    """題庫列表。filter 可疊加；考點以 OR 查詢；年級為「範圍有交集」。"""
    if question_type is not None and question_type not in QUESTION_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid question_type"
        )

    query = qbs.visible_questions_query(db, teacher).filter(Question.group_id.is_(None))

    # mine / organization 預設「自己的（機構的）+ 所有公開題」；only_own=true 只留自己的（機構的）
    if scope == "mine":
        own = and_(
            Question.teacher_id == teacher.id,
            Question.organization_id.is_(None),
            Question.school_id.is_(None),
        )
        query = query.filter(
            own if only_own else or_(own, Question.visibility == "public")
        )
    elif scope == "organization":
        org_uuid = _parse_uuid(organization_id, "organization_id")
        if org_uuid is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="organization_id required for organization scope",
            )
        org_own = Question.organization_id == org_uuid
        query = query.filter(
            org_own if only_own else or_(org_own, Question.visibility == "public")
        )
    elif scope == "school":
        school_uuid = _parse_uuid(school_id, "school_id")
        if school_uuid is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="school_id required for school scope",
            )
        query = query.filter(Question.school_id == school_uuid)
    elif scope == "platform":
        query = query.filter(Question.is_platform.is_(True))

    if question_type:
        query = query.filter(Question.question_type == question_type)
    if exam_point_ids:
        resolved = qbs.resolve_exam_point_ids(db, exam_point_ids)
        if not resolved:
            return {"items": [], "total": 0, "page": page, "page_size": page_size}
        query = query.filter(
            Question.id.in_(
                db.query(QuestionExamPoint.question_id).filter(
                    QuestionExamPoint.exam_point_id.in_(resolved)
                )
            )
        )
    # 年級：題目範圍與查詢範圍有交集（沒設年級的題目不會被年級 filter 排除）
    if grade_min is not None:
        query = query.filter(
            or_(Question.grade_max.is_(None), Question.grade_max >= grade_min)
        )
    if grade_max is not None:
        query = query.filter(
            or_(Question.grade_min.is_(None), Question.grade_min <= grade_max)
        )
    if q and q.strip():
        # 題幹（正規化後子字串）或 考題來源名稱（ILIKE）任一命中
        raw = q.strip()
        needle = qbs.normalize_stem(raw)
        source_hit = Question.id.in_(
            db.query(QuestionSourceLink.question_id)
            .join(QuestionSource, QuestionSource.id == QuestionSourceLink.source_id)
            .filter(qbs.ilike_contains(QuestionSource.name, raw))
        )
        # 題幹也要轉義：normalize_stem 會保留 "_"（\w），不轉義會變成單字元萬用字元
        stem_hit = Question.normalized_stem.like(
            f"%{qbs.escape_like(needle)}%", escape=qbs.LIKE_ESCAPE
        )
        query = query.filter(or_(stem_hit, source_hit) if needle else source_hit)

    total = query.count()
    items = (
        _load_options(query)
        .order_by(Question.updated_at.desc().nullslast(), Question.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    perm_cache: dict = {}
    return {
        "items": [_question_out(db, x, teacher, perm_cache) for x in items],
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
    if payload.question_type not in CREATABLE_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="此題型尚未開放")

    org_uuid = _parse_uuid(payload.organization_id, "organization_id")
    school_uuid = _parse_uuid(payload.school_id, "school_id")
    # 新增：機構／學校的 active 成員都可以；編輯／刪除才需要管理權限（_can_edit）
    if org_uuid is not None and not has_read_org_materials_permission(
        teacher.id, org_uuid, db
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="不是此機構的成員")
    if school_uuid is not None and school_uuid not in qbs.teacher_school_ids(
        db, teacher.id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="不是此學校的成員")

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
    existing = (
        qbs.visible_sources_query(db, teacher)
        .filter(
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
