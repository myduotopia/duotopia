"""ReleaseAnnouncementService 單元測試（issue #804）。

涵蓋：release 標題解析、AI 草稿產生（含失敗退回）、草稿編輯與合併、
以及「LINE / 官網」兩通道各自獨立的發布行為。
外部服務（Vertex AI、LINE API）全部 mock，純 service 層測試，本機可執行。
"""

import pytest
from unittest.mock import AsyncMock, patch

from models import BlogPost
from models.blog import BlogCategory, BlogPostCategory
from models.release_announcement import (
    ReleaseAnnouncement,
    STATUS_DRAFT,
    STATUS_DISCARDED,
    STATUS_MERGED,
    STATUS_PARTIALLY_PUBLISHED,
    STATUS_PUBLISHED,
    CHANNEL_FAILED,
    CHANNEL_PENDING,
    CHANNEL_PUBLISHED,
)
from services.release_announcement_service import (
    PRODUCT_UPDATE_CATEGORY_SLUG,
    ReleaseAnnouncementService,
)
from services.line_publish_service import LinePublishError

AI_RESULT = {
    "line_message_zh": "單字選擇題型上線囉！",
    "line_message_en": "Word choice questions are live!",
    "article_title_zh": "新功能：單字選擇題型",
    "article_body_zh": "老師現在可以指派單字選擇題型。",
    "article_title_en": "New: word choice questions",
    "article_body_en": "Teachers can now assign word choice questions.",
}


def _patch_ai(result=None, side_effect=None):
    service = AsyncMock()
    service.generate_json = AsyncMock(
        return_value=result if result is not None else AI_RESULT,
        side_effect=side_effect,
    )
    return (
        patch(
            "services.release_announcement_service.get_vertex_ai_service",
            return_value=service,
        ),
        service,
    )


async def _make_draft(db, *, environment="production", source_ref="sha1", **kwargs):
    with _patch_ai()[0]:
        ann, _ = await ReleaseAnnouncementService.create_draft_from_release(
            db,
            environment=environment,
            source_ref=source_ref,
            release_title=kwargs.pop(
                "release_title", "Release: [Feature]: 單字選擇 (Fixes #860)"
            ),
            **kwargs,
        )
    return ann


