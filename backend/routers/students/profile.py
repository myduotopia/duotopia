"""Student profile management endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, cast, Date
from typing import Dict, Any, Optional

from database import get_db
from models import (
    Student,
    Classroom,
    ClassroomStudent,
    Identity,
    StudentAssignment,
    AssignmentStatus,
)
from models.organization import ClassroomSchool, School, Organization
from auth import (
    verify_password,
    get_password_hash,
    validate_student_password_strength,
)
from utils.classroom_grade import parse_grade
from .dependencies import get_current_student, get_student_id
from .validators import UpdateStudentProfileRequest, UpdatePasswordRequest

router = APIRouter()


def _first_visible_classroom(db: Session, student_id: int) -> Optional[Classroom]:
    """學生目前所屬的第一個「啟用且未刪除」班級（停用／刪除的班學生看不到，#1097）"""
    return (
        db.query(Classroom)
        .join(ClassroomStudent, ClassroomStudent.classroom_id == Classroom.id)
        .filter(
            ClassroomStudent.student_id == student_id,
            ClassroomStudent.is_active.is_(True),
            Classroom.is_active.is_(True),
            Classroom.deleted_at.is_(None),
        )
        .order_by(ClassroomStudent.id)
        .first()
    )


@router.get("/profile")
def get_student_profile(
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """取得當前學生資訊"""
    student_id = current_student.get("sub")
    student = db.query(Student).filter(Student.id == int(student_id)).first()

    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )

    # Get classroom info（只取啟用且未刪除的班級，#1097）
    classroom = _first_visible_classroom(db, student.id)
    classroom_id = classroom.id if classroom else None
    classroom_name = classroom.name if classroom else None
    classroom_grade = parse_grade(classroom.grade) if classroom else None

    return {
        "id": student.id,
        "name": student.name,
        "email": student.email,
        "student_id": student.student_number,
        "classroom_id": classroom_id,
        "classroom_name": classroom_name,
        "classroom_grade": classroom_grade,
        "target_wpm": student.target_wpm,
        "target_accuracy": student.target_accuracy,
    }


@router.get("/me")
def get_current_student_info(
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """取得當前學生資訊 (別名為 /profile)"""
    student_id = current_student.get("sub")
    student = db.query(Student).filter(Student.id == int(student_id)).first()

    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )

    # Get classroom info（只取啟用且未刪除的班級，#1097）
    classroom = _first_visible_classroom(db, student.id)
    classroom_id = classroom.id if classroom else None
    classroom_name = classroom.name if classroom else None
    classroom_grade = parse_grade(classroom.grade) if classroom else None

    # Get 1Campus binding status from Identity
    one_campus_account = None
    if student.identity_id:
        identity = db.query(Identity).filter(Identity.id == student.identity_id).first()
        if identity:
            one_campus_account = identity.one_campus_account

    return {
        "id": student.id,
        "name": student.name,
        "email": student.email,
        "email_verified": student.email_verified,
        "student_id": student.student_number,
        "classroom_id": classroom_id,
        "classroom_name": classroom_name,
        "classroom_grade": classroom_grade,
        "target_wpm": student.target_wpm,
        "target_accuracy": student.target_accuracy,
        # 1Campus binding status
        "one_campus_account": one_campus_account,
        "has_1campus_binding": one_campus_account is not None,
    }


@router.put("/me")
def update_student_profile(
    request: UpdateStudentProfileRequest,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """更新學生個人資料"""
    student_id = current_student.get("sub")
    student = db.query(Student).filter(Student.id == int(student_id)).first()

    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )

    # Update name if provided
    if request.name is not None:
        student.name = request.name

    db.commit()
    db.refresh(student)

    # Get classroom info（只取啟用且未刪除的班級，#1097）
    classroom = _first_visible_classroom(db, student.id)
    classroom_id = classroom.id if classroom else None
    classroom_name = classroom.name if classroom else None
    classroom_grade = parse_grade(classroom.grade) if classroom else None

    return {
        "id": student.id,
        "name": student.name,
        "email": student.email,
        "email_verified": student.email_verified,
        "student_id": student.student_number,
        "classroom_id": classroom_id,
        "classroom_name": classroom_name,
        "classroom_grade": classroom_grade,
        "target_wpm": student.target_wpm,
        "target_accuracy": student.target_accuracy,
    }


