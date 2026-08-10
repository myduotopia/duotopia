"""Google OAuth relay 端點測試（Issue #740）。

驗證 relay 只會把 authorization code 轉回 Duotopia 自己的環境，
避免 open redirect 把 code 導向外部網站。
"""

import base64
import json

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from routers.auth_google import (
    ALLOWED_ORIGIN_PATTERN,
    _extract_origin,
    google_oauth_relay,
)


def _state(origin):
    payload = base64.urlsafe_b64encode(
        json.dumps({"nonce": "abc", "exp": 9999999999, "origin": origin}).encode()
    ).decode()
    return f"{payload}.deadbeef"


def _request():
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/auth/google/relay",
            "headers": [],
            "query_string": b"",
            "client": ("127.0.0.1", 1234),
        }
    )


@pytest.mark.parametrize(
    "origin",
    [
        "https://duotopia.co",
        "https://www.duotopia.co",
        "https://duotopia-staging-frontend-b2ovkkgl6a-de.a.run.app",
        "https://duotopia-frontend-issue-740-316409492201.asia-east1.run.app",
    ],
)
def test_allowed_origins(origin):
    assert ALLOWED_ORIGIN_PATTERN.match(origin)


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.com",
        "http://duotopia.co",  # 非 https
        "https://duotopia.co.evil.com",
        "https://duotopia-evil-999999999.asia-east1.run.app",  # 別的 GCP 專案
        "https://duotopia-evil-b2ovkkgl6a-de.a.run.app.evil.com",
        "https://duotopia.co/path",  # origin 不該帶路徑
    ],
)
def test_rejected_origins(origin):
    assert not ALLOWED_ORIGIN_PATTERN.match(origin)


def test_extract_origin_handles_garbage():
    assert _extract_origin(None) is None
    assert _extract_origin("") is None
    assert _extract_origin("not-base64.sig") is None
    assert _extract_origin("e30.sig") is None  # {} 無 origin 欄位


@pytest.mark.asyncio
async def test_relay_redirects_to_allowed_origin():
    origin = "https://duotopia-staging-frontend-b2ovkkgl6a-de.a.run.app"
    resp = await google_oauth_relay(
        _request(), code="auth-code-123", state=_state(origin), error=None
    )
    assert resp.status_code == 302
    location = resp.headers["location"]
    assert location.startswith(f"{origin}/auth/google/callback?")
    assert "code=auth-code-123" in location
    assert "state=" in location


@pytest.mark.asyncio
async def test_relay_rejects_foreign_origin():
    with pytest.raises(HTTPException) as exc:
        await google_oauth_relay(
            _request(),
            code="auth-code-123",
            state=_state("https://evil.com"),
            error=None,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_relay_rejects_missing_state():
    with pytest.raises(HTTPException) as exc:
        await google_oauth_relay(
            _request(), code="auth-code-123", state=None, error=None
        )
    assert exc.value.status_code == 400
