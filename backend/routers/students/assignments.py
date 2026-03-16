"""Student assignment management endpoints."""

import json
import logging
import math
import random
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload, contains_eager
from sqlalchemy import text, case, func

from database import get_db
from models import (
    Assignment,
    StudentAssignment,
    StudentContentProgress,
    AssignmentContent,
    Content,
    ContentItem,
    StudentItemProgress,
    AssignmentStatus,
    PracticeSession,
)
from services.quota_service import QuotaService
from .dependencies import get_current_student
from .validators import (
    PracticeWord,
    PracticeWordsResponse,
    RearrangementQuestionResponse,
    RearrangementAnswerRequest,
    RearrangementAnswerResponse,
    RearrangementRetryRequest,
    RearrangementCompleteRequest,
)

logger = logging.getLogger(__name__)

# 自動批改的練習模式（不需要老師批改）
# - rearrangement: 例句重組
# - word_selection: 單字選擇
AUTO_GRADED_MODES = frozenset({"rearrangement", "word_selection"})

router = APIRouter()


@router.get("/assignments")
async def get_student_assignments(
    sort_by: Literal[
        "due_date_asc", "due_date_desc", "assigned_at_desc", "status"
    ] = Query("due_date_asc"),
    practice_mode: Optional[
        Literal["reading", "rearrangement", "word_selection", "word_reading"]
    ] = None,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """取得學生作業列表"""
    student_id = current_student.get("sub")

    # Base query: always join Assignment to filter archived and eager-load
    query = (
        db.query(StudentAssignment)
        .join(Assignment, StudentAssignment.assignment_id == Assignment.id)
        .options(contains_eager(StudentAssignment.assignment))
        .filter(
            StudentAssignment.student_id == int(student_id),
            Assignment.is_archived.is_(False),
        )
    )

    # Filter by practice_mode
    if practice_mode:
        query = query.filter(Assignment.practice_mode == practice_mode)

    # Sorting
    if sort_by == "due_date_desc":
        query = query.order_by(StudentAssignment.due_date.desc().nullslast())
    elif sort_by == "assigned_at_desc":
        query = query.order_by(StudentAssignment.assigned_at.desc().nullslast())
    elif sort_by == "status":
        # Priority: returned > in_progress > not_started > submitted > resubmitted > graded
        status_order = case(
            (StudentAssignment.status == AssignmentStatus.RETURNED, 0),
            (StudentAssignment.status == AssignmentStatus.IN_PROGRESS, 1),
            (StudentAssignment.status == AssignmentStatus.NOT_STARTED, 2),
            (StudentAssignment.status == AssignmentStatus.SUBMITTED, 3),
            (StudentAssignment.status == AssignmentStatus.RESUBMITTED, 4),
            (StudentAssignment.status == AssignmentStatus.GRADED, 5),
            else_=6,
        )
        query = query.order_by(
            status_order, StudentAssignment.due_date.asc().nullslast()
        )
    else:
        # Default: due_date_asc (nearest deadline first)
        query = query.order_by(StudentAssignment.due_date.asc().nullslast())

    assignments = query.all()

    # Batch query: count content items per assignment to avoid N+1
    parent_ids = [sa.assignment_id for sa in assignments if sa.assignment_id]
    count_map: Dict[int, int] = {}
    if parent_ids:
        count_rows = (
            db.query(
                AssignmentContent.assignment_id,
                func.count(ContentItem.id),
            )
            .join(Content, AssignmentContent.content_id == Content.id)
            .join(ContentItem, ContentItem.content_id == Content.id)
            .filter(AssignmentContent.assignment_id.in_(parent_ids))
            .group_by(AssignmentContent.assignment_id)
            .all()
        )
        count_map = {row[0]: row[1] for row in count_rows}

    result = []
    for sa in assignments:
        # Get fields from parent Assignment
        parent = sa.assignment
        score_category = parent.score_category if parent else None
        p_mode = parent.practice_mode if parent else None
        content_count = count_map.get(parent.id, 0) if parent else 0

        result.append(
            {
                "id": sa.id,
                "title": sa.title,
                "status": sa.status.value if sa.status else "not_started",
                "due_date": sa.due_date.isoformat() if sa.due_date else None,
                "assigned_at": sa.assigned_at.isoformat() if sa.assigned_at else None,
                "submitted_at": sa.submitted_at.isoformat()
                if sa.submitted_at
                else None,
                "classroom_id": sa.classroom_id,
                "score": sa.score,
                "feedback": sa.feedback,
                "score_category": score_category,
                "practice_mode": p_mode,
                "content_count": content_count,
            }
        )

    return result


@router.get("/assignments/{assignment_id}/activities")
async def get_assignment_activities(
    assignment_id: int,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """取得作業的活動內容列表（題目）"""
    student_id = int(current_student.get("sub"))

    # 確認學生有這個作業
    student_assignment = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.id == assignment_id,
            StudentAssignment.student_id == student_id,
            StudentAssignment.is_active.is_(True),
        )
        .first()
    )

    if not student_assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assignment not found or not assigned to you",
        )

    # 獲取作業對應的 Assignment（如果有 assignment_id）
    activities = []

    if student_assignment.assignment_id:
        # 直接查詢這個學生作業的所有進度記錄（這才是正確的數據源）
        progress_records = (
            db.query(StudentContentProgress)
            .filter(
                StudentContentProgress.student_assignment_id == student_assignment.id
            )
            .order_by(StudentContentProgress.order_index)
            .all()
        )

        # 如果沒有 progress_records，自動創建
        if not progress_records:
            # 獲取作業的所有 assignment_contents
            assignment_contents = (
                db.query(AssignmentContent)
                .filter(
                    AssignmentContent.assignment_id == student_assignment.assignment_id
                )
                .order_by(AssignmentContent.order_index)
                .all()
            )

            # 為每個 assignment_content 創建 StudentContentProgress
            for idx, ac in enumerate(assignment_contents):
                progress = StudentContentProgress(
                    student_assignment_id=student_assignment.id,
                    content_id=ac.content_id,
                    status=AssignmentStatus.NOT_STARTED,
                    order_index=idx,
                )
                db.add(progress)
                progress_records.append(progress)

                # 同時創建 StudentItemProgress
                content_items = (
                    db.query(ContentItem)
                    .filter(ContentItem.content_id == ac.content_id)
                    .order_by(ContentItem.order_index)
                    .all()
                )

                for item in content_items:
                    item_progress = StudentItemProgress(
                        student_assignment_id=student_assignment.id,
                        content_item_id=item.id,
                        status="NOT_STARTED",
                    )
                    db.add(item_progress)

            # 提交到資料庫
            db.commit()

            # 重新查詢以獲取 ID
            progress_records = (
                db.query(StudentContentProgress)
                .filter(
                    StudentContentProgress.student_assignment_id
                    == student_assignment.id
                )
                .order_by(StudentContentProgress.order_index)
                .all()
            )

        # 優化：批次查詢所有 content，避免 N+1 問題
        content_ids = [progress.content_id for progress in progress_records]
        contents = db.query(Content).filter(Content.id.in_(content_ids)).all()
        content_dict = {content.id: content for content in contents}

        # 優化：預先批次查詢所有 ContentItems 和 StudentItemProgress
        # 避免在循環中對每個 content 都查詢一次（N+1 問題）
        all_content_items = (
            db.query(ContentItem)
            .filter(ContentItem.content_id.in_(content_ids))
            .order_by(ContentItem.content_id, ContentItem.order_index)
            .all()
        )

        # 建立 content_id -> [items] 的索引
        content_items_map = {}
        for ci in all_content_items:
            if ci.content_id not in content_items_map:
                content_items_map[ci.content_id] = []
            content_items_map[ci.content_id].append(ci)

        # 批次查詢所有 StudentItemProgress
        all_item_progress = (
            db.query(StudentItemProgress)
            .filter(StudentItemProgress.student_assignment_id == student_assignment.id)
            .all()
        )

        # 建立 content_item_id -> progress 的索引
        progress_by_item = {p.content_item_id: p for p in all_item_progress}

        for progress in progress_records:
            content = content_dict.get(progress.content_id)

            if content:
                # 將整個 content 作為一個活動，包含所有 items
                activity_data = {
                    "id": progress.id,
                    "content_id": content.id,
                    "order": len(activities) + 1,
                    "type": (
                        content.type.value if content.type else "reading_assessment"
                    ),
                    "title": content.title,
                    "duration": 60,  # Default duration
                    "points": (
                        100 // len(progress_records)
                        if len(progress_records) > 0
                        else 100
                    ),  # 平均分配分數
                    "status": (
                        progress.status.value if progress.status else "NOT_STARTED"
                    ),
                    "score": progress.score,
                    "completed_at": (
                        progress.completed_at.isoformat()
                        if progress.completed_at
                        else None
                    ),
                    # AI 評估結果現在統一在 activity_data["ai_assessments"] 陣列中處理
                }

                # 優化：從預先載入的 map 取得 ContentItems（不再查詢資料庫）
                content_items = content_items_map.get(content.id, [])

                if content_items:
                    # 使用 ContentItem 記錄（每個都有 ID）
                    items_with_ids = []
                    for ci in content_items:
                        item_progress = progress_by_item.get(ci.id)
                        item_data = {
                            "id": ci.id,  # ContentItem 的 ID！
                            "text": ci.text,
                            "translation": ci.translation,
                            "audio_url": ci.audio_url,
                            "order_index": ci.order_index,
                        }

                        # 如果有 progress 記錄，加入 AI 評估資料
                        if item_progress:
                            item_data["recording_url"] = item_progress.recording_url
                            item_data["status"] = item_progress.status
                            item_data[
                                "progress_id"
                            ] = item_progress.id  # 返回 progress_id 給前端用於批次分析

                            # 加入老師評語相關資料
                            item_data[
                                "teacher_feedback"
                            ] = item_progress.teacher_feedback
                            item_data["teacher_passed"] = item_progress.teacher_passed
                            item_data["teacher_review_score"] = (
                                float(item_progress.teacher_review_score)
                                if item_progress.teacher_review_score
                                else None
                            )
                            item_data["teacher_reviewed_at"] = (
                                item_progress.teacher_reviewed_at.isoformat()
                                if item_progress.teacher_reviewed_at
                                else None
                            )
                            item_data["review_status"] = item_progress.review_status

                            if (
                                item_progress.has_ai_assessment
                                and item_progress.ai_feedback
                            ):
                                # 從 ai_feedback JSON 中取得分數

                                try:
                                    ai_feedback = (
                                        json.loads(item_progress.ai_feedback)
                                        if isinstance(item_progress.ai_feedback, str)
                                        else item_progress.ai_feedback
                                    )
                                    item_data["ai_assessment"] = {
                                        "accuracy_score": float(
                                            ai_feedback.get("accuracy_score", 0)
                                        ),
                                        "fluency_score": float(
                                            ai_feedback.get("fluency_score", 0)
                                        ),
                                        "pronunciation_score": float(
                                            ai_feedback.get("pronunciation_score", 0)
                                        ),
                                        "completeness_score": float(
                                            ai_feedback.get("completeness_score", 0)
                                        ),
                                        "prosody_score": ai_feedback.get(
                                            "prosody_score"
                                        ),
                                        # 舊版相容性
                                        "word_details": ai_feedback.get(
                                            "word_details", []
                                        ),
                                        # 新版詳細分析資料
                                        "detailed_words": ai_feedback.get(
                                            "detailed_words", []
                                        ),
                                        "reference_text": ai_feedback.get(
                                            "reference_text", ""
                                        ),
                                        "recognized_text": ai_feedback.get(
                                            "recognized_text", ""
                                        ),
                                        "analysis_summary": ai_feedback.get(
                                            "analysis_summary", {}
                                        ),
                                        "ai_feedback": item_progress.ai_feedback,
                                        "assessed_at": item_progress.ai_assessed_at.isoformat()
                                        if item_progress.ai_assessed_at
                                        else None,
                                    }
                                except (json.JSONDecodeError, TypeError):
                                    # 如果 JSON 解析失敗，設為 None
                                    item_data["ai_assessment"] = None

                        items_with_ids.append(item_data)

                    activity_data["items"] = items_with_ids
                    activity_data["item_count"] = len(items_with_ids)
                else:
                    # 沒有 ContentItem 記錄的情況 - 返回空陣列
                    logger.warning("Content %s has no ContentItem records", content.id)
                    activity_data["items"] = []
                    activity_data["item_count"] = 0

                # 如果完全沒有項目，提供一個空的預設項目
                if not activity_data.get("items"):
                    single_item = {
                        "text": "",
                        "translation": "",
                    }
                    activity_data["items"] = [single_item]
                    activity_data["item_count"] = 1

                activity_data["content"] = ""
                activity_data["target_text"] = ""

                # 現在統一使用 StudentItemProgress 的資料，不再從 response_data 讀取
                # recordings 和 AI 評分都應該從 items 的 recording_url 和 ai_assessment 取得
                # 保留這些空陣列只是為了向後相容，未來應該移除
                activity_data["recordings"] = []
                activity_data["answers"] = (
                    progress.response_data.get("answers", [])
                    if progress.response_data
                    else []
                )
                activity_data["ai_assessments"] = []

                activities.append(activity_data)

    # 如果沒有活動，創建一個默認的朗讀活動
    if not activities:
        # 創建一個臨時的朗讀活動
        activities.append(
            {
                "id": 0,
                "content_id": 0,
                "order": 1,
                "type": "reading_assessment",
                "title": "朗讀測驗",
                "content": "Please read the following text aloud.",
                "target_text": (
                    "The quick brown fox jumps over the lazy dog. "
                    "This pangram contains all letters of the English alphabet."
                ),
                "duration": 60,
                "points": 100,
                "status": "NOT_STARTED",
                "score": None,
                "audio_url": None,
                "completed_at": None,
            }
        )

    # 更新作業狀態為進行中（如果還是未開始）
    if student_assignment.status == AssignmentStatus.NOT_STARTED:
        student_assignment.status = AssignmentStatus.IN_PROGRESS
        db.commit()

    # 獲取 Assignment 的 practice_mode 和 show_answer（用於前端路由）
    practice_mode = None
    show_answer = False
    score_category = None
    parent_assignment = None
    if student_assignment.assignment_id:
        parent_assignment = (
            db.query(Assignment)
            .filter(Assignment.id == student_assignment.assignment_id)
            .first()
        )
        if parent_assignment:
            practice_mode = parent_assignment.practice_mode
            show_answer = parent_assignment.show_answer or False
            score_category = parent_assignment.score_category

    # 檢查 AI 分析額度（根據作業所屬班級判斷：機構班級→機構點數，個人班級→個人配額）
    can_use_ai_analysis = (
        QuotaService.check_ai_analysis_availability_by_assignment(parent_assignment, db)
        if parent_assignment
        else True
    )

    return {
        "assignment_id": assignment_id,
        "title": student_assignment.title,
        "status": student_assignment.status.value,  # 返回作業狀態
        "practice_mode": practice_mode,  # 前端用來判斷顯示哪個元件
        "show_answer": show_answer,  # 例句重組：答題結束後是否顯示正確答案
        "score_category": score_category,  # 分數記錄分類
        "total_activities": len(activities),
        "activities": activities,
        "can_use_ai_analysis": can_use_ai_analysis,  # 根據工作區判斷的 AI 分析額度
    }


