"""
LINE 官方帳號發布 service（issue #804）。

以 LINE Messaging API 把更新公告送到官方帳號好友（broadcast），或在非
production 環境改推給指定測試帳號（push），避免測試訊息轟炸真實好友。
本 service 只負責「呼叫 LINE API 與組裝訊息」，不碰 DB；發布結果的記錄
由 ReleaseAnnouncementService 負責，以維持單一職責與可測試性。

憑證來自 core.config.settings（LINE_CHANNEL_ACCESS_TOKEN / LINE_TEST_USER_ID），
與 CI 通知共用同一個 channel（GCP Secret Manager: line-channel-access-token）。
"""

import logging
from typing import Any, Dict, List, Optional

from core.config import settings
from utils.http_client import get_http_client

logger = logging.getLogger(__name__)

# LINE altText 上限 400 字（超過會被 API 拒絕）
ALT_TEXT_MAX = 400


class LinePublishError(Exception):
    """發布失敗（LINE API 錯誤或內容驗證失敗）。

    status_code：LINE 回傳的 HTTP status（若有），供上層判斷
    （401/403 = token 失效或權限不足、429 = 超出訊息量上限）。
    """

    def __init__(self, message: str, status_code: Optional[int] = None):
        self.status_code = status_code
        super().__init__(message)


class LineConfigError(LinePublishError):
    """缺少必要的 LINE 設定（channel access token / 測試帳號 user id）。"""


class LinePublishService:
    """LINE 官方帳號訊息發送（純 Messaging API 呼叫，無 DB）。"""

    API_BASE = "https://api.line.me/v2/bot"

    # ============ 內部工具 ============

    @staticmethod
    def _require_token() -> str:
        token = settings.LINE_CHANNEL_ACCESS_TOKEN
        if not token:
            raise LineConfigError("缺少 LINE 設定：LINE_CHANNEL_ACCESS_TOKEN")
        return token

    @staticmethod
    def _raise_for_line_error(resp) -> None:
        """LINE API 4xx/5xx → 擷取 message/details 轉成 LinePublishError。"""
        if resp.status_code >= 400:
            message = None
            try:
                body = resp.json()
                message = body.get("message")
                details = body.get("details")
                if details:
                    message = f"{message}（{details}）"
            except Exception:  # noqa: BLE001 - 回應非 JSON 時退回通用訊息
                pass
            raise LinePublishError(
                message or f"LINE API error (HTTP {resp.status_code})",
                status_code=resp.status_code,
            )

    @classmethod
    async def _post(cls, path: str, payload: Dict[str, Any]) -> Optional[str]:
        """送出請求並回傳 x-line-request-id（LINE 的追蹤 id，供稽核用）。"""
        token = cls._require_token()
        client = get_http_client()
        resp = await client.post(
            f"{cls.API_BASE}{path}",
            json=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )
        cls._raise_for_line_error(resp)
        headers = getattr(resp, "headers", None) or {}
        return headers.get("x-line-request-id")

    # ============ 發送 ============

    @classmethod
    async def broadcast(cls, messages: List[Dict[str, Any]]) -> Optional[str]:
        """廣播給官方帳號的所有好友。

        注意：broadcast 一次會消耗「好友數」則訊息量（免費方案每月 200 則），
        因此只在 production 由管理者手動觸發。
        """
        if not messages:
            raise LinePublishError("訊息內容不可為空")
        return await cls._post("/message/broadcast", {"messages": messages})

    @classmethod
    async def push(cls, to: str, messages: List[Dict[str, Any]]) -> Optional[str]:
        """推播給單一使用者（非 production 環境用來驗證訊息外觀）。"""
        if not to:
            raise LineConfigError("缺少 LINE 設定：LINE_TEST_USER_ID")
        if not messages:
            raise LinePublishError("訊息內容不可為空")
        return await cls._post("/message/push", {"to": to, "messages": messages})

    # ============ 訊息組裝 ============

    @staticmethod
    def _text_block(text: str, *, bold: bool = False, size: str = "sm") -> Dict:
        return {
            "type": "text",
            "text": text,
            "wrap": True,
            "size": size,
            "weight": "bold" if bold else "regular",
            "color": "#111111" if bold else "#555555",
        }

    @classmethod
    def build_release_flex(
        cls,
        *,
        title_zh: str,
        body_zh: str,
        title_en: str = "",
        body_en: str = "",
        image_url: Optional[str] = None,
        link: Optional[str] = None,
        link_label: str = "看完整更新 / Read more",
    ) -> Dict[str, Any]:
        """組出雙語更新公告的 Flex Message（中文段 + 英文段 + 選填圖與連結）。

        英文欄位留空時只出中文段，避免卡片出現空白區塊。
        """
        contents: List[Dict[str, Any]] = [
            cls._text_block(title_zh, bold=True, size="lg"),
            cls._text_block(body_zh),
        ]
        if title_en or body_en:
            contents.append({"type": "separator", "margin": "lg"})
            if title_en:
                contents.append(cls._text_block(title_en, bold=True, size="md"))
            if body_en:
                contents.append(cls._text_block(body_en))

        bubble: Dict[str, Any] = {
            "type": "bubble",
            "body": {
                "type": "box",
                "layout": "vertical",
                "spacing": "md",
                "contents": contents,
            },
        }

        if image_url:
            bubble["hero"] = {
                "type": "image",
                "url": image_url,
                "size": "full",
                "aspectRatio": "20:13",
                "aspectMode": "cover",
            }

        if link:
            bubble["footer"] = {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                        "type": "button",
                        "style": "primary",
                        "height": "sm",
                        "action": {
                            "type": "uri",
                            "label": link_label[:20],  # LINE button label 上限 20 字
                            "uri": link,
                        },
                    }
                ],
            }

        alt_text = f"{title_zh} {body_zh}".strip()[:ALT_TEXT_MAX]
        return {
            "type": "flex",
            "altText": alt_text or title_zh[:ALT_TEXT_MAX],
            "contents": bubble,
        }
