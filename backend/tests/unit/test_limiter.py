"""
Tests for rate-limit key functions (core/limiter.py)

Focus: get_authenticated_user_identifier — derives a per-user rate-limit key
from the JWT in the Authorization header, so a malicious user cannot bypass
limits by rotating IPs/proxies (Issue #139).
"""
from starlette.requests import Request

from auth import create_access_token
from core.limiter import get_authenticated_user_identifier


def _make_request(headers=None, client_host="1.2.3.4"):
    """Build a minimal Starlette Request for key-function testing."""
    headers = headers or {}
    raw_headers = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    scope = {
        "type": "http",
        "headers": raw_headers,
        "client": (client_host, 12345),
    }
    return Request(scope)


class TestAuthenticatedUserIdentifier:
    def test_valid_token_returns_user_key(self):
        """有效 JWT → 以 user:<sub> 作為 key"""
        token = create_access_token(data={"sub": "42", "type": "teacher"})
        request = _make_request({"Authorization": f"Bearer {token}"})

        assert get_authenticated_user_identifier(request) == "user:42"

    def test_different_users_get_different_keys(self):
        """不同使用者 → 不同 key（即使同 IP）"""
        token_a = create_access_token(data={"sub": "1", "type": "student"})
        token_b = create_access_token(data={"sub": "2", "type": "student"})

        key_a = get_authenticated_user_identifier(
            _make_request({"Authorization": f"Bearer {token_a}"}, client_host="9.9.9.9")
        )
        key_b = get_authenticated_user_identifier(
            _make_request({"Authorization": f"Bearer {token_b}"}, client_host="9.9.9.9")
        )

        assert key_a == "user:1"
        assert key_b == "user:2"
        assert key_a != key_b

    def test_empty_string_sub_still_uses_user_bucket(self):
        """sub 為空字串也是合法身分 → 仍走 user 桶，不可掉進共用 IP 桶"""
        token = create_access_token(data={"sub": "", "type": "teacher"})
        request = _make_request({"Authorization": f"Bearer {token}"})

        assert get_authenticated_user_identifier(request) == "user:"

    def test_no_auth_header_falls_back_to_ip(self):
        """沒有 Authorization header → fallback 到 IP，不可是 user 桶"""
        request = _make_request(client_host="5.6.7.8")

        key = get_authenticated_user_identifier(request)
        assert "5.6.7.8" in key
        assert not key.startswith("user:")

    def test_invalid_token_falls_back_to_ip(self):
        """無效 token → fallback 到 IP，不可當成單一 user 共用桶"""
        request = _make_request(
            {"Authorization": "Bearer not-a-real-token"}, client_host="5.6.7.8"
        )

        key = get_authenticated_user_identifier(request)
        assert "5.6.7.8" in key
        assert not key.startswith("user:")
