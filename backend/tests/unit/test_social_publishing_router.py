"""social_publishing router 的 orchestration 單元測試（issue #591）。

不經 TestClient / 真 DB：用 FakeSession + mock MetaPublishService 直接呼叫
router 內的 async 函式，驗證「每平台一列記錄、平台獨立、全失敗 502、
自由貼文驗證、blog 轉發文案組裝」等邏輯。本機可執行。
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from fastapi import HTTPException

import routers.social_publishing as sp
from services.meta_publish_service import MetaPublishError


class FakeSession:
    """極簡假 DB session：refresh 時給 record 一個遞增 id。"""

    def __init__(self):
        self._id = 0
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        pass

    def refresh(self, obj):
        self._id += 1
        obj.id = self._id


@pytest.fixture
def db():
    return FakeSession()


class TestPublishToPlatforms:
    @pytest.mark.asyncio
    async def test_both_platforms_success(self, db):
        with patch.object(
            sp.MetaPublishService,
            "publish_facebook",
            new=AsyncMock(return_value="FB1"),
        ), patch.object(
            sp.MetaPublishService,
            "publish_instagram",
            new=AsyncMock(return_value="IG1"),
        ):
            resp = await sp._publish_to_platforms(
                db,
                ["facebook", "instagram"],
                message="hi",
                image_url="https://img/x.jpg",
                link=None,
                source="manual",
                source_blog_post_id=None,
                admin_id=7,
            )

        assert resp.ok is True
        assert [r.platform for r in resp.results] == ["facebook", "instagram"]
        assert [r.status for r in resp.results] == ["success", "success"]
        assert {r.external_post_id for r in resp.results} == {"FB1", "IG1"}
        # 每平台一列，共 2 列，且 created_by 帶入
        assert len(db.added) == 2
        assert all(rec.created_by == 7 for rec in db.added)

    @pytest.mark.asyncio
    async def test_one_platform_fails_other_still_recorded(self, db):
        with patch.object(
            sp.MetaPublishService,
            "publish_facebook",
            new=AsyncMock(return_value="FB1"),
        ), patch.object(
            sp.MetaPublishService,
            "publish_instagram",
            new=AsyncMock(side_effect=MetaPublishError("no image")),
        ):
            resp = await sp._publish_to_platforms(
                db,
                ["facebook", "instagram"],
                message="hi",
                image_url=None,
                link=None,
                source="manual",
                source_blog_post_id=None,
                admin_id=1,
            )

        assert resp.ok is True  # 只要一個成功即 ok
        fb, ig = resp.results
        assert fb.status == "success"
        assert ig.status == "failed"
        assert "no image" in ig.error
        assert len(db.added) == 2  # 失敗也留紀錄

    @pytest.mark.asyncio
    async def test_all_fail_raises_502(self, db):
        with patch.object(
            sp.MetaPublishService,
            "publish_facebook",
            new=AsyncMock(side_effect=MetaPublishError("token expired", code=190)),
        ):
            with pytest.raises(HTTPException) as exc:
                await sp._publish_to_platforms(
                    db,
                    ["facebook"],
                    message="hi",
                    image_url=None,
                    link=None,
                    source="manual",
                    source_blog_post_id=None,
                    admin_id=1,
                )
        assert exc.value.status_code == 502
        assert exc.value.detail["ok"] is False
        # 紀錄仍寫入（失敗紀錄）
        assert len(db.added) == 1
        assert db.added[0].status == "failed"


class TestPublishPostEndpoint:
    @pytest.mark.asyncio
    async def test_empty_message_and_image_returns_400(self, db):
        body = sp.PublishRequest(platforms=["facebook"], message="", image_url=None)
        admin = MagicMock(id=1)
        with pytest.raises(HTTPException) as exc:
            await sp.publish_post(body=body, db=db, admin=admin)
        assert exc.value.status_code == 400


class TestPublishFromBlog:
    @pytest.mark.asyncio
    async def test_not_found_returns_404(self, db):
        admin = MagicMock(id=1)
        body = sp.BlogPublishRequest(platforms=["facebook"])
        with patch.object(sp.BlogService, "get_post_by_id", return_value=None):
            with pytest.raises(HTTPException) as exc:
                await sp.publish_from_blog(post_id=999, body=body, db=db, admin=admin)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_builds_message_with_title_summary_url(self, db, monkeypatch):
        admin = MagicMock(id=3)
        body = sp.BlogPublishRequest(platforms=["facebook"])
        post = MagicMock(
            id=12,
            title="標題",
            summary="摘要",
            slug="hello-world",
            cover_image_url="https://img/cover.jpg",
        )
        monkeypatch.setattr(sp.settings, "FRONTEND_URL", "https://duotopia.co/")

        captured = {}

        async def fake_publish(db_, platforms, **kwargs):
            captured.update(kwargs)
            captured["platforms"] = platforms
            return sp.PublishResponse(ok=True, results=[])

        with patch.object(
            sp.BlogService, "get_post_by_id", return_value=post
        ), patch.object(sp, "_publish_to_platforms", new=fake_publish):
            await sp.publish_from_blog(post_id=12, body=body, db=db, admin=admin)

        assert captured["source"] == "blog"
        assert captured["source_blog_post_id"] == 12
        assert captured["image_url"] == "https://img/cover.jpg"
        # 文案含標題、摘要、去除重複斜線的文章連結
        assert "標題" in captured["message"]
        assert "摘要" in captured["message"]
        assert "https://duotopia.co/blog/hello-world" in captured["message"]
        assert captured["link"] == "https://duotopia.co/blog/hello-world"
