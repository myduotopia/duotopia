"""
題庫 API：題組端點（自 routers/question_bank.py 拆出，#1082）。

- POST   /api/question-bank/question-groups           新增題組（整組一個交易）
- GET    /api/question-bank/question-groups/{id}      題組（含小題）
- PATCH  /api/question-bank/question-groups/{id}      整組替換（單交易；小題整份對齊）
- DELETE /api/question-bank/question-groups/{id}      軟刪除整組

本檔的 ``router`` 不帶 prefix／tags，由 ``routers/question_bank.py`` 在原本
題組段落的位置 ``router.include_router(...)`` 掛上（prefix ``/api/question-bank`` 與 tags 由
外層 router 套用），網址、權限、回應與 OpenAPI 路徑都與拆檔前相同。``main.py`` 不需改。

小題的 question_type／visibility／歸屬跟隨題組，不做重複偵測（同一篇文章的問法常重複）。
#1083：題組可帶 ``segments``（圖片對話逐句「說話者：台詞」）；有 segments 時
``passage_text`` 一律由 segments 推導（見 ``_sync_dialogue``）。
#1085：克漏字空格與小題一一對應，以「合併後」狀態檢查（``check_group_blanks``）。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from models import Question, QuestionGroup, QuestionGroupSegment, Teacher
from models.question_bank import EXAM_POINT_LINK_SOURCE_MANUAL, STIMULUS_TYPES
from routers.teachers import get_current_teacher
from services import question_bank_service as qbs
from routers.question_bank_schemas import (
    GROUP_CREATABLE_TYPES,
    GroupQuestionIn,
    QuestionGroupCreate,
    QuestionGroupUpdate,
    SegmentIn,
    check_group_blanks,
    dialogue_passage_text,
    _effective_passage_text,
)
from routers.question_bank_common import (
    _can_edit,
    _group_out,
    _parse_uuid,
    _require_bank_membership,
)

router = APIRouter()


def _replace_segments(
    db: Session, group: QuestionGroup, segments: List[SegmentIn]
) -> None:
    """整組替換對話文稿，order_index 依陣列順序 0..n-1（#1083）。

    先刪舊的並 flush 再加新的：同一次 flush 內 SQLAlchemy 會先 INSERT 再 DELETE，
    會撞到 ``uq_question_group_segments_order``（group_id, order_index）。
    """
    if group.segments:
        group.segments.clear()
        if group.id is not None:
            db.flush()
    for i, seg in enumerate(segments):
        group.segments.append(
            QuestionGroupSegment(
                order_index=i,
                speaker_label=seg.speaker_label,
                transcript=seg.transcript,
            )
        )


def _sync_dialogue(group: QuestionGroup) -> None:
    """有對話文稿時，文字版由 segments 重組（只保留開頭的非對話文字：標題、旁白）。

    決策（#1083，2026-10-06，使用者定案）：對話文稿的唯一來源是 segments ——
    之後同一題組的對話音檔（Gemini 2.5 Flash TTS 多說話者）也由它產生。文字版
    （``passage_text``）只是它的純文字副本，供搜尋與 AI 考點分析；若採用前端送來的
    文字，文字版與 segments／音檔就可能各說各話，所以有 segments 時一律覆蓋。
    沒有 segments 的題組（海報、地圖、散文、舊資料）不受影響，文字版維持老師可編輯。
    """
    if group.segments:
        group.passage_text = dialogue_passage_text(group.passage_text, group.segments)


def _check_question_grades(questions) -> None:
    """小題年段上下限各自繼承題組，一邊自訂、一邊繼承可能變成 min > max。

    DB 有 ck_questions_grade_range，不先擋會在 commit 變 500（前端看到 Failed to fetch）。
    """
    for q in questions:
        if (
            q.is_active is not False
            and q.grade_min is not None
            and q.grade_max is not None
            and q.grade_min > q.grade_max
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="小題年段與題組年段衝突：grade_min 不可大於 grade_max",
            )


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
    if payload.segments:
        _replace_segments(db, group, payload.segments)
        _sync_dialogue(group)
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
                blank_index=qin.blank_index,
            )
            _check_question_grades([question])
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
    # 下面 replace_options 會 flush，年段衝突要在這之前擋下
    _check_question_grades([question])
    question.allow_multiple_answers = qin.allow_multiple_answers
    question.show_stem_text = qin.show_stem_text
    question.visibility = group.visibility
    question.is_platform = group.is_platform
    question.organization_id = group.organization_id
    question.school_id = group.school_id
    question.group_order = order
    question.blank_index = qin.blank_index
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
    previous_text = g.passage_text
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
        # 先驗年段：下面 _replace_segments 會 flush，反轉的年段會在那裡變成 500
        if (
            g.grade_min is not None
            and g.grade_max is not None
            and g.grade_min > g.grade_max
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="grade_min 不可大於 grade_max",
            )
        if "passage_text" in data:
            # 老師明確給文字版（含清空 → 由 layout 重新拼）
            g.passage_text = _effective_passage_text(data["passage_text"], g.layout)
        elif "layout" in data:
            # 只改排版：舊的純文字副本已過期，由新 layout 重拼
            g.passage_text = _effective_passage_text(None, g.layout)
        if payload.segments is not None:
            # 給了就整組替換（[] = 清掉對話，文字版回到上面的一般規則）
            _replace_segments(db, g, payload.segments)
        # 有對話文稿時文字版由 segments 重組（上面任何一條規則改過 passage_text 都要再覆蓋）；
        # 但上面「只改排版」會把旁白連同對話一起洗掉 → 用 PATCH 前的文字版取回旁白
        if g.segments:
            if "passage_text" not in data:
                g.passage_text = previous_text
            _sync_dialogue(g)
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
                        # 明確給值：Column default 要等 flush 才套，空格檢查需要先讀得到
                        is_active=True,
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
            _check_question_grades(g.questions)

        # 空格對應以「合併後」的狀態檢查：只改 layout 刪掉空格也要被擋下（#1085）
        active = [q for q in g.questions if q.is_active]
        try:
            check_group_blanks(
                active[0].question_type if active else "reading",
                g.layout,
                [q.blank_index for q in active],
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
            ) from e

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
