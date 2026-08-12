"""Google OAuth callback 端點測試（Issue #740）。

比照 1Campus 測試作法：直接呼叫 router handler，並以 AsyncMock 取代對
Google 的 HTTP 呼叫，避免 TestClient 的 Casbin 啟動問題。
"""

import time
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from routers.auth_google import _create_oauth_state, google_callback


def _request():
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/auth/google/callback",
            "headers": [],
            "query_string": b"",
            "client": ("127.0.0.1", 1234),
        }
    )


def _patch_google(user_info):
    return (
        patch(
            "routers.auth_google.GoogleOAuthService.exchange_code",
            new=AsyncMock(return_value={"access_token": "google-access-token"}),
        ),
        patch(
            "routers.auth_google.GoogleOAuthService.get_user_info",
            new=AsyncMock(return_value=user_info),
        ),
    )


@pytest.mark.asyncio
async def test_callback_creates_teacher_and_returns_jwt(shared_test_session):
    user_info = {
        "sub": "callback-sub-001",
        "email": "callback@example.com",
        "email_verified": True,
        "name": "Callback Teacher",
        "picture": "https://lh3.googleusercontent.com/avatar",
    }
    exchange_patch, userinfo_patch = _patch_google(user_info)
    with exchange_patch, userinfo_patch:
        resp = await google_callback(
            _request(),
            code="auth-code",
            state=_create_oauth_state("https://duotopia.co"),
            db=shared_test_session,
        )

    assert resp.action == "created"
    assert resp.role_type == "teacher"
    assert resp.access_token
    assert resp.user["email"] == "callback@example.com"


@pytest.mark.asyncio
async def test_callback_rejects_invalid_state(shared_test_session):
    with pytest.raises(HTTPException) as exc:
        await google_callback(
            _request(),
            code="auth-code",
            state="tampered.signature",
            db=shared_test_session,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_callback_rejects_expired_state(shared_test_session):
    with patch("routers.auth_google.time.time", return_value=time.time() - 3600):
        expired_state = _create_oauth_state("https://duotopia.co")

    with pytest.raises(HTTPException) as exc:
        await google_callback(
            _request(), code="auth-code", state=expired_state, db=shared_test_session
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_callback_rejects_unverified_google_email(shared_test_session):
    user_info = {
        "sub": "callback-sub-unverified",
        "email": "unverified-google@example.com",
        "email_verified": False,
        "name": "Unverified",
    }
    exchange_patch, userinfo_patch = _patch_google(user_info)
    with exchange_patch, userinfo_patch:
        with pytest.raises(HTTPException) as exc:
            await google_callback(
                _request(),
                code="auth-code",
                state=_create_oauth_state("https://duotopia.co"),
                db=shared_test_session,
            )

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "GOOGLE_EMAIL_NOT_VERIFIED"


@pytest.mark.asyncio
async def test_callback_rejects_missing_sub(shared_test_session):
    exchange_patch, userinfo_patch = _patch_google({"email": "no-sub@example.com"})
    with exchange_patch, userinfo_patch:
        with pytest.raises(HTTPException) as exc:
            await google_callback(
                _request(),
                code="auth-code",
                state=_create_oauth_state("https://duotopia.co"),
                db=shared_test_session,
            )
    assert exc.value.status_code == 502
