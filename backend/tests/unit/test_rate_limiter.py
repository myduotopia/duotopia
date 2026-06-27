"""Rate Limiter 單元測試 - 測試 get_user_identifier

識別優先序 (見 core/limiter.py)：
1. 已驗證的 JWT (Authorization: Bearer) → f"{type}:{sub}"
2. request body 的 email / id（登入端點，尚未持有 token）
3. Fallback 到 client IP
"""
from datetime import datetime, timedelta, timezone

from jose import jwt

from core.config import settings
from core.limiter import get_user_identifier


class MockRequest:
    """模擬 FastAPI Request"""

    def __init__(self, body=None, client_ip="127.0.0.1", headers=None):
        # 故意只在有 body 時才設 _json，模擬 FastAPI 在無 pydantic body
        # 參數的端點上不會 cache _json 的情況（_identifier_from_body 以
        # getattr(..., None) 處理屬性缺席）。
        if body is not None:
            self._json = body
        self.client = type("Client", (), {"host": client_ip})()
        self.headers = headers or {}


def _make_token(payload: dict, secret: str = None, algorithm: str = None) -> str:
    return jwt.encode(
        payload,
        secret or settings.JWT_SECRET,
        algorithm=algorithm or settings.JWT_ALGORITHM,
    )


# ---------- Tier 2: body (login endpoints) ----------


def test_get_user_identifier_by_email():
    """測試：優先使用 email 作為識別"""
    request = MockRequest(body={"email": "teacher@school.com", "password": "xxx"})
    result = get_user_identifier(request)
    assert result == "email:teacher@school.com"


def test_get_user_identifier_by_student_id():
    """測試：使用 student id 作為識別"""
    request = MockRequest(body={"id": "S12345", "password": "xxx"})
    result = get_user_identifier(request)
    assert result == "student:S12345"


def test_get_user_identifier_fallback_to_ip():
    """測試：無法取得 email/id 時，fallback 到 IP"""
    request = MockRequest(body={"some_field": "value"}, client_ip="203.123.45.67")
    result = get_user_identifier(request)
    assert "203.123.45.67" in result or result.startswith("ip:")


def test_get_user_identifier_email_takes_priority():
    """測試：email 優先於其他欄位"""
    request = MockRequest(body={"email": "t@s.com", "id": "S12345"})
    result = get_user_identifier(request)
    assert result == "email:t@s.com"


def test_get_user_identifier_no_body_no_token_fallback_to_ip():
    """測試：無 body 也無 token（例如 GET 端點）→ fallback 到 IP"""
    request = MockRequest(body=None, client_ip="10.0.0.5")
    result = get_user_identifier(request)
    assert result == "ip:10.0.0.5"


# ---------- Tier 1: verified JWT ----------


def test_get_user_identifier_by_valid_jwt_teacher():
    """測試：已驗證的 teacher JWT → teacher:<sub>，不受共用 IP 影響"""
    token = _make_token({"sub": "42", "type": "teacher"})
    request = MockRequest(headers={"Authorization": f"Bearer {token}"})
    result = get_user_identifier(request)
    assert result == "teacher:42"


def test_get_user_identifier_by_valid_jwt_student():
    """測試：已驗證的 student JWT → student:<sub>"""
    token = _make_token({"sub": "777", "type": "student"})
    request = MockRequest(headers={"Authorization": f"Bearer {token}"})
    result = get_user_identifier(request)
    assert result == "student:777"


def test_get_user_identifier_jwt_takes_priority_over_body():
    """測試：同時有 token 與 body 時，以驗證過的 JWT 為準"""
    token = _make_token({"sub": "42", "type": "teacher"})
    request = MockRequest(
        body={"email": "someone@else.com"},
        headers={"Authorization": f"Bearer {token}"},
    )
    result = get_user_identifier(request)
    assert result == "teacher:42"


def test_get_user_identifier_forged_token_does_not_trust_sub():
    """安全性：偽造（簽章錯誤）的 token 不可被信任，避免攻擊者竄改 sub 繞過限制"""
    forged = _make_token({"sub": "victim", "type": "teacher"}, secret="wrong-secret")
    request = MockRequest(
        body={"email": "real@user.com"},
        headers={"Authorization": f"Bearer {forged}"},
    )
    result = get_user_identifier(request)
    # 簽章驗證失敗 → 不採用 sub，落到 body
    assert result == "email:real@user.com"


def test_get_user_identifier_expired_token_falls_through():
    """測試：過期 token 驗證失敗 → 落到下一層（此處 IP）"""
    expired = _make_token(
        {
            "sub": "42",
            "type": "teacher",
            "exp": datetime.now(timezone.utc) - timedelta(hours=1),
        }
    )
    request = MockRequest(
        headers={"Authorization": f"Bearer {expired}"}, client_ip="8.8.8.8"
    )
    result = get_user_identifier(request)
    assert result == "ip:8.8.8.8"


def test_get_user_identifier_token_without_sub_falls_through():
    """測試：JWT 缺少 sub → 落到下一層"""
    token = _make_token({"type": "teacher"})  # no sub
    request = MockRequest(
        headers={"Authorization": f"Bearer {token}"}, client_ip="1.2.3.4"
    )
    result = get_user_identifier(request)
    assert result == "ip:1.2.3.4"


def test_get_user_identifier_jwt_default_type_when_missing():
    """測試：JWT 有 sub 但缺 type → 使用通用前綴 user:<sub>"""
    token = _make_token({"sub": "99"})
    request = MockRequest(headers={"Authorization": f"Bearer {token}"})
    result = get_user_identifier(request)
    assert result == "user:99"


def test_get_user_identifier_malformed_auth_header_falls_through():
    """測試：非 Bearer 格式的 Authorization → 落到下一層"""
    request = MockRequest(
        body={"email": "a@b.com"}, headers={"Authorization": "Basic abc123"}
    )
    result = get_user_identifier(request)
    assert result == "email:a@b.com"
