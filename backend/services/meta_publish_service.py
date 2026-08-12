"""
Meta 社群發文 service（issue #591）。

以 Meta Graph API 發文到 Facebook 粉專與 Instagram Business 帳號。
本 service 只負責「呼叫 Graph API」，不碰 DB；發文結果記錄（social_posts）
由 router 層負責，以維持單一職責與可測試性。

憑證來自 core.config.settings（META_PAGE_ACCESS_TOKEN / META_PAGE_ID /
META_IG_USER_ID / META_GRAPH_VERSION），建議用 Business Manager 的
System User 產生長效 Page Access Token。
"""

import logging
from typing import Optional

from core.config import settings
from utils.http_client import get_http_client

logger = logging.getLogger(__name__)


class MetaPublishError(Exception):
    """發文失敗（Graph API 錯誤或內容驗證失敗）。

    code：Meta 回傳的 error code（若有），供上層判斷（如 190 = token 失效）。
    """

    def __init__(self, message: str, code: Optional[int] = None):
        self.code = code
        super().__init__(message)


class MetaConfigError(MetaPublishError):
    """缺少必要的 Meta 設定（token / page id / ig user id）。"""


class MetaPublishService:
    """Facebook 粉專 / Instagram 發文（純 Graph API 呼叫，無 DB）。"""

    GRAPH_BASE = "https://graph.facebook.com"

    @classmethod
    def _base_url(cls) -> str:
        return f"{cls.GRAPH_BASE}/{settings.META_GRAPH_VERSION}"

    @staticmethod
    def _require(value: Optional[str], name: str) -> str:
        if not value:
            raise MetaConfigError(f"缺少 Meta 設定：{name}")
        return value

    @staticmethod
    def _raise_for_graph_error(resp) -> None:
        """Graph API 4xx/5xx → 擷取 error message/code 轉成 MetaPublishError。"""
        if resp.status_code >= 400:
            message = None
            code = None
            try:
                err = resp.json().get("error", {})
                message = err.get("message")
                code = err.get("code")
            except Exception:  # noqa: BLE001 - 回應非 JSON 時退回通用訊息
                pass
            raise MetaPublishError(
                message or f"Graph API error (HTTP {resp.status_code})",
                code=code,
            )

    @classmethod
    async def publish_facebook(
        cls,
        message: str,
        image_url: Optional[str] = None,
        link: Optional[str] = None,
    ) -> str:
        """發文到 Facebook 粉專，回傳貼文 id。

        有圖 → POST /{page_id}/photos（url + caption）
        無圖 → POST /{page_id}/feed（message + 選填 link）
        """
        token = cls._require(settings.META_PAGE_ACCESS_TOKEN, "META_PAGE_ACCESS_TOKEN")
        page_id = cls._require(settings.META_PAGE_ID, "META_PAGE_ID")
        client = get_http_client()

        if image_url:
            url = f"{cls._base_url()}/{page_id}/photos"
            data = {
                "url": image_url,
                "caption": message or "",
                "access_token": token,
            }
        else:
            url = f"{cls._base_url()}/{page_id}/feed"
            data = {"message": message or "", "access_token": token}
            if link:
                data["link"] = link

        resp = await client.post(url, data=data)
        cls._raise_for_graph_error(resp)
        body = resp.json()
        # /photos 回 {"id": photo_id, "post_id": 貼文 id}；/feed 回 {"id": 貼文 id}
        return body.get("post_id") or body["id"]

    @classmethod
    async def publish_instagram(cls, message: str, image_url: Optional[str]) -> str:
        """發文到 Instagram Business 帳號，回傳 media id。

        IG 內容發布為兩段式，且必須提供公開可存取的圖片 URL：
        1. POST /{ig_user_id}/media（image_url + caption）→ creation_id
        2. POST /{ig_user_id}/media_publish（creation_id）→ media id
        """
        if not image_url:
            raise MetaPublishError("Instagram 發文必須提供圖片 image_url")

        token = cls._require(settings.META_PAGE_ACCESS_TOKEN, "META_PAGE_ACCESS_TOKEN")
        ig_user_id = cls._require(settings.META_IG_USER_ID, "META_IG_USER_ID")
        client = get_http_client()

        # 1) 建立 media container
        resp = await client.post(
            f"{cls._base_url()}/{ig_user_id}/media",
            data={
                "image_url": image_url,
                "caption": message or "",
                "access_token": token,
            },
        )
        cls._raise_for_graph_error(resp)
        creation_id = resp.json()["id"]

        # 2) 發布
        resp2 = await client.post(
            f"{cls._base_url()}/{ig_user_id}/media_publish",
            data={"creation_id": creation_id, "access_token": token},
        )
        cls._raise_for_graph_error(resp2)
        return resp2.json()["id"]
