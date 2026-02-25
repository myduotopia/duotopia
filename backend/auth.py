from datetime import datetime, timedelta  # noqa: F401
from typing import Optional, Dict, Any  # noqa: F401
from jose import JWTError, jwt
import bcrypt
from sqlalchemy.orm import Session
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from models import Teacher, Student
from database import get_session_local, SessionLocal
import os
from dotenv import load_dotenv

load_dotenv()

# Test workflow trigger: 2025-11-10

# 🔐 Security: No default values for secrets
SECRET_KEY = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")

# 🔐 Production 強制檢查：必須設定 JWT_SECRET
ENVIRONMENT = os.getenv("ENVIRONMENT", "local")
if ENVIRONMENT == "production" and SECRET_KEY == "your-secret-key-change-in-production":
    raise RuntimeError(
        "❌ SECURITY ERROR: JWT_SECRET must be set in production! "
        "Generate one with: python -c 'import secrets; print(secrets.token_urlsafe(64))'"
    )

ALGORITHM = "HS256"  # Hardcoded to prevent 'none' algorithm attack
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "30"))

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """驗證密碼"""
    # 🔐 Handle None hash gracefully (return False)
    # But raise error for None password (security: never accept None as valid password)
    if plain_password is None:
        raise TypeError("Password cannot be None")

    if hashed_password is None:
        return False

    # Ensure password is encoded properly and truncated if needed
    password_bytes = plain_password.encode("utf-8")[:72]
    hashed_bytes = (
        hashed_password.encode("utf-8")
        if isinstance(hashed_password, str)
        else hashed_password
    )
    return bcrypt.checkpw(password_bytes, hashed_bytes)


def validate_password_strength(password: str) -> tuple[bool, str]:
    """
    驗證密碼強度
    Returns: (is_valid, error_message)
    """
    if len(password) < 8:
        return False, "Password must be at least 8 characters"

    # 檢查是否包含大寫字母
    if not any(c.isupper() for c in password):
        return False, "Password must contain at least one uppercase letter"

    # 檢查是否包含小寫字母
    if not any(c.islower() for c in password):
        return False, "Password must contain at least one lowercase letter"

    # 檢查是否包含數字
    if not any(c.isdigit() for c in password):
        return False, "Password must contain at least one number"

    # 檢查是否包含特殊字元
    special_chars = "!@#$%^&*()_+-=[]{}|;:,.<>?"
    if not any(c in special_chars for c in password):
        return (
            False,
            "Password must contain at least one special character (!@#$%^&* etc.)",
        )

    return True, ""


def get_password_hash(password: str) -> str:
    """密碼雜湊"""
    # Ensure password is encoded properly and truncated if needed
    password_bytes = password.encode("utf-8")[:72]
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode("utf-8")


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """建立 JWT token"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_token(token: str):
    """驗證 JWT token"""
    if token is None:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except (JWTError, AttributeError):
        return None


def authenticate_teacher(db: Session, email: str, password: str):
    """教師認證"""
    teacher = db.query(Teacher).filter(Teacher.email == email).first()
    if not teacher:
        return None
    if not verify_password(password, teacher.password_hash):
        return None
    return teacher


def authenticate_student(db: Session, email: str, password: str):
    """學生認證（支援 StudentIdentity 統一密碼）"""
    student = db.query(Student).filter(Student.email == email).first()
    if not student:
        return None

    # 判斷使用哪個密碼來源
    password_hash = _get_student_password_hash(db, student)
    if not verify_password(password, password_hash):
        return None
    return student


def _get_student_password_hash(db: Session, student) -> str:
    """取得學生的有效密碼 hash

    已遷移到 Identity 的帳號使用 Identity 的統一密碼，
    否則使用 Student 自身的密碼。
    """
    if student.password_migrated_to_identity and student.identity_id:
        from models.user import StudentIdentity

        identity = (
            db.query(StudentIdentity)
            .filter(StudentIdentity.id == student.identity_id)
            .first()
        )
        if identity:
            return identity.password_hash
    return student.password_hash


async def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
) -> Dict[str, Any]:
    """從 token 取得當前使用者資訊"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if token is None:
        raise credentials_exception

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        user_type: str = payload.get("type")

        if user_id is None or user_type is None:
            raise credentials_exception

        return payload
    except JWTError:
        raise credentials_exception


async def get_current_student(
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    """取得當前登入的學生（返回 Student model 實例）

    注意：這個函數僅允許學生訪問，不允許老師預覽。
    如果需要允許老師預覽，請使用 get_current_student_or_teacher
    """
    # 驗證必須是學生
    user_type = current_user.get("type")
    if user_type != "student":
        raise HTTPException(
            status_code=403, detail="Only students can access this endpoint"
        )

    # 從資料庫查詢 Student 對象
    user_id = current_user.get("sub")
    SessionLocal = get_session_local()
    db = SessionLocal()
    try:
        student = db.query(Student).filter(Student.id == int(user_id)).first()

        if not student:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Student not found",
            )

        return student
    finally:
        db.close()


async def get_current_student_or_teacher(
    current_user: Dict[str, Any] = Depends(get_current_user),
    db: Any = Depends(lambda: None),  # Will be injected by endpoint's db parameter
):
    """取得當前登入的使用者（學生或老師）

    用於支援老師預覽功能的 API endpoint
    - 如果是學生，返回 Student 實例的資訊 dict
    - 如果是老師，返回包含 user_type 的 dict

    重要：這個函數需要和 db Session 一起使用
    使用方式：
    ```python
    async def my_endpoint(
        user = Depends(get_current_student_or_teacher),
        db: Session = Depends(get_db),
    ):
        if user.get("user_type") == "student":
            student_id = user["user_id"]
            # 使用 student_id 查詢資料庫
        else:
            # 老師預覽邏輯
    ```
    """
    user_type = current_user.get("type")
    user_id = current_user.get("sub")

    # 使用臨時 session 僅用於驗證
    temp_db = SessionLocal()
    try:
        if user_type == "student":
            # 驗證學生存在
            try:
                student = (
                    temp_db.query(Student).filter(Student.id == int(user_id)).first()
                )
                if not student:
                    print(f"❌ Student not found: user_id={user_id}")
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail=f"Student not found: user_id={user_id}",
                    )
                # 返回學生資訊（不返回 ORM 對象，避免 lazy loading 問題）
                print(f"✅ Student authenticated: id={student.id}, name={student.name}")
                return {
                    "user_type": "student",
                    "user_id": int(user_id),
                    "student_id": student.id,
                    "name": student.name,
                    "email": student.email,
                }
            except Exception as e:
                print(f"❌ Error in get_current_student_or_teacher: {e}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Authentication error: {str(e)}",
                )

        elif user_type == "teacher":
            # 驗證老師存在
            teacher = temp_db.query(Teacher).filter(Teacher.id == int(user_id)).first()
            if not teacher:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Teacher not found",
                )
            # 返回老師資訊
            return {
                "user_type": "teacher",
                "user_id": int(user_id),
                "teacher_id": teacher.id,
                "name": teacher.name,
                "email": teacher.email,
            }
        else:
            raise HTTPException(status_code=403, detail="Invalid user type")
    finally:
        temp_db.close()
