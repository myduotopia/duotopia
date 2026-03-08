from fastapi import APIRouter, Depends, HTTPException, status, Body, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from typing import Optional  # noqa: F401
from pydantic import BaseModel, EmailStr
from database import get_db
from models import (
    Teacher,
    Student,
    ClassroomStudent,
    ClassroomSchool,
    School,
    Organization,
    TeacherOrganization,
    TeacherSchool,
)
from auth import (
    verify_password,
    create_access_token,
    get_password_hash,
    verify_token,
    validate_password_strength,
)
from services.email_service import email_service
from datetime import datetime, timedelta
from core.limiter import limiter

router = APIRouter(prefix="/api/auth", tags=["authentication"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/teacher/login")


# ============ Request/Response Models ============
class TeacherLoginRequest(BaseModel):
    email: EmailStr
    password: str


class StudentLoginRequest(BaseModel):
    id: int  # 學生資料庫主鍵 ID
    password: str


class TeacherRegisterRequest(BaseModel):
    email: EmailStr
    password: str
    name: str
    phone: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: dict


class RegisterResponse(BaseModel):
    message: str
    email: str
    verification_required: bool


# ============ Teacher Authentication ============
@router.post("/teacher/login", response_model=TokenResponse)
@limiter.limit("3/minute")  # 每分鐘最多 3 次登入嘗試 (DDoS 防護)
async def teacher_login(
    request: Request, login_req: TeacherLoginRequest, db: Session = Depends(get_db)
):
    """教師登入"""
    import logging

    logger = logging.getLogger(__name__)

    logger.info(f"🔍 Login attempt for email: {login_req.email}")
    teacher = db.query(Teacher).filter(Teacher.email == login_req.email).first()

    # 🔐 Security: 統一錯誤訊息，不洩漏帳號是否存在
    if not teacher:
        logger.error(f"❌ Teacher not found for email: {login_req.email}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )

    logger.info(f"✅ Teacher found: id={teacher.id}, email={teacher.email}")
    logger.info(f"   - is_active: {teacher.is_active}")
    logger.info(f"   - email_verified: {teacher.email_verified}")

    password_valid = verify_password(login_req.password, teacher.password_hash)
    logger.info(f"🔑 Password verification result: {password_valid}")

    if not password_valid:
        logger.error(f"❌ Password verification failed for email: {login_req.email}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )

    logger.info(f"✅ Password verified successfully")

    if not teacher.is_active:
        # 檢查是否是因為 email 未驗證
        if not teacher.email_verified:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Please verify your email address before logging in. Check your inbox for verification link.",
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive"
            )

    # Sync Casbin roles on login
    try:
        from services.casbin_service import get_casbin_service

        casbin_service = get_casbin_service()
        casbin_service.sync_teacher_roles(teacher.id)
    except Exception as e:
        # Log error but don't fail login
        import logging

        logger = logging.getLogger(__name__)
        logger.error(
            f"Failed to sync Casbin roles for teacher {teacher.id} on login: {e}"
        )

    # Query organization role
    teacher_org = (
        db.query(TeacherOrganization)
        .filter(
            TeacherOrganization.teacher_id == teacher.id,
            TeacherOrganization.is_active.is_(True),
        )
        .first()
    )

    # Query school role
    teacher_school = (
        db.query(TeacherSchool)
        .filter(
            TeacherSchool.teacher_id == teacher.id,
            TeacherSchool.is_active.is_(True),
        )
        .first()
    )

    # Determine role (priority: org > school > teacher)
    role = "teacher"  # default
    organization_id = None
    school_id = None

    if teacher_org:
        role = teacher_org.role  # org_owner, org_admin, etc.
        organization_id = str(teacher_org.organization_id)
    elif teacher_school:
        # TeacherSchool uses 'roles' array, get the first one or 'teacher' as default
        if teacher_school.roles and len(teacher_school.roles) > 0:
            role = teacher_school.roles[0]  # school_admin or teacher
        school_id = str(teacher_school.school_id)

    # Create token
    access_token = create_access_token(
        data={
            "sub": str(teacher.id),
            "email": teacher.email,
            "type": "teacher",
            "name": teacher.name,
            "role": role,
        },
        expires_delta=timedelta(hours=24),  # 24 hours for development
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": teacher.id,
            "email": teacher.email,
            "name": teacher.name,
            "phone": teacher.phone,
            "is_demo": teacher.is_demo,
            "is_admin": teacher.is_admin,
            "role": role,
            "organization_id": organization_id,
            "school_id": school_id,
        },
    }


@router.post("/teacher/register", response_model=RegisterResponse)
# 註冊不應有嚴格限制，由 middleware 統一管理即可
async def teacher_register(
    request: Request,
    register_req: TeacherRegisterRequest,
    db: Session = Depends(get_db),
):
    """教師註冊"""
    # 🔐 Security: 驗證密碼強度
    is_valid, error_msg = validate_password_strength(register_req.password)
    if not is_valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)

    # Check if email exists
    existing = db.query(Teacher).filter(Teacher.email == register_req.email).first()
    if existing:
        # 如果已經驗證，不允許重複註冊
        if existing.email_verified:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered and verified",
            )
        else:
            # 如果未驗證，刪除舊的未驗證帳號，允許重新註冊
            db.delete(existing)
            db.commit()

    # Create new teacher (未啟用，需要 email 驗證)
    new_teacher = Teacher(
        email=register_req.email,
        password_hash=get_password_hash(register_req.password),
        name=register_req.name,
        phone=register_req.phone,
        is_active=False,  # 🔴 未啟用，需要 email 驗證
        is_demo=False,
        email_verified=False,  # 🔴 未驗證 email
        # subscription_end_date 留空，驗證後才設定
    )

    db.add(new_teacher)
    db.commit()
    db.refresh(new_teacher)

    # 🆕 Issue #61: Trigger onboarding immediately for new teacher
    try:
        from services.onboarding import OnboardingService
        import logging

        logger = logging.getLogger(__name__)
        logger.info(
            f"Triggering onboarding for newly registered teacher {new_teacher.id}"
        )

        onboarding_service = OnboardingService(db=db)
        await onboarding_service.trigger_onboarding(new_teacher.id)

        logger.info(f"Onboarding completed for teacher {new_teacher.id}")
    except Exception as e:
        # Log error but don't fail registration
        import logging

        logger = logging.getLogger(__name__)
        logger.error(f"Onboarding failed for teacher {new_teacher.id}: {e}")
        # User can still complete registration and login, just without default resources

    # 🎯 發送驗證 email
    email_sent = email_service.send_teacher_verification_email(db, new_teacher)

    if not email_sent:
        # 如果發送失敗，仍然創建帳號但給予警告
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Registration successful but verification email failed to send. Please contact support.",
        )

    # 🔴 不再自動登入，需要先驗證 email
    return {
        "message": "Registration successful! Please check your email to verify your account.",
        "email": new_teacher.email,
        "verification_required": True,
    }


