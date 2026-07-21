"""
Azure Speech Token Service

提供短效 Azure Speech Token 給前端直接調用
- Token 有效期 10 分鐘
- Server-side cache 避免重複調用 issueToken endpoint
- 安全性：Subscription Key 不外泄
"""

import os
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict
from utils.http_client import get_http_client
from core.config import settings

logger = logging.getLogger(__name__)


class AzureSpeechTokenService:
    """Azure Speech Token 服務"""

    def __init__(self):
        self.subscription_key = os.getenv("AZURE_SPEECH_KEY")
        # 單一設定來源，避免各處寫死 fallback region（Issue #958）
        self.region = settings.AZURE_SPEECH_REGION
        self._cached_token: Optional[str] = None
        self._token_expires_at: Optional[datetime] = None

        if not self.subscription_key:
            logger.error("AZURE_SPEECH_KEY not configured")
            raise ValueError("AZURE_SPEECH_KEY environment variable is required")

    async def get_token(self) -> Dict[str, any]:
        """
        獲取短效 Azure Speech Token（10分鐘有效）

        Returns:
            {
                "token": "<authorization-token>",
                "region": "japaneast",
                "expires_in": 600
            }

        實施策略：
        - Server-side cache（8分鐘內重用同一 token）
        - 提前2分鐘過期，避免前端使用到期 token
        - Issue #136: cache 命中時回傳「實際剩餘秒數」而非固定 600，
          避免前端依固定值 over-cache 一個即將到期的 token 而產生 401
        """
        # Check cache (8分鐘內重用，提前2分鐘過期)
        if self._cached_token and self._token_expires_at:
            if datetime.now() < self._token_expires_at - timedelta(minutes=2):
                remaining_seconds = (
                    self._token_expires_at - datetime.now()
                ).total_seconds()
                # 回傳真實剩餘壽命（clamp 非負），讓前端據此計算 cache 窗口
                expires_in = max(0, int(remaining_seconds))
                logger.info(f"Returning cached token (expires in {expires_in}s)")
                return {
                    "token": self._cached_token,
                    "region": self.region,
                    "expires_in": expires_in,
                }

        # Call Azure issueToken endpoint
        url = f"https://{self.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
        headers = {"Ocp-Apim-Subscription-Key": self.subscription_key}

        logger.info(f"Requesting new token from Azure (region: {self.region})")

        try:
            # Use shared http_client for connection pooling
            client = get_http_client()
            response = await client.post(url, headers=headers, timeout=10.0)
            response.raise_for_status()
            token = response.text

            # Cache token
            self._cached_token = token
            self._token_expires_at = datetime.now() + timedelta(minutes=10)

            logger.info("New token issued and cached successfully")

            return {"token": token, "region": self.region, "expires_in": 600}

        except Exception as e:
            logger.error(f"Azure token request failed: {e}")
            raise


# Singleton instance
_token_service = None


def get_azure_speech_token_service() -> AzureSpeechTokenService:
    """
    獲取 AzureSpeechTokenService 單例實例

    使用單例確保 token cache 在整個應用程式生命週期內共享
    """
    global _token_service
    if _token_service is None:
        _token_service = AzureSpeechTokenService()
    return _token_service
