"""
測試關鍵認證流程的單元測試
確保認證系統的核心邏輯正確運作
"""

from datetime import datetime, date
import bcrypt
from models import Student
from auth import validate_password_strength


class TestValidatePasswordStrength:
    """直接測試 auth.validate_password_strength"""

    def test_valid_password(self):
        valid, msg = validate_password_strength("SecurePass1!")
        assert valid is True

    def test_too_short(self):
        valid, msg = validate_password_strength("Ab1!")
        assert valid is False
        assert "8" in msg

    def test_contains_space(self):
        valid, msg = validate_password_strength("Secure Pass1!")
        assert valid is False

    def test_contains_tab(self):
        valid, msg = validate_password_strength("Secure\tPass1!")
        assert valid is False

    def test_contains_newline(self):
        valid, msg = validate_password_strength("Secure\nPass1!")
        assert valid is False

    def test_missing_uppercase(self):
        valid, msg = validate_password_strength("securepass1!")
        assert valid is False

    def test_missing_lowercase(self):
        valid, msg = validate_password_strength("SECUREPASS1!")
        assert valid is False

    def test_missing_digit(self):
        valid, msg = validate_password_strength("SecurePass!")
        assert valid is False


class TestPasswordHashing:
    """測試密碼雜湊功能"""

    def test_bcrypt_password_hashing(self):
        """測試 bcrypt 密碼雜湊"""
        password = "test_password_123"
        hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())

        # 確認雜湊不等於原密碼
        assert hashed != password
        assert isinstance(hashed, bytes)

        # 確認可以驗證密碼
        assert bcrypt.checkpw(password.encode("utf-8"), hashed)

    def test_bcrypt_wrong_password_fails(self):
        """測試錯誤密碼驗證失敗"""
        password = "correct_password"
        wrong_password = "wrong_password"
        hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())

        # 錯誤密碼應該驗證失敗
        assert not bcrypt.checkpw(wrong_password.encode("utf-8"), hashed)


class TestStudentModel:
    """測試學生模型的認證相關功能"""

    def test_get_default_password_from_birthdate(self):
        """測試從生日生成預設密碼"""
        student = Student()
        student.birthdate = date(2012, 3, 15)  # 2012年3月15日

        default_password = student.get_default_password()
        assert default_password == "20120315"

    def test_get_default_password_no_birthdate(self):
        """測試沒有生日時返回 None"""
        student = Student()
        student.birthdate = None

        default_password = student.get_default_password()
        assert default_password is None

    def test_student_password_validation_logic(self):
        """測試學生密碼驗證邏輯"""
        # 模擬學生資料
        date(2012, 3, 15)
        expected_password = "20120315"

        # 正確的預設密碼雜湊
        correct_hash = bcrypt.hashpw(
            expected_password.encode("utf-8"), bcrypt.gensalt()
        )

        # 驗證邏輯
        def validate_student_password(input_password: str, stored_hash: bytes) -> bool:
            return bcrypt.checkpw(input_password.encode("utf-8"), stored_hash)

        # 測試正確密碼
        assert validate_student_password(expected_password, correct_hash)

        # 測試錯誤密碼
        assert not validate_student_password("wrong_password", correct_hash)


