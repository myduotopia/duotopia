"""
題庫 service（Issue #1061 / #1062）。

集中三件事，router 不自己寫 query：
1. **可見範圍**：老師 T 看得到哪些題目（``visible_questions_query``）。
2. **重複偵測**：只比對「自己的 + public」（``find_similar``），不含機構內部題目，
   避免相似題提示把機構題目外洩給非機構老師。
3. **考點歸一**：alias → 正式考點、``merged`` 考點 redirect 到 ``merged_into``。

可見規則（與 docs/design/question-bank-schema.md 一致）：
  1. teacher_id = T 且非機構／學校題庫（自己的）
  2. visibility = 'public'（含全部平台題庫）
  3. 機構題庫（organization_id 有值）且 T 是該機構 active 成員
  4. 學校題庫（school_id 有值）且 T 是該學校 active 成員
  5. visibility = 'organization_only' 且 T 屬於任一機構
  6. visibility = 'individual_only' 且 T 不屬於任何機構
"""

from __future__ import annotations

import os
import re
import unicodedata
from typing import Iterable, Optional

from sqlalchemy import and_, or_
from sqlalchemy.orm import Query, Session, selectinload

from models import (
    ExamPoint,
    ExamPointAlias,
    Question,
    QuestionExamPoint,
    QuestionOption,
    QuestionProgramLink,
    Teacher,
    TeacherOrganization,
    TeacherSchool,
)
from models.question_bank import (
    EXAM_POINT_LINK_SOURCE_MANUAL,
    EXAM_POINT_STATUS_ACTIVE,
    EXAM_POINT_STATUS_MERGED,
)

# 平台題庫建置帳號；此帳號建的題目 is_platform=True 且 visibility 強制 public。
PLATFORM_TEACHER_EMAIL = os.getenv(
    "QUESTION_BANK_PLATFORM_EMAIL", "contact@duotopia.co"
).lower()

VISIBILITY_VALUES = ("private", "public", "organization_only", "individual_only")

# 相似題：trgm similarity 門檻（Postgres）。SQLite 測試環境退化成 LIKE 子字串。
SIMILARITY_THRESHOLD = 0.4
SIMILAR_LIMIT = 5


# --------------------------------------------------------------------------- #
# 題幹正規化 / 重複偵測
# --------------------------------------------------------------------------- #
_PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)
_WS_RE = re.compile(r"\s+")


def normalize_stem(stem: str) -> str:
    """小寫、去標點、壓空白。全形統一成半形（NFKC），讓「Ｉ ａｍ」＝「i am」。"""
    text = unicodedata.normalize("NFKC", stem or "").lower()
    text = _PUNCT_RE.sub(" ", text)
    return _WS_RE.sub(" ", text).strip()


def is_platform_teacher(teacher: Teacher) -> bool:
    return (teacher.email or "").lower() == PLATFORM_TEACHER_EMAIL


# --------------------------------------------------------------------------- #
# 老師的機構 / 學校歸屬（可見範圍用）
# --------------------------------------------------------------------------- #
def teacher_org_ids(db: Session, teacher_id: int) -> list:
    rows = (
        db.query(TeacherOrganization.organization_id)
        .filter(
            TeacherOrganization.teacher_id == teacher_id,
            TeacherOrganization.is_active.is_(True),
        )
        .all()
    )
    return [r[0] for r in rows]


def teacher_school_ids(db: Session, teacher_id: int) -> list:
    rows = (
        db.query(TeacherSchool.school_id)
        .filter(
            TeacherSchool.teacher_id == teacher_id,
            TeacherSchool.is_active.is_(True),
        )
        .all()
    )
    return [r[0] for r in rows]


