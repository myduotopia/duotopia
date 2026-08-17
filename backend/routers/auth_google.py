"""Google OAuth 登入端點（Issue #740，老師端）。

提供：
- GET /api/auth/google/login-url — 回傳 Google 同意畫面網址（含簽章 state）
- GET /api/auth/google/relay     — OAuth redirect URI 中繼站
- GET /api/auth/google/callback  — code 換 token、解析/建立帳號、發 JWT

為什麼需要 relay：
Google 的 Authorized redirect URI 不支援萬用字元，但 per-issue 測試環境每次
網址都不同（duotopia-frontend-issue-<N>-...run.app），不可能逐一註冊。
因此 develop / staging / per-issue 三類環境共用一個「固定」的 redirect URI
（staging 後端的 relay 端點），由 relay 依 state 內帶的 origin 轉回原環境前端。
Production 不走 relay，直接註冊 https://duotopia.co/auth/google/callback。

安全性：
- relay 刻意「不驗 state 的 HMAC 簽章」——state 是由來源環境用自己的
  JWT_SECRET 簽的，staging 無從驗證。改以 ALLOWED_ORIGIN_PATTERN 白名單擋
  開放轉導（open redirect）；authorization code 最終仍只有持有正確
  client_secret 且能驗 state 簽章的來源環境後端能兌換。
- callback 才是真正驗 state 簽章與效期的地方。
"""

import base64
import binascii
import hashlib
import hmac
import json
import logging
import re
import secrets
import time
from datetime import timedelta
from typing import Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import create_access_token
from core.config import settings
from core.limiter import limiter
from database import get_db
from routers.auth_one_campus import _build_teacher_response
from services.google_account_service import (
    GoogleAccountNotVerifiedError,
    GoogleAccountService,
    GoogleEmailNotVerifiedError,
)
from services.google_oauth_service import GoogleOAuthService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth/google", tags=["auth-google"])

# 前端 callback 路徑（各環境一致）
CALLBACK_PATH = "/auth/google/callback"

# OAuth state token 有效期（秒）
OAUTH_STATE_TTL = 600

# 允許被轉回的來源 origin。
# 1. https://duotopia.co / https://www.duotopia.co（production 自訂網域）
# 2. Cloud Run 網址，且必須帶本專案的識別碼（b2ovkkgl6a-de 或專案編號
#    316409492201），避免任何人在自己的 GCP 專案建一個叫 duotopia-xxx 的
#    服務就能把 authorization code 導走。
ALLOWED_ORIGIN_PATTERN = re.compile(
    r"^https://("
    r"(www\.)?duotopia\.co"
    r"|duotopia-[a-z0-9-]+-b2ovkkgl6a-[a-z]{2}\.a\.run\.app"
    r"|duotopia-[a-z0-9-]+-316409492201\.[a-z0-9-]+\.run\.app"
    r")$"
)


# --- Schemas ---


class GoogleCallbackResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role_type: str = "teacher"
    user: dict
    action: str  # "existing" | "linked" | "created"


# --- Helpers ---


def _sign(payload_b64: str) -> str:
    return hmac.HMAC(
        settings.JWT_SECRET.encode(), payload_b64.encode(), hashlib.sha256
    ).hexdigest()


def _create_oauth_state(origin: Optional[str]) -> str:
    """建立 HMAC 簽章的 state token。

    payload 內含 origin（本環境前端網址），供 relay 判斷要轉回哪個環境。
    格式：base64url(json(payload)).signature
    """
    payload_dict = {
        "nonce": secrets.token_urlsafe(16),
        "exp": int(time.time()) + OAUTH_STATE_TTL,
    }
    if origin:
        payload_dict["origin"] = origin
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload_dict).encode()).decode()
    return f"{payload_b64}.{_sign(payload_b64)}"


def _verify_oauth_state(state: Optional[str]) -> Optional[dict]:
    """驗證 state token，成功回 payload dict，任何失敗回 None。"""
    if not state:
        return None
    parts = state.split(".", 1)
    if len(parts) != 2:
        return None
    payload_b64, sig = parts
    if not hmac.compare_digest(sig, _sign(payload_b64)):
        return None
    try:
        payload_dict = json.loads(base64.urlsafe_b64decode(payload_b64))
    except (json.JSONDecodeError, UnicodeDecodeError, binascii.Error):
        return None
    if payload_dict.get("exp", 0) < int(time.time()):
        return None
    return payload_dict


