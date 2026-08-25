"""
更新公告 service（issue #804 — LINE 官方帳號 / 官網自動發布更新）。

職責：
1. 從 CI 傳來的 release 資訊（commit 標題）產生「LINE 文案」與「官網雙語文章」
   兩份彼此獨立的草稿（AI 產生，失敗時退回用 release 標題）。
2. 後台編輯、把未發布的舊草稿併入新草稿。
3. 依管理者勾選的通道發布：LINE、官網或兩者，各自記錄狀態，
   所以能「先發官網、之後再補發 LINE」。

安全防呆：只有 ENVIRONMENT=production 才真的 broadcast 給所有好友；
其他環境改 push 給 LINE_TEST_USER_ID 並加上 [STAGING] 前綴，
避免測試訊息轟炸真實好友、並保護每月訊息量。
"""

import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from core.config import settings
from models.blog import BlogCategory, BlogPost, BlogPostCategory
from models.release_announcement import (
    CHANNEL_FAILED,
    CHANNEL_LINE,
    CHANNEL_PENDING,
    CHANNEL_PUBLISHED,
    CHANNEL_WEBSITE,
    STATUS_DISCARDED,
    STATUS_DRAFT,
    STATUS_MERGED,
    STATUS_PARTIALLY_PUBLISHED,
    STATUS_PUBLISHED,
    ReleaseAnnouncement,
)
from services.blog_service import BlogService
from services.line_publish_service import LinePublishError, LinePublishService
from services.vertex_ai import get_vertex_ai_service

logger = logging.getLogger(__name__)

# 官網更新公告掛在部落格底下的分類（沒有就自動建立）
PRODUCT_UPDATE_CATEGORY_SLUG = "product-updates"
PRODUCT_UPDATE_CATEGORY_NAME = "產品更新"

VALID_CHANNELS = (CHANNEL_LINE, CHANNEL_WEBSITE)

# 可編輯的草稿欄位（後台 PATCH 白名單）
EDITABLE_FIELDS = (
    "line_message_zh",
    "line_message_en",
    "article_title_zh",
    "article_body_zh",
    "article_title_en",
    "article_body_en",
    "image_url",
)

# 併入舊草稿時各欄位的接合方式
_MERGE_FIELDS = (
    "line_message_zh",
    "line_message_en",
    "article_body_zh",
    "article_body_en",
)

_AI_SYSTEM_INSTRUCTION = (
    "你是 Duotopia（英語學習平台）的產品行銷編輯。"
    "把工程師寫的 release 標題改寫成家長與老師看得懂的更新公告，"
    "不要出現 issue 編號、commit hash、分支名稱或技術術語。"
)

_AI_PROMPT_TEMPLATE = """請根據以下這次上線的內容，產生更新公告。

上線標題：{title}
變更類型：{change_type}

請輸出 JSON，欄位如下（全部必填）：
- line_message_zh：LINE 推播用繁體中文文案，60 字以內，親切口吻，可用 1 個 emoji
- line_message_en：上述文案的英文版，40 words 以內
- article_title_zh：官網文章繁體中文標題，25 字以內
- article_body_zh：官網文章繁體中文內文，150-300 字，說明這次更新帶來什麼好處
- article_title_en：官網文章英文標題
- article_body_en：官網文章英文內文，與中文內文對應

只輸出 JSON，不要額外說明。"""


