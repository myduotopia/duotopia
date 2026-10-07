"""release_announcements router 的 orchestration 測試（issue #804）。

不經 TestClient：直接呼叫 router 內的函式（DB 用 conftest 的 sqlite session），
驗證 webhook 驗證、清單過濾、編輯限制、通道發布結果與 LINE 預覽。
"""

import pytest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from pydantic import ValidationError

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
    async def test_accepts_prewritten_content(self, test_db_session):
        written = {**AI_RESULT, "line_message_zh": "CI 帶來的現成文案"}
        with _patch_ai() as ai:
            resp = await ra.create_release_announcement(
                _body(source_ref="pre", content=written),
                x_release_secret="SECRET",
                db=test_db_session,
            )
        assert resp.created is True
        assert ai.return_value.generate_json.await_count == 0
        row = test_db_session.get(ReleaseAnnouncement, resp.id)
        assert row.line_message_zh == "CI 帶來的現成文案"

    @pytest.mark.asyncio
    async def test_new_draft_notifies_announce_user_once(self, test_db_session):
        with patch.object(
            ra.ReleaseAnnouncementService,
            "notify_draft_created",
            new=AsyncMock(return_value=True),
        ) as notify:
            first = await _create(test_db_session, source_ref="notify-1")
            # CI 重跑同一個 commit：草稿已存在，不再通知
            await _create(test_db_session, source_ref="notify-1")

        assert notify.await_count == 1
        assert notify.await_args.args[0].id == first.id

    def test_content_fields_have_length_limits(self):
        with pytest.raises(ValidationError):
            ra.AnnouncementContent(line_message_zh="字" * 5001)
        with pytest.raises(ValidationError):
            ra.AnnouncementContent(article_body_en="a" * 50001)
        # 標題上限與 DB / 後台編輯一致（200），不在 service 裡默默截斷
        with pytest.raises(ValidationError):
            ra.AnnouncementContent(article_title_zh="標" * 201)

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


class TestImageUpload:
    """#1100：後台上傳公告圖片"""

    PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    GIF = b"GIF89a" + b"0" * 64

    @staticmethod
    def _file(data, name="a.png"):
        from io import BytesIO
        from fastapi import UploadFile

        return UploadFile(file=BytesIO(data), filename=name)

    @pytest.mark.asyncio
    async def test_stores_and_returns_url(self):
        with patch.object(
            ra,
            "store_announcement_image",
            return_value="https://storage.googleapis.com/duotopia-audio/announcements/x.png",
        ) as store:
            resp = await ra.upload_announcement_image(
                file=self._file(self.PNG), purpose="body", admin=_Admin()
            )
        assert resp["url"].endswith("x.png")
        assert store.call_args.args[1:] == ("image/png", "png")

    @pytest.mark.asyncio
    async def test_rejects_non_image(self):
        with pytest.raises(HTTPException) as exc:
            await ra.upload_announcement_image(
                file=self._file(b"<html>"), purpose="body", admin=_Admin()
            )
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_rejects_over_10mb(self):
        with pytest.raises(HTTPException) as exc:
            await ra.upload_announcement_image(
                file=self._file(self.PNG + b"0" * (10 * 1024 * 1024)),
                purpose="body",
                admin=_Admin(),
            )
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_hero_over_1mb_rejected_body_allowed(self):
        big = self.PNG + b"0" * (1024 * 1024)
        with pytest.raises(HTTPException) as exc:
            await ra.upload_announcement_image(
                file=self._file(big), purpose="hero", admin=_Admin()
            )
        assert exc.value.status_code == 400
        assert "1 MB" in exc.value.detail

        with patch.object(
            ra, "store_announcement_image", return_value="https://x/b.png"
        ):
            resp = await ra.upload_announcement_image(
                file=self._file(big), purpose="body", admin=_Admin()
            )
        assert resp["url"] == "https://x/b.png"

    @pytest.mark.asyncio
    async def test_hero_must_be_jpeg_or_png(self):
        with pytest.raises(HTTPException) as exc:
            await ra.upload_announcement_image(
                file=self._file(self.GIF, "a.gif"), purpose="hero", admin=_Admin()
            )
        assert exc.value.status_code == 400
        assert "JPEG" in exc.value.detail

        with patch.object(
            ra, "store_announcement_image", return_value="https://x/a.gif"
        ):
            resp = await ra.upload_announcement_image(
                file=self._file(self.GIF, "a.gif"), purpose="body", admin=_Admin()
            )
        assert resp["url"] == "https://x/a.gif"

    def test_webhook_content_accepts_https_hero(self):
        assert ra.AnnouncementContent(image_url="https://a/b.png").image_url
        with pytest.raises(ValidationError):
            ra.AnnouncementContent(image_url="http://a/b.png")


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

    @pytest.mark.parametrize(
        "url",
        [
            "http://cdn.example.com/a.png",
            "javascript:alert(1)",
            "cdn/a.png",
            "https://",
            "https:///a.png",
        ],
    )
    def test_image_url_must_be_https(self, url):
        with pytest.raises(ValidationError):
            ra.ReleaseAnnouncementUpdate(image_url=url)

    @pytest.mark.parametrize("url", ["https://cdn.example.com/a.png", "", "  "])
    def test_image_url_accepts_https_or_blank(self, url):
        assert ra.ReleaseAnnouncementUpdate(image_url=url).image_url == url

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
