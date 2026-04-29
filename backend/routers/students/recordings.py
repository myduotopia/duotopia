"""Student audio recording upload endpoints."""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
from sqlalchemy.orm import Session
from typing import Dict, Any
from datetime import datetime

from database import get_db
from models import (
    StudentAssignment,
    ContentItem,
    StudentItemProgress,
    StudentContentProgress,
    AssignmentStatus,
)
from auth import get_current_user

router = APIRouter()


@router.post("/upload-recording")
async def upload_student_recording(
    request: Request,
    assignment_id: int = Form(...),  # StudentAssignment ID
    content_item_id: int = Form(...),  # ContentItem ID (最關鍵的簡化)
    audio_file: UploadFile = File(...),
    duration_seconds: int = Form(default=None),  # Optional: client-reported duration
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """上傳學生錄音到 Google Cloud Storage (支援重新錄製)"""
    try:
        from services.audio_upload import get_audio_upload_service
        from services.audio_manager import get_audio_manager

        audio_service = get_audio_upload_service()
        audio_manager = get_audio_manager()

        # 驗證學生身份
        if current_user.get("type") != "student":
            raise HTTPException(
                status_code=403, detail="Only students can upload recordings"
            )

        student_id = int(current_user.get("sub"))

        # 驗證作業存在且屬於該學生
        assignment = (
            db.query(StudentAssignment)
            .filter(
                StudentAssignment.id == assignment_id,
                StudentAssignment.student_id == student_id,
            )
            .first()
        )
        if not assignment:
            raise HTTPException(status_code=404, detail="Assignment not found")

        # 直接用 content_item_id 查詢
        content_item = (
            db.query(ContentItem).filter(ContentItem.id == content_item_id).first()
        )

        if not content_item:
            raise HTTPException(
                status_code=404,
                detail=f"Content item not found with id {content_item_id}",
            )

        # 查找現有的 StudentItemProgress 記錄以獲取舊 URL
        existing_item_progress = (
            db.query(StudentItemProgress)
            .filter(
                StudentItemProgress.student_assignment_id == assignment_id,
                StudentItemProgress.content_item_id == content_item.id,
            )
            .first()
        )

        # 檢查是否有舊錄音需要刪除
        old_audio_url = None
        if existing_item_progress and existing_item_progress.recording_url:
            old_audio_url = existing_item_progress.recording_url

        # 上傳新錄音（不傳 content_id 和 item_index，讓它用 UUID）
        ua = request.headers.get("user-agent", "")
        audio_url = await audio_service.upload_audio(
            audio_file,
            duration_seconds=duration_seconds if duration_seconds is not None else 30,
            assignment_id=assignment_id,
            student_id=student_id,
            user_agent=ua,
        )

        # 刪除舊錄音檔案（如果存在且不同）
        if old_audio_url and old_audio_url != audio_url:
            try:
                audio_manager.delete_old_audio(old_audio_url)
                print(f"Deleted old student recording: {old_audio_url}")

                # 同時清除舊的 AI 分數，因為分數對應的是舊錄音
                if existing_item_progress:
                    existing_item_progress.accuracy_score = None
                    existing_item_progress.fluency_score = None
                    existing_item_progress.pronunciation_score = None
                    existing_item_progress.ai_feedback = None
                    existing_item_progress.ai_assessed_at = None
                    print("Cleared AI scores for re-recording")

            except Exception as e:
                print(f"Failed to delete old recording: {e}")

        # 更新或創建 StudentItemProgress 記錄
        if existing_item_progress:
            # 更新現有記錄
            existing_item_progress.recording_url = audio_url
            existing_item_progress.submitted_at = datetime.utcnow()
            existing_item_progress.status = "COMPLETED"
            if duration_seconds is not None:
                existing_item_progress.recording_duration_seconds = duration_seconds
            print(f"Updated existing item progress record: {existing_item_progress.id}")
            current_item_progress = existing_item_progress
        else:
            # 創建新記錄
            new_item_progress = StudentItemProgress(
                student_assignment_id=assignment_id,
                content_item_id=content_item.id,
                recording_url=audio_url,
                submitted_at=datetime.utcnow(),
                status="COMPLETED",
                recording_duration_seconds=duration_seconds,
            )
            db.add(new_item_progress)
            print("Created new item progress record")
            current_item_progress = new_item_progress

        # 從 ContentItem 找到對應的 Content
        content_item_obj = db.query(ContentItem).filter_by(id=content_item_id).first()
        if not content_item_obj:
            raise HTTPException(status_code=404, detail="Content item not found")

        content_id = content_item_obj.content_id

        # 更新或創建摘要統計 (StudentContentProgress)
        summary_progress = (
            db.query(StudentContentProgress)
            .filter(
                StudentContentProgress.student_assignment_id == assignment_id,
                StudentContentProgress.content_id == content_id,
            )
            .first()
        )

        if not summary_progress:
            summary_progress = StudentContentProgress(
                student_assignment_id=assignment_id,
                content_id=content_id,
                order_index=0,  # 摘要記錄使用 0
                status=AssignmentStatus.IN_PROGRESS,
            )
            db.add(summary_progress)

        # 更新 StudentContentProgress 狀態
        summary_progress.status = AssignmentStatus.IN_PROGRESS

        db.commit()

        # 重新查詢以取得 ID（因為新記錄需要 commit 後才有 ID）
        db.refresh(current_item_progress)

        return {
            "audio_url": audio_url,
            "assignment_id": assignment_id,
            "content_item_id": content_item_id,
            "progress_id": current_item_progress.id,  # 新增：回傳 progress_id 給前端使用
            "storage_type": "gcs",
            "message": "Recording uploaded successfully to cloud storage",
        }

    except HTTPException as e:
        raise e
    except Exception as e:
        print(f"Student upload error: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to upload recording: {str(e)}"
        )
