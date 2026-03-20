"""
Instant Practice API - 即刻練習

Allows teachers to quickly practice content without creating a full assignment.
Creates a lightweight assignment marked as is_instant_practice=True.
Uses lazy cleanup: deletes old instant practice assignments before creating new ones.

Reuses all existing preview APIs for the actual practice experience.
"""

import logging
import random
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
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
)
from .dependencies import get_current_teacher

logger = logging.getLogger(__name__)

router = APIRouter()


class InstantPracticeRequest(BaseModel):
    """即刻練習請求"""

    content_id: int
    classroom_id: Optional[int] = None
    practice_mode: str = (
        "reading"  # reading, rearrangement, word_reading, word_selection
    )
    time_limit_per_question: Optional[int] = None
    shuffle_questions: bool = False
    show_answer: bool = False
    play_audio: bool = False
    show_translation: Optional[bool] = True
    show_word: Optional[bool] = True
    show_image: Optional[bool] = True


@router.post("/instant-practice/create")
async def create_instant_practice(
    request: InstantPracticeRequest,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    建立即刻練習作業

    - 懶清理：先刪除該老師的舊即刻練習作業
    - 建立新的 assignment (is_instant_practice=True)
    - 複製 content（重用既有邏輯）
    - 不建立 StudentAssignment（老師使用 preview API 練習）
    - 回傳 assignment_id，前端導向 preview 頁面
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

    # 驗證 Content 存在
    content = (
        db.query(Content)
        .options(selectinload(Content.content_items))
        .filter(Content.id == request.content_id)
        .first()
    )

    if not content:
        raise HTTPException(status_code=404, detail="Content not found")

    # 懶清理：刪除該老師的舊即刻練習作業及相關資料
    old_assignments = (
        db.query(Assignment)
        .filter(
            Assignment.teacher_id == current_teacher.id,
            Assignment.is_instant_practice.is_(True),
        )
        .all()
    )

    for old_assignment in old_assignments:
        # Delete related student assignments and progress (cascade should handle this,
        # but be explicit for safety)
        old_student_assignments = (
            db.query(StudentAssignment)
            .filter(StudentAssignment.assignment_id == old_assignment.id)
            .all()
        )
        for sa in old_student_assignments:
            db.query(StudentContentProgress).filter(
                StudentContentProgress.student_assignment_id == sa.id
            ).delete()
            db.query(StudentItemProgress).filter(
                StudentItemProgress.student_assignment_id == sa.id
            ).delete()
            db.delete(sa)

        # Collect copied content IDs before deleting AssignmentContent
        old_ac_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == old_assignment.id)
            .all()
        )
        copied_content_ids = [ac.content_id for ac in old_ac_contents]

        # Delete assignment contents
        db.query(AssignmentContent).filter(
            AssignmentContent.assignment_id == old_assignment.id
        ).delete()

        # Delete copied content and items
        for content_id in copied_content_ids:
            db.query(ContentItem).filter(ContentItem.content_id == content_id).delete()
            db.query(Content).filter(Content.id == content_id).delete()

        db.delete(old_assignment)

    db.flush()

    # 複製 Content 和 ContentItem（重用既有邏輯）
    content_copy = Content(
        lesson_id=content.lesson_id,
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

    # word_selection 模式：為缺少干擾項的 items 生成
    if request.practice_mode == "word_selection":
        all_items = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == content_copy.id)
            .filter(ContentItem.translation.isnot(None))
            .filter(ContentItem.translation != "")
            .order_by(ContentItem.order_index)
            .all()
        )
        all_translations = [item.translation for item in all_items]

        for item in all_items:
            if not isinstance(item.distractors, list) or len(item.distractors) == 0:
                candidates = [
                    t
                    for t in all_translations
                    if t.lower().strip() != item.translation.lower().strip()
                ]
                random.shuffle(candidates)
                item.distractors = candidates[:3]

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

    db.commit()

    return {
        "success": True,
        "assignment_id": assignment.id,
        "content_title": content.title,
        "practice_mode": request.practice_mode,
    }