@router.post("/assignments/{assignment_id}/activities/{progress_id}/save")
async def save_activity_progress(
    assignment_id: int,
    progress_id: int,
    audio_url: Optional[str] = None,
    text_answer: Optional[str] = None,
    recordings: Optional[List[str]] = None,
    answers: Optional[List[str]] = None,
    user_answers: Optional[List[str]] = None,
    item_index: Optional[int] = None,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """儲存活動進度（自動儲存）"""
    student_id = int(current_student.get("sub"))

    # 確認學生有這個作業
    student_assignment = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.id == assignment_id,
            StudentAssignment.student_id == student_id,
        )
        .first()
    )

    if not student_assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found"
        )

    # 獲取並更新進度記錄
    progress = (
        db.query(StudentContentProgress)
        .filter(
            StudentContentProgress.id == progress_id,
            StudentContentProgress.student_assignment_id == student_assignment.id,
        )
        .first()
    )

    if not progress:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Activity progress not found"
        )

    # 更新進度 - 使用 response_data JSON 欄位儲存所有資料
    if not progress.response_data:
        progress.response_data = {}

    # 更新各種類型的資料
    if audio_url:
        progress.response_data["audio_url"] = audio_url
    if text_answer:
        progress.response_data["text_answer"] = text_answer
    if recordings:
        progress.response_data["recordings"] = recordings
    if answers:
        progress.response_data["answers"] = answers
    if user_answers:
        progress.response_data["user_answers"] = user_answers
    if item_index is not None:
        progress.response_data["item_index"] = item_index

    # 標記 JSON 欄位已修改，確保 SQLAlchemy 偵測到變更
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(progress, "response_data")

    # 更新狀態
    if progress.status == AssignmentStatus.NOT_STARTED:
        progress.status = AssignmentStatus.IN_PROGRESS

    db.commit()

    return {"message": "Progress saved successfully"}


