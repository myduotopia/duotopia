"""
Instant Practice API - 即刻練習

Allows teachers to quickly practice content as if they were a student.
Creates an assignment marked as is_instant_practice=True with a
StudentAssignment record (teacher_id set, student_id=NULL) so that
answering progress is persisted permanently.

All records are kept for review in the assignment management page.
"""

import logging
import random
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, model_validator
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models import (
    Teacher,
    Classroom,
    Content,
    ContentItem,
    Assignment,
    AssignmentContent,
    StudentAssignment,
    StudentContentProgress,
    StudentItemProgress,
    AssignmentStatus,
)
from utils.permissions import check_content_access
from utils.score_category import resolve_score_category
from .dependencies import get_current_teacher

logger = logging.getLogger(__name__)

router = APIRouter()


class InstantPracticeRequest(BaseModel):
    """即刻練習請求"""

    content_id: int
    classroom_id: Optional[int] = None
    practice_mode: Literal[
        "reading", "rearrangement", "word_reading", "word_selection", "tug_of_war"
    ] = "reading"
    time_limit_per_question: Optional[int] = None
    shuffle_questions: bool = False
    show_answer: bool = False
    play_audio: bool = False
    show_translation: Optional[bool] = True
    show_word: Optional[bool] = True
    show_image: Optional[bool] = True
    show_option_images: Optional[bool] = False  # Issue #631

    @model_validator(mode="after")
    def _option_images_xor_image(self) -> "InstantPracticeRequest":
        if self.show_image and self.show_option_images:
            raise ValueError("show_image and show_option_images are mutually exclusive")
        return self


def _ensure_distractors_for_content(db: Session, content_id: int) -> None:
    """為指定 content 下缺少干擾項的 items 生成干擾項。

    word_selection / tug_of_war 模式需要干擾項。Issue #631：干擾項為
    list[{text, image_url}]。建立即刻練習與練習畫面即時切到這兩種模式時共用。
    """
    from utils.distractors import make_distractor

    all_items = (
        db.query(ContentItem)
        .filter(ContentItem.content_id == content_id)
        .filter(ContentItem.translation.isnot(None))
        .filter(ContentItem.translation != "")
        .order_by(ContentItem.order_index)
        .all()
    )
    all_candidates = [(item.translation, item.image_url) for item in all_items]

    for item in all_items:
        if not isinstance(item.distractors, list) or len(item.distractors) == 0:
            target = item.translation.lower().strip()
            pool = [
                (t, img) for (t, img) in all_candidates if t.lower().strip() != target
            ]
            random.shuffle(pool)
            item.distractors = [
                make_distractor(text=t, image_url=img) for (t, img) in pool[:3]
            ]


