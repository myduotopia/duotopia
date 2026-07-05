"""
Student submission endpoints
"""

from typing import Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models import (
    Assignment,
    Student,
    StudentAssignment,
    StudentContentProgress,
    StudentItemProgress,
    AssignmentStatus,
)
from .dependencies import get_current_student

router = APIRouter()


@router.get("/student")
async def get_student_assignments(
    status: Optional[str] = Query(None, description="Filter by status"),
    db: Session = Depends(get_db),
    current_student: Student = Depends(get_current_student),
):
    """
    取得學生的作業列表
    學生只能看到自己的作業
    """
    # 建立查詢（排除已封存的作業）
    query = (
        db.query(StudentAssignment)
        .join(Assignment, StudentAssignment.assignment_id == Assignment.id)
        .filter(
            StudentAssignment.student_id == current_student.id,
            Assignment.is_archived.is_(False),
        )
    )

    # 套用篩選條件
    if status:
        try:
            status_enum = AssignmentStatus[status.upper()]
            query = query.filter(StudentAssignment.status == status_enum)
        except KeyError:
            raise HTTPException(status_code=400, detail="Invalid status")

    # 排序：最新的在前，但即將到期的優先
    assignments = query.order_by(
        StudentAssignment.due_date.asc().nullsfirst(),
        StudentAssignment.assigned_at.desc(),
    ).all()

    # 組合回應，加入 Content 資訊
    result = []
    for assignment in assignments:
        # 簡化版 - 不查詢 Content
        content = None

        # 計算剩餘時間
        time_remaining = None
        is_overdue = False
        if assignment.due_date:
            now = datetime.now(timezone.utc)
            if assignment.due_date < now:
                is_overdue = True
                time_remaining = "已過期"
            else:
                delta = assignment.due_date - now
                if delta.days > 0:
                    time_remaining = f"剩餘 {delta.days} 天"
                else:
                    hours = delta.seconds // 3600
                    if hours > 0:
                        time_remaining = f"剩餘 {hours} 小時"
                    else:
                        minutes = (delta.seconds % 3600) // 60
                        time_remaining = f"剩餘 {minutes} 分鐘"

        result.append(
            {
                "id": assignment.id,
                "title": assignment.title,
                "instructions": assignment.instructions,
                "status": assignment.status.value,
                "assigned_at": (
                    assignment.assigned_at.isoformat()
                    if assignment.assigned_at
                    else None
                ),
                "due_date": (
                    assignment.due_date.isoformat() if assignment.due_date else None
                ),
                "submitted_at": (
                    assignment.submitted_at.isoformat()
                    if assignment.submitted_at
                    else None
                ),
                "score": assignment.score,
                "feedback": assignment.feedback,
                "time_remaining": time_remaining,
                "is_overdue": is_overdue,
                "content": (
                    {
                        "id": content.id,
                        "title": content.title,
                        "type": (
                            content.type.value
                            if hasattr(content.type, "value")
                            else str(content.type)
                        ),
                        "items_count": len(content.content_items)
                        if hasattr(content, "content_items")
                        else 0,
                    }
                    if content
                    else None
                ),
            }
        )

    return result


@router.post("/{assignment_id}/submit")
async def submit_assignment(
    assignment_id: int,
    submission_data: dict,
    db: Session = Depends(get_db),
    current_student: Student = Depends(get_current_student),
):
    """
    提交作業
    學生只能提交自己的作業
    """
    # 取得作業
    assignment = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.id == assignment_id,
            StudentAssignment.student_id == current_student.id,
        )
        .first()
    )

    if not assignment:
        raise HTTPException(
            status_code=404, detail="Assignment not found or you don't have permission"
        )

    # 檢查作業狀態
    if assignment.status == AssignmentStatus.GRADED:
        raise HTTPException(
            status_code=400, detail="Assignment has already been graded"
        )

    # 檢查是否過期（但仍允許提交）
    is_late = False
    if assignment.due_date and assignment.due_date < datetime.now(timezone.utc):
        is_late = True

    # 更新作業狀態
    assignment.status = AssignmentStatus.SUBMITTED
    assignment.submitted_at = datetime.now(timezone.utc)

    # 更新 StudentContentProgress（新架構）
    # 這裡應該更新相關的 StudentContentProgress 記錄
    # 暫時簡化處理，後續完善

    db.commit()

    return {
        "success": True,
        "message": "作業提交成功" + ("（遲交）" if is_late else ""),
        "submission_time": datetime.now(timezone.utc).isoformat(),
        "is_late": is_late,
    }