@router.post("/assignments/{assignment_id}/submit")
async def submit_assignment(
    assignment_id: int,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """提交作業"""
    student_id = int(current_student.get("sub"))

    # 確認學生有這個作業
    student_assignment = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.id == assignment_id,
            StudentAssignment.student_id == student_id,
        )
        .first()
    )

    if not student_assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found"
        )

    # 取得作業的 practice_mode 來判斷是否為自動批改類型
    # 自動批改類型：rearrangement（例句重組）、word_selection（單字選擇）
    # 手動批改類型：reading（例句朗讀）、word_reading（單字朗讀）
    practice_mode = None
    if student_assignment.assignment_id:
        assignment = (
            db.query(Assignment)
            .filter(Assignment.id == student_assignment.assignment_id)
            .first()
        )
        if assignment:
            practice_mode = assignment.practice_mode

    # 判斷是否為自動批改類型
    is_auto_graded = practice_mode in AUTO_GRADED_MODES

    # 更新所有進度為已完成
    progress_records = (
        db.query(StudentContentProgress)
        .filter(StudentContentProgress.student_assignment_id == student_assignment.id)
        .all()
    )

    for progress in progress_records:
        if progress.status == AssignmentStatus.IN_PROGRESS:
            # 自動批改類型直接標記為 GRADED，手動批改類型標記為 SUBMITTED
            progress.status = (
                AssignmentStatus.GRADED
                if is_auto_graded
                else AssignmentStatus.SUBMITTED
            )
            progress.completed_at = datetime.now(timezone.utc)

    # 更新作業狀態
    # Issue #165: 例句重組和單字選擇為自動批改，提交後直接標記為 GRADED（已完成）
    # 例句朗讀和單字朗讀需要老師批改，標記為 SUBMITTED（已提交）
    if is_auto_graded:
        student_assignment.status = AssignmentStatus.GRADED
        student_assignment.graded_at = datetime.now(timezone.utc)

        # Issue #165: 計算並儲存自動批改的總分
        if practice_mode == "rearrangement":
            # 例句重組：從 StudentItemProgress.expected_score 計算平均分
            # 注意：只計算有分數的記錄，忽略 NULL 值（避免拉低平均分）
            item_progress_records = (
                db.query(StudentItemProgress)
                .filter(
                    StudentItemProgress.student_assignment_id == student_assignment.id
                )
                .all()
            )
            # 過濾掉 NULL 值，只計算有效分數
            valid_scores = [
                float(p.expected_score)
                for p in item_progress_records
                if p.expected_score is not None
            ]
            if valid_scores:
                student_assignment.score = sum(valid_scores) / len(valid_scores)
            else:
                student_assignment.score = 0
        elif practice_mode == "word_selection":
            # 單字選擇：使用 calculate_assignment_mastery 函數計算
            result = db.execute(
                text("SELECT * FROM calculate_assignment_mastery(:sa_id)"),
                {"sa_id": student_assignment.id},
            ).fetchone()
            if result:
                current_mastery = float(result.current_mastery) * 100
                student_assignment.score = min(100, int(current_mastery))
            else:
                student_assignment.score = 0
    else:
        student_assignment.status = AssignmentStatus.SUBMITTED
    student_assignment.submitted_at = datetime.now(timezone.utc)

    db.commit()

    return {
        "message": "Assignment submitted successfully",
        "submitted_at": student_assignment.submitted_at.isoformat(),
        "status": student_assignment.status.value,
        "is_auto_graded": is_auto_graded,
        "score": student_assignment.score if is_auto_graded else None,
    }