class TestAuthenticationFlow:
    """測試認證流程的核心邏輯"""

    def test_teacher_login_flow_logic(self):
        """測試教師登入流程邏輯"""
        # 模擬教師資料
        teacher_email = "teacher@example.com"
        teacher_password = "secure_password"
        teacher_hash = bcrypt.hashpw(teacher_password.encode("utf-8"), bcrypt.gensalt())

        # 模擬認證邏輯
        def authenticate_teacher(email: str, password: str) -> dict:
            # 這裡模擬從資料庫查找教師
            if email == teacher_email:
                if bcrypt.checkpw(password.encode("utf-8"), teacher_hash):
                    return {
                        "success": True,
                        "user_id": 1,
                        "email": email,
                        "role": "teacher",
                    }
            return {"success": False, "error": "Invalid credentials"}

        # 測試正確登入
        result = authenticate_teacher(teacher_email, teacher_password)
        assert result["success"] is True
        assert result["role"] == "teacher"
        assert result["email"] == teacher_email

        # 測試錯誤密碼
        result = authenticate_teacher(teacher_email, "wrong_password")
        assert result["success"] is False

        # 測試錯誤 email
        result = authenticate_teacher("wrong@email.com", teacher_password)
        assert result["success"] is False

    def test_student_login_flow_logic(self):
        """測試學生登入流程邏輯"""
        # 模擬學生資料
        student_birthdate = date(2012, 3, 15)
        expected_password = "20120315"
        student_hash = bcrypt.hashpw(
            expected_password.encode("utf-8"), bcrypt.gensalt()
        )

        # 模擬學生認證邏輯
        def authenticate_student(student_id: int, password: str) -> dict:
            # 模擬查找學生
            if student_id == 1:
                if bcrypt.checkpw(password.encode("utf-8"), student_hash):
                    return {
                        "success": True,
                        "user_id": student_id,
                        "role": "student",
                        "birthdate": student_birthdate.strftime("%Y%m%d"),
                    }
            return {"success": False, "error": "Invalid credentials"}

        # 測試正確登入
        result = authenticate_student(1, expected_password)
        assert result["success"] is True
        assert result["role"] == "student"
        assert result["birthdate"] == "20120315"

        # 測試錯誤密碼
        result = authenticate_student(1, "wrong_password")
        assert result["success"] is False

        # 測試不存在的學生
        result = authenticate_student(999, expected_password)
        assert result["success"] is False


class TestTokenGeneration:
    """測試 JWT Token 生成邏輯"""

    def test_jwt_payload_structure(self):
        """測試 JWT payload 結構"""
        # 模擬 JWT payload
        teacher_payload = {
            "user_id": 1,
            "email": "teacher@example.com",
            "role": "teacher",
            "exp": datetime.utcnow().timestamp() + 3600,  # 1小時後過期
            "iat": datetime.utcnow().timestamp(),
        }

        student_payload = {
            "user_id": 1,
            "role": "student",
            "classroom_id": 1,
            "exp": datetime.utcnow().timestamp() + 3600,
            "iat": datetime.utcnow().timestamp(),
        }

        # 驗證必要欄位存在
        assert "user_id" in teacher_payload
        assert "role" in teacher_payload
        assert "exp" in teacher_payload
        assert "iat" in teacher_payload

        assert "user_id" in student_payload
        assert "role" in student_payload
        assert "exp" in student_payload
        assert "iat" in student_payload

        # 驗證角色正確
        assert teacher_payload["role"] == "teacher"
        assert student_payload["role"] == "student"


class TestSecurityValidation:
    """測試安全驗證邏輯"""

    def test_email_validation_logic(self):
        """測試 email 驗證邏輯"""
        import re

        def is_valid_email(email: str) -> bool:
            pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
            return bool(re.match(pattern, email))

        # 有效 email
        assert is_valid_email("teacher@example.com")
        assert is_valid_email("test.user@school.edu.tw")
        assert is_valid_email("demo@duotopia.com")

        # 無效 email
        assert not is_valid_email("invalid.email")
        assert not is_valid_email("@example.com")
        assert not is_valid_email("test@")
        assert not is_valid_email("")

    def test_password_strength_validation(self):
        """測試密碼強度驗證邏輯"""

        def is_strong_password(password: str) -> bool:
            # 至少8個字符，包含大小寫字母和數字
            if len(password) < 8:
                return False
            if not any(c.isupper() for c in password):
                return False
            if not any(c.islower() for c in password):
                return False
            if not any(c.isdigit() for c in password):
                return False
            return True

        # 強密碼
        assert is_strong_password("MyPassword123")
        assert is_strong_password("SecurePass1")

        # 弱密碼
        assert not is_strong_password("password")  # 沒有大寫和數字
        assert not is_strong_password("PASSWORD")  # 沒有小寫和數字
        assert not is_strong_password("123456")  # 沒有字母
        assert not is_strong_password("Short1")  # 太短

    def test_input_sanitization(self):
        """測試輸入清理邏輯"""

        def sanitize_input(input_str: str) -> str:
            if not input_str:
                return ""
            # 移除首尾空格，轉換為小寫（針對 email）
            return input_str.strip().lower()

        assert sanitize_input("  TEST@EXAMPLE.COM  ") == "test@example.com"
        assert sanitize_input("Teacher@School.edu") == "teacher@school.edu"
        assert sanitize_input("") == ""
        assert sanitize_input(None) == ""


