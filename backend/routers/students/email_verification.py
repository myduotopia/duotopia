"""Student email verification endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Dict, Any

from database import get_db
from models import Student
from auth import get_current_user
from .validators import EmailUpdateRequest
from .dependencies import get_current_student

router = APIRouter()


@router.post("/update-email")
async def update_student_email(
    request: EmailUpdateRequest,
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """更新學生 email (簡化版本用於前端)"""
    from services.email_service import email_service

    student_id = int(current_student.get("sub"))
    student = db.query(Student).filter(Student.id == student_id).first()

    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )

    from services.identity_service import identity_service

    # 更新 email
    student.email = request.email
    student.email_verified = False
    student.email_verified_at = None

    # 建立/關聯 Identity（未驗證狀態，失敗不阻擋 email 更新）
    identity = identity_service.ensure_identity_on_email_bind(
        db, student, request.email
    )
    if not identity:
        import logging

        logging.getLogger(__name__).warning(
            f"Failed to create/link identity for student {student.id}, "
            f"email update continues without identity"
        )

    # 發送驗證信
    success = email_service.send_verification_email(db, student, request.email)

    db.commit()

    return {
        "message": "Email updated and verification email sent",
        "email": request.email,
        "verified": False,
        "verification_sent": success,
    }


@router.post("/unbind-email")
async def unbind_student_email(
    current_student: Dict[str, Any] = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """解除學生 email 綁定"""
    student_id = int(current_student.get("sub"))
    student = db.query(Student).filter(Student.id == student_id).first()

    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )

    from services.identity_service import identity_service

    # 解除 Identity 關聯
    if student.identity_id:
        identity_service._unlink_student_from_identity(db, student)

    # 清除 email 相關欄位
    student.email = None
    student.email_verified = False
    student.email_verified_at = None
    student.email_verification_token = None
    student.email_verification_sent_at = None

    db.commit()

    return {
        "message": "Email unbind successfully",
        "email": None,
        "verified": False,
    }


@router.post("/{student_id}/email/request-verification")
async def request_email_verification(
    student_id: int,
    email_request: Dict[str, str],
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """請求發送 email 驗證信"""
    from services.email_service import email_service
    from services.identity_service import identity_service

    # 確認是學生本人
    if (
        current_user.get("type") != "student"
        or int(current_user.get("sub")) != student_id
    ):
        raise HTTPException(status_code=403, detail="Unauthorized")

    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # 檢查是否已經驗證
    if student.email_verified:
        return {"message": "Email already verified", "verified": True}

    email = email_request.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")

    # 建立/關聯 Identity（未驗證狀態，失敗不阻擋驗證流程）
    identity = identity_service.ensure_identity_on_email_bind(db, student, email)
    if not identity:
        import logging

        logging.getLogger(__name__).warning(
            f"Failed to create/link identity for student {student.id}, "
            f"verification continues without identity"
        )

    # 發送驗證信
    success = email_service.send_verification_email(db, student, email)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to send verification email")

    return {
        "message": "Verification email sent successfully",
        "email": email,
        "verification_sent": True,
    }


@router.post("/{student_id}/email/resend-verification")
async def resend_email_verification(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """重新發送驗證信"""
    from services.email_service import email_service

    # 確認是學生本人
    if (
        current_user.get("type") != "student"
        or int(current_user.get("sub")) != student_id
    ):
        raise HTTPException(status_code=403, detail="Unauthorized")

    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # 檢查是否已經驗證
    if student.email_verified:
        return {"message": "Email already verified", "verified": True}

    # 檢查是否有 email（且不是系統生成的）
    if not student.email or "@duotopia.local" in student.email:
        raise HTTPException(status_code=400, detail="No valid email to verify")

    # 重新發送
    success = email_service.resend_verification_email(db, student)
    if not success:
        raise HTTPException(
            status_code=429, detail="Please wait 5 minutes before requesting again"
        )

    return {
        "message": "Verification email resent successfully",
        "email": student.email,
        "verification_sent": True,
    }


@router.get("/verify-email/{token}")
async def verify_email(token: str, db: Session = Depends(get_db)):
    """驗證 email token，並觸發身分整合"""
    from services.email_service import email_service
    from services.identity_service import identity_service

    student = email_service.verify_email_token(db, token)
    if not student:
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    # 更新 Identity 驗證狀態 + 密碼遷移
    identity = identity_service.on_email_verified(db, student)

    # Path B: If this Identity is a 1Campus SSO account, perform bind/merge
    bound_identity = None
    if identity and identity.one_campus_account and identity.email_verified:
        bound_identity = identity_service.bind_1campus_identity_to_email(
            db, identity, student.email, user_type="student"
        )
        # If merge happened, update student's identity_id to the surviving one
        if bound_identity and bound_identity.id != identity.id:
            db.refresh(student)
            identity = bound_identity

    # 將 identity_id 同步到所有同 email 的 sibling students
    if student.identity_id and student.email:
        siblings = (
            db.query(Student)
            .filter(
                Student.email == student.email,
                Student.id != student.id,
                Student.is_active.is_(True),
                Student.identity_id.is_(None),
            )
            .all()
        )
        for sibling in siblings:
            sibling.identity_id = student.identity_id

    db.commit()

    linked_count = 0
    if identity:
        db.refresh(identity)
        linked_count = len(
            [s for s in identity.linked_students if s.id != student.id and s.is_active]
        )

    return {
        "message": "Email 驗證成功",
        "student_name": student.name,
        "email": student.email,
        "verified": True,
        "identity_consolidated": identity is not None,
        "linked_accounts_count": linked_count,
        "one_campus_bound": bound_identity is not None,
    }


@router.get("/{student_id}/email-status")
async def get_email_status(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """獲取 email 驗證狀態"""
    # 確認是學生本人
    if (
        current_user.get("type") != "student"
        or int(current_user.get("sub")) != student_id
    ):
        raise HTTPException(status_code=403, detail="Unauthorized")

    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    return {
        "email": student.email,
        "is_system_email": (
            "@duotopia.local" in student.email if student.email else True
        ),
        "email_verified": student.email_verified,
        "email_verified_at": (
            student.email_verified_at.isoformat() if student.email_verified_at else None
        ),
        "verification_sent_at": (
            student.email_verification_sent_at.isoformat()
            if student.email_verification_sent_at
            else None
        ),
    }