# =============================================================================
# Practice Words API (艾賓浩斯記憶曲線)
# =============================================================================


@router.get(
    "/assignments/{student_assignment_id}/practice-words",
    response_model=PracticeWordsResponse,
)
async def get_practice_words(
    student_assignment_id: int,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """
    獲取練習題目（10個單字）
    - 根據艾賓浩斯記憶曲線智能選擇單字
    - 優先選擇即將遺忘或從未練習的單字
    """
    student_id = current_student.get("sub")

    # 1. 取得學生作業實例
    student_assignment = (
        db.query(StudentAssignment)
        .join(Assignment)
        .filter(
            StudentAssignment.id == student_assignment_id,
            StudentAssignment.student_id == int(student_id),
        )
        .first()
    )

    if not student_assignment:
        raise HTTPException(status_code=404, detail="Student assignment not found")

    # 2. 創建新的練習 session
    assignment = student_assignment.assignment

    # 確保 practice_mode 是正確的字串值
    answer_mode_value = assignment.answer_mode
    if answer_mode_value is None:
        answer_mode_value = "listening"  # default

    if isinstance(answer_mode_value, str):
        practice_mode_str = answer_mode_value.lower()
    else:
        try:
            practice_mode_str = answer_mode_value.value
        except AttributeError:
            practice_mode_str = "listening"

    practice_session = PracticeSession(
        student_id=int(student_id),
        student_assignment_id=student_assignment.id,
        practice_mode=practice_mode_str,
    )
    db.add(practice_session)
    db.commit()
    db.refresh(practice_session)

    # 3. 使用 SQL function 選擇 10 個單字
    result = db.execute(
        text(
            """
            SELECT * FROM get_words_for_practice(
                :student_assignment_id,
                :limit_count
            )
        """
        ),
        {"student_assignment_id": student_assignment.id, "limit_count": 10},
    )

    words = []
    for row in result:
        words.append(
            PracticeWord(
                content_item_id=row[0],
                text=row[1] or "",
                translation=row[2] or "",
                example_sentence=row[3] or "",
                example_sentence_translation=row[4] or "",
                audio_url=row[5] or "",
                memory_strength=float(row[6]) if row[6] else 0.0,
                priority_score=float(row[7]) if row[7] else 0.0,
            )
        )

    return PracticeWordsResponse(
        session_id=practice_session.id,
        answer_mode=answer_mode_value
        if isinstance(answer_mode_value, str)
        else answer_mode_value.value
        if hasattr(answer_mode_value, "value")
        else "listening",
        words=words,
    )


# =============================================================================
# Vocabulary Word Reading APIs
# =============================================================================


@router.get("/assignments/{assignment_id}/vocabulary/activities")
async def get_vocabulary_activities(
    assignment_id: int,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """
    Get vocabulary word reading activities for an assignment.

    Returns all words from the assignment's content with their progress status.
    """
    student_id = int(current_student.get("sub"))

    # Verify student has this assignment
    student_assignment = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.id == assignment_id,
            StudentAssignment.student_id == student_id,
            StudentAssignment.is_active.is_(True),
        )
        .first()
    )

    if not student_assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assignment not found or not assigned to you",
        )

    # Get the Assignment to check practice_mode
    assignment = None
    if student_assignment.assignment_id:
        assignment = (
            db.query(Assignment)
            .filter(Assignment.id == student_assignment.assignment_id)
            .first()
        )

    # Verify this is a word_reading assignment
    if assignment and assignment.practice_mode != "word_reading":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This is not a word reading assignment",
        )

    # Get all content items for this assignment
    items = []

    if student_assignment.assignment_id:
        # Get assignment contents
        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == student_assignment.assignment_id)
            .order_by(AssignmentContent.order_index)
            .all()
        )

        content_ids = [ac.content_id for ac in assignment_contents]

        # Get all ContentItems
        content_items = (
            db.query(ContentItem)
            .filter(ContentItem.content_id.in_(content_ids))
            .order_by(ContentItem.content_id, ContentItem.order_index)
            .all()
        )

        # Get all StudentItemProgress for this assignment
        all_progress = (
            db.query(StudentItemProgress)
            .filter(StudentItemProgress.student_assignment_id == student_assignment.id)
            .all()
        )
        progress_by_item = {p.content_item_id: p for p in all_progress}

        # Build items list
        for ci in content_items:
            progress = progress_by_item.get(ci.id)

            item_data = {
                "id": ci.id,
                "text": ci.text,
                "translation": ci.translation,
                "audio_url": ci.audio_url,
                "image_url": ci.image_url,
                "part_of_speech": ci.part_of_speech,
                "order_index": ci.order_index,
            }

            if progress:
                item_data["progress_id"] = progress.id
                item_data["recording_url"] = progress.recording_url
                item_data["status"] = progress.status

                # AI Assessment scores
                if progress.ai_assessed_at:
                    item_data["ai_assessment"] = {
                        "accuracy_score": (
                            float(progress.accuracy_score)
                            if progress.accuracy_score
                            else None
                        ),
                        "fluency_score": (
                            float(progress.fluency_score)
                            if progress.fluency_score
                            else None
                        ),
                        "completeness_score": (
                            float(progress.completeness_score)
                            if progress.completeness_score
                            else None
                        ),
                        "pronunciation_score": (
                            float(progress.pronunciation_score)
                            if progress.pronunciation_score
                            else None
                        ),
                    }

                # Teacher review
                if progress.teacher_reviewed_at:
                    item_data["teacher_feedback"] = progress.teacher_feedback
                    item_data["teacher_passed"] = progress.teacher_passed
                    item_data["teacher_review_score"] = (
                        float(progress.teacher_review_score)
                        if progress.teacher_review_score
                        else None
                    )
                    item_data["review_status"] = progress.review_status

            items.append(item_data)

    # Get assignment settings
    show_translation = assignment.show_translation if assignment else True
    show_image = assignment.show_image if assignment else True

    # 檢查 AI 分析額度（根據作業所屬班級判斷：機構班級→機構點數，個人班級→個人配額）
    can_use_ai_analysis = (
        QuotaService.check_ai_analysis_availability_by_assignment(assignment, db)
        if assignment
        else True
    )

    return {
        "assignment_id": assignment_id,
        "title": student_assignment.title,
        "status": student_assignment.status.value,
        "practice_mode": "word_reading",
        "show_translation": show_translation,
        "show_image": show_image,
        "total_items": len(items),
        "items": items,
        "can_use_ai_analysis": can_use_ai_analysis,  # 根據工作區判斷的 AI 分析額度
    }