# ============ Email 驗證 ============
@router.get("/verify-teacher")
async def verify_teacher_email(token: str, db: Session = Depends(get_db)):
    """驗證教師 email 並啟動 30 天訂閱"""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification token is required",
        )

    # 驗證 token 並啟動訂閱
    teacher = email_service.verify_teacher_email_token(db, token)

    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification token",
        )

    # 不自動登入，只返回驗證成功訊息
    return {
        "status": "success",
        "message": "Email verified successfully! Your 30-day free trial has started.",
        "user": {
            "id": teacher.id,
            "email": teacher.email,
            "name": teacher.name,
            "email_verified": True,
            "subscription_status": teacher.subscription_status,
            "days_remaining": teacher.days_remaining,
        },
    }


@router.post("/resend-verification")
async def resend_verification_email(request: dict, db: Session = Depends(get_db)):
    """重新發送驗證 email"""
    email = request.get("email")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Email is required"
        )

    teacher = db.query(Teacher).filter(Teacher.email == email).first()
    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found"
        )

    if teacher.email_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Email already verified"
        )

    success = email_service.resend_teacher_verification_email(db, teacher)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Please wait before requesting another verification email",
        )

    return {"message": "Verification email sent successfully"}


# ============ Student Authentication ============
@router.post("/student/login", response_model=TokenResponse)
@limiter.limit("3/minute")  # 每分鐘最多 3 次登入嘗試 (DDoS 防護)
async def student_login(
    request: Request, login_req: StudentLoginRequest, db: Session = Depends(get_db)
):
    """學生登入"""
    student = db.query(Student).filter(Student.id == login_req.id).first()

    # 🔐 Security: 統一錯誤訊息，不洩漏帳號是否存在
    if not student:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )

    # 驗證密碼（支援 Identity 統一密碼）
    from auth import _get_student_password_hash

    password_hash = _get_student_password_hash(db, student)
    if not verify_password(login_req.password, password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )

    # Query classroom's school and organization
    school_name = None
    organization_name = None

    # Get student's active classroom enrollment
    classroom_student = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.student_id == student.id,
            ClassroomStudent.is_active.is_(True),
        )
        .first()
    )

    if classroom_student:
        # Get classroom's school via ClassroomSchool
        classroom_school = (
            db.query(ClassroomSchool)
            .filter(
                ClassroomSchool.classroom_id == classroom_student.classroom_id,
                ClassroomSchool.is_active.is_(True),
            )
            .first()
        )

        if classroom_school:
            # Get school info
            school = (
                db.query(School).filter(School.id == classroom_school.school_id).first()
            )
            if school and school.is_active:
                school_name = school.display_name or school.name

                # Get school's organization
                organization = (
                    db.query(Organization)
                    .filter(Organization.id == school.organization_id)
                    .first()
                )
                if organization and organization.is_active:
                    organization_name = organization.display_name or organization.name

    # 創建 JWT token
    access_token = create_access_token(
        data={
            "sub": str(student.id),
            "email": student.email,
            "type": "student",
            "name": student.name,
            "student_number": student.student_number,
        },
        expires_delta=timedelta(hours=24),
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": student.id,
            "email": student.email,
            "name": student.name,
            "student_number": student.student_number,
            "school_name": school_name,
            "organization_name": organization_name,
        },
    }


