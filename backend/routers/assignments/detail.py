"""
Assignment detail and progress endpoints
"""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from sqlalchemy import text, func

from database import get_db
from models import (
    Teacher,
    Student,
    Classroom,
    ClassroomStudent,
    Content,
    ContentItem,
    Assignment,
    AssignmentContent,
    StudentAssignment,
    StudentItemProgress,
)
from .dependencies import get_current_teacher

router = APIRouter()

# Auto-graded practice modes (matching students/assignments.py)
AUTO_GRADED_MODES = frozenset({"rearrangement", "word_selection"})


def _get_total_item_count(assignment_id: int, db: Session) -> int:
    """Get total ContentItem count for an assignment via AssignmentContent → Content → ContentItem."""
    return (
        db.query(func.count(ContentItem.id))
        .join(Content, ContentItem.content_id == Content.id)
        .join(AssignmentContent, AssignmentContent.content_id == Content.id)
        .filter(AssignmentContent.assignment_id == assignment_id)
        .scalar()
        or 0
    )


def _is_interim_score(sa, assignment) -> bool:
    """Check if a student assignment should show an interim (provisional) score."""
    return (
        sa is not None
        and sa.score is None
        and sa.status is not None
        and sa.status.value == "IN_PROGRESS"
        and assignment.practice_mode in AUTO_GRADED_MODES
    )


def _compute_interim_score(sa, assignment, db: Session, total_items: int | None = None):
    """
    Compute interim score for IN_PROGRESS auto-graded assignments.
    - GRADED/RETURNED: return sa.score (already finalized)
    - IN_PROGRESS + rearrangement: sum(expected_scores) / total_items
    - IN_PROGRESS + word_selection: calculate_assignment_mastery DB function

    Args:
        total_items: Pre-computed total item count to avoid redundant DB queries.
    """
    if sa.score is not None:
        return sa.score

    practice_mode = assignment.practice_mode
    if not (
        sa.status
        and sa.status.value == "IN_PROGRESS"
        and practice_mode in AUTO_GRADED_MODES
    ):
        return None

    if practice_mode == "rearrangement":
        items = (
            db.query(StudentItemProgress)
            .filter(StudentItemProgress.student_assignment_id == sa.id)
            .all()
        )
        valid_scores = [
            float(p.expected_score) for p in items if p.expected_score is not None
        ]
        if not valid_scores:
            return None
        if total_items is None:
            total_items = _get_total_item_count(assignment.id, db)
        if total_items == 0:
            return None
        return round(sum(valid_scores) / total_items, 1)

    elif practice_mode == "word_selection":
        try:
            result = db.execute(
                text("SELECT * FROM calculate_assignment_mastery(:sa_id)"),
                {"sa_id": sa.id},
            ).fetchone()
        except Exception:
            return None
        if result and result.current_mastery is not None:
            return min(100, round(float(result.current_mastery) * 100, 1))

    return None


