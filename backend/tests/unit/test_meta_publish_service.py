"""MetaPublishService 單元測試（issue #591 — Meta 發文 API）。

以 mock 的 httpx client 驗證 Graph API 呼叫組裝與錯誤處理，不實際打 Meta。
純 service 層測試，本機可執行。
"""

import pytest
from unittest.mock import AsyncMock, patch

from services.meta_publish_service import (
    MetaPublishService,
    MetaPublishError,
    MetaConfigError,
)


def _fake_response(status_code=200, json_body=None):
    resp = AsyncMock()
    resp.status_code = status_code
    # .json() 在程式裡是同步呼叫
    resp.json = lambda: (json_body or {})
    return resp


def _patch_client(post_side_effect):
    """回傳 (patcher, mock_client)：mock get_http_client().post。"""
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=post_side_effect)
    patcher = patch(
        "services.meta_publish_service.get_http_client",
        return_value=mock_client,
    )
    return patcher, mock_client


@pytest.fixture(autouse=True)
def _meta_settings(monkeypatch):
    """設定齊全的 Meta 憑證，個別測試可再覆寫。"""
    from services import meta_publish_service as mod

    monkeypatch.setattr(mod.settings, "META_PAGE_ACCESS_TOKEN", "TESTTOKEN")
    monkeypatch.setattr(mod.settings, "META_PAGE_ID", "PAGE123")
    monkeypatch.setattr(mod.settings, "META_IG_USER_ID", "IG456")
    monkeypatch.setattr(mod.settings, "META_GRAPH_VERSION", "v21.0")


class TestPublishFacebook:
    @pytest.mark.asyncio
    async def test_text_only_posts_to_feed(self):
        patcher, client = _patch_client(
            [_fake_response(json_body={"id": "PAGE123_999"})]
        )
        with patcher:
            post_id = await MetaPublishService.publish_facebook(message="Hello")

        assert post_id == "PAGE123_999"
        url, kwargs = client.post.call_args[0][0], client.post.call_args[1]
        assert url.endswith("/v21.0/PAGE123/feed")
        assert kwargs["data"]["message"] == "Hello"
        assert kwargs["data"]["access_token"] == "TESTTOKEN"
        assert "link" not in kwargs["data"]

    @pytest.mark.asyncio
    async def test_with_link_included(self):
        patcher, client = _patch_client([_fake_response(json_body={"id": "X"})])
        with patcher:
            await MetaPublishService.publish_facebook(
                message="hi", link="https://duotopia.co/blog/x"
            )
        assert client.post.call_args[1]["data"]["link"] == (
            "https://duotopia.co/blog/x"
        )

    @pytest.mark.asyncio
    async def test_with_image_posts_to_photos_and_returns_post_id(self):
        patcher, client = _patch_client(
            [_fake_response(json_body={"id": "PHOTO1", "post_id": "PAGE123_777"})]
        )
        with patcher:
            post_id = await MetaPublishService.publish_facebook(
                message="cap", image_url="https://img/x.jpg"
            )
        # 帶圖時優先回 post_id（真正的貼文 id）
        assert post_id == "PAGE123_777"
        url = client.post.call_args[0][0]
        assert url.endswith("/PAGE123/photos")
        assert client.post.call_args[1]["data"]["url"] == "https://img/x.jpg"

    @pytest.mark.asyncio
    async def test_graph_error_raises_meta_publish_error(self):
        patcher, _ = _patch_client(
            [
                _fake_response(
                    status_code=400,
                    json_body={
                        "error": {"message": "Invalid OAuth token", "code": 190}
                    },
                )
            ]
        )
        with patcher, pytest.raises(MetaPublishError) as exc:
            await MetaPublishService.publish_facebook(message="x")
        assert "Invalid OAuth token" in str(exc.value)
        assert exc.value.code == 190

    @pytest.mark.asyncio
    async def test_missing_token_raises_config_error(self, monkeypatch):
        from services import meta_publish_service as mod

        monkeypatch.setattr(mod.settings, "META_PAGE_ACCESS_TOKEN", None)
        with pytest.raises(MetaConfigError):
            await MetaPublishService.publish_facebook(message="x")


class TestPublishInstagram:
    @pytest.mark.asyncio
    async def test_two_step_publish_returns_media_id(self):
        patcher, client = _patch_client(
            [
                _fake_response(json_body={"id": "CREATION1"}),
                _fake_response(json_body={"id": "MEDIA1"}),
            ]
        )
        with patcher:
            media_id = await MetaPublishService.publish_instagram(
                message="cap", image_url="https://img/x.jpg"
            )
        assert media_id == "MEDIA1"
        assert client.post.call_count == 2
        first_url = client.post.call_args_list[0][0][0]
        second_url = client.post.call_args_list[1][0][0]
        assert first_url.endswith("/IG456/media")
        assert second_url.endswith("/IG456/media_publish")
        assert client.post.call_args_list[1][1]["data"]["creation_id"] == "CREATION1"

    @pytest.mark.asyncio
    async def test_missing_image_raises_without_http_call(self):
        patcher, client = _patch_client([])
        with patcher, pytest.raises(MetaPublishError):
            await MetaPublishService.publish_instagram(message="cap", image_url=None)
        client.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_error_on_container_creation_raises(self):
        patcher, client = _patch_client(
            [
                _fake_response(
                    status_code=400,
                    json_body={"error": {"message": "bad image", "code": 100}},
                )
            ]
        )
        with patcher, pytest.raises(MetaPublishError):
            await MetaPublishService.publish_instagram(
                message="c", image_url="https://img/x.jpg"
            )
        # 第一段就失敗，不應呼叫第二段 publish
        assert client.post.call_count == 1