class SaveAssessmentRequest(BaseModel):
    progress_id: int
    ai_assessment: Dict[str, Any]


@router.post("/assignments/{assignment_id}/vocabulary/save-assessment")
async def save_vocabulary_assessment(
    assignment_id: int,
    request: SaveAssessmentRequest,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """
    Save AI assessment result for a vocabulary item.
    """
    student_id = int(current_student.get("sub"))

    # Verify student has this assignment
    student_assignment = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.id == assignment_id,
            StudentAssignment.student_id == student_id,
            StudentAssignment.is_active.is_(True),
        )
        .first()
    )

    if not student_assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assignment not found or not assigned to you",
        )

    # Find the progress record and verify the content item belongs to this assignment
    progress = (
        db.query(StudentItemProgress)
        .join(ContentItem, StudentItemProgress.content_item_id == ContentItem.id)
        .join(Content, ContentItem.content_id == Content.id)
        .join(AssignmentContent, AssignmentContent.content_id == Content.id)
        .filter(
            StudentItemProgress.id == request.progress_id,
            StudentItemProgress.student_assignment_id == assignment_id,
            AssignmentContent.assignment_id == student_assignment.assignment_id,
        )
        .first()
    )

    if not progress:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Progress record not found",
        )

    # Update assessment scores
    ai = request.ai_assessment
    progress.accuracy_score = ai.get("accuracy_score")
    progress.fluency_score = ai.get("fluency_score")
    progress.completeness_score = ai.get("completeness_score")
    progress.pronunciation_score = ai.get("pronunciation_score")
    progress.ai_assessed_at = datetime.now(timezone.utc)
    progress.ai_feedback = json.dumps(ai)

    db.commit()

    return {
        "success": True,
        "progress_id": progress.id,
        "message": "Assessment saved successfully",
    }


@router.post("/assignments/{assignment_id}/vocabulary/submit")
async def submit_vocabulary_assignment(
    assignment_id: int,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """
    Submit a vocabulary word reading assignment.

    Marks the assignment as SUBMITTED for teacher review.
    """
    student_id = int(current_student.get("sub"))

    # Verify student has this assignment
    student_assignment = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.id == assignment_id,
            StudentAssignment.student_id == student_id,
            StudentAssignment.is_active.is_(True),
        )
        .first()
    )

    if not student_assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assignment not found or not assigned to you",
        )

    # Check if already submitted
    if student_assignment.status in [
        AssignmentStatus.SUBMITTED,
        AssignmentStatus.GRADED,
    ]:
        return {
            "success": True,
            "message": "Assignment already submitted",
            "status": student_assignment.status.value,
        }

    # Update assignment status
    student_assignment.status = AssignmentStatus.SUBMITTED
    student_assignment.submitted_at = datetime.now(timezone.utc)

    # Update all item progress to SUBMITTED status
    db.query(StudentItemProgress).filter(
        StudentItemProgress.student_assignment_id == assignment_id
    ).update({"status": "SUBMITTED", "review_status": "PENDING"})

    db.commit()

    return {
        "success": True,
        "message": "Assignment submitted successfully",
        "status": "SUBMITTED",
        "submitted_at": student_assignment.submitted_at.isoformat(),
    }


# =============================================================================
# Phase 2-3: Vocabulary Set - Word Selection APIs
# =============================================================================


class WordSelectionStartResponse(BaseModel):
    session_id: int
    words: List[Dict[str, Any]]
    total_words: int
    current_proficiency: float
    target_proficiency: int


class WordSelectionAnswerRequest(BaseModel):
    content_item_id: int
    selected_answer: str
    is_correct: bool
    time_spent_seconds: int = 0


class WordSelectionAnswerResponse(BaseModel):
    success: bool
    is_correct: bool
    correct_answer: str
    new_memory_strength: float
    message: str


