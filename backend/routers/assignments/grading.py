"""
Grading operations (AI and manual)
"""

import json
import logging
from typing import List, Dict, Any
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import and_
from sqlalchemy.orm.attributes import flag_modified

from database import get_db
from performance_monitoring import trace_function, start_span, PerformanceSnapshot
from models import (
    Teacher,
    Student,
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
from .validators import (
    AIGradingRequest,
    AIGradingResponse,
    AIScores,
    BatchGradingRequest,
    BatchGradingResponse,
    StudentBatchGradingResult,
    BatchGradeFinalizeRequest,
    BatchGradeFinalizeResponse,
)
from .dependencies import get_current_teacher
from .utils import (
    process_audio_with_whisper,
    calculate_text_similarity,
    calculate_pronunciation_score,
    calculate_fluency_score,
    calculate_wpm,
    generate_ai_feedback,
    get_score_with_fallback,
    generate_item_comment,
    generate_assignment_feedback,
    trigger_ai_assessment_for_item,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _check_not_archived(student_assignment: StudentAssignment, db: Session):
    """封存後禁止修改成績"""
    if student_assignment.assignment_id:
        parent = (
            db.query(Assignment)
            .filter(Assignment.id == student_assignment.assignment_id)
            .first()
        )
        if parent and parent.is_archived:
            raise HTTPException(
                status_code=403,
                detail="Cannot modify grades: assignment is archived",
            )


@router.post("/{assignment_id}/ai-grade", response_model=AIGradingResponse)
@trace_function("AI Grade Assignment")
async def ai_grade_assignment(
    assignment_id: int,
    request: AIGradingRequest,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    AI 自動批改作業
    只有教師可以觸發批改
    """
    start_time = datetime.now()
    perf = PerformanceSnapshot(f"AI_Grade_Assignment_{assignment_id}")

    # 1. 取得作業並驗證權限
    with start_span("Database Query - Get Assignment"):
        assignment = (
            db.query(StudentAssignment)
            .join(Classroom)
            .filter(
                and_(
                    StudentAssignment.id == assignment_id,
                    Classroom.teacher_id == current_teacher.id,
                )
            )
            .first()
        )

        if not assignment:
            raise HTTPException(
                status_code=404,
                detail="Assignment not found or you don't have permission",
            )
        perf.checkpoint("Assignment Query")

    # 2. 檢查作業狀態
    with start_span("Validate Assignment Status"):
        _check_not_archived(assignment, db)
        if assignment.status != AssignmentStatus.SUBMITTED:
            raise HTTPException(
                status_code=400, detail="Assignment must be submitted before grading"
            )
        perf.checkpoint("Status Validation")

    # 3. 簡化版 - 不查詢 Content
    content = None

    # 4. 取得提交資料（新架構從 StudentContentProgress 取得）
    # 暫時簡化處理

    try:
        # 5. 處理批改邏輯
        if request.mock_mode and request.mock_data:
            # 使用模擬資料（測試模式）
            with start_span("Mock Mode - Load Test Data"):
                whisper_result = request.mock_data
                perf.checkpoint("Mock Data Loaded")
        else:
            # 準備預期文字
            with start_span("Prepare Expected Texts"):
                expected_texts = []
                if hasattr(content, "content_items"):
                    for item in content.content_items:
                        expected_texts.append(
                            item.text if hasattr(item, "text") else ""
                        )
                perf.checkpoint("Text Preparation")

            # 呼叫 Whisper API（這裡最可能慢）
            with start_span(
                "Whisper API Call", {"audio_count": len(request.audio_urls or [])}
            ):
                whisper_result = await process_audio_with_whisper(
                    request.audio_urls or [], expected_texts
                )
                perf.checkpoint("Whisper API Complete")

        # 6. 分析批改結果
        with start_span(
            "Calculate AI Scores",
            {"transcription_count": len(whisper_result.get("transcriptions", []))},
        ):
            transcriptions = whisper_result.get("transcriptions", [])
            audio_analysis = whisper_result.get("audio_analysis", {})

            # 計算各項評分
            total_accuracy = 0
            total_pronunciation = 0
            detailed_results = []

            for transcription in transcriptions:
                expected = transcription.get("expected_text", "")
                actual = transcription.get("transcribed_text", "")
                words = transcription.get("words", [])

                # 計算準確率
                accuracy = calculate_text_similarity(expected, actual) * 100

                # 計算發音評分
                pronunciation = calculate_pronunciation_score(words)

                total_accuracy += accuracy
                total_pronunciation += pronunciation

                detailed_results.append(
                    {
                        "item_id": transcription.get("item_id", 0),
                        "expected_text": expected,
                        "transcribed_text": actual,
                        "accuracy_score": accuracy,
                        "pronunciation_score": pronunciation,
                        "word_count": len(expected.split()) if expected else 0,
                    }
                )

            # 計算平均值
            item_count = len(transcriptions) if transcriptions else 1
            avg_accuracy = total_accuracy / item_count
            avg_pronunciation = total_pronunciation / item_count

            # 計算流暢度
            fluency = calculate_fluency_score(audio_analysis)

            # 計算語速
            all_transcribed = " ".join(
                [t.get("transcribed_text", "") for t in transcriptions]
            )
            total_duration = audio_analysis.get("total_duration", 10.0)
            wpm = calculate_wpm(all_transcribed, total_duration)

            # 建立評分物件
            ai_scores = AIScores(
                pronunciation=round(avg_pronunciation, 1),
                fluency=round(fluency, 1),
                accuracy=round(avg_accuracy, 1),
                wpm=wpm,
            )

            # 計算整體評分（加權平均）
            overall_score = round(
                ai_scores.pronunciation * 0.3
                + ai_scores.fluency * 0.3
                + ai_scores.accuracy * 0.4,
                1,
            )

            # 生成回饋
            feedback = generate_ai_feedback(ai_scores, detailed_results)
            perf.checkpoint("Score Calculation Complete")

        # 7. 更新資料庫
        with start_span("Database Update - Save Results"):
            # 更新作業狀態
            assignment.status = AssignmentStatus.GRADED
            assignment.score = overall_score
            assignment.feedback = feedback
            assignment.graded_at = datetime.now(timezone.utc)

            db.commit()
            perf.checkpoint("Database Update Complete")

        # 8. 計算處理時間
        processing_time = (datetime.now() - start_time).total_seconds()
        perf.finish()

        return AIGradingResponse(
            assignment_id=assignment_id,
            ai_scores=ai_scores,
            overall_score=overall_score,
            feedback=feedback,
            detailed_feedback=detailed_results,
            graded_at=datetime.now(),
            processing_time_seconds=round(processing_time, 2),
        )

    except Exception as e:
        # 發生錯誤時回滾
        db.rollback()
        raise HTTPException(status_code=500, detail=f"AI grading failed: {str(e)}")


@router.get("/{assignment_id}/submissions")
async def get_assignment_submissions(
    assignment_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """獲取作業的所有提交（教師用）"""
    # 獲取基礎作業資訊
    base_assignment = (
        db.query(StudentAssignment)
        .filter(StudentAssignment.id == assignment_id)
        .first()
    )

    if not base_assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # 獲取同一內容的所有學生作業
    submissions = (
        db.query(StudentAssignment)
        .join(Student)
        .filter(
            StudentAssignment.classroom_id == base_assignment.classroom_id,
        )
        .all()
    )

    # 優化：批次查詢學生和進度資料，避免 N+1 問題
    student_ids = [sub.student_id for sub in submissions]
    students_dict = {
        s.id: s for s in db.query(Student).filter(Student.id.in_(student_ids)).all()
    }

    submission_ids = [sub.id for sub in submissions]
    from collections import defaultdict

    progress_dict = defaultdict(list)
    for progress in (
        db.query(StudentContentProgress)
        .filter(StudentContentProgress.student_assignment_id.in_(submission_ids))
        .all()
    ):
        progress_dict[progress.student_assignment_id].append(progress)

    result = []
    for sub in submissions:
        student = students_dict.get(sub.student_id)
        if not student:
            continue

        # 取得學生的內容進度（新架構）
        progress_list = progress_dict.get(sub.id, [])

        result.append(
            {
                "assignment_id": sub.id,
                "student_id": student.id,
                "student_name": student.name,
                "status": sub.status.value,
                "submitted_at": (
                    sub.submitted_at.isoformat() if sub.submitted_at else None
                ),
                "score": sub.score,
                "feedback": sub.feedback,
                "content_progress": [
                    {
                        "content_id": p.content_id,
                        "status": p.status.value if p.status else "NOT_STARTED",
                        "response_data": p.response_data,
                    }
                    for p in progress_list
                ],
            }
        )

    return result


@router.get("/{assignment_id}/submissions/{student_id}")
async def get_student_submission(
    assignment_id: int,
    student_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """獲取單個學生的作業提交詳情（教師批改用）"""
    import json

    # 直接查詢學生作業
    assignment = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.assignment_id == assignment_id,
            StudentAssignment.student_id == student_id,
        )
        .first()
    )

    if not assignment:
        raise HTTPException(status_code=404, detail="Student assignment not found")

    # 獲取學生資訊
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # 從資料庫獲取真實的 content 題目資料
    actual_assignment_id = assignment.assignment_id

    # 載入 Assignment 以取得 practice_mode（批改頁依 practice_mode 分流中間欄）
    parent_assignment = (
        db.query(Assignment).filter(Assignment.id == actual_assignment_id).first()
    )
    practice_mode = (
        parent_assignment.practice_mode
        if parent_assignment and parent_assignment.practice_mode
        else "reading"
    )

    # 查詢作業關聯的 contents (按 order_index 排序)
    assignment_contents = (
        db.query(AssignmentContent, Content)
        .join(Content)
        .filter(AssignmentContent.assignment_id == actual_assignment_id)
        .order_by(AssignmentContent.order_index)
        .all()
    )

    submissions = []
    content_groups = []  # 用於儲存分組資訊

    # 獲取所有 StudentItemProgress 記錄（新系統）
    item_progress_records = (
        db.query(StudentItemProgress)
        .filter(StudentItemProgress.student_assignment_id == assignment.id)
        .all()
    )

    # 建立以 content_item_id 為 key 的字典，方便查詢
    progress_by_item_id = {}
    for progress in item_progress_records:
        progress_by_item_id[progress.content_item_id] = progress

    # 如果有真實的 content 資料
    if assignment_contents:
        item_index = 0  # 全局題目索引
        for ac, content in assignment_contents:
            if hasattr(content, "content_items") and content.content_items:
                # 建立內容群組
                group = {
                    "content_id": content.id,
                    "content_title": content.title,
                    "content_type": (
                        content.type.value if content.type else "READING_ASSESSMENT"
                    ),
                    "submissions": [],
                }

                # 使用 ContentItem 關聯
                items_data = list(content.content_items)
                for local_item_index, item in enumerate(items_data):
                    submission = {
                        "content_id": content.id,
                        "content_title": content.title,
                        "content_item_id": item.id,
                        "question_text": item.text if hasattr(item, "text") else "",
                        "question_translation": item.translation
                        if hasattr(item, "translation")
                        else "",
                        "question_audio_url": item.audio_url
                        if hasattr(item, "audio_url")
                        else "",
                        "student_answer": "",
                        "student_audio_url": "",
                        "transcript": "",
                        "duration": 0,
                        "item_index": item_index,
                        "feedback": "",
                        "passed": None,
                    }

                    # 例句重組專用：補上 max_errors（來自 content_item）
                    if practice_mode == "rearrangement":
                        submission["max_errors"] = (
                            item.max_errors if hasattr(item, "max_errors") else None
                        )

                    # 使用 content_item_id 來獲取對應的 StudentItemProgress 記錄
                    item_progress = progress_by_item_id.get(item.id)

                    # 加入 item_progress_id 供前端呼叫 reanalyze API
                    if item_progress:
                        submission["item_progress_id"] = item_progress.id

                    # 從 StudentItemProgress 直接獲取資料
                    if item_progress:
                        # 加入老師批改的評語和通過狀態
                        if item_progress.teacher_feedback:
                            submission["feedback"] = item_progress.teacher_feedback
                        if item_progress.teacher_passed is not None:
                            submission["passed"] = item_progress.teacher_passed
                        # 學生錄音檔案
                        if item_progress.recording_url:
                            submission["audio_url"] = item_progress.recording_url
                            submission[
                                "student_audio_url"
                            ] = item_progress.recording_url

                        # 作答狀態
                        if item_progress.status == "SUBMITTED":
                            submission["status"] = "submitted"

                        # AI 評分物件
                        if item_progress.ai_feedback:
                            try:
                                ai_data = (
                                    json.loads(item_progress.ai_feedback)
                                    if isinstance(item_progress.ai_feedback, str)
                                    else item_progress.ai_feedback
                                )
                            except (json.JSONDecodeError, TypeError):
                                ai_data = None

                            if ai_data and isinstance(ai_data, dict):
                                submission["ai_scores"] = {
                                    "accuracy_score": float(
                                        ai_data.get("accuracy_score", 0)
                                    ),
                                    "fluency_score": float(
                                        ai_data.get("fluency_score", 0)
                                    ),
                                    "pronunciation_score": float(
                                        ai_data.get("pronunciation_score", 0)
                                    ),
                                    "completeness_score": float(
                                        ai_data.get("completeness_score", 0)
                                    ),
                                    "overall_score": float(
                                        ai_data.get("overall_score", 0)
                                    )
                                    if ai_data.get("overall_score")
                                    else (
                                        (
                                            float(ai_data.get("accuracy_score", 0))
                                            + float(ai_data.get("fluency_score", 0))
                                            + float(
                                                ai_data.get("pronunciation_score", 0)
                                            )
                                            + float(
                                                ai_data.get("completeness_score", 0)
                                            )
                                        )
                                        / 4
                                    ),
                                    "word_details": ai_data.get("word_details", []),
                                }

                        # 例句重組：補上 rearrangement 相關欄位
                        if practice_mode == "rearrangement":
                            submission[
                                "rearrangement_data"
                            ] = item_progress.rearrangement_data
                            submission["error_count"] = item_progress.error_count
                            submission[
                                "correct_word_count"
                            ] = item_progress.correct_word_count
                            submission["retry_count"] = item_progress.retry_count
                            submission["expected_score"] = (
                                float(item_progress.expected_score)
                                if item_progress.expected_score is not None
                                else None
                            )
                            submission["timeout_ended"] = item_progress.timeout_ended
                            # status 供前端判斷是否顯示歷程（僅 COMPLETED 顯示）
                            submission["item_status"] = (
                                item_progress.status.value
                                if hasattr(item_progress.status, "value")
                                else item_progress.status
                            )
                            # 完成時間：優先取 rearrangement_data.completed_at，
                            # 沒有則 fallback updated_at（COMPLETED 後 updated_at ≈ 完成時間）
                            rd = item_progress.rearrangement_data or {}
                            completed_at = rd.get("completed_at")
                            if (
                                not completed_at
                                and item_progress.status
                                and (
                                    item_progress.status == "COMPLETED"
                                    or getattr(item_progress.status, "value", None)
                                    == "COMPLETED"
                                )
                                and item_progress.updated_at
                            ):
                                completed_at = item_progress.updated_at.isoformat()
                            submission["completed_at"] = completed_at

                    submissions.append(submission)
                    group["submissions"].append(submission)
                    item_index += 1

                content_groups.append(group)

    # 如果沒有真實資料，使用模擬資料 (標記為 MOCK)
    if not submissions:
        print(
            f"WARNING: No real content found for assignment_id={actual_assignment_id}, using MOCK data"
        )
        submissions = [
            {
                "question_text": "[MOCK] How are you today?",
                "question_translation": "[MOCK] 你今天好嗎？",
                "question_audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
                "student_answer": "I am fine, thank you!",
                "student_audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
                "transcript": "I am fine thank you",
                "duration": 3.5,
                "feedback": "",
                "passed": None,
            },
        ]

    return {
        "student_id": student.id,
        "student_name": student.name,
        "student_email": student.email,
        "status": assignment.status.value,
        "submitted_at": (
            assignment.submitted_at.isoformat() if assignment.submitted_at else None
        ),
        "content_type": "SPEAKING_PRACTICE",
        "practice_mode": practice_mode,
        "submissions": submissions,
        "content_groups": content_groups,
        "current_score": assignment.score,
        "current_feedback": assignment.feedback,
    }


@router.post("/{assignment_id}/grade")
async def grade_student_assignment(
    assignment_id: int,
    grade_data: dict,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """教師批改學生作業"""
    import logging

    # 獲取學生ID
    student_id = grade_data.get("student_id")
    if not student_id:
        raise HTTPException(status_code=400, detail="Student ID is required")

    # 使用 assignment_id (主作業ID) 和 student_id 查詢學生作業
    assignment = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.assignment_id == assignment_id,
            StudentAssignment.student_id == student_id,
        )
        .first()
    )

    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # 確認教師有權限批改（檢查班級關聯）
    classroom = (
        db.query(Classroom)
        .filter(
            Classroom.id == assignment.classroom_id,
            Classroom.teacher_id == current_teacher.id,
        )
        .first()
    )

    if not classroom:
        raise HTTPException(
            status_code=403, detail="Not authorized to grade this assignment"
        )

    # 更新評分資訊
    assignment.score = grade_data.get("score")
    assignment.feedback = grade_data.get("feedback")

    # 只有在 update_status 為 True 時才更新狀態
    if grade_data.get("update_status", True):
        assignment.status = AssignmentStatus.GRADED
        assignment.graded_at = datetime.now(timezone.utc)

    # 更新個別題目的評分和回饋
    if "item_results" in grade_data:
        # 獲取所有內容進度記錄
        progress_records = (
            db.query(StudentContentProgress)
            .filter(StudentContentProgress.student_assignment_id == assignment.id)
            .order_by(StudentContentProgress.order_index)
            .all()
        )

        # 建立 item 結果的索引映射
        item_feedback_map = {}
        for item_result in grade_data["item_results"]:
            item_feedback_map[item_result.get("item_index")] = item_result

        # 優化：批次查詢所有 content，避免 N+1 問題
        content_ids = {progress.content_id for progress in progress_records}
        content_dict = {
            c.id: c
            for c in db.query(Content)
            .filter(Content.id.in_(content_ids))
            .options(selectinload(Content.content_items))
            .all()
        }

        # Preload all StudentItemProgress (avoid N+1)
        all_item_progress = (
            db.query(StudentItemProgress)
            .filter(StudentItemProgress.student_assignment_id == assignment.id)
            .all()
        )
        item_progress_map = {ip.content_item_id: ip for ip in all_item_progress}

        # 對每個 progress record，儲存其對應的所有 item 回饋
        current_item_index = 0
        for progress in progress_records:
            # 獲取此 content 的所有項目數量
            content = content_dict.get(progress.content_id)
            if content and hasattr(content, "content_items"):
                items_count = len(content.content_items)

                # 收集此 content 的所有 item 回饋
                items_feedback = []
                for i in range(items_count):
                    if current_item_index in item_feedback_map:
                        item_data = item_feedback_map[current_item_index]
                        items_feedback.append(
                            {
                                "feedback": item_data.get("feedback", ""),
                                "passed": item_data.get("passed"),
                                "score": item_data.get("score"),
                            }
                        )

                        # 更新 StudentItemProgress 表中的 teacher_feedback
                        if (
                            item_data.get("feedback")
                            or item_data.get("passed") is not None
                        ):
                            item_progress = item_progress_map.get(
                                content.content_items[i].id
                            )

                            # 如果記錄不存在，創建一個
                            if not item_progress:
                                logger = logging.getLogger(__name__)
                                logger.info(
                                    f"Creating StudentItemProgress on-demand: "
                                    f"assignment_id={assignment.id}, "
                                    f"content_item_id={content.content_items[i].id}"
                                )

                                try:
                                    item_progress = StudentItemProgress(
                                        student_assignment_id=assignment.id,
                                        content_item_id=content.content_items[i].id,
                                        status="NOT_SUBMITTED",
                                        answer_text=None,
                                        recording_url=None,
                                        accuracy_score=None,
                                        fluency_score=None,
                                        pronunciation_score=None,
                                        ai_feedback=None,
                                        review_status="PENDING",
                                    )
                                    db.add(item_progress)
                                    db.flush()
                                except Exception as e:
                                    logger.error(
                                        f"Failed to create StudentItemProgress: {e}"
                                    )
                                    raise HTTPException(
                                        status_code=500,
                                        detail="Failed to save teacher feedback",
                                    )

                            # 更新老師評語和相關欄位
                            item_progress.teacher_feedback = item_data.get(
                                "feedback", ""
                            )
                            item_progress.teacher_review_score = (
                                item_data.get("score")
                                if item_data.get("score")
                                else item_progress.teacher_review_score
                            )
                            item_progress.teacher_passed = item_data.get("passed")
                            item_progress.teacher_reviewed_at = datetime.now(
                                timezone.utc
                            )
                            item_progress.teacher_id = current_teacher.id
                            item_progress.review_status = "REVIEWED"
                    else:
                        items_feedback.append(
                            {"feedback": "", "passed": None, "score": None}
                        )
                    current_item_index += 1

                # 將所有 item 回饋儲存在 response_data JSON 欄位中
                new_response_data = (
                    progress.response_data.copy() if progress.response_data else {}
                )
                new_response_data["item_feedbacks"] = items_feedback
                progress.response_data = new_response_data
                flag_modified(progress, "response_data")

                # 更新整體的 checked 狀態
                all_passed = all(
                    item.get("passed") is True
                    for item in items_feedback
                    if item.get("passed") is not None
                )
                any_failed = any(item.get("passed") is False for item in items_feedback)
                if any_failed:
                    progress.checked = False
                elif all_passed and len(items_feedback) > 0:
                    progress.checked = True

    db.commit()

    return {
        "message": "Assignment graded successfully",
        "assignment_id": assignment.id,
        "student_id": student_id,
        "score": assignment.score,
        "feedback": assignment.feedback,
        "graded_at": assignment.graded_at.isoformat() if assignment.graded_at else None,
    }


@router.post("/{assignment_id}/set-in-progress")
async def set_assignment_in_progress(
    assignment_id: int,
    data: dict,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """設定為批改中狀態"""
    # 獲取學生ID
    student_id = data.get("student_id")
    if not student_id:
        raise HTTPException(status_code=400, detail="Student ID is required")

    # 使用 assignment_id (主作業ID) 和 student_id 查詢學生作業
    assignment = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.assignment_id == assignment_id,
            StudentAssignment.student_id == student_id,
        )
        .first()
    )

    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # 確認教師有權限（檢查班級關聯）
    classroom = (
        db.query(Classroom)
        .filter(
            Classroom.id == assignment.classroom_id,
            Classroom.teacher_id == current_teacher.id,
        )
        .first()
    )

    if not classroom:
        raise HTTPException(
            status_code=403, detail="Not authorized to modify this assignment"
        )

    # 檢查當前狀態
    if assignment.status in [AssignmentStatus.SUBMITTED, AssignmentStatus.RESUBMITTED]:
        return {
            "message": "Assignment is already in progress",
            "assignment_id": assignment.id,
            "student_id": student_id,
            "status": assignment.status.value,
        }

    # 根據之前的狀態決定要設定成哪種批改中狀態
    if assignment.status == AssignmentStatus.RETURNED:
        if assignment.resubmitted_at and (
            not assignment.submitted_at
            or assignment.resubmitted_at > assignment.submitted_at
        ):
            assignment.status = AssignmentStatus.RESUBMITTED
        else:
            assignment.status = AssignmentStatus.SUBMITTED
    elif assignment.status == AssignmentStatus.GRADED:
        if assignment.resubmitted_at and (
            not assignment.submitted_at
            or assignment.resubmitted_at > assignment.submitted_at
        ):
            assignment.status = AssignmentStatus.RESUBMITTED
        else:
            assignment.status = AssignmentStatus.SUBMITTED
        assignment.graded_at = None

    db.commit()

    return {
        "message": "Assignment set to in progress",
        "assignment_id": assignment.id,
        "student_id": student_id,
        "status": assignment.status.value,
    }


@router.post("/{assignment_id}/return-for-revision")
async def return_for_revision(
    assignment_id: int,
    data: dict,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """要求訂正 - 要求學生修改作業"""
    # 獲取學生ID
    student_id = data.get("student_id")
    if not student_id:
        raise HTTPException(status_code=400, detail="Student ID is required")

    # 使用 assignment_id (主作業ID) 和 student_id 查詢學生作業
    assignment = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.assignment_id == assignment_id,
            StudentAssignment.student_id == student_id,
        )
        .first()
    )

    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    _check_not_archived(assignment, db)

    # 確認教師有權限（檢查班級關聯）
    classroom = (
        db.query(Classroom)
        .filter(
            Classroom.id == assignment.classroom_id,
            Classroom.teacher_id == current_teacher.id,
        )
        .first()
    )

    if not classroom:
        raise HTTPException(
            status_code=403, detail="Not authorized to return this assignment"
        )

    # 檢查是否已經是要求訂正狀態
    if assignment.status == AssignmentStatus.RETURNED:
        return {
            "message": "Assignment is already in returned status",
            "assignment_id": assignment.id,
            "student_id": student_id,
            "status": assignment.status.value,
            "returned_at": (
                assignment.returned_at.isoformat() if assignment.returned_at else None
            ),
        }

    # 更新狀態為 RETURNED（要求訂正）
    assignment.status = AssignmentStatus.RETURNED
    assignment.returned_at = datetime.now(timezone.utc)

    # 可選：儲存退回訊息
    message = data.get("message", "")
    if message and hasattr(assignment, "return_message"):
        assignment.return_message = message

    db.commit()

    return {
        "message": "Assignment returned for revision",
        "assignment_id": assignment.id,
        "student_id": student_id,
        "status": assignment.status.value,
        "returned_at": assignment.returned_at.isoformat(),
    }


@router.post("/{assignment_id}/manual-grade")
async def manual_grade_assignment(
    assignment_id: int,
    grade_data: dict,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """手動評分（教師用）"""
    # 獲取作業
    assignment = (
        db.query(StudentAssignment)
        .filter(StudentAssignment.id == assignment_id)
        .first()
    )

    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    _check_not_archived(assignment, db)

    # 驗證教師權限（檢查作業是否屬於教師的班級）
    classroom = (
        db.query(Classroom)
        .filter(
            Classroom.id == assignment.classroom_id,
            Classroom.teacher_id == current_teacher.id,
        )
        .first()
    )

    if not classroom:
        raise HTTPException(
            status_code=403, detail="Not authorized to grade this assignment"
        )

    # 更新評分
    assignment.score = grade_data.get("score")
    assignment.feedback = grade_data.get("feedback")
    assignment.status = AssignmentStatus.GRADED
    assignment.graded_at = datetime.now(timezone.utc)

    # 更新內容進度評分（新架構）
    if "detailed_scores" in grade_data:
        progress_records = (
            db.query(StudentContentProgress)
            .filter(StudentContentProgress.student_assignment_id == assignment_id)
            .all()
        )

        for progress in progress_records:
            if "ai_scores" in grade_data.get("detailed_scores", {}):
                progress.ai_scores = grade_data["detailed_scores"]["ai_scores"]
                progress.ai_feedback = grade_data.get("feedback")
                progress.checked = True
                progress.score = grade_data.get("score")

    db.commit()

    return {
        "id": assignment.id,
        "status": assignment.status.value,
        "score": assignment.score,
        "feedback": assignment.feedback,
        "graded_at": assignment.graded_at.isoformat(),
        "message": "Assignment graded successfully",
    }


# ============ Batch Grading Endpoints ============


@router.post("/{assignment_id}/batch-grade", response_model=BatchGradingResponse)
@trace_function("Batch Grade Assignment")
async def batch_grade_assignment(
    assignment_id: int,
    request: BatchGradingRequest,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    AI 批次批改作業

    批改流程：
    1. 查找需要批改的學生：
       - 批次模式（未指定 student_ids 或多個學生）：僅處理「已提交」或「已訂正」狀態
       - 單人模式（指定一個 student_id）：處理任何狀態（允許重新批改）
    2. 計算每個學生的分數：
       - 每題分數 = (總體發音 + 準確度 + 流暢度 + 完整度) / 4
       - 總分 = 所有題目平均分
       - 平均成績 = 各項目平均
    3. 更新作業狀態（已批改 或 已退回）

    Modes:
    - Batch mode (no student_ids or multiple IDs): Only processes SUBMITTED/RESUBMITTED students
    - Single-student mode (one student_id): Processes ANY status (for manual re-grading)

    The status filter is intentionally skipped in single-student mode to allow
    teachers to re-grade or apply AI suggestions to any student at any time.
    """
    perf = PerformanceSnapshot(f"Batch_Grade_Assignment_{assignment_id}")

    # 1. 驗證教師權限
    with start_span("Verify Teacher Permission"):
        assignment = (
            db.query(Assignment)
            .join(Classroom)
            .filter(
                and_(
                    Assignment.id == assignment_id,
                    Classroom.id == request.classroom_id,
                    Classroom.teacher_id == current_teacher.id,
                )
            )
            .first()
        )

        if not assignment:
            raise HTTPException(
                status_code=404,
                detail="Assignment not found or you don't have permission",
            )

        if assignment.is_archived:
            raise HTTPException(
                status_code=403,
                detail="Cannot modify grades: assignment is archived",
            )
        perf.checkpoint("Permission Check")

    # 2. 查找需要批改的學生
    # 單人模式：不限狀態（允許重新批改）
    # 批次模式：僅處理 SUBMITTED 或 RESUBMITTED
    with start_span("Query Students to Grade"):
        # Build base query
        query = (
            db.query(StudentAssignment)
            .join(Student)
            .filter(StudentAssignment.assignment_id == assignment_id)
        )

        # Apply status filter based on mode
        is_single_student_mode = request.student_ids and len(request.student_ids) == 1

        if is_single_student_mode:
            # Single-student mode: Allow grading ANY status
            query = query.filter(Student.id.in_(request.student_ids))
        elif request.student_ids:
            # Multi-student mode with specific IDs: Filter by status + IDs
            query = query.filter(
                and_(
                    StudentAssignment.status.in_(
                        [AssignmentStatus.SUBMITTED, AssignmentStatus.RESUBMITTED]
                    ),
                    Student.id.in_(request.student_ids),
                )
            )
        else:
            # Batch mode (all students): Only SUBMITTED/RESUBMITTED
            query = query.filter(
                StudentAssignment.status.in_(
                    [AssignmentStatus.SUBMITTED, AssignmentStatus.RESUBMITTED]
                )
            )

        student_assignments = query.options(
            selectinload(StudentAssignment.student)
        ).all()
        perf.checkpoint(
            f"Found {len(student_assignments)} Students"
            + (" (single-student mode)" if is_single_student_mode else "")
        )

    # 3. Pre-load all StudentItemProgress records at once (fix N+1 query)
    with start_span("Pre-load Item Progress"):
        student_assignment_ids = [sa.id for sa in student_assignments]
        all_item_progress = (
            db.query(StudentItemProgress)
            .filter(
                StudentItemProgress.student_assignment_id.in_(student_assignment_ids)
            )
            .all()
        )

        # Create lookup dictionary: student_assignment_id -> [item_progress]
        progress_by_student = {}
        for item in all_item_progress:
            if item.student_assignment_id not in progress_by_student:
                progress_by_student[item.student_assignment_id] = []
            progress_by_student[item.student_assignment_id].append(item)

        perf.checkpoint(f"Pre-loaded {len(all_item_progress)} Item Progress Records")

    # 4. Pre-load all ContentItem records at once (fix N+1 query in AI assessment)
    with start_span("Pre-load Content Items"):
        content_item_ids = list(
            set(
                [
                    item.content_item_id
                    for item in all_item_progress
                    if item.content_item_id
                ]
            )
        )
        content_items = (
            db.query(ContentItem).filter(ContentItem.id.in_(content_item_ids)).all()
        )

        # Create lookup dictionary: content_item_id -> ContentItem
        content_items_by_id = {item.id: item for item in content_items}
        perf.checkpoint(f"Pre-loaded {len(content_items)} Content Items")

    results = []

    # 5. 批改每個學生的作業
    with start_span("Process Each Student"):
        for student_assignment in student_assignments:
            student = student_assignment.student

            # 6. 從預載的資料中取得該學生所有題目的進度
            item_progress_list = progress_by_student.get(student_assignment.id, [])

            # 6.5. Trigger AI assessment for items with recordings but no scores
            with start_span("Trigger Missing AI Assessments"):
                for item in item_progress_list:
                    # Check if has recording but no AI assessment
                    if item.recording_url and not item.ai_assessed_at:
                        logger.info(
                            f"Triggering AI assessment for item_progress {item.id}"
                        )
                        # Pass pre-loaded content_item to avoid N+1 query
                        content_item = content_items_by_id.get(item.content_item_id)
                        await trigger_ai_assessment_for_item(item, db, content_item)
                        # Refresh to get updated scores
                        db.refresh(item)

                perf.checkpoint("AI Assessments Triggered")

            # 7. 計算分數
            item_scores = []
            pronunciation_scores = []
            accuracy_scores = []
            fluency_scores = []
            completeness_scores = []
            missing_count = 0

            for item in item_progress_list:
                # 檢查是否有錄音
                if not item.recording_url:
                    # 缺題
                    item_scores.append(0)
                    missing_count += 1
                    continue

                # 檢查是否有 AI 評分
                if not item.has_ai_assessment:
                    # 沒有分析結果，視為 0 分
                    item_scores.append(0)
                    missing_count += 1
                    continue

                # Parse ai_feedback once for efficiency
                ai_feedback_data = {}
                if item.ai_feedback:
                    try:
                        ai_feedback_data = (
                            json.loads(item.ai_feedback)
                            if isinstance(item.ai_feedback, str)
                            else item.ai_feedback
                        )
                    except (json.JSONDecodeError, TypeError):
                        ai_feedback_data = {}

                # 收集有效分數（使用 fallback + backfill）
                available_scores = []

                pronunciation = get_score_with_fallback(
                    item,
                    "pronunciation_score",
                    "pronunciation_score",
                    db,
                    ai_feedback_data,
                )
                if pronunciation > 0:
                    available_scores.append(pronunciation)
                    pronunciation_scores.append(pronunciation)

                accuracy = get_score_with_fallback(
                    item, "accuracy_score", "accuracy_score", db, ai_feedback_data
                )
                if accuracy > 0:
                    available_scores.append(accuracy)
                    accuracy_scores.append(accuracy)

                fluency = get_score_with_fallback(
                    item, "fluency_score", "fluency_score", db, ai_feedback_data
                )
                if fluency > 0:
                    available_scores.append(fluency)
                    fluency_scores.append(fluency)

                completeness = get_score_with_fallback(
                    item,
                    "completeness_score",
                    "completeness_score",
                    db,
                    ai_feedback_data,
                )
                if completeness > 0:
                    available_scores.append(completeness)
                    completeness_scores.append(completeness)

                # 計算該題分數（4 項平均）
                if available_scores:
                    item_score = sum(available_scores) / len(available_scores)
                    item_scores.append(item_score)
                else:
                    # 有錄音和 AI 評分但分數為 0 - 不算缺題，只是得分低
                    item_scores.append(0)

            # 8. 計算總分和平均分
            total_score = sum(item_scores) / len(item_scores) if item_scores else 0.0

            avg_pronunciation = (
                sum(pronunciation_scores) / len(pronunciation_scores)
                if pronunciation_scores
                else 0.0
            )
            avg_accuracy = (
                sum(accuracy_scores) / len(accuracy_scores) if accuracy_scores else 0.0
            )
            avg_fluency = (
                sum(fluency_scores) / len(fluency_scores) if fluency_scores else 0.0
            )
            avg_completeness = (
                sum(completeness_scores) / len(completeness_scores)
                if completeness_scores
                else 0.0
            )

            # 9. 更新 StudentAssignment
            student_assignment.score = total_score
            student_assignment.graded_at = datetime.now(timezone.utc)

            # 9.5. Generate item-level comments
            with start_span("Generate Item Comments"):
                for item in item_progress_list:
                    # Only generate comments for items with recordings
                    if item.recording_url and item.ai_assessed_at:
                        # Get scores (use get_score_with_fallback for safety)
                        pron = float(
                            get_score_with_fallback(
                                item,
                                "pronunciation_score",
                                "pronunciation_score",
                                db,
                                ai_feedback_data={},
                            )
                        )
                        acc = float(
                            get_score_with_fallback(
                                item,
                                "accuracy_score",
                                "accuracy_score",
                                db,
                                ai_feedback_data={},
                            )
                        )
                        flu = float(
                            get_score_with_fallback(
                                item,
                                "fluency_score",
                                "fluency_score",
                                db,
                                ai_feedback_data={},
                            )
                        )
                        comp = float(
                            get_score_with_fallback(
                                item,
                                "completeness_score",
                                "completeness_score",
                                db,
                                ai_feedback_data={},
                            )
                        )

                        # Generate and store comment
                        comment = generate_item_comment(pron, acc, flu, comp)
                        item.teacher_feedback = comment

                perf.checkpoint("Item Comments Generated")

            # 9.6. Generate assignment feedback
            with start_span("Generate Assignment Feedback"):
                completed_items_count = len(
                    [i for i in item_progress_list if i.recording_url]
                )

                assignment_feedback = generate_assignment_feedback(
                    total_items=len(item_progress_list),
                    completed_items=completed_items_count,
                    avg_score=total_score,
                    avg_pronunciation=avg_pronunciation,
                    avg_fluency=avg_fluency,
                    avg_accuracy=avg_accuracy,
                    avg_completeness=avg_completeness,
                )

                student_assignment.feedback = assignment_feedback
                perf.checkpoint("Assignment Feedback Generated")

            # 10. Set graded_at timestamp (status will be decided in finalize step)
            student_assignment.graded_at = datetime.now(timezone.utc)

            # 11. 記錄結果
            results.append(
                StudentBatchGradingResult(
                    student_id=student.id,
                    student_name=student.name,
                    total_score=round(total_score, 1),
                    missing_items=missing_count,
                    total_items=len(item_progress_list),
                    completed_items=len(
                        [i for i in item_progress_list if i.recording_url]
                    ),
                    avg_pronunciation=round(avg_pronunciation, 1),
                    avg_accuracy=round(avg_accuracy, 1),
                    avg_fluency=round(avg_fluency, 1),
                    avg_completeness=round(avg_completeness, 1),
                    feedback=student_assignment.feedback,
                    status=student_assignment.status.value,
                )
            )

        perf.checkpoint("All Students Processed")

    # 12. 提交到資料庫
    with start_span("Database Commit"):
        db.commit()
        perf.checkpoint("Database Committed")

    perf.finish()

    return BatchGradingResponse(
        total_students=len(student_assignments), processed=len(results), results=results
    )


@router.post(
    "/{assignment_id}/finalize-batch-grade",
    response_model=BatchGradeFinalizeResponse,
)
@trace_function("Finalize Batch Grade")
async def finalize_batch_grade(
    assignment_id: int,
    request: BatchGradeFinalizeRequest,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    完成批次批改 - 根據老師決定設定最終狀態

    Teacher Decisions:
    - "RETURNED" → Mark as RETURNED
    - "GRADED" → Mark as GRADED
    - None or missing → Keep SUBMITTED/RESUBMITTED (no change)
    """
    perf = PerformanceSnapshot(f"Finalize_Batch_Grade_{assignment_id}")

    with start_span("Verify Permissions"):
        # Verify assignment exists
        assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
        if not assignment:
            raise HTTPException(status_code=404, detail="Assignment not found")

        # Verify teacher owns this assignment's classroom
        classroom = (
            db.query(Classroom)
            .filter(
                Classroom.id == request.classroom_id,
                Classroom.teacher_id == current_teacher.id,
            )
            .first()
        )

        if not classroom:
            raise HTTPException(status_code=403, detail="Access denied")

        perf.checkpoint("Permissions Verified")

    with start_span("Query Student Assignments"):
        # Get all submitted/resubmitted students
        student_assignments = (
            db.query(StudentAssignment)
            .filter(
                StudentAssignment.assignment_id == assignment_id,
                StudentAssignment.classroom_id == request.classroom_id,
                StudentAssignment.status.in_(
                    [AssignmentStatus.SUBMITTED, AssignmentStatus.RESUBMITTED]
                ),
            )
            .all()
        )
        perf.checkpoint(f"Queried {len(student_assignments)} Student Assignments")

    returned_count = 0
    graded_count = 0
    unchanged_count = 0

    with start_span("Update Student Statuses"):
        for sa in student_assignments:
            student_id = str(sa.student_id)

            # Check teacher's decision for this student
            decision = request.teacher_decisions.get(student_id)

            if decision == "RETURNED":
                sa.status = AssignmentStatus.RETURNED
                sa.returned_at = datetime.now(timezone.utc)
                returned_count += 1
            elif decision == "GRADED":
                sa.status = AssignmentStatus.GRADED
                # graded_at was already set in batch-grade step
                graded_count += 1
            else:
                # None or other value → Keep original status (SUBMITTED/RESUBMITTED)
                unchanged_count += 1

        perf.checkpoint("Updated Student Statuses")

    with start_span("Database Commit"):
        db.commit()
        perf.checkpoint("Database Committed")

    perf.finish()

    return BatchGradeFinalizeResponse(
        returned_count=returned_count,
        graded_count=graded_count,
        unchanged_count=unchanged_count,
        total_count=len(student_assignments),
    )


@router.post("/{assignment_id}/reanalyze-item/{item_progress_id}")
@trace_function("Reanalyze Item")
async def reanalyze_item(
    assignment_id: int,
    item_progress_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    老師端手動觸發單一題目的 AI 語音重新分析

    條件：
    - 該題目必須有 recording_url（音檔存在）
    - 老師必須有權限存取該作業
    """
    # 1. 查詢 item_progress
    item_progress = (
        db.query(StudentItemProgress)
        .filter(StudentItemProgress.id == item_progress_id)
        .first()
    )
    if not item_progress:
        raise HTTPException(status_code=404, detail="Item progress not found")

    # 2. 驗證該 item 屬於正確的 assignment
    student_assignment = (
        db.query(StudentAssignment)
        .filter(StudentAssignment.id == item_progress.student_assignment_id)
        .first()
    )
    if not student_assignment or student_assignment.assignment_id != assignment_id:
        raise HTTPException(status_code=404, detail="Item not found in this assignment")

    # 3. 驗證老師有權限（透過 classroom ownership）
    classroom = (
        db.query(Classroom)
        .filter(
            Classroom.id == student_assignment.classroom_id,
            Classroom.teacher_id == current_teacher.id,
        )
        .first()
    )
    if not classroom:
        raise HTTPException(status_code=403, detail="Access denied")

    # 4. 確認作業未封存
    _check_not_archived(student_assignment, db)

    # 5. 確認有錄音檔案
    if not item_progress.recording_url:
        raise HTTPException(
            status_code=400, detail="No recording available for reanalysis"
        )

    # 5. 查詢對應的 content_item
    content_item = (
        db.query(ContentItem)
        .filter(ContentItem.id == item_progress.content_item_id)
        .first()
    )
    if not content_item:
        raise HTTPException(status_code=404, detail="Content item not found")

    # 6. 清除舊的評估結果，觸發重新分析
    # flush 使 ai_assessed_at=None 在當前 transaction 生效，
    # 因為 trigger_ai_assessment_for_item 會檢查此欄位決定是否執行分析。
    # 該函式內部已包含 db.commit()，成功時分數會被持久化。
    # 若分析失敗，需手動恢復 ai_assessed_at（因為 commit 後 rollback 無效）。
    original_ai_assessed_at = item_progress.ai_assessed_at
    try:
        item_progress.ai_assessed_at = None
        db.flush()

        success = await trigger_ai_assessment_for_item(item_progress, db, content_item)

        if not success:
            # trigger 函式失敗時內部會 rollback，
            # 但若它已 commit 了 ai_assessed_at=None，需手動恢復
            item_progress.ai_assessed_at = original_ai_assessed_at
            db.commit()
            raise HTTPException(
                status_code=500, detail="AI analysis failed, please try again later"
            )
    except HTTPException:
        raise
    except Exception as e:
        item_progress.ai_assessed_at = original_ai_assessed_at
        db.commit()
        logger.error(f"Reanalyze failed for item_progress {item_progress_id}: {e}")
        raise HTTPException(
            status_code=500, detail="AI analysis failed, please try again later"
        )

    # 7. 回傳更新後的分數
    ai_data = {}
    if item_progress.ai_feedback:
        try:
            ai_data = (
                json.loads(item_progress.ai_feedback)
                if isinstance(item_progress.ai_feedback, str)
                else item_progress.ai_feedback
            )
        except (json.JSONDecodeError, TypeError):
            ai_data = {}

    scores = [
        item_progress.accuracy_score,
        item_progress.fluency_score,
        item_progress.pronunciation_score,
        item_progress.completeness_score,
    ]
    valid_scores = [float(s) for s in scores if s is not None]
    overall = sum(valid_scores) / len(valid_scores) if valid_scores else 0

    return {
        "success": True,
        "ai_scores": {
            "accuracy_score": float(item_progress.accuracy_score or 0),
            "fluency_score": float(item_progress.fluency_score or 0),
            "pronunciation_score": float(item_progress.pronunciation_score or 0),
            "completeness_score": float(item_progress.completeness_score or 0),
            "overall_score": overall,
            "word_details": ai_data.get("word_details", []),
        },
    }