def visible_questions_query(db: Session, teacher: Teacher) -> Query:
    """老師可見的題目（未刪除）。規則見模組 docstring。"""
    org_ids = teacher_org_ids(db, teacher.id)
    school_ids = teacher_school_ids(db, teacher.id)

    own = and_(
        Question.teacher_id == teacher.id,
        Question.organization_id.is_(None),
        Question.school_id.is_(None),
    )
    conds = [own, Question.visibility == "public"]
    if org_ids:
        conds.append(Question.organization_id.in_(org_ids))
        conds.append(Question.visibility == "organization_only")
    else:
        conds.append(Question.visibility == "individual_only")
    if school_ids:
        conds.append(Question.school_id.in_(school_ids))

    return db.query(Question).filter(Question.is_active.is_(True), or_(*conds))


def dedup_scope_query(db: Session, teacher: Teacher) -> Query:
    """重複偵測範圍：自己的 + public 單題（不含題組小題）。"""
    return db.query(Question).filter(
        Question.is_active.is_(True),
        Question.group_id.is_(None),
        or_(Question.teacher_id == teacher.id, Question.visibility == "public"),
    )


def find_exact_duplicate(
    db: Session, teacher: Teacher, stem: str, exclude_id: Optional[int] = None
) -> Optional[Question]:
    norm = normalize_stem(stem)
    if not norm:
        return None
    q = dedup_scope_query(db, teacher).filter(Question.normalized_stem == norm)
    if exclude_id is not None:
        q = q.filter(Question.id != exclude_id)
    return q.first()


