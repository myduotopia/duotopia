"""Google OAuth 登入端點（Issue #740，老師端）。

目前提供：
- GET /api/auth/google/relay — OAuth redirect URI 中繼站

為什麼需要 relay：
Google 的 Authorized redirect URI 不支援萬用字元，但 per-issue 測試環境每次
網址都不同（duotopia-frontend-issue-<N>-...run.app），不可能逐一註冊。
因此 develop / staging / per-issue 三類環境共用一個「固定」的 redirect URI
（staging 後端的本端點），由本端點依 state 內帶的 origin 轉回原環境前端。
Production 不走 relay，直接註冊 https://duotopia.co/auth/google/callback。

安全性：
本端點刻意「不驗 state 的 HMAC 簽章」——state 是由來源環境用自己的
JWT_SECRET 簽的，staging 無從驗證。改以 ALLOWED_ORIGIN_PATTERN 白名單擋
開放轉導（open redirect）；authorization code 最終仍只有持有正確
client_secret 且能驗 state 簽章的來源環境後端能兌換。
"""

import base64
import binascii
import json
import logging
import re
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse

from core.limiter import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth/google", tags=["auth-google"])

# 前端 callback 路徑（各環境一致）
CALLBACK_PATH = "/auth/google/callback"

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