@router.post("/instant-practice/create")
async def create_instant_practice(
    request: InstantPracticeRequest,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    建立即刻練習作業

    - 建立 assignment (is_instant_practice=True)
    - 複製 content（重用既有邏輯）
    - 建立 StudentAssignment（teacher_id = 老師，student_id = NULL）
    - 建立 StudentContentProgress + StudentItemProgress
    - 回傳 assignment_id + student_assignment_id，前端導向作答頁面
    - 所有記錄永久保存，不再自動清理
    """
    # 驗證班級存在且教師有權限（classroom_id 為 optional，我的教材不需要班級）
    if request.classroom_id:
        classroom = (
            db.query(Classroom)
            .filter(
                Classroom.id == request.classroom_id,
                Classroom.is_active.is_(True),
            )
            .first()
        )

        if not classroom:
            raise HTTPException(status_code=404, detail="Classroom not found")

        if classroom.teacher_id != current_teacher.id:
            raise HTTPException(
                status_code=403,
                detail="You don't have permission for this classroom",
            )

    # 驗證 Content 存在且教師有權限存取
    check_content_access(db, request.content_id, current_teacher, require_owner=False)
    # Re-query with eagerly loaded content_items for copying
    content = (
        db.query(Content)
        .options(selectinload(Content.content_items))
        .filter(Content.id == request.content_id)
        .first()
    )
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")

    # 複製 Content 和 ContentItem（重用既有邏輯）
    content_copy = Content(
        lesson_id=content.lesson_id,
        # Issue #587: carry program_id so program-direct content (lesson_id=NULL)
        # doesn't violate the ck_contents_lesson_or_program CHECK constraint.
        program_id=content.program_id,
        type=content.type,
        title=content.title,
        order_index=content.order_index,
        is_active=True,
        target_wpm=content.target_wpm,
        target_accuracy=content.target_accuracy,
        time_limit_seconds=content.time_limit_seconds,
        level=content.level,
        tags=content.tags.copy() if content.tags else [],
        is_public=False,
        is_assignment_copy=True,
        source_content_id=content.id,
    )
    db.add(content_copy)
    db.flush()

    # 複製所有 ContentItem
    original_items = sorted(content.content_items, key=lambda x: x.order_index)
    for original_item in original_items:
        item_copy = ContentItem(
            content_id=content_copy.id,
            order_index=original_item.order_index,
            text=original_item.text,
            translation=original_item.translation,
            audio_url=original_item.audio_url,
            item_metadata=(
                original_item.item_metadata.copy()
                if original_item.item_metadata
                else {}
            ),
            example_sentence=original_item.example_sentence,
            example_sentence_translation=original_item.example_sentence_translation,
            example_sentence_definition=original_item.example_sentence_definition,
            example_sentence_audio_url=original_item.example_sentence_audio_url,
            image_url=original_item.image_url,
            part_of_speech=original_item.part_of_speech,
            distractors=(
                original_item.distractors.copy()
                if isinstance(original_item.distractors, list)
                and len(original_item.distractors) > 0
                else None
            ),
            word_count=original_item.word_count,
            max_errors=original_item.max_errors,
        )
        db.add(item_copy)
        db.flush()

    # word_selection / tug_of_war 模式：為缺少干擾項的 items 生成
    # Issue #631: 干擾項升級為 list[{text, image_url}]
    if request.practice_mode in ("word_selection", "tug_of_war"):
        _ensure_distractors_for_content(db, content_copy.id)

    # 建立 Assignment
    assignment = Assignment(
        title=f"{content.title} - 即刻練習",
        description=None,
        classroom_id=request.classroom_id,  # None when from 我的教材
        teacher_id=current_teacher.id,
        is_active=True,
        is_instant_practice=True,
        practice_mode=request.practice_mode,
        time_limit_per_question=request.time_limit_per_question,
        shuffle_questions=request.shuffle_questions,
        show_answer=request.show_answer,
        play_audio=request.play_audio,
        show_translation=request.show_translation,
        show_word=request.show_word,
        show_image=request.show_image,
        show_option_images=bool(request.show_option_images),  # Issue #631
        score_category=resolve_score_category(
            request.practice_mode, request.play_audio
        ),
    )
    db.add(assignment)
    db.flush()

    # 建立 AssignmentContent 關聯
    assignment_content = AssignmentContent(
        assignment_id=assignment.id,
        content_id=content_copy.id,
        order_index=1,
    )
    db.add(assignment_content)
    db.flush()

    # 建立 StudentAssignment（老師作為作答者）
    student_assignment = StudentAssignment(
        assignment_id=assignment.id,
        student_id=None,  # 老師作答，非學生
        teacher_id=current_teacher.id,  # 記錄作答的老師
        classroom_id=request.classroom_id,  # 可為 None
        title=assignment.title,
        status=AssignmentStatus.NOT_STARTED,
        is_active=True,
    )
    db.add(student_assignment)
    db.flush()

    # 建立 StudentContentProgress
    content_progress = StudentContentProgress(
        student_assignment_id=student_assignment.id,
        content_id=content_copy.id,
        status=AssignmentStatus.NOT_STARTED,
        order_index=1,
        is_locked=False,
    )
    db.add(content_progress)
    db.flush()

    # 建立 StudentItemProgress（每個 ContentItem 一筆）
    copy_items = (
        db.query(ContentItem)
        .filter(ContentItem.content_id == content_copy.id)
        .order_by(ContentItem.order_index)
        .all()
    )
    for item in copy_items:
        item_progress = StudentItemProgress(
            student_assignment_id=student_assignment.id,
            content_item_id=item.id,
            status="NOT_STARTED",
        )
        db.add(item_progress)

    db.commit()

    return {
        "success": True,
        "assignment_id": assignment.id,
        "student_assignment_id": student_assignment.id,
        "content_title": content.title,
        "practice_mode": request.practice_mode,
    }


class InstantPracticeReconfigureRequest(BaseModel):
    """即刻練習練習畫面即時調整設定（改完從頭重練）"""

    practice_mode: Literal[
        "reading", "rearrangement", "word_reading", "word_selection", "tug_of_war"
    ]
    time_limit_per_question: Optional[int] = None
    shuffle_questions: bool = False
    show_answer: bool = False
    play_audio: bool = False
    show_translation: Optional[bool] = True
    show_word: Optional[bool] = True
    show_image: Optional[bool] = True
    show_option_images: Optional[bool] = False  # Issue #631
    target_proficiency: Optional[int] = None

    @model_validator(mode="after")
    def _option_images_xor_image(self) -> "InstantPracticeReconfigureRequest":
        if self.show_image and self.show_option_images:
            raise ValueError("show_image and show_option_images are mutually exclusive")
        return self


@router.patch("/instant-practice/{assignment_id}/reconfigure")
async def reconfigure_instant_practice(
    assignment_id: int,
    request: InstantPracticeReconfigureRequest,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """即時調整即刻練習設定，並把進度重設為從頭重練。

    僅限本人建立的即刻練習作業：
    - 更新進階設定，依 (practice_mode, play_audio) 重算 score_category
    - 切到 word_selection / tug_of_war 時，為複製出的 content 補齊干擾項
    - 重設 StudentAssignment / StudentContentProgress / StudentItemProgress
      狀態為 NOT_STARTED，達成「從頭重練」
    """
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.is_instant_practice.is_(True),
        )
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="Instant practice not found")
    if assignment.teacher_id != current_teacher.id:
        raise HTTPException(
            status_code=403, detail="You don't have permission for this practice"
        )

    # 更新進階設定
    assignment.practice_mode = request.practice_mode
    assignment.time_limit_per_question = request.time_limit_per_question
    assignment.shuffle_questions = request.shuffle_questions
    assignment.show_answer = request.show_answer
    assignment.play_audio = request.play_audio
    assignment.show_translation = request.show_translation
    assignment.show_word = request.show_word
    assignment.show_image = request.show_image
    assignment.show_option_images = bool(request.show_option_images)  # Issue #631
    if request.target_proficiency is not None:
        assignment.target_proficiency = request.target_proficiency
    assignment.score_category = resolve_score_category(
        request.practice_mode, request.play_audio
    )

    # 切到需要干擾項的模式時，為複製出的 content 補齊
    if request.practice_mode in ("word_selection", "tug_of_war"):
        content_ids = [
            ac.content_id
            for ac in db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment.id)
            .all()
        ]
        for content_id in content_ids:
            _ensure_distractors_for_content(db, content_id)

    # 從頭重練：重設進度狀態
    sa_ids = [
        sa.id
        for sa in db.query(StudentAssignment)
        .filter(StudentAssignment.assignment_id == assignment.id)
        .all()
    ]
    if sa_ids:
        db.query(StudentAssignment).filter(StudentAssignment.id.in_(sa_ids)).update(
            {"status": AssignmentStatus.NOT_STARTED}, synchronize_session=False
        )
        db.query(StudentContentProgress).filter(
            StudentContentProgress.student_assignment_id.in_(sa_ids)
        ).update({"status": AssignmentStatus.NOT_STARTED}, synchronize_session=False)
        db.query(StudentItemProgress).filter(
            StudentItemProgress.student_assignment_id.in_(sa_ids)
        ).update({"status": "NOT_STARTED"}, synchronize_session=False)

    db.commit()

    return {
        "success": True,
        "assignment_id": assignment.id,
        "practice_mode": assignment.practice_mode,
        "score_category": assignment.score_category,
    }