@router.get("/me")
async def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
):
    """取得當前登入的使用者資訊"""
    # 解碼 token
    payload = verify_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 取得使用者類型和 ID
    user_id = payload.get("sub")
    user_type = payload.get("type")

    if not user_id or not user_type:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload"
        )

    # 根據類型取得使用者
    if user_type == "teacher":
        user = db.query(Teacher).filter(Teacher.id == int(user_id)).first()
    elif user_type == "student":
        user = db.query(Student).filter(Student.id == int(user_id)).first()
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user type"
        )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    return user


@router.get("/validate")
async def validate_token():
    """驗證 API 是否正常運作"""
    return {"status": "auth endpoint working", "version": "1.0.0"}


# ========== 密碼重設功能 ==========


@router.post("/teacher/forgot-password")
@limiter.limit("3/hour")  # 每小時最多 3 次密碼重設請求
async def forgot_password(
    request: Request, email: str = Body(..., embed=True), db: Session = Depends(get_db)
):
    """教師忘記密碼 - 發送重設郵件"""
    # 查找教師
    teacher = db.query(Teacher).filter(Teacher.email == email).first()

    # 不論是否找到都返回相同訊息（安全性考量）
    if not teacher:
        return {"message": "如果該電子郵件存在，我們已發送密碼重設連結", "success": True}

    # 檢查是否已驗證 email
    if not teacher.email_verified:
        return {"message": "如果該電子郵件存在，我們已發送密碼重設連結", "success": True}

    # 檢查發送頻率限制（5分鐘內不能重複發送）
    if teacher.password_reset_sent_at:
        # 確保兩個時間都是 naive 或都是 aware
        current_time = datetime.utcnow()
        reset_time = teacher.password_reset_sent_at
        # 如果 reset_time 是 aware，轉換為 naive
        if reset_time.tzinfo is not None:
            reset_time = reset_time.replace(tzinfo=None)

        time_diff = current_time - reset_time
        if time_diff < timedelta(minutes=5):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="請稍後再試，密碼重設郵件每5分鐘只能發送一次",
            )

    # 發送密碼重設郵件
    success = email_service.send_password_reset_email(db, teacher)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="發送郵件失敗，請稍後再試"
        )

    return {"message": "如果該電子郵件存在，我們已發送密碼重設連結", "success": True}


@router.post("/teacher/reset-password")
async def reset_password(
    token: str = Body(...), new_password: str = Body(...), db: Session = Depends(get_db)
):
    """使用 token 重設密碼"""
    # 查找擁有此 token 的教師
    teacher = db.query(Teacher).filter(Teacher.password_reset_token == token).first()

    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="無效或過期的重設連結"
        )

    # 檢查 token 是否過期
    if teacher.password_reset_expires_at:
        current_time = datetime.utcnow()
        expires_at = teacher.password_reset_expires_at
        # 如果 expires_at 是 aware，轉換為 naive
        if expires_at.tzinfo is not None:
            expires_at = expires_at.replace(tzinfo=None)

        if current_time > expires_at:
            # 清除過期的 token
            teacher.password_reset_token = None
            teacher.password_reset_expires_at = None
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="重設連結已過期，請重新申請"
            )

    # 🔐 Security: 驗證密碼強度
    is_valid, error_msg = validate_password_strength(new_password)
    if not is_valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)

    # 更新密碼
    teacher.password_hash = get_password_hash(new_password)

    # 清除 token
    teacher.password_reset_token = None
    teacher.password_reset_sent_at = None
    teacher.password_reset_expires_at = None

    db.commit()

    return {"message": "密碼已成功重設", "success": True}


@router.get("/teacher/verify-reset-token")
async def verify_reset_token(token: str, db: Session = Depends(get_db)):
    """驗證密碼重設 token 是否有效"""

    # 查找擁有此 token 的教師
    teacher = db.query(Teacher).filter(Teacher.password_reset_token == token).first()

    if not teacher:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="無效的重設連結")

    # 檢查 token 是否過期
    if teacher.password_reset_expires_at:
        current_time = datetime.utcnow()
        expires_at = teacher.password_reset_expires_at
        # 如果 expires_at 是 aware，轉換為 naive
        if expires_at.tzinfo is not None:
            expires_at = expires_at.replace(tzinfo=None)

        if current_time > expires_at:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="重設連結已過期"
            )

    return {"valid": True, "email": teacher.email, "name": teacher.name}
