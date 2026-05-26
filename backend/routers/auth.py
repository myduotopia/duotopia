import logging

from fastapi import APIRouter, Depends, HTTPException, status, Body, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import Optional  # noqa: F401
from pydantic import BaseModel, EmailStr, field_validator
from database import get_db
from models import (
    Teacher,
    Student,
    Identity,
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
    validate_student_password_strength,
)
from services.email_service import email_service
from datetime import datetime, timedelta
from core.limiter import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["authentication"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/teacher/login")


# ============ Request/Response Models ============
class TeacherLoginRequest(BaseModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def strip_password(cls, v: str) -> str:
        return v.strip()


class StudentLoginRequest(BaseModel):
    id: int  # 學生資料庫主鍵 ID
    password: str

    @field_validator("password")
    @classmethod
    def strip_password(cls, v: str) -> str:
        return v.strip()


class TeacherRegisterRequest(BaseModel):
    email: EmailStr
    password: str
    name: str
    phone: Optional[str] = None
    # Optional referral code (from ?promo= URL param or input field)
    promo_code: Optional[str] = None

    @field_validator("password")
    @classmethod
    def strip_password(cls, v: str) -> str:
        return v.strip()


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
    teacher = (
        db.query(Teacher)
        .filter(func.lower(Teacher.email) == login_req.email.lower())
        .first()
    )

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

    # 🔒 Email case-insensitive: normalize to lowercase before storing
    normalized_email = register_req.email.strip().lower()

    # Check if email exists (case-insensitive, matches the unique functional index)
    existing = (
        db.query(Teacher).filter(func.lower(Teacher.email) == normalized_email).first()
    )
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
        email=normalized_email,
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

    # 建立個人推銷碼，並（若有填）綁定推薦關係。全程非致命，失敗不影響註冊。
    try:
        from services.promo_code_service import (
            create_personal_code_for_teacher,
            bind_referral,
        )

        create_personal_code_for_teacher(db, new_teacher.id)

        if register_req.promo_code:
            referral = bind_referral(db, register_req.promo_code, new_teacher.id)
            if referral is None:
                logger.info(
                    f"Promo code '{register_req.promo_code}' not bound for "
                    f"teacher {new_teacher.id} (invalid/expired/self-referral)"
                )
            else:
                logger.info(
                    f"Referral {referral.id} bound: teacher {new_teacher.id} "
                    f"referred by {referral.referrer_teacher_id}"
                )
    except Exception as e:
        logger.error(f"Promo code handling failed for teacher {new_teacher.id}: {e}")

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

    # 標記推薦關係已驗證（非致命）。實際發點在獎勵引擎處理。
    try:
        from services.promo_code_service import mark_referral_verified

        mark_referral_verified(db, teacher.id)
    except Exception as e:
        logger.error(f"Marking referral verified failed for teacher {teacher.id}: {e}")

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

    teacher = (
        db.query(Teacher).filter(func.lower(Teacher.email) == email.lower()).first()
    )
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

    # 驗證密碼：已驗證學生用 Identity 統一密碼，未驗證用本地密碼
    effective_hash = student.password_hash
    password_source = "student"
    identity = None
    if student.identity_id:
        identity = db.query(Identity).filter(Identity.id == student.identity_id).first()
        if identity and identity.password_hash:
            effective_hash = identity.password_hash
            password_source = "identity"

    password_matched = verify_password(login_req.password, effective_hash)

    # 🔍 Debug logging: 只在登入失敗時記錄詳細資訊
    if not password_matched:
        # 檢查是否為預設密碼嘗試（YYYYMMDD 格式）
        is_default_password_attempt = (
            len(login_req.password) == 8 and login_req.password.isdigit()
        )
        default_password = student.get_default_password()
        is_trying_default = (
            login_req.password == default_password if default_password else None
        )

        # 檢查 effective_hash 是否為 None 或空
        hash_status = "ok"
        if effective_hash is None:
            hash_status = "None"
        elif not effective_hash:
            hash_status = "empty"

        # 額外測試：輸入的密碼是否匹配另一個來源
        other_source_matched = None
        if password_source == "identity" and student.password_hash:
            other_source_matched = verify_password(
                login_req.password, student.password_hash
            )
        elif password_source == "student" and identity and identity.password_hash:
            other_source_matched = verify_password(
                login_req.password, identity.password_hash
            )

        logger.warning(
            f"[LOGIN-DEBUG] student_login FAILED | "
            f"student_id={student.id} | "
            f"student_name={student.name} | "
            f"password_source={password_source} | "
            f"hash_status={hash_status} | "
            f"identity_id={student.identity_id} | "
            f"email_verified={student.email_verified} | "
            f"password_changed={getattr(student, 'password_changed', None)} | "
            f"is_default_pw_attempt={is_default_password_attempt} | "
            f"is_trying_current_default={is_trying_default} | "
            f"other_source_matched={other_source_matched}"
        )

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
    # 查找教師 (case-insensitive)
    teacher = (
        db.query(Teacher).filter(func.lower(Teacher.email) == email.lower()).first()
    )

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
    new_password = new_password.strip()
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


# ========== 學生密碼重設功能 ==========


@router.post("/student/forgot-password")
@limiter.limit("3/hour")
async def student_forgot_password(
    request: Request, email: str = Body(..., embed=True), db: Session = Depends(get_db)
):
    """學生忘記密碼 - 發送重設郵件（僅限已驗證 email 的學生）

    Note: `Student.email` 查詢維持 case-sensitive 直到 students 表完成資料
    正規化並建立 ix_students_email_lower functional index；見 #648 的 follow-up。
    """
    # 查找學生
    student = db.query(Student).filter(Student.email == email).first()

    # 不論是否找到都返回相同訊息（安全性考量）
    if not student:
        return {"message": "如果該電子郵件存在，我們已發送密碼重設連結", "success": True}

    # 檢查是否已驗證 email（僅已驗證的學生可使用此功能）
    if not student.email_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="此帳號尚未驗證 Email，請聯繫教師恢復預設密碼",
        )

    # 檢查發送頻率限制（5分鐘內不能重複發送）
    if student.password_reset_sent_at:
        current_time = datetime.utcnow()
        reset_time = student.password_reset_sent_at
        if reset_time.tzinfo is not None:
            reset_time = reset_time.replace(tzinfo=None)

        time_diff = current_time - reset_time
        if time_diff < timedelta(minutes=5):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="請稍後再試，密碼重設郵件每5分鐘只能發送一次",
            )

    # 發送密碼重設郵件
    success = email_service.send_student_password_reset_email(db, student)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="發送郵件失敗，請稍後再試"
        )

    return {"message": "如果該電子郵件存在，我們已發送密碼重設連結", "success": True}