@router.get("/{assignment_id}")
async def get_assignment_detail(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    取得作業詳細資訊（新架構）
    """
    # 取得作業
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
            Assignment.is_active.is_(True),
        )
        .first()
    )

    if not assignment:
        raise HTTPException(
            status_code=404, detail="Assignment not found or you don't have permission"
        )

    # 取得內容列表
    assignment_contents = (
        db.query(AssignmentContent)
        .filter(AssignmentContent.assignment_id == assignment_id)
        .order_by(AssignmentContent.order_index)
        .all()
    )

    # 優化：批次查詢所有 content，避免 N+1 問題
    content_ids = [ac.content_id for ac in assignment_contents]
    content_dict = {
        c.id: c for c in db.query(Content).filter(Content.id.in_(content_ids)).all()
    }

    contents = []
    for ac in assignment_contents:
        content = content_dict.get(ac.content_id)
        if content:
            contents.append(
                {
                    "id": content.id,
                    "title": content.title,
                    "type": (
                        content.type.value
                        if hasattr(content.type, "value")
                        else str(content.type)
                    ),
                    "order_index": ac.order_index,
                }
            )

    # 取得學生進度（使用 eager loading 避免 N+1）
    student_assignments = (
        db.query(StudentAssignment)
        .options(selectinload(StudentAssignment.content_progress))
        .filter(
            StudentAssignment.assignment_id == assignment_id,
            StudentAssignment.is_active.is_(True),
        )
        .all()
    )

    # 收集已指派的學生 IDs
    student_ids = [sa.student_id for sa in student_assignments]

    # 取得班級的全部學生，並標示指派狀態
    all_students = (
        db.query(Student)
        .join(ClassroomStudent, Student.id == ClassroomStudent.student_id)
        .filter(
            ClassroomStudent.classroom_id == assignment.classroom_id,
            ClassroomStudent.is_active.is_(True),
            Student.is_active.is_(True),
        )
        .order_by(Student.student_number)
        .all()
    )

    # Pre-compute total item count once (avoids O(N) redundant queries in the loop)
    total_items = _get_total_item_count(assignment.id, db)

    students_progress = []
    for student in all_students:
        # 檢查這個學生是否已被指派
        sa = None
        for student_assignment in student_assignments:
            if student_assignment.student_id == student.id:
                sa = student_assignment
                break

        is_assigned = sa is not None

        # 取得各內容進度（使用預先載入的資料，避免 N+1）
        content_progress = []
        if sa:  # 只有已指派的學生才有進度資料
            # 建立 content_id -> progress 的映射（從預先載入的資料）
            progress_map = {p.content_id: p for p in sa.content_progress}

            for content in contents:
                progress = progress_map.get(content["id"])

                if progress:
                    content_progress.append(
                        {
                            "content_id": content["id"],
                            "content_title": content["title"],
                            "status": (
                                progress.status.value
                                if progress.status
                                else "NOT_STARTED"
                            ),
                            "score": progress.score,
                            "checked": progress.checked,
                            "completed_at": (
                                progress.completed_at.isoformat()
                                if progress.completed_at
                                else None
                            ),
                        }
                    )

        students_progress.append(
            {
                "student_id": student.id,
                "student_name": student.name,
                "student_number": student.student_number,
                "is_assigned": is_assigned,
                "overall_status": (
                    sa.status.value
                    if sa and sa.status
                    else ("NOT_STARTED" if is_assigned else "unassigned")
                ),
                "submitted_at": (
                    sa.submitted_at.isoformat() if sa and sa.submitted_at else None
                ),
                "content_progress": content_progress,
                "score": (
                    _compute_interim_score(sa, assignment, db, total_items=total_items)
                    if sa
                    else None
                ),
                "is_interim_score": _is_interim_score(sa, assignment),
            }
        )

    # Get content_type from first content
    content_type = contents[0]["type"] if contents else None

    return {
        "id": assignment.id,
        "title": assignment.title,
        "description": assignment.description,
        "classroom_id": assignment.classroom_id,
        "due_date": assignment.due_date.isoformat() if assignment.due_date else None,
        "created_at": (
            assignment.created_at.isoformat() if assignment.created_at else None
        ),
        "contents": contents,
        "student_ids": student_ids,
        "students_progress": students_progress,
        # 內容類型與作答模式
        "content_type": content_type,
        "practice_mode": assignment.practice_mode,
        "answer_mode": assignment.answer_mode,
        "time_limit_per_question": assignment.time_limit_per_question,
        "shuffle_questions": assignment.shuffle_questions,
        "play_audio": assignment.play_audio,
        "show_answer": assignment.show_answer,
        "score_category": assignment.score_category,
        "target_proficiency": assignment.target_proficiency,
        "show_translation": assignment.show_translation,
        "show_word": assignment.show_word,
        "show_image": assignment.show_image,
    }


@router.get("/{assignment_id}/progress")
async def get_assignment_progress(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    取得作業的學生進度
    """
    # 確認作業存在且屬於當前教師
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
            Assignment.is_active.is_(True),
        )
        .first()
    )

    if not assignment:
        raise HTTPException(
            status_code=404, detail="Assignment not found or you don't have permission"
        )

    # 取得學生作業進度
    student_assignments = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.assignment_id == assignment_id,
            StudentAssignment.is_active.is_(True),
        )
        .all()
    )

    # 取得班級全部學生
    all_students = (
        db.query(Student)
        .join(ClassroomStudent, Student.id == ClassroomStudent.student_id)
        .filter(
            ClassroomStudent.classroom_id == assignment.classroom_id,
            ClassroomStudent.is_active.is_(True),
            Student.is_active.is_(True),
        )
        .order_by(Student.student_number)
        .all()
    )

    # 優化：使用字典查找避免嵌套循環 O(N*M) 問題
    student_assignments_dict = {sa.student_id: sa for sa in student_assignments}

    # Pre-compute total item count once (avoids O(N) redundant queries in the loop)
    total_items = _get_total_item_count(assignment.id, db)

    progress_list = []
    for student in all_students:
        # 使用字典快速查找，O(1) 時間複雜度
        sa = student_assignments_dict.get(student.id)
        is_assigned = sa is not None

        progress_list.append(
            {
                "student_id": student.id,
                "student_name": student.name,
                "student_number": student.student_number,
                "is_assigned": is_assigned,
                "status": (
                    sa.status.value
                    if sa and sa.status
                    else ("NOT_STARTED" if is_assigned else "unassigned")
                ),
                "submission_date": (
                    sa.submitted_at.isoformat() if sa and sa.submitted_at else None
                ),
                "score": (
                    _compute_interim_score(sa, assignment, db, total_items=total_items)
                    if sa
                    else None
                ),
                "is_interim_score": _is_interim_score(sa, assignment),
                "attempts": 1 if sa and sa.submitted_at else 0,
                "last_activity": (
                    sa.updated_at.isoformat()
                    if sa and sa.updated_at
                    else sa.created_at.isoformat()
                    if sa and sa.created_at
                    else None
                ),
                "timestamps": {
                    "started_at": (
                        sa.started_at.isoformat() if sa and sa.started_at else None
                    ),
                    "submitted_at": (
                        sa.submitted_at.isoformat() if sa and sa.submitted_at else None
                    ),
                    "graded_at": (
                        sa.graded_at.isoformat() if sa and sa.graded_at else None
                    ),
                    "returned_at": (
                        sa.returned_at.isoformat() if sa and sa.returned_at else None
                    ),
                    "resubmitted_at": (
                        sa.resubmitted_at.isoformat()
                        if sa and sa.resubmitted_at
                        else None
                    ),
                    "created_at": (
                        sa.created_at.isoformat() if sa and sa.created_at else None
                    ),
                    "updated_at": (
                        sa.updated_at.isoformat() if sa and sa.updated_at else None
                    ),
                },
            }
        )

    return progress_list