def find_similar(
    db: Session,
    teacher: Teacher,
    stem: str,
    exclude_id: Optional[int] = None,
    limit: int = SIMILAR_LIMIT,
) -> list[Question]:
    """相似題（含完全相同）。Postgres 用 pg_trgm similarity；其他 dialect 退化成
    子字串比對，讓單元測試（SQLite）也能跑。"""
    norm = normalize_stem(stem)
    if not norm:
        return []
    q = dedup_scope_query(db, teacher)
    if exclude_id is not None:
        q = q.filter(Question.id != exclude_id)

    if db.bind is not None and db.bind.dialect.name == "postgresql":
        from sqlalchemy import func

        sim = func.similarity(Question.normalized_stem, norm)
        return (
            q.filter(sim >= SIMILARITY_THRESHOLD)
            .order_by(sim.desc(), Question.id)
            .limit(limit)
            .all()
        )

    # 非 Postgres：取前幾個字做子字串比對（測試用，不追求精準）
    probe = norm[: max(8, len(norm) // 2)]
    return (
        q.filter(Question.normalized_stem.like(f"%{probe}%"))
        .order_by(Question.id)
        .limit(limit)
        .all()
    )


# --------------------------------------------------------------------------- #
# 考點
# --------------------------------------------------------------------------- #
def resolve_exam_point(db: Session, exam_point_id: int) -> Optional[ExamPoint]:
    """把 merged 考點 redirect 到正式考點（最多跟 10 層，防環）。"""
    ep = db.query(ExamPoint).filter(ExamPoint.id == exam_point_id).first()
    hops = 0
    while ep is not None and ep.status == EXAM_POINT_STATUS_MERGED:
        if ep.merged_into_id is None or hops >= 10:
            return None
        ep = db.query(ExamPoint).filter(ExamPoint.id == ep.merged_into_id).first()
        hops += 1
    return ep


def resolve_exam_point_ids(db: Session, ids: Iterable[int]) -> list[int]:
    """去重、redirect、丟掉非 active 的考點。"""
    out: list[int] = []
    for i in ids:
        ep = resolve_exam_point(db, i)
        if ep is not None and ep.status == EXAM_POINT_STATUS_ACTIVE:
            if ep.id not in out:
                out.append(ep.id)
    return out


def _name_matches(ep: ExamPoint, needle: str) -> bool:
    names = ep.names or {}
    if isinstance(names, dict):
        return any(needle in str(v).lower() for v in names.values())
    return needle in str(names).lower()


def search_exam_points(
    db: Session, q: Optional[str] = None, include_pending: bool = False
) -> list[ExamPoint]:
    """考點清單（含 alias 命中）。考點數量小（數百），過濾在 Python 做，
    避免 JSONB 查詢在 SQLite / Postgres 之間寫兩套。"""
    statuses = [EXAM_POINT_STATUS_ACTIVE]
    if include_pending:
        statuses.append("pending")
    points = (
        db.query(ExamPoint)
        .options(selectinload(ExamPoint.aliases))
        .filter(ExamPoint.status.in_(statuses))
        .order_by(ExamPoint.parent_id.nullsfirst(), ExamPoint.order_index, ExamPoint.id)
        .all()
    )
    if not q:
        return points
    needle = q.strip().lower()
    if not needle:
        return points
    hit_ids = set()
    for ep in points:
        if needle in ep.code.lower() or _name_matches(ep, needle):
            hit_ids.add(ep.id)
            continue
        if any(needle in (a.alias or "").lower() for a in ep.aliases):
            hit_ids.add(ep.id)
    return [ep for ep in points if ep.id in hit_ids]


def find_exam_point_by_alias(db: Session, text: str) -> Optional[ExamPoint]:
    """老師手打或 AI 回傳非正式名稱時，先用 alias 對回正式考點。"""
    needle = (text or "").strip().lower()
    if not needle:
        return None
    alias = db.query(ExamPointAlias).filter(ExamPointAlias.alias.ilike(needle)).first()
    if alias is None:
        return None
    return resolve_exam_point(db, alias.exam_point_id)


# --------------------------------------------------------------------------- #
# 題目寫入
# --------------------------------------------------------------------------- #
def enforce_platform_rules(question: Question, teacher: Teacher) -> None:
    """平台帳號建的題目：is_platform=True 且 visibility 強制 public。"""
    if is_platform_teacher(teacher):
        question.is_platform = True
        question.visibility = "public"
    elif question.is_platform:
        # 非平台帳號不能自稱平台題庫
        question.is_platform = False


def _clear_children(db: Optional[Session], collection) -> None:
    """整批覆寫子集合前先刪舊的並 flush。

    SQLAlchemy 在同一次 flush 內會先 INSERT 新列再 DELETE 孤兒，新舊列若撞到
    (question_id, order_index) / (question_id, exam_point_id) 這類唯一鍵就會爆
    IntegrityError，所以拆成兩段 flush。新建（尚未 persist）的 question 不需要。
    """
    if db is None or not collection:
        return
    collection.clear()
    db.flush()


def replace_options(
    question: Question, options: list[dict], db: Optional[Session] = None
) -> None:
    """整批覆寫選項（order_index 依傳入順序重編）。既有題目請傳 db。"""
    _clear_children(db, question.options)
    question.options = [
        QuestionOption(
            order_index=i,
            text=o["text"],
            is_correct=bool(o.get("is_correct", False)),
            audio_url=o.get("audio_url"),
            image_url=o.get("image_url"),
        )
        for i, o in enumerate(options)
    ]


def replace_exam_points(
    db: Session,
    question: Question,
    exam_point_ids: Iterable[int],
    source: str = EXAM_POINT_LINK_SOURCE_MANUAL,
) -> None:
    resolved = resolve_exam_point_ids(db, exam_point_ids)
    if question.id is not None:
        _clear_children(db, question.exam_point_links)
    question.exam_point_links = [
        QuestionExamPoint(exam_point_id=i, source=source) for i in resolved
    ]


def replace_program_links(
    question: Question, links: list[dict], db: Optional[Session] = None
) -> None:
    """整批覆寫教材包／單元關聯（去重）。既有題目請傳 db。"""
    _clear_children(db, question.program_links)
    seen = set()
    out = []
    for link in links:
        key = (link["program_id"], link.get("lesson_id"))
        if key in seen:
            continue
        seen.add(key)
        out.append(
            QuestionProgramLink(
                program_id=link["program_id"], lesson_id=link.get("lesson_id")
            )
        )
    question.program_links = out


def get_visible_question(
    db: Session, teacher: Teacher, question_id: int
) -> Optional[Question]:
    return (
        visible_questions_query(db, teacher)
        .options(
            selectinload(Question.options),
            selectinload(Question.exam_point_links).selectinload(
                QuestionExamPoint.exam_point
            ),
            selectinload(Question.program_links),
        )
        .filter(Question.id == question_id)
        .first()
    )