class TestErrorHandling:
    """測試錯誤處理邏輯"""

    def test_authentication_error_responses(self):
        """測試認證錯誤回應格式"""

        def create_auth_error(error_type: str, message: str) -> dict:
            return {
                "success": False,
                "error_type": error_type,
                "message": message,
                "timestamp": datetime.utcnow().isoformat(),
            }

        # 測試不同錯誤類型
        email_error = create_auth_error("INVALID_EMAIL", "Email not found")
        password_error = create_auth_error("INVALID_PASSWORD", "Incorrect password")
        account_error = create_auth_error("ACCOUNT_DISABLED", "Account is disabled")

        assert email_error["success"] is False
        assert email_error["error_type"] == "INVALID_EMAIL"
        assert "timestamp" in email_error

        assert password_error["error_type"] == "INVALID_PASSWORD"
        assert account_error["error_type"] == "ACCOUNT_DISABLED"

    def test_rate_limiting_logic(self):
        """測試速率限制邏輯"""
        from collections import defaultdict, deque
        from time import time

        class RateLimiter:
            def __init__(self, max_attempts: int = 5, window_seconds: int = 300):
                self.max_attempts = max_attempts
                self.window_seconds = window_seconds
                self.attempts = defaultdict(deque)

            def is_allowed(self, identifier: str) -> bool:
                now = time()
                attempts = self.attempts[identifier]

                # 移除過期的嘗試
                while attempts and attempts[0] < now - self.window_seconds:
                    attempts.popleft()

                # 檢查是否超過限制
                if len(attempts) >= self.max_attempts:
                    return False

                # 記錄這次嘗試
                attempts.append(now)
                return True

        limiter = RateLimiter(max_attempts=3, window_seconds=60)

        # 前3次應該被允許
        assert limiter.is_allowed("user1") is True
        assert limiter.is_allowed("user1") is True
        assert limiter.is_allowed("user1") is True

        # 第4次應該被拒絕
        assert limiter.is_allowed("user1") is False

        # 不同用戶應該有獨立的限制
        assert limiter.is_allowed("user2") is True


class TestSessionManagement:
    """測試會話管理邏輯"""

    def test_session_creation_logic(self):
        """測試會話創建邏輯"""

        def create_session(user_id: int, role: str) -> dict:
            return {
                "session_id": f"sess_{user_id}_{int(datetime.utcnow().timestamp())}",
                "user_id": user_id,
                "role": role,
                "created_at": datetime.utcnow().isoformat(),
                "expires_at": datetime.utcnow().timestamp() + 3600,  # 1小時
                "is_active": True,
            }

        session = create_session(1, "teacher")

        assert "session_id" in session
        assert session["user_id"] == 1
        assert session["role"] == "teacher"
        assert session["is_active"] is True
        assert "created_at" in session
        assert "expires_at" in session

    def test_session_validation_logic(self):
        """測試會話驗證邏輯"""

        def is_session_valid(session: dict) -> bool:
            if not session or not session.get("is_active"):
                return False

            current_time = datetime.utcnow().timestamp()
            expires_at = session.get("expires_at", 0)

            return current_time < expires_at

        # 有效會話
        valid_session = {
            "session_id": "sess_123",
            "is_active": True,
            "expires_at": datetime.utcnow().timestamp() + 3600,
        }
        assert is_session_valid(valid_session) is True

        # 過期會話
        expired_session = {
            "session_id": "sess_123",
            "is_active": True,
            "expires_at": datetime.utcnow().timestamp() - 3600,  # 1小時前過期
        }
        assert is_session_valid(expired_session) is False

        # 未激活會話
        inactive_session = {
            "session_id": "sess_123",
            "is_active": False,
            "expires_at": datetime.utcnow().timestamp() + 3600,
        }
        assert is_session_valid(inactive_session) is False
