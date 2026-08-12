"""
社群發文 API（issue #591 — Meta 發文）。

admin-only 端點，透過 MetaPublishService 發文到 Facebook 粉專 / Instagram，
並把每個平台的發文結果寫入 social_posts。

- POST /api/admin/social/posts            自由貼文（手填文案 + 圖）
- POST /api/admin/social/posts/from-blog/{post_id}  Blog 一鍵轉發
- GET  /api/admin/social/posts            發文歷史

發到 FB + IG 會各寫一列 social_posts；平台之間互相獨立，其一失敗不影響另一個。
"""

import logging
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.config import settings
from database import get_db
from models import Teacher, SocialPost, BlogPost
from routers.admin import get_current_admin
from services.blog_service import BlogService
from services.meta_publish_service import MetaPublishService, MetaPublishError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/social", tags=["social-publishing"])

Platform = Literal["facebook", "instagram"]


# ============ Schemas ============


class PublishRequest(BaseModel):
    platforms: List[Platform] = Field(..., min_length=1)
    message: str = ""
    image_url: Optional[str] = None
    link: Optional[str] = None


class BlogPublishRequest(BaseModel):
    platforms: List[Platform] = Field(..., min_length=1)


class PlatformResult(BaseModel):
    id: int  # social_posts 記錄 id
    platform: str
    status: str  # 'success' | 'failed'
    external_post_id: Optional[str] = None
    error: Optional[str] = None


class PublishResponse(BaseModel):
    ok: bool  # 是否至少一個平台成功
    results: List[PlatformResult]


class SocialPostItem(BaseModel):
    id: int
    platform: str
    source: str
    source_blog_post_id: Optional[int] = None
    external_post_id: Optional[str] = None
    status: str
    message: Optional[str] = None
    image_url: Optional[str] = None
    link: Optional[str] = None
    error: Optional[str] = None
    created_at: Optional[str] = None


# ============ 內部：發文並記錄 ============


async def _publish_one(
    db: Session,
    platform: str,
    *,
    message: str,
    image_url: Optional[str],
    link: Optional[str],
    source: str,
    source_blog_post_id: Optional[int],
    admin_id: Optional[int],
) -> SocialPost:
    """發一個平台並寫入一列 social_posts（成功或失敗都會留紀錄）。"""
    external_post_id: Optional[str] = None
    status = "success"
    error: Optional[str] = None
    try:
        if platform == "facebook":
            external_post_id = await MetaPublishService.publish_facebook(
                message=message, image_url=image_url, link=link
            )
        elif platform == "instagram":
            external_post_id = await MetaPublishService.publish_instagram(
                message=message, image_url=image_url
            )
        else:  # pragma: no cover - Pydantic Literal 已擋掉
            raise MetaPublishError(f"不支援的平台：{platform}")
    except MetaPublishError as exc:
        status = "failed"
        error = str(exc)
        logger.warning("Meta 發文失敗 platform=%s: %s", platform, error)

    record = SocialPost(
        platform=platform,
        source=source,
        source_blog_post_id=source_blog_post_id,
        external_post_id=external_post_id,
        status=status,
        message=message,
        image_url=image_url,
        link=link,
        error=error,
        created_by=admin_id,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


async def _publish_to_platforms(
    db: Session,
    platforms: List[str],
    *,
    message: str,
    image_url: Optional[str],
    link: Optional[str],
    source: str,
    source_blog_post_id: Optional[int],
    admin_id: Optional[int],
) -> PublishResponse:
    results: List[PlatformResult] = []
    for platform in platforms:
        record = await _publish_one(
            db,
            platform,
            message=message,
            image_url=image_url,
            link=link,
            source=source,
            source_blog_post_id=source_blog_post_id,
            admin_id=admin_id,
        )
        results.append(
            PlatformResult(
                id=record.id,
                platform=record.platform,
                status=record.status,
                external_post_id=record.external_post_id,
                error=record.error,
            )
        )

    ok = any(r.status == "success" for r in results)
    response = PublishResponse(ok=ok, results=results)
    if not ok:
        # 全部平台失敗 → 502，但仍附上每平台明細（紀錄已寫入 DB）
        raise HTTPException(status_code=502, detail=response.model_dump())
    return response


# ============ Endpoints ============


@router.post("/posts", response_model=PublishResponse)
async def publish_post(
    body: PublishRequest,
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    """自由貼文：手填文案 + 選填圖片 / 連結，發到指定平台。"""
    if not body.message and not body.image_url:
        raise HTTPException(status_code=400, detail="message 與 image_url 至少需提供一項")
    return await _publish_to_platforms(
        db,
        body.platforms,
        message=body.message,
        image_url=body.image_url,
        link=body.link,
        source="manual",
        source_blog_post_id=None,
        admin_id=admin.id,
    )


@router.post("/posts/from-blog/{post_id}", response_model=PublishResponse)
async def publish_from_blog(
    post_id: int,
    body: BlogPublishRequest,
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    """Blog 一鍵轉發：把部落格文章的標題 / 摘要 / 封面圖 / 連結發到社群。"""
    post: Optional[BlogPost] = BlogService.get_post_by_id(db, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Blog post not found")

    # 組文案：標題 + 摘要 +（文章連結，直接放進內文文字，FB/IG 都看得到）
    parts = [post.title]
    if post.summary:
        parts.append(post.summary)
    blog_url: Optional[str] = None
    if settings.FRONTEND_URL:
        blog_url = f"{settings.FRONTEND_URL.rstrip('/')}/blog/{post.slug}"
        parts.append(blog_url)
    message = "\n\n".join(p for p in parts if p)

    return await _publish_to_platforms(
        db,
        body.platforms,
        message=message,
        image_url=post.cover_image_url,
        link=blog_url,
        source="blog",
        source_blog_post_id=post.id,
        admin_id=admin.id,
    )


@router.get("/posts", response_model=List[SocialPostItem])
async def list_posts(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    """發文歷史（依時間新到舊）。"""
    rows = (
        db.query(SocialPost)
        .order_by(SocialPost.created_at.desc(), SocialPost.id.desc())
        .limit(limit)
        .all()
    )
    return [
        SocialPostItem(
            id=r.id,
            platform=r.platform,
            source=r.source,
            source_blog_post_id=r.source_blog_post_id,
            external_post_id=r.external_post_id,
            status=r.status,
            message=r.message,
            image_url=r.image_url,
            link=r.link,
            error=r.error,
            created_at=r.created_at.isoformat() if r.created_at else None,
        )
        for r in rows
    ]