def _extract_origin(state: Optional[str]) -> Optional[str]:
    """從 state token 取出來源環境 origin（不驗簽章，見模組 docstring）。"""
    if not state:
        return None

    payload_b64 = state.split(".", 1)[0]
    try:
        # base64url 可能缺 padding，補足再解
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
    except (ValueError, binascii.Error, json.JSONDecodeError):
        return None

    if not isinstance(payload, dict):
        return None

    origin = payload.get("origin")
    return origin if isinstance(origin, str) else None


# --- Endpoints ---


@router.get("/login-url")
@limiter.limit("30/minute")
async def get_google_login_url(request: Request):
    """回傳 Google 同意畫面網址；前端拿到後 window.location.href 過去。"""
    origin = (settings.FRONTEND_URL or "").rstrip("/") or None
    try:
        url = GoogleOAuthService.get_authorize_url(_create_oauth_state(origin))
    except RuntimeError as e:
        logger.error("Google OAuth not configured: %s", e)
        raise HTTPException(status_code=500, detail="Google login is not configured.")
    return {"url": url}


@router.get("/relay")
@limiter.limit("30/minute")
async def google_oauth_relay(
    request: Request,
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
):
    """Google OAuth redirect URI 中繼站：依 state.origin 轉回原環境前端。"""
    origin = _extract_origin(state)

    if not origin or not ALLOWED_ORIGIN_PATTERN.match(origin):
        logger.warning("Google OAuth relay rejected origin: %r", origin)
        raise HTTPException(
            status_code=400,
            detail="Invalid or missing OAuth state origin.",
        )

    params = {
        k: v for k, v in (("code", code), ("state", state), ("error", error)) if v
    }
    return RedirectResponse(
        url=f"{origin}{CALLBACK_PATH}?{urlencode(params)}", status_code=302
    )


@router.get("/callback", response_model=GoogleCallbackResponse)
@limiter.limit("10/minute")
async def google_callback(
    request: Request,
    code: str = Query(...),
    state: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """處理 Google OAuth callback：驗 state、換 token、解析帳號、發 JWT。

    比照 1Campus：不做 HTTP 轉導，由前端 callback 頁以 XHR 呼叫本端點取 JSON。
    """
    if _verify_oauth_state(state) is None:
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired OAuth state. Please try logging in again.",
        )

    try:
        token_data = await GoogleOAuthService.exchange_code(code)
    except RuntimeError as e:
        logger.error("Google OAuth not configured: %s", e)
        raise HTTPException(status_code=500, detail="Google login is not configured.")
    except httpx.HTTPError as e:
        logger.error("Google token exchange failed: %s", e)
        raise HTTPException(status_code=502, detail="Google token exchange failed.")

    access_token = token_data.get("access_token")
    if not access_token:
        logger.error("Google token response missing access_token")
        raise HTTPException(status_code=502, detail="Google token exchange failed.")

    try:
        user_info = await GoogleOAuthService.get_user_info(access_token)
    except httpx.HTTPError as e:
        logger.error("Google userinfo request failed: %s", e)
        raise HTTPException(status_code=502, detail="Google user info request failed.")

    google_sub = user_info.get("sub")
    if not google_sub:
        logger.error("Google userinfo missing sub")
        raise HTTPException(status_code=502, detail="Google user info is incomplete.")

    try:
        teacher, action = GoogleAccountService.find_or_create_teacher(
            db,
            google_sub=google_sub,
            email=user_info.get("email"),
            email_verified=bool(user_info.get("email_verified")),
            name=user_info.get("name"),
            picture=user_info.get("picture"),
            raw_profile=user_info,
        )
    except GoogleEmailNotVerifiedError:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "GOOGLE_EMAIL_NOT_VERIFIED",
                "message": "This Google account has no verified email address.",
            },
        )
    except GoogleAccountNotVerifiedError:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "EMAIL_NOT_VERIFIED",
                "message": (
                    "A Duotopia account with this email exists but is not verified. "
                    "Please verify your email first, then sign in with Google."
                ),
            },
        )

    teacher_response = _build_teacher_response(db, teacher)
    jwt_token = create_access_token(
        data={
            "sub": str(teacher.id),
            "email": teacher.email,
            "type": "teacher",
            "name": teacher.name,
            "role": teacher_response["role"],
        },
        expires_delta=timedelta(hours=24),
    )
    return GoogleCallbackResponse(
        access_token=jwt_token,
        user=teacher_response,
        action=action,
    )
