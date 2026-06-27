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
擠進同一個 bucket、互相把對方打到 429。改用 JWT 後每個帳號有獨立 bucket。

安全性：JWT 必須「驗章」後才信任 sub，否則攻擊者可竄改 sub 把請求
分散到大量 bucket 來繞過限制。
"""
import json
import logging

from fastapi import Request
from jose import JWTError, jwt
from slowapi import Limiter
from slowapi.util import get_remote_address

from core.config import settings

logger = logging.getLogger(__name__)

# 與 auth.py 一致：硬寫死 HS256，不讀 settings.JWT_ALGORITHM。
# auth.py 簽 token 時固定用 HS256（並註明「prevent 'none' algorithm attack」），
# 解 token 的這側也必須鎖死同一演算法，否則若有人把 JWT_ALGORITHM 設成別的
# 值，限流器可能接受非預期簽章的 token 而破壞 per-user bucket 隔離。
_JWT_ALGORITHM = "HS256"

# 只有真正的「使用者存取權杖」才拿來當限流身分。
# refresh token（type="refresh"）等其他權杖不算數，避免同一使用者用不同
# 權杖型別取得額外的獨立 bucket。
_RATE_LIMIT_IDENTITY_TYPES = {"teacher", "student"}


def _identifier_from_jwt(request: Request) -> str | None:
    """從已驗證的 Bearer JWT 推導 per-user key，失敗回傳 None。"""
    auth_header = (
        request.headers.get("Authorization", "") if hasattr(request, "headers") else ""
    )
    if not auth_header.startswith("Bearer "):
        return None

    token = auth_header[len("Bearer ") :].strip()
    if not token:
        return None

    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[_JWT_ALGORITHM])
    except JWTError:
        # 簽章錯誤 / 過期 / 格式不符 → 不信任，落到下一層
        return None

    sub = payload.get("sub")
    user_type = payload.get("type")
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
    """
    return (
        _identifier_from_jwt(request)
        or _identifier_from_body(request)
        or f"ip:{get_remote_address(request)}"
    )


# 🔐 Create limiter with smart identifier
limiter = Limiter(key_func=get_user_identifier)
