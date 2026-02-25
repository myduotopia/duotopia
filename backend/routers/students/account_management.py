"""Student account management endpoints (account switching, linking, email binding).

Uses StudentIdentity for account linking when available, falls back to
email-based matching for backward compatibility.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from typing import Dict, Any
from datetime import datetime, timedelta

from database import get_db
from models import Student, StudentIdentity, Classroom, ClassroomStudent
from models.organization import ClassroomSchool, School, Organization
from auth import (
    get_current_user,
    create_access_token,
    verify_password,
    _get_student_password_hash,
)
from .validators import SwitchAccountRequest

router = APIRouter()


def _build_account_info(db: Session, student: Student) -> dict:
    """建立帳號資訊（含班級、學校、機構）"""
    # 取得班級
    enrollment = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.student_id == student.id,
            ClassroomStudent.is_active.is_(True),
        )
        .first()
    )

    classroom_info = None
    school_info = None
    organization_info = None

    if enrollment:
        classroom = (
            db.query(Classroom)
            .options(joinedload(Classroom.teacher))
            .filter(Classroom.id == enrollment.classroom_id)
            .first()
        )
        if classroom:
            classroom_info = {
                "id": classroom.id,
                "name": classroom.name,
                "teacher_name": classroom.teacher.name if classroom.teacher else None,
            }

            # 取得學校和機構
            cs = (
                db.query(ClassroomSchool)
                .filter(
                    ClassroomSchool.classroom_id == classroom.id,
                    ClassroomSchool.is_active.is_(True),
                )
                .first()
            )
            if cs:
                school = db.query(School).filter(School.id == cs.school_id).first()
                if school and school.is_active:
                    school_info = {
                        "id": str(school.id),
                        "name": school.display_name or school.name,
                    }
                    if school.organization_id:
                        org = (
                            db.query(Organization)
                            .filter(Organization.id == school.organization_id)
                            .first()
                        )
                        if org and org.is_active:
                            organization_info = {
                                "id": str(org.id),
                                "name": org.display_name or org.name,
                            }

    return {
        "student_id": student.id,
        "name": student.name,
        "student_number": student.student_number,
        "is_primary_account": student.is_primary_account,
        "classroom": classroom_info,
        "school": school_info,
        "organization": organization_info,
        "last_login": (student.last_login.isoformat() if student.last_login else None),
    }


@router.get("/{student_id}/linked-accounts")
async def get_linked_accounts(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """獲取關聯帳號列表（優先使用 Identity，fallback 到 email 比對）"""
    # 確認是學生本人
    if (
        current_user.get("type") != "student"
        or int(current_user.get("sub")) != student_id
    ):
        raise HTTPException(status_code=403, detail="Unauthorized")

    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    linked_students = []

    # 方式 1：透過 StudentIdentity 查詢（首選）
    if student.identity_id:
        linked_students = (
            db.query(Student)
            .filter(
                Student.identity_id == student.identity_id,
                Student.id != student_id,
                Student.is_active.is_(True),
            )
            .all()
        )
    # 方式 2：Fallback - 透過相同已驗證 email 查詢
    elif student.email and student.email_verified:
        linked_students = (
            db.query(Student)
            .filter(
                Student.email == student.email,
                Student.email_verified.is_(True),
                Student.id != student_id,
                Student.is_active.is_(True),
            )
            .all()
        )
    else:
        return {"linked_accounts": [], "message": "No verified email or identity"}

    # 建立帳號資訊
    linked_accounts = [_build_account_info(db, s) for s in linked_students]

    return {
        "linked_accounts": linked_accounts,
        "current_email": student.email,
        "identity_id": student.identity_id,
    }


@router.post("/switch-account")
async def switch_account(
    request: SwitchAccountRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """切換到另一個已連結的學生帳號

    若兩帳號同屬一個 Identity，不需要重新輸入密碼。
    若為 fallback（email 比對），仍需密碼驗證。
    """
    if current_user.get("type") != "student":
        raise HTTPException(status_code=403, detail="Only students can switch accounts")

    current_student_id = int(current_user.get("sub"))
    current_student = db.query(Student).filter(Student.id == current_student_id).first()

    if not current_student:
        raise HTTPException(status_code=404, detail="Current student not found")

    # 查找目標學生
    target_student = (
        db.query(Student).filter(Student.id == request.target_student_id).first()
    )
    if not target_student:
        raise HTTPException(status_code=404, detail="Target student not found")
    if not target_student.is_active:
        raise HTTPException(status_code=400, detail="Target account is inactive")

    # 驗證關聯性
    is_identity_linked = (
        current_student.identity_id is not None
        and current_student.identity_id == target_student.identity_id
    )
    is_email_linked = (
        current_student.email
        and current_student.email_verified
        and target_student.email == current_student.email
        and target_student.email_verified
    )

    if not is_identity_linked and not is_email_linked:
        raise HTTPException(status_code=403, detail="Target account is not linked")

    # Identity 關聯的帳號不需要密碼（密碼已統一）
    # Email fallback 仍需密碼
    if not is_identity_linked and request.password:
        password_hash = _get_student_password_hash(db, target_student)
        if not verify_password(request.password, password_hash):
            raise HTTPException(status_code=401, detail="Invalid password")

    # 更新最後登入時間
    target_student.last_login = datetime.utcnow()
    db.commit()

    # 建立新的 JWT token
    access_token = create_access_token(
        data={"sub": str(target_student.id), "type": "student"},
        expires_delta=timedelta(hours=24),
    )

    account_info = _build_account_info(db, target_student)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "student": account_info,
        "message": "Successfully switched to target account",
    }


@router.delete("/{student_id}/email-binding")
async def unbind_email(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """解除 email 綁定（學生自己或老師都可以操作）

    解除後也會從 StudentIdentity 中移除關聯。
    """
    # 檢查權限：學生本人或老師
    is_student_self = (
        current_user.get("type") == "student"
        and int(current_user.get("sub")) == student_id
    )
    is_teacher = current_user.get("type") == "teacher"

    if not is_student_self and not is_teacher:
        raise HTTPException(status_code=403, detail="Unauthorized")

    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # 如果是老師，檢查學生是否在老師的班級中
    if is_teacher:
        teacher_id = int(current_user.get("sub"))
        student_in_teacher_class = (
            db.query(ClassroomStudent)
            .join(Classroom)
            .filter(
                ClassroomStudent.student_id == student_id,
                Classroom.teacher_id == teacher_id,
                ClassroomStudent.is_active.is_(True),
            )
            .first()
        )
        if not student_in_teacher_class:
            raise HTTPException(
                status_code=403, detail="Student is not in your classroom"
            )

    # 如果有 Identity 關聯，解除
    old_identity_id = student.identity_id
    if student.identity_id:
        # 如果是主帳號，需要轉移主帳號給其他關聯帳號
        if student.is_primary_account:
            other_linked = (
                db.query(Student)
                .filter(
                    Student.identity_id == student.identity_id,
                    Student.id != student_id,
                    Student.is_active.is_(True),
                )
                .first()
            )
            if other_linked:
                # 轉移主帳號
                identity = (
                    db.query(StudentIdentity)
                    .filter(StudentIdentity.id == student.identity_id)
                    .first()
                )
                if identity:
                    identity.primary_student_id = other_linked.id
                    other_linked.is_primary_account = True

        student.identity_id = None
        student.is_primary_account = None
        student.password_migrated_to_identity = False

    # 清除 email 綁定相關資訊
    old_email = student.email
    student.email = None
    student.email_verified = False
    student.email_verified_at = None
    student.email_verification_token = None
    student.email_verification_sent_at = None

    db.commit()

    return {
        "message": "Email binding removed successfully",
        "student_id": student_id,
        "old_email": old_email,
        "removed_by": "teacher" if is_teacher else "student",
        "identity_unlinked": old_identity_id is not None,
    }
