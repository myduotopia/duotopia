"""release_announcements router 的 orchestration 測試（issue #804）。

不經 TestClient：直接呼叫 router 內的函式（DB 用 conftest 的 sqlite session），
驗證 webhook 驗證、清單過濾、編輯限制、通道發布結果與 LINE 預覽。
"""

import pytest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

import routers.release_announcements as ra
from models.release_announcement import (
    ReleaseAnnouncement,
    STATUS_DISCARDED,
    STATUS_MERGED,
    STATUS_PUBLISHED,
    CHANNEL_PUBLISHED,
)

AI_RESULT = {
    "line_message_zh": "新功能上線",
    "line_message_en": "New feature is live",
    "article_title_zh": "新功能",
    "article_body_zh": "內文",
    "article_title_en": "New feature",
    "article_body_en": "Body",
}


def _patch_ai():
    service = AsyncMock()
    service.generate_json = AsyncMock(return_value=AI_RESULT)
    return patch(
        "services.release_announcement_service.get_vertex_ai_service",
        return_value=service,
    )


@pytest.fixture(autouse=True)
def _settings(monkeypatch):
    from services import release_announcement_service as svc

    monkeypatch.setattr(ra.settings, "RELEASE_WEBHOOK_SECRET", "SECRET")
    monkeypatch.setattr(ra.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(svc.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(svc.settings, "FRONTEND_URL", "https://duotopia.co")
    monkeypatch.setattr(
        svc.settings, "RELEASE_ANNOUNCEMENT_BANNER_URL", "https://cdn/b.png"
    )


class _Admin:
    id = 7


def _body(**overrides):
    payload = dict(
        environment="production",
        source_ref="sha-1",
        release_title="Release: [Feature]: 單字選擇 (Fixes #860)",
        source_branch="main",
        pr_number=991,
    )
    payload.update(overrides)
    return ra.ReleaseWebhookRequest(**payload)


async def _create(db, **overrides):
    with _patch_ai():
        return await ra.create_release_announcement(
            _body(**overrides), x_release_secret="SECRET", db=db
        )


class TestWebhook:
    @pytest.mark.asyncio
    async def test_creates_draft(self, test_db_session):
        resp = await _create(test_db_session)
        assert resp.created is True
        assert resp.id is not None
        assert test_db_session.query(ReleaseAnnouncement).count() == 1

    @pytest.mark.asyncio
    async def test_duplicate_commit_returns_existing(self, test_db_session):
        first = await _create(test_db_session)
        second = await _create(test_db_session)
        assert second.created is False
        assert second.id == first.id

    @pytest.mark.asyncio
    async def test_wrong_secret_rejected(self, test_db_session):
        with pytest.raises(HTTPException) as exc:
            await ra.create_release_announcement(
                _body(), x_release_secret="WRONG", db=test_db_session
            )
        assert exc.value.status_code == 401

    @pytest.mark.asyncio
    async def test_missing_secret_rejected(self, test_db_session):
        with pytest.raises(HTTPException) as exc:
            await ra.create_release_announcement(
                _body(), x_release_secret=None, db=test_db_session
            )
        assert exc.value.status_code == 401

    @pytest.mark.asyncio
    async def test_unconfigured_secret_disables_endpoint(
        self, test_db_session, monkeypatch
    ):
        monkeypatch.setattr(ra.settings, "RELEASE_WEBHOOK_SECRET", None)
        with pytest.raises(HTTPException) as exc:
            await ra.create_release_announcement(
                _body(), x_release_secret="SECRET", db=test_db_session
            )
        assert exc.value.status_code == 503


class TestListAndGet:
    @pytest.mark.asyncio
    async def test_list_hides_merged_and_discarded_by_default(self, test_db_session):
        db = test_db_session
        keep = await _create(db, source_ref="keep")
        merged = await _create(db, source_ref="merged")
        discarded = await _create(db, source_ref="discarded")
        db.query(ReleaseAnnouncement).filter(
            ReleaseAnnouncement.id == merged.id
        ).update({"status": STATUS_MERGED})
        db.query(ReleaseAnnouncement).filter(
            ReleaseAnnouncement.id == discarded.id
        ).update({"status": STATUS_DISCARDED})
        db.commit()

        items = await ra.list_release_announcements(
            status=None, limit=50, db=db, admin=_Admin()
        )
        assert [i.id for i in items] == [keep.id]

    @pytest.mark.asyncio
    async def test_list_filters_by_status(self, test_db_session):
        db = test_db_session
        created = await _create(db, source_ref="s1")
        db.query(ReleaseAnnouncement).filter(
            ReleaseAnnouncement.id == created.id
        ).update({"status": STATUS_PUBLISHED})
        db.commit()

        items = await ra.list_release_announcements(
            status=STATUS_PUBLISHED, limit=50, db=db, admin=_Admin()
        )
        assert [i.id for i in items] == [created.id]

    @pytest.mark.asyncio
    async def test_get_missing_returns_404(self, test_db_session):
        with pytest.raises(HTTPException) as exc:
            await ra.get_release_announcement(999, db=test_db_session, admin=_Admin())
        assert exc.value.status_code == 404


class TestUpdate:
    @pytest.mark.asyncio
    async def test_updates_line_and_article_independently(self, test_db_session):
        db = test_db_session
        created = await _create(db, source_ref="edit")
        item = await ra.update_release_announcement(
            created.id,
            ra.ReleaseAnnouncementUpdate(line_message_zh="改過的 LINE 文案"),
            db=db,
            admin=_Admin(),
        )
        assert item.line_message_zh == "改過的 LINE 文案"
        assert item.article_title_zh == AI_RESULT["article_title_zh"]

    @pytest.mark.asyncio
    async def test_published_announcement_cannot_be_edited(self, test_db_session):
        db = test_db_session
        created = await _create(db, source_ref="locked")
        db.query(ReleaseAnnouncement).filter(
            ReleaseAnnouncement.id == created.id
        ).update({"status": STATUS_PUBLISHED})
        db.commit()

        with pytest.raises(HTTPException) as exc:
            await ra.update_release_announcement(
                created.id,
                ra.ReleaseAnnouncementUpdate(line_message_zh="x"),
                db=db,
                admin=_Admin(),
            )
        assert exc.value.status_code == 400


class TestMerge:
    @pytest.mark.asyncio
    async def test_merges_old_draft_into_new(self, test_db_session):
        db = test_db_session
        old = await _create(db, source_ref="old")
        new = await _create(db, source_ref="new")

        item = await ra.merge_release_announcements(
            new.id, ra.MergeRequest(source_ids=[old.id]), db=db, admin=_Admin()
        )
        assert item.line_message_zh.count(AI_RESULT["line_message_zh"]) == 2

        merged = (
            db.query(ReleaseAnnouncement).filter(ReleaseAnnouncement.id == old.id).one()
        )
        assert merged.status == STATUS_MERGED

    @pytest.mark.asyncio
    async def test_invalid_merge_returns_400(self, test_db_session):
        db = test_db_session
        target = await _create(db, source_ref="target")
        with pytest.raises(HTTPException) as exc:
            await ra.merge_release_announcements(
                target.id,
                ra.MergeRequest(source_ids=[target.id]),
                db=db,
                admin=_Admin(),
            )
        assert exc.value.status_code == 400


class TestPublish:
    @pytest.mark.asyncio
    async def test_publish_website_only(self, test_db_session):
        db = test_db_session
        created = await _create(db, source_ref="pub-web")
        item = await ra.publish_release_announcement(
            created.id,
            ra.PublishRequest(channels=["website"]),
            db=db,
            admin=_Admin(),
        )
        assert item.website_status == CHANNEL_PUBLISHED
        assert item.published_blog_url.startswith("https://duotopia.co/blog/")

    @pytest.mark.asyncio
    async def test_publish_line_failure_returns_502(self, test_db_session):
        db = test_db_session
        created = await _create(db, source_ref="pub-line-fail")
        from services.line_publish_service import LinePublishError

        with patch(
            "services.release_announcement_service.LinePublishService.broadcast",
            new=AsyncMock(side_effect=LinePublishError("limit reached", 429)),
        ):
            with pytest.raises(HTTPException) as exc:
                await ra.publish_release_announcement(
                    created.id,
                    ra.PublishRequest(channels=["line"]),
                    db=db,
                    admin=_Admin(),
                )
        assert exc.value.status_code == 502
        assert "limit reached" in str(exc.value.detail)

    @pytest.mark.asyncio
    async def test_partial_failure_still_returns_200(self, test_db_session):
        db = test_db_session
        created = await _create(db, source_ref="pub-partial")
        from services.line_publish_service import LinePublishError

        with patch(
            "services.release_announcement_service.LinePublishService.broadcast",
            new=AsyncMock(side_effect=LinePublishError("limit reached", 429)),
        ):
            item = await ra.publish_release_announcement(
                created.id,
                ra.PublishRequest(channels=["line", "website"]),
                db=db,
                admin=_Admin(),
            )
        assert item.website_status == CHANNEL_PUBLISHED
        assert item.line_status == "failed"

    @pytest.mark.asyncio
    async def test_discard(self, test_db_session):
        db = test_db_session
        created = await _create(db, source_ref="discard-me")
        item = await ra.discard_release_announcement(created.id, db=db, admin=_Admin())
        assert item.status == STATUS_DISCARDED


class TestLinePreview:
    @pytest.mark.asyncio
    async def test_returns_flex_payload_for_admin_preview(self, test_db_session):
        db = test_db_session
        created = await _create(db, source_ref="preview")
        preview = await ra.preview_line_message(created.id, db=db, admin=_Admin())
        assert preview["type"] == "flex"
        assert AI_RESULT["line_message_zh"] in str(preview)
