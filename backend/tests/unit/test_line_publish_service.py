"""LinePublishService 單元測試（issue #804 — LINE 官方帳號發布更新公告）。

以 mock 的 httpx client 驗證 LINE Messaging API 呼叫組裝與錯誤處理，不實際打 LINE。
純 service 層測試，本機可執行。
"""

import pytest
from unittest.mock import AsyncMock, patch

from services.line_publish_service import (
    LinePublishService,
    LinePublishError,
    LineConfigError,
)


def _fake_response(status_code=200, json_body=None, request_id="REQ-1"):
    resp = AsyncMock()
    resp.status_code = status_code
    resp.json = lambda: (json_body or {})
    resp.headers = {"x-line-request-id": request_id} if request_id else {}
    return resp


def _patch_client(post_side_effect):
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=post_side_effect)
    patcher = patch(
        "services.line_publish_service.get_http_client",
        return_value=mock_client,
    )
    return patcher, mock_client


@pytest.fixture(autouse=True)
def _line_settings(monkeypatch):
    from services import line_publish_service as mod

    monkeypatch.setattr(mod.settings, "LINE_CHANNEL_ACCESS_TOKEN", "TESTTOKEN")
    monkeypatch.setattr(mod.settings, "LINE_TEST_USER_ID", "Utest123")


class TestBroadcast:
    @pytest.mark.asyncio
    async def test_posts_to_broadcast_endpoint(self):
        patcher, client = _patch_client([_fake_response()])
        messages = [{"type": "text", "text": "hi"}]
        with patcher:
            request_id = await LinePublishService.broadcast(messages)

        assert request_id == "REQ-1"
        url = client.post.call_args[0][0]
        kwargs = client.post.call_args[1]
        assert url == "https://api.line.me/v2/bot/message/broadcast"
        assert kwargs["json"] == {"messages": messages}
        assert kwargs["headers"]["Authorization"] == "Bearer TESTTOKEN"

    @pytest.mark.asyncio
    async def test_missing_token_raises_config_error(self, monkeypatch):
        from services import line_publish_service as mod

        monkeypatch.setattr(mod.settings, "LINE_CHANNEL_ACCESS_TOKEN", None)
        with pytest.raises(LineConfigError):
            await LinePublishService.broadcast([{"type": "text", "text": "hi"}])

    @pytest.mark.asyncio
    async def test_api_error_raises_with_line_message(self):
        patcher, _ = _patch_client(
            [_fake_response(status_code=403, json_body={"message": "Not authorized"})]
        )
        with patcher, pytest.raises(LinePublishError) as exc:
            await LinePublishService.broadcast([{"type": "text", "text": "hi"}])

        assert "Not authorized" in str(exc.value)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_empty_messages_rejected(self):
        with pytest.raises(LinePublishError):
            await LinePublishService.broadcast([])


class TestPush:
    @pytest.mark.asyncio
    async def test_push_includes_target_user(self):
        patcher, client = _patch_client([_fake_response(request_id="REQ-2")])
        with patcher:
            request_id = await LinePublishService.push(
                "Uabc", [{"type": "text", "text": "hi"}]
            )

        assert request_id == "REQ-2"
        assert client.post.call_args[0][0] == "https://api.line.me/v2/bot/message/push"
        assert client.post.call_args[1]["json"]["to"] == "Uabc"

    @pytest.mark.asyncio
    async def test_push_without_target_raises_config_error(self):
        with pytest.raises(LineConfigError):
            await LinePublishService.push("", [{"type": "text", "text": "hi"}])


class TestBuildReleaseFlex:
    def _flex(self, **overrides):
        kwargs = dict(
            title_zh="新功能上線",
            body_zh="我們新增了單字選擇題型。",
            title_en="New feature",
            body_en="Word choice questions are now available.",
            image_url="https://cdn.example.com/banner.png",
            link="https://duotopia.co/blog/new-feature",
        )
        kwargs.update(overrides)
        return LinePublishService.build_release_flex(**kwargs)

    def test_contains_both_locales_and_hero_image(self):
        flex = self._flex()
        assert flex["type"] == "flex"
        payload = str(flex)
        assert "新功能上線" in payload
        assert "New feature" in payload
        assert flex["contents"]["hero"]["url"] == "https://cdn.example.com/banner.png"

    def test_alt_text_truncated_to_line_limit(self):
        flex = self._flex(body_zh="長" * 900)
        assert len(flex["altText"]) <= 400

    def test_link_becomes_footer_button(self):
        flex = self._flex()
        footer = str(flex["contents"]["footer"])
        assert "https://duotopia.co/blog/new-feature" in footer

    def test_without_image_has_no_hero(self):
        flex = self._flex(image_url=None)
        assert "hero" not in flex["contents"]

    def test_without_link_has_no_footer(self):
        flex = self._flex(link=None)
        assert "footer" not in flex["contents"]

    def test_english_section_omitted_when_blank(self):
        flex = self._flex(title_en="", body_en="")
        payload = str(flex)
        assert "新功能上線" in payload
        assert "New feature" not in payload
