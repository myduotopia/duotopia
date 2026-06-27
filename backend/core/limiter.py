"""
Shared rate limiter instance

Rate Limit Strategy:
- 按 Email/Student ID 限制 (每個帳號獨立計算)
- 同 IP 的不同用戶不會互相影響
- Fallback 到 IP (無法識別用戶時)
"""
from slowapi import Limiter
from slowapi.util import get_remote_address
from fastapi import Request


def get_user_identifier(request: Request) -> str:
    """
    聰明的識別策略：
    1. 優先使用 email（從 request body）
    2. 其次使用 student id
    3. Fallback 到 IP address

    這樣每個用戶帳號有自己的限制，不會被同 IP 的其他人影響
    """
    try:
        # 嘗試從 request body 取得識別資訊
        if hasattr(request, "_json"):
            # FastAPI 已經 parse 過的 JSON
            body = request._json
        elif hasattr(request, "_body"):
            # 需要手動 parse
            import json

            body = json.loads(request._body.decode())
        else:
            # 無法取得 body，使用 IP
            return get_remote_address(request)

        # 如果有 email，使用 email 作為 key
        if isinstance(body, dict) and "email" in body:
            return f"email:{body['email']}"

        # 如果有 id（student login），使用 student_id
        if isinstance(body, dict) and "id" in body:
            return f"student:{body['id']}"

    except Exception:
        # 任何錯誤都 fallback 到 IP
        pass

    # Fallback: 使用 IP
    return f"ip:{get_remote_address(request)}"


def get_authenticated_user_identifier(request: Request) -> str:
    """
    以「登入身分」為基準的 rate-limit key。

    從 Authorization: Bearer header 解析 JWT，回傳 user:<sub>，
    讓單一帳號的請求數受限，無法靠輪換 IP/proxy 繞過（Issue #139）。

    無有效 token 時 fallback 到 get_user_identifier（最後到 IP），
    確保未驗證的請求不會被歸到同一個 user 桶互相干擾。
    """
    # 延遲 import 以避免 import limiter 時就 eager-load 整個 ORM stack
    # （auth → models → database），同時讓單元測試與啟動更輕量
    from auth import verify_token

    # 兩個 @limiter.limit 裝飾器會對同一 request 都呼叫本函式，
    # 用 request.state 快取結果，避免重複解碼 JWT
    if hasattr(request.state, "_duotopia_rate_limit_user_key"):
        return request.state._duotopia_rate_limit_user_key

    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[len("Bearer ") :]
        payload = verify_token(token)
        if payload:
            sub = payload.get("sub")
            # sub 只要存在就用 user 桶；空字串也是合法 sub，不可掉進 IP 桶
            if sub is not None:
                key = f"user:{sub}"
                request.state._duotopia_rate_limit_user_key = key
                return key

    # 無有效 token → 回到既有識別策略（body email/id 或 IP）
    key = get_user_identifier(request)
    request.state._duotopia_rate_limit_user_key = key
    return key


# 🔐 Create limiter with smart identifier
limiter = Limiter(key_func=get_user_identifier)