@router.put("/me/password")
def update_student_password(
    request: UpdatePasswordRequest,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """更新學生密碼"""
    student_id = current_student.get("sub")
    student = db.query(Student).filter(Student.id == int(student_id)).first()

    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )

    # 取得有效密碼：已遷移至 Identity 就用 Identity 密碼，否則用本地密碼
    effective_hash = student.password_hash
    identity = None
    if student.password_migrated_to_identity and student.identity_id:
        identity = db.query(Identity).filter(Identity.id == student.identity_id).first()
        if identity and identity.password_hash:
            effective_hash = identity.password_hash

    # Verify current password
    if not verify_password(request.current_password, effective_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    # Check if new password is same as current password
    if verify_password(request.new_password, effective_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from current password",
        )

    # Validate new password strength (student: min 6 chars, digits-only OK)
    is_valid, error_msg = validate_student_password_strength(request.new_password)
    if not is_valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)

    # Update password
    new_hash = get_password_hash(request.new_password)
    student.password_hash = new_hash
    student.password_changed = True

    # 有 Identity 就同步更新 Identity 密碼
    if identity:
        identity.password_hash = new_hash

    db.commit()

    return {"message": "Password updated successfully"}


@router.get("/my-classrooms")
def get_my_classrooms(
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """取得當前學生的所有班級列表（只含啟用且未刪除的班級，#1097）"""
    student_id = int(current_student.get("sub"))

    classrooms = (
        db.query(Classroom)
        .join(ClassroomStudent)
        .outerjoin(ClassroomSchool, Classroom.id == ClassroomSchool.classroom_id)
        .outerjoin(School, ClassroomSchool.school_id == School.id)
        .outerjoin(Organization, School.organization_id == Organization.id)
        .options(
            joinedload(Classroom.classroom_schools)
            .joinedload(ClassroomSchool.school)
            .joinedload(School.organization),
            joinedload(Classroom.teacher),
        )
        .filter(
            ClassroomStudent.student_id == student_id,
            ClassroomStudent.is_active.is_(True),
            Classroom.is_active.is_(True),
            Classroom.deleted_at.is_(None),
        )
        .all()
    )

    result = []
    for cr in classrooms:
        cr_info = {
            "id": cr.id,
            "name": cr.name,
            "grade": parse_grade(cr.grade),
            "teacher_name": cr.teacher.name if cr.teacher else None,
        }
        cs = next((c for c in (cr.classroom_schools or []) if c.is_active), None)
        if cs and cs.school:
            cr_info["school_id"] = str(cs.school.id)
            cr_info["school_name"] = cs.school.name
            if cs.school.organization:
                cr_info["organization_id"] = str(cs.school.organization.id)
                cr_info["organization_name"] = cs.school.organization.name
        result.append(cr_info)

    return {"classrooms": result, "count": len(result)}


@router.get("/stats")
def get_student_stats(
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """Get current student statistics for dashboard"""
    student_id = current_student.get("sub")

    # Calculate completed assignments (GRADED status)
    completed_count = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.student_id == int(student_id),
            StudentAssignment.status == AssignmentStatus.GRADED,
        )
        .count()
    )

    # Calculate average score from graded assignments
    graded_assignments = (
        db.query(StudentAssignment.score)
        .filter(
            StudentAssignment.student_id == int(student_id),
            StudentAssignment.status == AssignmentStatus.GRADED,
            StudentAssignment.score.isnot(None),
        )
        .all()
    )

    average_score = 0
    if graded_assignments:
        total_scores = [
            score[0] for score in graded_assignments if score[0] is not None
        ]
        if total_scores:
            average_score = round(sum(total_scores) / len(total_scores))

    # Calculate total practice time (sum of all submitted assignments' durations)
    # For now, estimate based on number of submissions (10 min per assignment)
    submitted_count = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.student_id == int(student_id),
            StudentAssignment.status.in_(
                [
                    AssignmentStatus.SUBMITTED,
                    AssignmentStatus.GRADED,
                    AssignmentStatus.RESUBMITTED,
                ]
            ),
        )
        .count()
    )
    total_practice_time = submitted_count * 10  # 10 minutes per assignment

    # Calculate practice days (累積練習天數 - 有幾天有練習過)
    # Count distinct dates where student submitted assignments
    practice_days_result = (
        db.query(func.count(func.distinct(cast(StudentAssignment.submitted_at, Date))))
        .filter(
            StudentAssignment.student_id == int(student_id),
            StudentAssignment.submitted_at.isnot(None),
        )
        .scalar()
    )
    practice_days = practice_days_result or 0

    return {
        "completedAssignments": completed_count,
        "averageScore": average_score,
        "totalPracticeTime": total_practice_time,
        "practiceDays": practice_days,  # 累積練習天數
    }