@router.get("/assignments/{assignment_id}/vocabulary/selection/start")
async def start_word_selection_practice(
    assignment_id: int,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """
    Start a new word selection practice session.

    Returns 10 words selected by the intelligent get_words_for_practice function,
    each with 3 distractors from the word set plus the correct answer.
    """
    student_id = int(current_student.get("sub"))

    # Verify student has this assignment
    student_assignment = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.id == assignment_id,
            StudentAssignment.student_id == student_id,
            StudentAssignment.is_active.is_(True),
        )
        .first()
    )

    if not student_assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assignment not found or not assigned to you",
        )

    # Get the Assignment to check practice_mode
    assignment = None
    if student_assignment.assignment_id:
        assignment = (
            db.query(Assignment)
            .filter(Assignment.id == student_assignment.assignment_id)
            .first()
        )

    # Verify this is a word_selection assignment
    if assignment and assignment.practice_mode != "word_selection":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This is not a word selection assignment",
        )

    # Update assignment status to IN_PROGRESS if not started
    if student_assignment.status == AssignmentStatus.NOT_STARTED:
        student_assignment.status = AssignmentStatus.IN_PROGRESS
        student_assignment.started_at = datetime.now(timezone.utc)
        db.commit()

    # Get target proficiency from assignment (default 80%)
    target_proficiency = assignment.target_proficiency if assignment else 80

    # Get total words in assignment
    total_words_result = db.execute(
        text(
            """
            SELECT COUNT(DISTINCT ci.id) as total_count
            FROM student_content_progress scp
            JOIN content_items ci ON ci.content_id = scp.content_id
            WHERE scp.student_assignment_id = :sa_id
        """
        ),
        {"sa_id": assignment_id},
    ).fetchone()
    total_words_in_assignment = (
        total_words_result.total_count if total_words_result else 0
    )

    # Fallback if no progress records yet
    if total_words_in_assignment == 0:
        fallback_count = db.execute(
            text(
                """
                SELECT COUNT(DISTINCT ci.id) as total_count
                FROM assignment_contents ac
                JOIN content_items ci ON ci.content_id = ac.content_id
                WHERE ac.assignment_id = :assignment_id
            """
            ),
            {"assignment_id": student_assignment.assignment_id},
        ).fetchone()
        total_words_in_assignment = fallback_count.total_count if fallback_count else 0

    # Call get_words_for_practice PostgreSQL function
    words_result = db.execute(
        text("SELECT * FROM get_words_for_practice(:sa_id, :limit_count)"),
        {"sa_id": assignment_id, "limit_count": 10},
    ).fetchall()

    if not words_result:
        # No words found - get all content items directly
        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == student_assignment.assignment_id)
            .all()
        )
        content_ids = [ac.content_id for ac in assignment_contents]

        content_items = (
            db.query(ContentItem)
            .filter(ContentItem.content_id.in_(content_ids))
            .limit(10)
            .all()
        )

        if not content_items:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No vocabulary items found for this assignment",
            )

        # Build words list from content items
        words_data = []
        for ci in content_items:
            words_data.append(
                {
                    "content_item_id": ci.id,
                    "text": ci.text,
                    "translation": ci.translation or "",
                    "audio_url": ci.audio_url,
                    "image_url": ci.image_url,
                    "memory_strength": 0,
                }
            )
    else:
        # Build words list from function result
        words_data = []
        for row in words_result:
            words_data.append(
                {
                    "content_item_id": row.content_item_id,
                    "text": row.text,
                    "translation": row.translation or "",
                    "audio_url": row.audio_url,
                    "image_url": getattr(row, "image_url", None),
                    "memory_strength": float(row.memory_strength)
                    if row.memory_strength
                    else 0,
                }
            )

    # Create practice session
    practice_session = PracticeSession(
        student_id=student_id,
        student_assignment_id=assignment_id,
        practice_mode="word_selection",
        words_practiced=0,
        correct_count=0,
        started_at=datetime.now(timezone.utc),
    )
    db.add(practice_session)
    db.commit()
    db.refresh(practice_session)

    # Build response with words and their options
    words_with_options = []

    # Collect all unique translations for picking distractors from the word set
    all_translations = {
        w["translation"].lower().strip(): w["translation"]
        for w in words_data
        if w["translation"]
    }

    # Query stored AI distractors from DB
    content_item_ids = [w["content_item_id"] for w in words_data]
    items_with_distractors = (
        db.query(ContentItem).filter(ContentItem.id.in_(content_item_ids)).all()
    )
    distractors_map = {item.id: item.distractors for item in items_with_distractors}

    for i, word in enumerate(words_data):
        correct_answer = word["translation"]
        stored_distractors = distractors_map.get(word["content_item_id"])

        if isinstance(stored_distractors, list) and len(stored_distractors) >= 3:
            # 使用已儲存的干擾項（來自同作業其他單字翻譯）
            final_distractors = list(stored_distractors[:3])
        else:
            # Fallback: 從其他單字翻譯取
            other_translations = [
                t
                for key, t in all_translations.items()
                if key != correct_answer.lower().strip()
            ]
            random.shuffle(other_translations)
            final_distractors = other_translations[:3]

        # Fallback for small word sets
        num_needed = 3 - len(final_distractors)
        for j in range(num_needed):
            final_distractors.append(f"選項{chr(65 + j)}")

        # Create options array with correct answer and 3 distractors = 4 total
        options = [correct_answer] + final_distractors
        random.shuffle(options)

        words_with_options.append(
            {
                "content_item_id": word["content_item_id"],
                "text": word["text"],
                "translation": correct_answer,
                "audio_url": word.get("audio_url"),
                "image_url": word.get("image_url"),
                "memory_strength": word.get("memory_strength", 0),
                "options": options,
            }
        )

    # Get current proficiency
    mastery_result = db.execute(
        text("SELECT * FROM calculate_assignment_mastery(:sa_id)"),
        {"sa_id": assignment_id},
    ).fetchone()

    current_proficiency = (
        float(mastery_result.current_mastery) * 100 if mastery_result else 0
    )
    words_mastered = int(mastery_result.words_mastered) if mastery_result else 0
    achieved = bool(mastery_result.achieved) if mastery_result else False

    return {
        "session_id": practice_session.id,
        "words": words_with_options,
        "total_words": total_words_in_assignment,
        "current_proficiency": current_proficiency,
        "target_proficiency": target_proficiency,
        "words_mastered": words_mastered,
        "achieved": achieved,
        "show_word": assignment.show_word if assignment else True,
        "show_image": assignment.show_image if assignment else True,
        "play_audio": assignment.play_audio if assignment else False,
        "time_limit_per_question": (
            assignment.time_limit_per_question if assignment else None
        ),
    }


@router.post("/assignments/{assignment_id}/vocabulary/selection/answer")
async def submit_word_selection_answer(
    assignment_id: int,
    request: WordSelectionAnswerRequest,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """
    Submit an answer for a word selection question.

    Calls update_memory_strength() to update proficiency based on the answer.
    """
    student_id = int(current_student.get("sub"))

    # Verify student has this assignment
    student_assignment = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.id == assignment_id,
            StudentAssignment.student_id == student_id,
            StudentAssignment.is_active.is_(True),
        )
        .first()
    )

    if not student_assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assignment not found or not assigned to you",
        )

    # Get the correct answer from content item (verify it belongs to this assignment)
    content_item = (
        db.query(ContentItem)
        .join(Content, ContentItem.content_id == Content.id)
        .join(AssignmentContent, AssignmentContent.content_id == Content.id)
        .filter(
            ContentItem.id == request.content_item_id,
            AssignmentContent.assignment_id == student_assignment.assignment_id,
        )
        .first()
    )

    if not content_item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Content item not found",
        )

    correct_answer = content_item.translation or ""

    # 伺服器端驗證答案正確性（不信任客戶端的 is_correct）
    is_correct = request.selected_answer.strip() == correct_answer.strip()

    # Call update_memory_strength PostgreSQL function
    result = db.execute(
        text(
            """
            SELECT * FROM update_memory_strength(
                :sa_id,
                :item_id,
                :is_correct
            )
            """
        ),
        {
            "sa_id": assignment_id,
            "item_id": request.content_item_id,
            "is_correct": is_correct,
        },
    ).fetchone()

    new_memory_strength = float(result.memory_strength) if result else 0

    # Sync assignment status after each answer
    mastery_result = db.execute(
        text("SELECT * FROM calculate_assignment_mastery(:sa_id)"),
        {"sa_id": assignment_id},
    ).fetchone()

    if mastery_result:
        current_mastery = float(mastery_result.current_mastery)
        target_mastery = float(mastery_result.target_mastery)
        achieved = current_mastery >= target_mastery

        # Sync status based on mastery
        if achieved:
            student_assignment.score = min(100.0, current_mastery * 100)
            if student_assignment.status != AssignmentStatus.GRADED:
                student_assignment.status = AssignmentStatus.GRADED
                student_assignment.submitted_at = datetime.now(timezone.utc)
        else:
            # If was GRADED but now below target, change back to IN_PROGRESS
            if student_assignment.status == AssignmentStatus.GRADED:
                student_assignment.status = AssignmentStatus.IN_PROGRESS
                student_assignment.submitted_at = None
                student_assignment.score = None

    db.commit()

    return {
        "success": True,
        "is_correct": is_correct,
        "correct_answer": correct_answer,
        "new_memory_strength": new_memory_strength,
        "message": "正確！" if is_correct else f"正確答案是: {correct_answer}",
    }


