"""
Shared rate limiter instance

Rate Limit Strategy（識別優先序）：
1. 已驗證的 JWT（Authorization: Bearer）→ f"{type}:{sub}"
   適用所有「已登入」端點，不論 HTTP method 或有無 body。
2. request body 的 email / id（登入端點，尚未持有 token）
3. Fallback 到 client IP

為什麼需要 JWT：FastAPI 只有在端點宣告 pydantic body 參數時，才會在
呼叫 slowapi 的 key_func 前把 body parse 並 cache 到 request._json/_body。
GET 或 token-only 的端點沒有 body 可讀，舊版會落到 client IP；但在
Cloud Run 上那是 load balancer 的共用 egress IP，導致同校所有使用者
擠進同一個 bucket、互相把對方打到 429（Issue #137 / #139）。改用 JWT
後每個帳號有獨立 bucket，也無法靠輪換 IP/proxy 繞過限制。

安全性：JWT 必須「驗章」後才信任 sub，否則攻擊者可竄改 sub 把請求
分散到大量 bucket 來繞過限制。
"""
import json
import logging

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from auth import verify_token

logger = logging.getLogger(__name__)

# 只有真正的「使用者存取權杖」才拿來當限流身分。
# refresh token（type="refresh"）等其他權杖不算數，避免同一使用者用不同
# 權杖型別取得額外的獨立 bucket。
_RATE_LIMIT_IDENTITY_TYPES = {"teacher", "student"}

# 掛多個 @limiter.limit 的端點，slowapi 會對同一 request 多次呼叫 key_func；
# 把結果快取在 request.state，避免重複解碼 JWT（原 Issue #139 的優化）。
_RATE_LIMIT_KEY_STATE_ATTR = "_duotopia_rate_limit_key"


def _identifier_from_jwt(request: Request) -> str | None:
    """從已驗證的 Bearer JWT 推導 per-user key，失敗回傳 None。"""
    auth_header = request.headers.get("Authorization", "")
    # RFC 7235：auth-scheme 不分大小寫，bearer / BEARER 都合法
    if not auth_header.lower().startswith("bearer "):
        return None

    token = auth_header[len("bearer ") :].strip()
    if not token:
        return None

    # 委派給 auth.verify_token —— 與其餘 routers 走同一條驗證路徑（同 secret、
    # 硬寫死 HS256 以防 'none' algorithm 攻擊）。未來若在 verify_token 加入
    # jti 撤銷或 audience 檢查，限流器也會自動套用，不會悄悄走樣。
    payload = verify_token(token)
    if payload is None:
        # 簽章錯誤 / 過期 / 格式不符 → 不信任，落到下一層
        return None

    sub = payload.get("sub")
    user_type = payload.get("type")
    # sub 只要存在（空字串也算合法身分）且 type 在白名單才採用。
    if sub is None or user_type not in _RATE_LIMIT_IDENTITY_TYPES:
        # 缺 sub、或不是存取權杖（如 refresh token）→ 不採用，落到下一層
        return None

    return f"{user_type}:{sub}"


def _identifier_from_body(request: Request) -> str | None:
    """從 FastAPI 已 cache 的 request body 取得 email / id，失敗回傳 None。"""
    try:
        if getattr(request, "_json", None) is not None:
            body = request._json
        elif hasattr(request, "_body"):
            body = json.loads(request._body.decode())
        else:
            return None

        if isinstance(body, dict):
            if "email" in body:
                return f"email:{body['email']}"
            if "id" in body:
                return f"student:{body['id']}"
    except Exception as exc:
        # request._json / _body 是 Starlette 內部屬性；若未來版本改名導致
        # 解析失敗，登流會悄悄從 per-email 降級成 per-IP。記一筆 warning
        # 以便察覺，但仍 fallback 不擋住請求。
        logger.warning("Rate-limit body identifier parse failed: %s", exc)
        return None

    return None


def get_user_identifier(request: Request) -> str:
    """聰明的識別策略：JWT → body(email/id) → IP。

    這樣每個用戶帳號有自己的限制，不會被同 IP 的其他人影響。
    結果會快取在 request.state，避免同一 request 多個 limit 重複解碼 JWT。
    """
    state = getattr(request, "state", None)
    if state is not None and hasattr(state, _RATE_LIMIT_KEY_STATE_ATTR):
        return getattr(state, _RATE_LIMIT_KEY_STATE_ATTR)

    key = (
        _identifier_from_jwt(request)
        or _identifier_from_body(request)
        or f"ip:{get_remote_address(request)}"
    )

    if state is not None:
        setattr(state, _RATE_LIMIT_KEY_STATE_ATTR, key)
    return key


# 🔐 Create limiter with smart identifier
limiter = Limiter(key_func=get_user_identifier)
