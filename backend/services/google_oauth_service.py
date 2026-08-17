"""Google OAuth 2.0 整合（Issue #740，老師端登入）。

提供：
- get_authorize_url(state) — 組出 Google 同意畫面網址
- exchange_code(code) — authorization code 換 access token
- get_user_info(access_token) — 取得 sub / email / email_verified / name / picture

刻意不引入 google-auth 套件，比照 1Campus（services/one_campus_service.py）
以 httpx 直接呼叫，減少相依。
"""

import logging
from urllib.parse import urlencode

from core.config import settings
from utils.http_client import get_http_client

logger = logging.getLogger(__name__)

GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

# 只要非敏感 scope，Google 不需審核 app
GOOGLE_SCOPES = "openid email profile"


def _client_id() -> str:
    value = getattr(settings, "GOOGLE_CLIENT_ID", None)
    if not value:
        raise RuntimeError("GOOGLE_CLIENT_ID must be set")
    return value


def _client_secret() -> str:
    value = getattr(settings, "GOOGLE_CLIENT_SECRET", None)
    if not value:
        raise RuntimeError("GOOGLE_CLIENT_SECRET must be set")
    return value


def _redirect_uri() -> str:
    """本環境註冊在 Google 的 redirect URI。

    develop / staging / per-issue 指向 staging 後端的 relay 端點，
    production 直接指向 https://duotopia.co/auth/google/callback。
    """
    value = getattr(settings, "GOOGLE_REDIRECT_URI", None)
    if not value:
        raise RuntimeError("GOOGLE_REDIRECT_URI must be set")
    return value


class GoogleOAuthService:
    """Google OAuth 2.0 authorization code flow."""

    @staticmethod
    def get_authorize_url(state: str) -> str:
        """組出 Google 同意畫面網址。設定缺漏時 raise RuntimeError。"""
        params = {
            "client_id": _client_id(),
            "redirect_uri": _redirect_uri(),
            "response_type": "code",
            "scope": GOOGLE_SCOPES,
            "state": state,
            "access_type": "online",
            # 讓使用者每次都能選帳號，避免多 Google 帳號的老師被自動帶入前一個
            "prompt": "select_account",
            "include_granted_scopes": "true",
        }
        return f"{GOOGLE_AUTHORIZE_URL}?{urlencode(params)}"

    @staticmethod
    async def exchange_code(code: str) -> dict:
        """用 authorization code 換 token。redirect_uri 必須與授權時完全一致。"""
        client = get_http_client()
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": _client_id(),
                "client_secret": _client_secret(),
                "redirect_uri": _redirect_uri(),
                "grant_type": "authorization_code",
            },
        )
        resp.raise_for_status()
        return resp.json()

    @staticmethod
    async def get_user_info(access_token: str) -> dict:
        """取得 Google 使用者資料。

        回傳欄位：sub（Google 帳號唯一 ID）、email、email_verified、name、picture
        """
        client = get_http_client()
        resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        return resp.json()


def is_configured() -> bool:
    """判斷本環境是否已完成 Google OAuth 設定（前端可據此隱藏按鈕）。"""
    return all(
        getattr(settings, name, None)
        for name in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI")
    )
