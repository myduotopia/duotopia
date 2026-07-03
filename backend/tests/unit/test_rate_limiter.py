"""Rate Limiter 單元測試 - 測試 get_user_identifier

識別優先序 (見 core/limiter.py)：
1. 已驗證的 JWT (Authorization: Bearer) → f"{type}:{sub}"
2. request body 的 email / id（登入端點，尚未持有 token）
3. Fallback 到 client IP
"""
from datetime import timedelta

from jose import jwt
from starlette.datastructures import Headers

from auth import create_access_token
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
        # 用 Starlette Headers（大小寫不敏感）而非 dict，貼近 production
        # Request.headers 的行為，避免測試對 header 大小寫產生偽綠燈。
        self.headers = Headers(headers=headers or {})


def _token(payload: dict, expires_delta: timedelta = None) -> str:
    # 用 production 的簽發路徑 auth.create_access_token 產生 token，確保與
    # 受測對象 core.limiter（內部委派 auth.verify_token）的簽章 / 演算法完全
    # 對齊；金鑰來源若改變，測試與限流器會一起改變、不會出現假綠燈。
    return create_access_token(payload, expires_delta=expires_delta)


def _forged_token(payload: dict) -> str:
    # 以錯誤的 secret 簽發，模擬偽造 token（簽章驗證必定失敗）。
    return jwt.encode(payload, "wrong-secret", algorithm="HS256")


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
    token = _token({"sub": "42", "type": "teacher"})
    request = MockRequest(headers={"Authorization": f"Bearer {token}"})
    result = get_user_identifier(request)
    assert result == "teacher:42"


def test_get_user_identifier_by_valid_jwt_student():
    """測試：已驗證的 student JWT → student:<sub>"""
    token = _token({"sub": "777", "type": "student"})
    request = MockRequest(headers={"Authorization": f"Bearer {token}"})
    result = get_user_identifier(request)
    assert result == "student:777"


def test_get_user_identifier_jwt_takes_priority_over_body():
    """測試：同時有 token 與 body 時，以驗證過的 JWT 為準"""
    token = _token({"sub": "42", "type": "teacher"})
    request = MockRequest(
        body={"email": "someone@else.com"},
        headers={"Authorization": f"Bearer {token}"},
    )
    result = get_user_identifier(request)
    assert result == "teacher:42"


def test_get_user_identifier_forged_token_does_not_trust_sub():
    """安全性：偽造（簽章錯誤）的 token 不可被信任，避免攻擊者竄改 sub 繞過限制"""
    forged = _forged_token({"sub": "victim", "type": "teacher"})
    request = MockRequest(
        body={"email": "real@user.com"},
        headers={"Authorization": f"Bearer {forged}"},
    )
    result = get_user_identifier(request)
    # 簽章驗證失敗 → 不採用 sub，落到 body
    assert result == "email:real@user.com"


def test_get_user_identifier_expired_token_falls_through():
    """測試：過期 token 驗證失敗 → 落到下一層（此處 IP）"""
    expired = _token(
        {"sub": "42", "type": "teacher"}, expires_delta=timedelta(hours=-1)
    )
    request = MockRequest(
        headers={"Authorization": f"Bearer {expired}"}, client_ip="8.8.8.8"
    )
    result = get_user_identifier(request)
    assert result == "ip:8.8.8.8"


def test_get_user_identifier_token_without_sub_falls_through():
    """測試：JWT 缺少 sub → 落到下一層"""
    token = _token({"type": "teacher"})  # no sub
    request = MockRequest(
        headers={"Authorization": f"Bearer {token}"}, client_ip="1.2.3.4"
    )
    result = get_user_identifier(request)
    assert result == "ip:1.2.3.4"


def test_get_user_identifier_jwt_unlisted_type_falls_through():
    """測試：JWT 有 sub 但 type 不在白名單（缺 type）→ 不採用，落到下一層"""
    token = _token({"sub": "99"})  # no type
    request = MockRequest(
        headers={"Authorization": f"Bearer {token}"}, client_ip="5.6.7.8"
    )
    result = get_user_identifier(request)
    assert result == "ip:5.6.7.8"


def test_get_user_identifier_refresh_token_falls_through():
    """安全性：refresh token 不可當限流身分，避免取得額外的獨立 bucket"""
    token = _token({"sub": "42", "type": "refresh"})
    request = MockRequest(
        body={"email": "real@user.com"},
        headers={"Authorization": f"Bearer {token}"},
    )
    result = get_user_identifier(request)
    # type 不在白名單 → 落到 body
    assert result == "email:real@user.com"


def test_get_user_identifier_lowercase_authorization_header():
    """測試：header 大小寫不敏感（Starlette Headers）→ 仍能解出 JWT 身分"""
    token = _token({"sub": "42", "type": "teacher"})
    request = MockRequest(headers={"authorization": f"Bearer {token}"})
    result = get_user_identifier(request)
    assert result == "teacher:42"


def test_get_user_identifier_malformed_auth_header_falls_through():
    """測試：非 Bearer 格式的 Authorization → 落到下一層"""
    request = MockRequest(
        body={"email": "a@b.com"}, headers={"Authorization": "Basic abc123"}
    )
    result = get_user_identifier(request)
    assert result == "email:a@b.com"