@router.get("/assignments/{assignment_id}/vocabulary/selection/proficiency")
async def get_word_selection_proficiency(
    assignment_id: int,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """
    Get current proficiency status for word selection assignment.

    Returns current mastery percentage, target, and whether achieved.
    """
    student_id = int(current_student.get("sub"))

    # Verify student has this assignment
    student_assignment = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.id == assignment_id,
            StudentAssignment.student_id == student_id,
            StudentAssignment.is_active.is_(True),
        )
        .first()
    )

    if not student_assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assignment not found or not assigned to you",
        )

    # Get the Assignment for target_proficiency
    assignment = None
    if student_assignment.assignment_id:
        assignment = (
            db.query(Assignment)
            .filter(Assignment.id == student_assignment.assignment_id)
            .first()
        )

    target_proficiency = assignment.target_proficiency if assignment else 80

    # Call calculate_assignment_mastery PostgreSQL function
    result = db.execute(
        text("SELECT * FROM calculate_assignment_mastery(:sa_id)"),
        {"sa_id": assignment_id},
    ).fetchone()

    if not result:
        return {
            "current_mastery": 0,
            "target_mastery": target_proficiency,
            "achieved": False,
            "words_mastered": 0,
            "total_words": 0,
        }

    current_mastery = float(result.current_mastery) * 100  # Convert to percentage
    achieved = current_mastery >= target_proficiency

    return {
        "current_mastery": current_mastery,
        "target_mastery": target_proficiency,
        "achieved": achieved,
        "words_mastered": result.words_mastered,
        "total_words": result.total_words,
    }


@router.post("/assignments/{assignment_id}/vocabulary/selection/complete")
async def complete_word_selection_assignment(
    assignment_id: int,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """
    Mark word selection assignment as completed.

    Called when student reaches target proficiency and clicks "Close" button.
    """
    student_id = int(current_student.get("sub"))

    # Verify student has this assignment
    student_assignment = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.id == assignment_id,
            StudentAssignment.student_id == student_id,
            StudentAssignment.is_active.is_(True),
        )
        .first()
    )

    if not student_assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assignment not found or not assigned to you",
        )

    # Get current proficiency to verify achievement
    result = db.execute(
        text("SELECT * FROM calculate_assignment_mastery(:sa_id)"),
        {"sa_id": assignment_id},
    ).fetchone()

    # Get target proficiency
    assignment = None
    if student_assignment.assignment_id:
        assignment = (
            db.query(Assignment)
            .filter(Assignment.id == student_assignment.assignment_id)
            .first()
        )

    target_proficiency = assignment.target_proficiency if assignment else 80
    current_mastery = float(result.current_mastery) * 100 if result else 0

    # Update assignment status to COMPLETED
    student_assignment.status = (
        AssignmentStatus.GRADED
    )  # GRADED = completed for auto-graded
    student_assignment.submitted_at = datetime.now(timezone.utc)

    # Calculate final score based on mastery
    # Issue #165: Fix - use 'score' column instead of non-existent 'final_score'
    student_assignment.score = min(100, int(current_mastery))

    db.commit()

    return {
        "success": True,
        "message": "作業已完成！",
        "status": "COMPLETED",
        "final_score": student_assignment.score,
        "achieved_target": current_mastery >= target_proficiency,
    }


# =============================================================================
# 例句重組 (Rearrangement) APIs
# =============================================================================


@router.get("/assignments/{assignment_id}/rearrangement-questions")
async def get_rearrangement_questions(
    assignment_id: int,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """取得例句重組題目列表"""
    student_id = int(current_student.get("sub"))

    # 驗證學生作業存在（assignment_id 實際上是 StudentAssignment.id）
    student_assignment = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.id == assignment_id,
            StudentAssignment.student_id == student_id,
        )
        .first()
    )

    if not student_assignment:
        raise HTTPException(status_code=404, detail="Student assignment not found")

    # 取得作業設定
    assignment = (
        db.query(Assignment)
        .filter(Assignment.id == student_assignment.assignment_id)
        .first()
    )

    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # 確認是例句重組模式
    if assignment.practice_mode != "rearrangement":
        raise HTTPException(
            status_code=400, detail="This assignment is not in rearrangement mode"
        )

    # 取得所有內容項目
    content_items = (
        db.query(ContentItem)
        .join(Content)
        .join(AssignmentContent)
        .filter(AssignmentContent.assignment_id == assignment.id)
        .order_by(ContentItem.order_index)
        .all()
    )

    # 如果需要打亂順序
    if assignment.shuffle_questions:
        random.shuffle(content_items)

    questions = []
    for item in content_items:
        # 打亂單字順序
        words = item.text.strip().split()
        shuffled_words = words.copy()
        random.shuffle(shuffled_words)

        questions.append(
            RearrangementQuestionResponse(
                content_item_id=item.id,
                shuffled_words=shuffled_words,
                word_count=item.word_count or len(words),
                max_errors=item.max_errors or (3 if len(words) <= 10 else 5),
                time_limit=(
                    assignment.time_limit_per_question
                    if assignment.time_limit_per_question is not None
                    else 30
                ),
                play_audio=assignment.play_audio or False,
                audio_url=item.audio_url,
                translation=item.translation,
                original_text=item.text.strip(),  # 正確答案
            )
        )

    return {
        "student_assignment_id": assignment_id,
        "practice_mode": "rearrangement",
        "score_category": assignment.score_category,
        "questions": questions,
        "total_questions": len(questions),
    }


