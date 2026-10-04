"""Shared dependencies for student routers."""

from typing import Dict, Any
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Assignment, Classroom, StudentAssignment

# 作業所屬班級已停用或已刪除時，學生端作業內頁回 403 的 detail（前端依此顯示提示，#1097）
CLASSROOM_INACTIVE_DETAIL = "classroom_inactive"

# 學生端作業路由裡代表 StudentAssignment.id 的路徑參數名稱
_STUDENT_ASSIGNMENT_PATH_PARAMS = ("assignment_id", "student_assignment_id")


def get_current_student(
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """Verify current user is a student and return user info."""
    if current_user.get("type") != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint is for students only",
        )
    return current_user


def get_student_id(
    current_student: Dict[str, Any] = Depends(get_current_student)
) -> int:
    """Extract student ID from current user."""
    return int(current_student.get("sub"))


def require_visible_assignment_classroom(
    request: Request,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
) -> None:
    """學生端作業內頁守門：作業所屬班級停用或已刪除 → 403 ``classroom_inactive``（#1097）。

    以 router 層級 dependency 掛在學生作業路由上。路徑沒有作業 id（例如作業列表）
    直接放行；找不到該學生的這份作業也放行，交給端點本身回 404。
    沒有班級的作業（classroom_id 為 NULL）照常可用。
    """
    raw_id = next(
        (
            request.path_params[name]
            for name in _STUDENT_ASSIGNMENT_PATH_PARAMS
            if name in request.path_params
        ),
        None,
    )
    if raw_id is None:
        return
    try:
        student_assignment_id = int(raw_id)
        student_id = int(current_student.get("sub"))
    except (TypeError, ValueError):
        return  # 交給端點的參數驗證處理

    row = (
        db.query(Classroom.is_active, Classroom.deleted_at)
        .select_from(StudentAssignment)
        .join(Assignment, StudentAssignment.assignment_id == Assignment.id)
        .join(Classroom, Assignment.classroom_id == Classroom.id)
        .filter(
            StudentAssignment.id == student_assignment_id,
            StudentAssignment.student_id == student_id,
        )
        .first()
    )
    if row is None:
        return
    is_active, deleted_at = row
    if not is_active or deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=CLASSROOM_INACTIVE_DETAIL,
        )