@router.get("/{assignment_id}/students")
async def get_assignment_students(
    assignment_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    獲取作業的所有學生列表（包含未指派的學生）
    """
    # 查詢作業
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id, Assignment.teacher_id == current_teacher.id
        )
        .first()
    )

    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # 獲取教師教室中的所有學生
    classroom_students = (
        db.query(Student)
        .join(ClassroomStudent, ClassroomStudent.student_id == Student.id)
        .filter(ClassroomStudent.classroom_id == assignment.classroom_id)
        .order_by(Student.name)
        .all()
    )

    # 獲取已指派此作業的學生狀態
    student_assignments_dict = {}
    student_assignments = (
        db.query(StudentAssignment)
        .filter(StudentAssignment.assignment_id == assignment_id)
        .all()
    )

    for sa in student_assignments:
        student_assignments_dict[sa.student_id] = (
            sa.status.value if sa.status else "NOT_STARTED"
        )

    students = []
    for student in classroom_students:
        # 如果學生有作業記錄，使用實際狀態；否則標示為未指派
        if student.id in student_assignments_dict:
            status = student_assignments_dict[student.id]
        else:
            status = "NOT_ASSIGNED"

        students.append(
            {
                "student_id": student.id,
                "student_name": student.name,
                "status": status,
            }
        )

    return {"students": students}