@router.post("/assignments/{assignment_id}/rearrangement-answer")
async def submit_rearrangement_answer(
    assignment_id: int,
    request: RearrangementAnswerRequest,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """提交例句重組答案"""

    student_id = int(current_student.get("sub"))

    # 驗證學生作業存在（assignment_id 實際上是 StudentAssignment.id）
    student_assignment = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.id == assignment_id,
            StudentAssignment.student_id == student_id,
        )
        .first()
    )

    if not student_assignment:
        raise HTTPException(status_code=404, detail="Student assignment not found")

    # 取得內容項目
    content_item = (
        db.query(ContentItem).filter(ContentItem.id == request.content_item_id).first()
    )

    if not content_item:
        raise HTTPException(status_code=404, detail="Content item not found")

    # 取得或建立進度記錄
    progress = (
        db.query(StudentItemProgress)
        .filter(
            StudentItemProgress.student_assignment_id == assignment_id,
            StudentItemProgress.content_item_id == request.content_item_id,
        )
        .first()
    )

    if not progress:
        progress = StudentItemProgress(
            student_assignment_id=assignment_id,
            content_item_id=request.content_item_id,
            status="IN_PROGRESS",
            error_count=0,
            correct_word_count=0,
            expected_score=100.0,
            rearrangement_data={"selections": []},
        )
        db.add(progress)
        db.flush()

    # 解析正確答案
    correct_words = content_item.text.strip().split()
    word_count = len(correct_words)
    max_errors = content_item.max_errors or (3 if word_count <= 10 else 5)
    points_per_word = math.floor(100 / word_count)

    # 檢查答案是否正確
    current_position = request.current_position
    if current_position >= word_count:
        raise HTTPException(status_code=400, detail="Invalid position")

    correct_word = correct_words[current_position]
    is_correct = request.selected_word.strip() == correct_word.strip()

    # 更新進度
    if is_correct:
        progress.correct_word_count = current_position + 1
    else:
        progress.error_count = (progress.error_count or 0) + 1

    # 計算 expected_score
    progress.expected_score = max(
        0, 100 - ((progress.error_count or 0) * points_per_word)
    )

    # 記錄選擇歷史
    selections = (
        progress.rearrangement_data.get("selections", [])
        if progress.rearrangement_data
        else []
    )
    selections.append(
        {
            "position": current_position,
            "selected": request.selected_word,
            "correct": correct_word,
            "is_correct": is_correct,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )
    progress.rearrangement_data = {"selections": selections}

    # 檢查是否達到錯誤上限
    challenge_failed = progress.error_count >= max_errors

    # 檢查是否完成
    completed = progress.correct_word_count >= word_count

    if completed:
        progress.status = "COMPLETED"
        # 確保保底分（完成作答最低分）
        assignment = (
            db.query(Assignment)
            .filter(Assignment.id == student_assignment.assignment_id)
            .first()
        )
        if assignment:
            # 取得總題數
            total_items = (
                db.query(ContentItem)
                .join(Content)
                .join(AssignmentContent)
                .filter(AssignmentContent.assignment_id == assignment.id)
                .count()
            )
            min_score = math.floor(100 / total_items) if total_items > 0 else 1
            progress.expected_score = max(
                float(progress.expected_score or 0), min_score
            )

    db.commit()

    return RearrangementAnswerResponse(
        is_correct=is_correct,
        correct_word=correct_word if not is_correct else None,
        error_count=progress.error_count or 0,
        max_errors=max_errors,
        expected_score=float(progress.expected_score or 0),
        correct_word_count=progress.correct_word_count or 0,
        total_word_count=word_count,
        challenge_failed=challenge_failed,
        completed=completed,
    )


@router.post("/assignments/{student_assignment_id}/rearrangement-retry")
async def retry_rearrangement(
    student_assignment_id: int,
    request: RearrangementRetryRequest,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """重新挑戰題目（重置分數）"""
    student_id = int(current_student.get("sub"))

    # 驗證學生作業存在
    student_assignment = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.id == student_assignment_id,
            StudentAssignment.student_id == student_id,
        )
        .first()
    )

    if not student_assignment:
        raise HTTPException(status_code=404, detail="Student assignment not found")

    # 取得進度記錄
    progress = (
        db.query(StudentItemProgress)
        .filter(
            StudentItemProgress.student_assignment_id == student_assignment_id,
            StudentItemProgress.content_item_id == request.content_item_id,
        )
        .first()
    )

    if not progress:
        raise HTTPException(status_code=404, detail="Progress not found")

    # 重置進度
    progress.error_count = 0
    progress.correct_word_count = 0
    progress.expected_score = 100.0
    progress.retry_count = (progress.retry_count or 0) + 1
    progress.status = "IN_PROGRESS"
    progress.rearrangement_data = {"selections": [], "retries": progress.retry_count}

    db.commit()

    return {
        "success": True,
        "retry_count": progress.retry_count,
        "message": "Progress reset. You can start again.",
    }


@router.post("/assignments/{student_assignment_id}/rearrangement-complete")
async def complete_rearrangement(
    student_assignment_id: int,
    request: RearrangementCompleteRequest,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """完成題目（時間到期或主動完成）"""
    student_id = int(current_student.get("sub"))

    # 驗證學生作業存在
    student_assignment = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.id == student_assignment_id,
            StudentAssignment.student_id == student_id,
        )
        .first()
    )

    if not student_assignment:
        raise HTTPException(status_code=404, detail="Student assignment not found")

    # 取得進度記錄
    progress = (
        db.query(StudentItemProgress)
        .filter(
            StudentItemProgress.student_assignment_id == student_assignment_id,
            StudentItemProgress.content_item_id == request.content_item_id,
        )
        .first()
    )

    if not progress:
        # 防禦性：建立新記錄（正常情況下應該已存在）
        progress = StudentItemProgress(
            student_assignment_id=student_assignment_id,
            content_item_id=request.content_item_id,
            status="COMPLETED",
            timeout_ended=request.timeout,
            expected_score=request.expected_score or 0,
            error_count=request.error_count or 0,
        )
        db.add(progress)
    else:
        # 標記完成狀態
        progress.status = "COMPLETED"
        progress.timeout_ended = request.timeout

        # 更新分數（如果前端有提供）
        if request.expected_score is not None:
            progress.expected_score = request.expected_score
        if request.error_count is not None:
            progress.error_count = request.error_count

    db.commit()

    return {
        "success": True,
        "final_score": float(progress.expected_score or 0),
        "timeout": request.timeout,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