class ReleaseAnnouncementService:
    """更新公告草稿的產生、編輯、合併與發布。"""

    # ============ release 標題解析 ============

    @staticmethod
    def parse_release_title(title: str) -> Dict[str, Optional[str]]:
        """從 release commit 標題解析出變更類型、issue 編號與乾淨標題。

        支援專案兩種慣例：
        - `Release: [Feature]: 老師端 Google OAuth 登入 (Fixes #740) (#991)`
        - `fix(#816): 修復錄音中斷誤報 (#900)`
        """
        raw = (title or "").strip()

        lowered = raw.lower()
        if "[feature]" in lowered or lowered.startswith("feat"):
            change_type = "feature"
        elif "[bug]" in lowered or lowered.startswith("fix"):
            change_type = "bugfix"
        else:
            change_type = "other"

        # issue 編號：優先取 Fixes/Closes #N，其次 feat(#N) / fix(#N)
        issues: List[str] = re.findall(
            r"(?:fixes|closes|resolves)\s*#(\d+)", raw, flags=re.IGNORECASE
        )
        if not issues:
            issues = re.findall(r"^\w+\(#(\d+)\)", raw)
        issue_numbers = ",".join(dict.fromkeys(issues)) if issues else None

        clean = re.sub(r"^Release:\s*", "", raw, flags=re.IGNORECASE)
        clean = re.sub(r"^\[?\w+\]?(\(#\d+\))?:\s*", "", clean)
        clean = re.sub(
            r"\((?:fixes|closes|resolves)\s*#\d+\)", "", clean, flags=re.IGNORECASE
        )
        clean = re.sub(r"\(#\d+\)", "", clean)
        clean = clean.strip(" -–—")

        return {
            "change_type": change_type,
            "issue_numbers": issue_numbers,
            "clean_title": clean or raw,
        }

    # ============ 草稿產生 ============

    @classmethod
    async def _generate_content(
        cls, clean_title: str, change_type: str
    ) -> Tuple[Dict[str, str], Optional[str]]:
        """呼叫 AI 產雙語草稿，回傳 (內容, 失敗原因)。

        AI 失敗不擋草稿建立 —— 退回用 release 標題填最低限度內容，
        管理者仍可在後台自行編修後發布。
        """
        prompt = _AI_PROMPT_TEMPLATE.format(title=clean_title, change_type=change_type)
        try:
            ai = get_vertex_ai_service()
            result = await ai.generate_json(
                prompt,
                model_type="flash",
                max_tokens=1200,
                temperature=0.6,
                system_instruction=_AI_SYSTEM_INSTRUCTION,
            )
            content = {
                key: (result.get(key) or "").strip()
                for key in (
                    "line_message_zh",
                    "line_message_en",
                    "article_title_zh",
                    "article_body_zh",
                    "article_title_en",
                    "article_body_en",
                )
            }
            if not content["line_message_zh"] or not content["article_title_zh"]:
                raise ValueError("AI 回傳缺少必要欄位")
            return content, None
        except Exception as exc:  # noqa: BLE001 - AI 失敗退回標題草稿
            logger.warning("更新公告 AI 產生失敗，改用 release 標題：%s", exc)
            return (
                {
                    "line_message_zh": clean_title,
                    "line_message_en": "",
                    "article_title_zh": clean_title[:200],
                    "article_body_zh": clean_title,
                    "article_title_en": "",
                    "article_body_en": "",
                },
                str(exc),
            )

    @classmethod
    async def create_draft_from_release(
        cls,
        db: Session,
        *,
        environment: str,
        source_ref: str,
        release_title: str,
        source_branch: Optional[str] = None,
        pr_number: Optional[int] = None,
        issue_numbers: Optional[str] = None,
    ) -> Tuple[ReleaseAnnouncement, bool]:
        """依 release 產生草稿；回傳 (公告, 是否為本次新建)。

        以 (environment, source_ref) 去重：CI 重跑或重新部署同一個 commit
        不會重複建立草稿，也不會重複消耗 AI 額度。
        """
        existing = (
            db.query(ReleaseAnnouncement)
            .filter(
                ReleaseAnnouncement.environment == environment,
                ReleaseAnnouncement.source_ref == source_ref,
            )
            .first()
        )
        if existing:
            logger.info(
                "更新公告草稿已存在 env=%s ref=%s id=%s",
                environment,
                source_ref,
                existing.id,
            )
            return existing, False

        parsed = cls.parse_release_title(release_title)
        content, generation_error = await cls._generate_content(
            parsed["clean_title"], parsed["change_type"]
        )

        announcement = ReleaseAnnouncement(
            environment=environment,
            source_ref=source_ref,
            source_branch=source_branch,
            pr_number=pr_number,
            issue_numbers=issue_numbers or parsed["issue_numbers"],
            release_title=release_title,
            change_type=parsed["change_type"],
            image_url=settings.RELEASE_ANNOUNCEMENT_BANNER_URL,
            status=STATUS_DRAFT,
            line_status=CHANNEL_PENDING,
            website_status=CHANNEL_PENDING,
            generation_error=generation_error,
            **content,
        )
        db.add(announcement)
        db.commit()
        db.refresh(announcement)
        logger.info(
            "更新公告草稿建立 id=%s env=%s ref=%s",
            announcement.id,
            environment,
            source_ref,
        )
        return announcement, True

    # ============ 編輯 / 合併 / 捨棄 ============

    @staticmethod
    def update_draft(
        db: Session, announcement: ReleaseAnnouncement, data: Dict[str, Any]
    ) -> ReleaseAnnouncement:
        """更新草稿內容（只允許 EDITABLE_FIELDS，未提供的欄位不動）。"""
        for field in EDITABLE_FIELDS:
            if field in data and data[field] is not None:
                setattr(announcement, field, data[field])
        db.commit()
        db.refresh(announcement)
        return announcement

    @staticmethod
    def merge_drafts(
        db: Session, target: ReleaseAnnouncement, source_ids: List[int]
    ) -> ReleaseAnnouncement:
        """把未發布的舊草稿內容併入 target，舊草稿標記為 merged。

        用途：上次的更新沒發 LINE，這次一起發，不必額外消耗一次訊息量。
        併入的內容接在 target 內容「之前」，維持由舊到新的閱讀順序。
        """
        for source_id in source_ids:
            if source_id == target.id:
                raise ValueError("不能把公告併入自己")

            source = (
                db.query(ReleaseAnnouncement)
                .filter(ReleaseAnnouncement.id == source_id)
                .first()
            )
            if source is None:
                raise ValueError(f"找不到公告 id={source_id}")
            if source.status != STATUS_DRAFT:
                raise ValueError(f"公告 id={source_id} 狀態為 {source.status}，只有草稿可以併入")

            for field in _MERGE_FIELDS:
                old_value = (getattr(source, field) or "").strip()
                new_value = (getattr(target, field) or "").strip()
                if not old_value:
                    continue
                merged = (
                    f"{old_value}\n\n{new_value}".strip() if new_value else old_value
                )
                setattr(target, field, merged)

            source.status = STATUS_MERGED
            source.merged_into_id = target.id

        db.commit()
        db.refresh(target)
        return target

    @staticmethod
    def discard(db: Session, announcement: ReleaseAnnouncement) -> ReleaseAnnouncement:
        """捨棄草稿（不發布，也不再出現在待處理清單）。"""
        announcement.status = STATUS_DISCARDED
        db.commit()
        db.refresh(announcement)
        return announcement

    # ============ 發布 ============

    @staticmethod
    def _get_or_create_category(db: Session) -> BlogCategory:
        category = (
            db.query(BlogCategory)
            .filter(BlogCategory.slug == PRODUCT_UPDATE_CATEGORY_SLUG)
            .first()
        )
        if category is None:
            category = BlogCategory(
                name=PRODUCT_UPDATE_CATEGORY_NAME, slug=PRODUCT_UPDATE_CATEGORY_SLUG
            )
            db.add(category)
            db.flush()
        return category

    @classmethod
    def _publish_website(
        cls,
        db: Session,
        announcement: ReleaseAnnouncement,
        admin_id: Optional[int],
    ) -> None:
        """建立官網雙語文章（zh-TW + en 互相連結、同時上架）。"""
        if not announcement.article_title_zh:
            raise ValueError("官網文章缺少中文標題")

        category = cls._get_or_create_category(db)
        summary = (announcement.article_body_zh or "")[:200] or None

        zh_post = BlogService.create_post(
            db,
            {
                "title": announcement.article_title_zh,
                "summary": summary,
                "content": announcement.article_body_zh,
                "cover_image_url": announcement.image_url,
                "og_image_url": announcement.image_url,
                "is_published": True,
                "locale": "zh-TW",
                "category_ids": [category.id],
            },
            author_id=admin_id,
        )

        en_post = None
        if announcement.article_title_en:
            en_post = BlogService.create_post(
                db,
                {
                    "title": announcement.article_title_en,
                    "summary": (announcement.article_body_en or "")[:200] or None,
                    "content": announcement.article_body_en,
                    "cover_image_url": announcement.image_url,
                    "og_image_url": announcement.image_url,
                    "is_published": True,
                    "locale": "en",
                    "linked_post_id": zh_post.id,
                    "category_ids": [category.id],
                },
                author_id=admin_id,
            )
            zh_post.linked_post_id = en_post.id

        announcement.published_blog_post_id = zh_post.id
        announcement.published_blog_post_en_id = en_post.id if en_post else None
        announcement.website_status = CHANNEL_PUBLISHED
        announcement.website_error = None
        announcement.website_published_at = datetime.now(timezone.utc)

    @staticmethod
    def _article_link(announcement: ReleaseAnnouncement, db: Session) -> Optional[str]:
        """已發布官網文章時，LINE 卡片按鈕導到該文章。"""
        if not announcement.published_blog_post_id or not settings.FRONTEND_URL:
            return None
        post = (
            db.query(BlogPost)
            .filter(BlogPost.id == announcement.published_blog_post_id)
            .first()
        )
        if post is None:
            return None
        return f"{settings.FRONTEND_URL.rstrip('/')}/blog/{post.slug}"

    @classmethod
    async def _publish_line(
        cls, db: Session, announcement: ReleaseAnnouncement
    ) -> None:
        """發布到 LINE：production 廣播，其他環境推給測試帳號。"""
        if not announcement.line_message_zh:
            raise LinePublishError("LINE 文案不可為空")

        is_production = settings.ENVIRONMENT == "production"
        title_zh = announcement.article_title_zh or "Duotopia 更新公告"
        title_en = announcement.article_title_en or ""
        if not is_production:
            title_zh = f"[STAGING] {title_zh}"

        flex = LinePublishService.build_release_flex(
            title_zh=title_zh,
            body_zh=announcement.line_message_zh,
            title_en=title_en,
            body_en=announcement.line_message_en or "",
            image_url=announcement.image_url,
            link=cls._article_link(announcement, db),
        )

        if is_production:
            request_id = await LinePublishService.broadcast([flex])
        else:
            request_id = await LinePublishService.push(
                settings.LINE_TEST_USER_ID or "", [flex]
            )

        announcement.line_request_id = request_id
        announcement.line_status = CHANNEL_PUBLISHED
        announcement.line_error = None
        announcement.line_published_at = datetime.now(timezone.utc)

    @staticmethod
    def _recalc_status(announcement: ReleaseAnnouncement) -> None:
        published = [
            announcement.line_status == CHANNEL_PUBLISHED,
            announcement.website_status == CHANNEL_PUBLISHED,
        ]
        if all(published):
            announcement.status = STATUS_PUBLISHED
        elif any(published):
            announcement.status = STATUS_PARTIALLY_PUBLISHED
        # 兩個通道都還沒成功 → 維持草稿，可修正後重試

    @classmethod
    async def publish(
        cls,
        db: Session,
        announcement: ReleaseAnnouncement,
        channels: List[str],
        admin_id: Optional[int] = None,
    ) -> ReleaseAnnouncement:
        """發布指定通道；單一通道失敗只影響該通道，狀態與錯誤都會留下。

        官網先於 LINE 發布，這樣 LINE 卡片才能連到剛上架的文章。
        已發布成功的通道會直接略過，重按不會重複發文。
        """
        if not channels:
            raise ValueError("必須指定至少一個發布通道")
        unknown = [c for c in channels if c not in VALID_CHANNELS]
        if unknown:
            raise ValueError(f"不支援的發布通道：{', '.join(unknown)}")

        if CHANNEL_WEBSITE in channels:
            if announcement.website_status == CHANNEL_PUBLISHED:
                logger.info("官網已發布，略過 id=%s", announcement.id)
            else:
                try:
                    cls._publish_website(db, announcement, admin_id)
                except Exception as exc:  # noqa: BLE001 - 失敗記錄於該通道
                    db.rollback()
                    db.refresh(announcement)
                    announcement.website_status = CHANNEL_FAILED
                    announcement.website_error = str(exc)
                    logger.warning("官網公告發布失敗 id=%s: %s", announcement.id, exc)

        if CHANNEL_LINE in channels:
            if announcement.line_status == CHANNEL_PUBLISHED:
                logger.info("LINE 已發布，略過 id=%s", announcement.id)
            else:
                try:
                    await cls._publish_line(db, announcement)
                except (LinePublishError, ValueError) as exc:
                    announcement.line_status = CHANNEL_FAILED
                    announcement.line_error = str(exc)
                    logger.warning("LINE 公告發布失敗 id=%s: %s", announcement.id, exc)

        if admin_id is not None:
            announcement.published_by = admin_id
        cls._recalc_status(announcement)
        db.commit()
        db.refresh(announcement)
        return announcement