@pytest.fixture(autouse=True)
def _settings(monkeypatch):
    from services import release_announcement_service as mod

    monkeypatch.setattr(mod.settings, "FRONTEND_URL", "https://duotopia.co")
    monkeypatch.setattr(mod.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(
        mod.settings, "RELEASE_ANNOUNCEMENT_BANNER_URL", "https://cdn/banner.png"
    )
    monkeypatch.setattr(mod.settings, "LINE_TEST_USER_ID", "Utest123")


class TestParseReleaseTitle:
    def test_feature_release_title(self):
        parsed = ReleaseAnnouncementService.parse_release_title(
            "Release: [Feature]: 老師端 Google OAuth 登入 (Fixes #740) (#991)"
        )
        assert parsed["change_type"] == "feature"
        assert parsed["issue_numbers"] == "740"
        assert "Google OAuth" in parsed["clean_title"]
        assert "Fixes" not in parsed["clean_title"]

    def test_bugfix_conventional_commit(self):
        parsed = ReleaseAnnouncementService.parse_release_title(
            "fix(#816): 修復錄音中斷誤報 (#900)"
        )
        assert parsed["change_type"] == "bugfix"
        assert parsed["issue_numbers"] == "816"

    def test_unknown_type_falls_back_to_other(self):
        parsed = ReleaseAnnouncementService.parse_release_title("chore: 更新相依套件")
        assert parsed["change_type"] == "other"
        assert parsed["issue_numbers"] is None


class TestCreateDraft:
    @pytest.mark.asyncio
    async def test_creates_draft_with_bilingual_content(self, test_db_session):
        db = test_db_session
        patcher, ai = _patch_ai()
        with patcher:
            ann, created = await ReleaseAnnouncementService.create_draft_from_release(
                db,
                environment="production",
                source_ref="abc123",
                source_branch="main",
                release_title="Release: [Feature]: 單字選擇 (Fixes #860)",
                pr_number=991,
            )

        assert created is True
        assert ann.status == STATUS_DRAFT
        assert ann.line_message_zh == AI_RESULT["line_message_zh"]
        assert ann.line_message_en == AI_RESULT["line_message_en"]
        assert ann.article_title_zh == AI_RESULT["article_title_zh"]
        assert ann.article_body_en == AI_RESULT["article_body_en"]
        assert ann.change_type == "feature"
        assert ann.issue_numbers == "860"
        assert ann.pr_number == 991
        assert ann.image_url == "https://cdn/banner.png"
        assert ann.line_status == CHANNEL_PENDING
        assert ann.website_status == CHANNEL_PENDING
        assert ai.generate_json.await_count == 1

    @pytest.mark.asyncio
    async def test_same_commit_twice_is_idempotent(self, test_db_session):
        db = test_db_session
        first = await _make_draft(db, source_ref="dup-sha")

        patcher, ai = _patch_ai()
        with patcher:
            (
                second,
                created,
            ) = await ReleaseAnnouncementService.create_draft_from_release(
                db,
                environment="production",
                source_ref="dup-sha",
                release_title="Release: [Feature]: 單字選擇 (Fixes #860)",
            )

        assert created is False
        assert second.id == first.id
        assert ai.generate_json.await_count == 0
        assert db.query(ReleaseAnnouncement).count() == 1

    @pytest.mark.asyncio
    async def test_same_commit_in_other_environment_creates_separate_draft(
        self, test_db_session
    ):
        db = test_db_session
        await _make_draft(db, environment="production", source_ref="shared-sha")
        staging = await _make_draft(db, environment="staging", source_ref="shared-sha")

        assert staging.environment == "staging"
        assert db.query(ReleaseAnnouncement).count() == 2

    @pytest.mark.asyncio
    async def test_ai_failure_falls_back_to_release_title(self, test_db_session):
        db = test_db_session
        patcher, _ = _patch_ai(side_effect=RuntimeError("vertex down"))
        with patcher:
            ann, created = await ReleaseAnnouncementService.create_draft_from_release(
                db,
                environment="production",
                source_ref="fallback-sha",
                release_title="Release: [Bug]: 修復錄音問題 (Fixes #816)",
            )

        assert created is True
        assert ann.status == STATUS_DRAFT
        assert "修復錄音問題" in ann.line_message_zh
        assert "修復錄音問題" in ann.article_title_zh
        assert "vertex down" in ann.generation_error


class TestUpdateAndMerge:
    @pytest.mark.asyncio
    async def test_update_draft_overwrites_only_given_fields(self, test_db_session):
        db = test_db_session
        ann = await _make_draft(db, source_ref="edit-sha")

        updated = ReleaseAnnouncementService.update_draft(
            db, ann, {"line_message_zh": "手改文案", "article_title_en": "Edited"}
        )

        assert updated.line_message_zh == "手改文案"
        assert updated.article_title_en == "Edited"
        assert updated.article_title_zh == AI_RESULT["article_title_zh"]

    @pytest.mark.asyncio
    async def test_merge_appends_unpublished_drafts_and_marks_them(
        self, test_db_session
    ):
        db = test_db_session
        old = await _make_draft(db, source_ref="old-sha")
        ReleaseAnnouncementService.update_draft(
            db,
            old,
            {
                "line_message_zh": "舊的沒發的更新",
                "line_message_en": "Older unpublished update",
                "article_title_zh": "舊標題",
                "article_body_zh": "舊內文",
                "article_body_en": "Older body",
            },
        )
        new = await _make_draft(db, source_ref="new-sha")

        merged = ReleaseAnnouncementService.merge_drafts(db, new, [old.id])

        assert "舊的沒發的更新" in merged.line_message_zh
        assert AI_RESULT["line_message_zh"] in merged.line_message_zh
        assert "Older unpublished update" in merged.line_message_en
        assert "舊內文" in merged.article_body_zh
        assert "Older body" in merged.article_body_en

        db.refresh(old)
        assert old.status == STATUS_MERGED
        assert old.merged_into_id == new.id

    @pytest.mark.asyncio
    async def test_merge_rejects_already_published_draft(self, test_db_session):
        db = test_db_session
        published = await _make_draft(db, source_ref="pub-sha")
        published.status = STATUS_PUBLISHED
        db.commit()
        target = await _make_draft(db, source_ref="target-sha")

        with pytest.raises(ValueError):
            ReleaseAnnouncementService.merge_drafts(db, target, [published.id])

    @pytest.mark.asyncio
    async def test_merge_rejects_self(self, test_db_session):
        db = test_db_session
        ann = await _make_draft(db, source_ref="self-sha")
        with pytest.raises(ValueError):
            ReleaseAnnouncementService.merge_drafts(db, ann, [ann.id])

    @pytest.mark.asyncio
    async def test_discard_marks_draft(self, test_db_session):
        db = test_db_session
        ann = await _make_draft(db, source_ref="discard-sha")
        ReleaseAnnouncementService.discard(db, ann)
        assert ann.status == STATUS_DISCARDED


class TestPublishWebsite:
    @pytest.mark.asyncio
    async def test_creates_linked_bilingual_published_posts(self, test_db_session):
        db = test_db_session
        ann = await _make_draft(db, source_ref="web-sha")

        result = await ReleaseAnnouncementService.publish(
            db, ann, channels=["website"], admin_id=None
        )

        assert result.website_status == CHANNEL_PUBLISHED
        assert result.status == STATUS_PARTIALLY_PUBLISHED
        assert result.line_status == CHANNEL_PENDING

        zh = (
            db.query(BlogPost)
            .filter(BlogPost.id == result.published_blog_post_id)
            .one()
        )
        en = (
            db.query(BlogPost)
            .filter(BlogPost.id == result.published_blog_post_en_id)
            .one()
        )
        assert zh.locale == "zh-TW" and en.locale == "en"
        assert zh.is_published and en.is_published
        assert zh.linked_post_id == en.id and en.linked_post_id == zh.id
        assert zh.title == AI_RESULT["article_title_zh"]
        assert en.title == AI_RESULT["article_title_en"]
        assert zh.cover_image_url == "https://cdn/banner.png"

        category = (
            db.query(BlogCategory)
            .filter(BlogCategory.slug == PRODUCT_UPDATE_CATEGORY_SLUG)
            .one()
        )
        linked = (
            db.query(BlogPostCategory)
            .filter(BlogPostCategory.category_id == category.id)
            .all()
        )
        assert {row.post_id for row in linked} == {zh.id, en.id}

    @pytest.mark.asyncio
    async def test_publishing_website_twice_does_not_duplicate_posts(
        self, test_db_session
    ):
        db = test_db_session
        ann = await _make_draft(db, source_ref="web-twice-sha")
        await ReleaseAnnouncementService.publish(db, ann, channels=["website"])
        first_id = ann.published_blog_post_id

        await ReleaseAnnouncementService.publish(db, ann, channels=["website"])

        assert ann.published_blog_post_id == first_id
        assert db.query(BlogPost).count() == 2


class TestPublishLine:
    @pytest.mark.asyncio
    async def test_production_broadcasts(self, test_db_session):
        db = test_db_session
        ann = await _make_draft(db, source_ref="line-sha")

        with patch(
            "services.release_announcement_service.LinePublishService.broadcast",
            new=AsyncMock(return_value="REQ-9"),
        ) as broadcast:
            result = await ReleaseAnnouncementService.publish(
                db, ann, channels=["line"]
            )

        assert result.line_status == CHANNEL_PUBLISHED
        assert result.line_request_id == "REQ-9"
        assert result.status == STATUS_PARTIALLY_PUBLISHED
        messages = broadcast.await_args[0][0]
        assert messages[0]["type"] == "flex"
        assert AI_RESULT["line_message_zh"] in str(messages[0])

    @pytest.mark.asyncio
    async def test_non_production_pushes_to_test_user_with_prefix(
        self, test_db_session, monkeypatch
    ):
        from services import release_announcement_service as mod

        monkeypatch.setattr(mod.settings, "ENVIRONMENT", "staging")
        db = test_db_session
        ann = await _make_draft(
            db, environment="staging", source_ref="line-staging-sha"
        )

        with patch(
            "services.release_announcement_service.LinePublishService.push",
            new=AsyncMock(return_value="REQ-S"),
        ) as push, patch(
            "services.release_announcement_service.LinePublishService.broadcast",
            new=AsyncMock(),
        ) as broadcast:
            result = await ReleaseAnnouncementService.publish(
                db, ann, channels=["line"]
            )

        assert broadcast.await_count == 0
        assert push.await_args[0][0] == "Utest123"
        assert "[STAGING]" in str(push.await_args[0][1])
        assert result.line_status == CHANNEL_PUBLISHED

    @pytest.mark.asyncio
    async def test_line_failure_records_error_without_blocking(self, test_db_session):
        db = test_db_session
        ann = await _make_draft(db, source_ref="line-fail-sha")

        with patch(
            "services.release_announcement_service.LinePublishService.broadcast",
            new=AsyncMock(side_effect=LinePublishError("monthly limit", 429)),
        ):
            result = await ReleaseAnnouncementService.publish(
                db, ann, channels=["line"]
            )

        assert result.line_status == CHANNEL_FAILED
        assert "monthly limit" in result.line_error
        assert result.status == STATUS_DRAFT

    @pytest.mark.asyncio
    async def test_already_published_channel_is_skipped(self, test_db_session):
        db = test_db_session
        ann = await _make_draft(db, source_ref="line-skip-sha")

        with patch(
            "services.release_announcement_service.LinePublishService.broadcast",
            new=AsyncMock(return_value="REQ-1"),
        ) as broadcast:
            await ReleaseAnnouncementService.publish(db, ann, channels=["line"])
            await ReleaseAnnouncementService.publish(db, ann, channels=["line"])

        assert broadcast.await_count == 1


class TestPublishBothChannels:
    @pytest.mark.asyncio
    async def test_website_first_so_line_links_to_article(self, test_db_session):
        db = test_db_session
        ann = await _make_draft(db, source_ref="both-sha")

        with patch(
            "services.release_announcement_service.LinePublishService.broadcast",
            new=AsyncMock(return_value="REQ-B"),
        ) as broadcast:
            result = await ReleaseAnnouncementService.publish(
                db, ann, channels=["line", "website"]
            )

        assert result.status == STATUS_PUBLISHED
        zh = (
            db.query(BlogPost)
            .filter(BlogPost.id == result.published_blog_post_id)
            .one()
        )
        assert f"https://duotopia.co/blog/{zh.slug}" in str(broadcast.await_args[0][0])

    @pytest.mark.asyncio
    async def test_rejects_unknown_channel(self, test_db_session):
        db = test_db_session
        ann = await _make_draft(db, source_ref="bad-channel-sha")
        with pytest.raises(ValueError):
            await ReleaseAnnouncementService.publish(db, ann, channels=["twitter"])

    @pytest.mark.asyncio
    async def test_rejects_empty_channels(self, test_db_session):
        db = test_db_session
        ann = await _make_draft(db, source_ref="no-channel-sha")
        with pytest.raises(ValueError):
            await ReleaseAnnouncementService.publish(db, ann, channels=[])