@router.post("/student/reset-password")
async def student_reset_password(
    token: str = Body(...), new_password: str = Body(...), db: Session = Depends(get_db)
):
    """學生使用 token 重設密碼"""
    new_password = new_password.strip()
    # 查找擁有此 token 的學生
    student = db.query(Student).filter(Student.password_reset_token == token).first()

    if not student:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="無效或過期的重設連結"
        )

    # 檢查 token 是否過期
    if student.password_reset_expires_at:
        current_time = datetime.utcnow()
        expires_at = student.password_reset_expires_at
        if expires_at.tzinfo is not None:
            expires_at = expires_at.replace(tzinfo=None)

        if current_time > expires_at:
            student.password_reset_token = None
            student.password_reset_expires_at = None
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="重設連結已過期，請重新申請"
            )

    # 🔐 Security: 驗證密碼強度（使用學生版規則：6字元以上）
    is_valid, error_msg = validate_student_password_strength(new_password)
    if not is_valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)

    # 更新密碼
    student.password_hash = get_password_hash(new_password)
    student.password_changed = True

    # 清除 token
    student.password_reset_token = None
    student.password_reset_sent_at = None
    student.password_reset_expires_at = None

    db.commit()

    return {"message": "密碼已成功重設", "success": True}


@router.get("/student/verify-reset-token")
async def student_verify_reset_token(token: str, db: Session = Depends(get_db)):
    """驗證學生密碼重設 token 是否有效"""

    student = db.query(Student).filter(Student.password_reset_token == token).first()

    if not student:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="無效的重設連結")

    # 檢查 token 是否過期
    if student.password_reset_expires_at:
        current_time = datetime.utcnow()
        expires_at = student.password_reset_expires_at
        if expires_at.tzinfo is not None:
            expires_at = expires_at.replace(tzinfo=None)

        if current_time > expires_at:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="重設連結已過期"
            )

    return {"valid": True, "email": student.email, "name": student.name}
