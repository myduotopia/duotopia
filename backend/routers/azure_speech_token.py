"""
Azure Speech Token Router

提供短效 Azure Speech Token 給前端直接調用
安全措施：
- 需要用戶身份驗證
- Rate limiting（每分鐘最多 10 次請求）
- Token server-side cache
- Subscription Key 不外泄
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth import get_current_user
from core.limiter import limiter
from services.azure_speech_token import get_azure_speech_token_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/azure-speech",
    tags=["azure_speech"],
    responses={404: {"description": "Not found"}},
)


class TokenResponse(BaseModel):
    """Azure Speech Token 回應"""

    token: str
    region: str
    expires_in: int


@router.post("/token", response_model=TokenResponse)
# 兩段皆用預設 key_func（get_user_identifier）：已登入端點會以 JWT 推導出
# per-user key（teacher:/student:），天生防輪換 IP/proxy 繞過（Issue #137 / #139）。
@limiter.limit("10/minute")  # 每使用者每分鐘最多 10 次（防爆量）
@limiter.limit("60/hour")  # 每使用者每小時最多 60 次
async def get_speech_token(
    request: Request, current_user: dict = Depends(get_current_user)
):
    """
    發放 Azure Speech 短效 Token（10分鐘有效）

    安全措施：
    - ✅ 需要用戶身份驗證（get_current_user dependency）
    - ✅ Rate limiting（每 IP 每分鐘 10 次 + 每使用者每小時 60 次）
    - ✅ Token server-side cache（減少 Azure API 調用）
    - ✅ Subscription Key 不外泄（只在後端使用）

    前端使用流程：
    1. 獲取 token: `const {token, region} = await fetch('/api/azure-speech/token')`
    2. 使用 Azure Speech SDK: `SpeechConfig.fromAuthorizationToken(token, region)`
    3. Token 有效期 10 分鐘，過期後重新請求

    Returns:
        {
            "token": "<authorization-token>",
            "region": "japaneast",
            "expires_in": 600
        }
    """
    try:
        service = get_azure_speech_token_service()
        result = await service.get_token()

        logger.info(
            f"Token issued to user {current_user.get('sub')} ({current_user.get('email', 'unknown')})"
        )

        return TokenResponse(**result)

    except ValueError as e:
        logger.error(f"Configuration error: {e}")
        raise HTTPException(
            status_code=500, detail="Azure Speech service not configured"
        )
    except Exception as e:
        logger.error(f"Failed to get Azure Speech token: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to get speech token: {str(e)}"
        )
