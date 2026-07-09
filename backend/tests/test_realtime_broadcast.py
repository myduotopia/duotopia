"""Tests for services.realtime_broadcast (Issue #835 / PR #881 點 1).

重點：broadcast 永不破壞收卷流程 —— 未設定 Supabase 或網路失敗皆安全回 False，
設定齊全時才實際 POST 到 Realtime endpoint。
"""
import httpx
import pytest

from services import realtime_broadcast as rb


def test_quiz_channel_topic_format():
    assert rb.quiz_channel_topic(123) == "live-quiz:123"


@pytest.mark.asyncio
async def test_no_op_when_unconfigured(monkeypatch):
    """缺 SUPABASE_URL / key → 回 False 且不發任何請求。"""
    monkeypatch.setattr(rb.settings, "SUPABASE_URL", None, raising=False)
    monkeypatch.setattr(rb.settings, "SUPABASE_SERVICE_KEY", None, raising=False)
    monkeypatch.setattr(rb.settings, "SUPABASE_KEY", None, raising=False)
    monkeypatch.setattr(rb.settings, "SUPABASE_ANON_KEY", None, raising=False)

    def _boom(*_a, **_k):  # 若誤發請求就讓測試爆掉
        raise AssertionError("不應在未設定時送出請求")

    monkeypatch.setattr(rb.httpx, "AsyncClient", _boom)

    assert await rb.broadcast_quiz_closed(1, "2026-06-24T00:00:00+00:00") is False


@pytest.mark.asyncio
async def test_swallows_network_error(monkeypatch):
    """設定齊全但網路失敗 → 回 False，不向上拋例外。"""
    monkeypatch.setattr(
        rb.settings, "SUPABASE_URL", "https://x.supabase.co", raising=False
    )
    monkeypatch.setattr(rb.settings, "SUPABASE_SERVICE_KEY", "svc-key", raising=False)

    class _FailingClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            raise httpx.ConnectError("boom")

    monkeypatch.setattr(rb.httpx, "AsyncClient", _FailingClient)

    assert await rb.broadcast_quiz_closed(7, "2026-06-24T00:00:00+00:00") is False


@pytest.mark.asyncio
async def test_posts_to_realtime_when_configured(monkeypatch):
    """設定齊全 → POST 到 /realtime/v1/api/broadcast，帶正確 topic/event/headers。"""
    monkeypatch.setattr(
        rb.settings, "SUPABASE_URL", "https://x.supabase.co/", raising=False
    )
    monkeypatch.setattr(rb.settings, "SUPABASE_SERVICE_KEY", "svc-key", raising=False)

    captured = {}

    class _OkClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return httpx.Response(200, json={"message": "ok"})

    monkeypatch.setattr(rb.httpx, "AsyncClient", _OkClient)

    ok = await rb.broadcast_quiz_closed(42, "2026-06-24T01:02:03+00:00")
    assert ok is True
    assert captured["url"] == "https://x.supabase.co/realtime/v1/api/broadcast"
    msg = captured["json"]["messages"][0]
    assert msg["topic"] == "live-quiz:42"
    assert msg["event"] == "quiz_closed"
    assert msg["payload"]["assignment_id"] == 42
    assert msg["payload"]["closed_at"] == "2026-06-24T01:02:03+00:00"
    assert captured["headers"]["apikey"] == "svc-key"
    assert captured["headers"]["Authorization"] == "Bearer svc-key"


@pytest.mark.asyncio
async def test_returns_false_on_4xx(monkeypatch):
    """Realtime 回 4xx → False（不拋）。"""
    monkeypatch.setattr(
        rb.settings, "SUPABASE_URL", "https://x.supabase.co", raising=False
    )
    monkeypatch.setattr(rb.settings, "SUPABASE_SERVICE_KEY", "svc-key", raising=False)

    class _ForbiddenClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            return httpx.Response(403, text="forbidden")

    monkeypatch.setattr(rb.httpx, "AsyncClient", _ForbiddenClient)

    assert await rb.broadcast_quiz_closed(9, "2026-06-24T00:00:00+00:00") is False
