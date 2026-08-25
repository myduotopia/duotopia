"""
更新公告 API（issue #804 — LINE 官方帳號 / 官網自動發布更新）。

兩組端點：
- POST /api/internal/release-announcements
  CI 專用（X-Release-Secret 驗證）。每次 release 進 staging / production
  就產生一則草稿，內含「LINE 文案」與「官網雙語文章」兩份獨立內容。
- /api/admin/release-announcements（admin-only）
  後台清單、編輯、合併未發布舊草稿、LINE 卡片預覽、選擇通道發布、捨棄。

發布通道彼此獨立：可以只發官網、只發 LINE、或兩者一起；某個通道失敗不影響
另一個，狀態與錯誤都會留在該通道欄位，修正後可重按發布（已成功的通道會略過）。
"""

import logging
import secrets
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.config import settings
from database import get_db
from models import Teacher
from models.blog import BlogPost
from models.release_announcement import (
    CHANNEL_PUBLISHED,
    STATUS_DISCARDED,
    STATUS_DRAFT,
    STATUS_MERGED,
    STATUS_PARTIALLY_PUBLISHED,
    ReleaseAnnouncement,
)
from routers.admin import get_current_admin
from services.line_publish_service import LinePublishService
from services.release_announcement_service import ReleaseAnnouncementService

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/admin/release-announcements", tags=["release-announcements"]
)
internal_router = APIRouter(prefix="/api/internal", tags=["release-announcements"])

Channel = Literal["line", "website"]

# 發布後內容已對外，不再開放編輯；部分發布仍可修尚未送出的通道內容
EDITABLE_STATUSES = (STATUS_DRAFT, STATUS_PARTIALLY_PUBLISHED)


# ============ Schemas ============


class ReleaseWebhookRequest(BaseModel):
    source_ref: str = Field(..., max_length=100)  # commit sha
    release_title: str
    environment: Optional[Literal["staging", "production"]] = None
    source_branch: Optional[str] = Field(None, max_length=100)
    pr_number: Optional[int] = None
    issue_numbers: Optional[str] = Field(None, max_length=200)


class ReleaseWebhookResponse(BaseModel):
    id: int
    created: bool
    status: str


class ReleaseAnnouncementUpdate(BaseModel):
    line_message_zh: Optional[str] = None
    line_message_en: Optional[str] = None
    article_title_zh: Optional[str] = Field(None, max_length=200)
    article_body_zh: Optional[str] = None
    article_title_en: Optional[str] = Field(None, max_length=200)
    article_body_en: Optional[str] = None
    image_url: Optional[str] = Field(None, max_length=500)


class MergeRequest(BaseModel):
    source_ids: List[int] = Field(..., min_length=1)


class PublishRequest(BaseModel):
    channels: List[Channel] = Field(..., min_length=1)


class ReleaseAnnouncementItem(BaseModel):
    id: int
    environment: str
    source_ref: str
    source_branch: Optional[str] = None
    pr_number: Optional[int] = None
    issue_numbers: Optional[str] = None
    release_title: Optional[str] = None
    change_type: Optional[str] = None

    line_message_zh: Optional[str] = None
    line_message_en: Optional[str] = None
    article_title_zh: Optional[str] = None
    article_body_zh: Optional[str] = None
    article_title_en: Optional[str] = None
    article_body_en: Optional[str] = None
    image_url: Optional[str] = None

    status: str
    line_status: str
    line_error: Optional[str] = None
    line_published_at: Optional[str] = None
    website_status: str
    website_error: Optional[str] = None
    website_published_at: Optional[str] = None
    published_blog_url: Optional[str] = None
    published_blog_url_en: Optional[str] = None
    generation_error: Optional[str] = None
    merged_into_id: Optional[int] = None
    created_at: Optional[str] = None


# ============ 內部工具 ============


def _blog_url(db: Session, post_id: Optional[int]) -> Optional[str]:
    if not post_id or not settings.FRONTEND_URL:
        return None
    post = db.query(BlogPost).filter(BlogPost.id == post_id).first()
    if post is None:
        return None
    return f"{settings.FRONTEND_URL.rstrip('/')}/blog/{post.slug}"


def _serialize(db: Session, ann: ReleaseAnnouncement) -> ReleaseAnnouncementItem:
    def _iso(value):
        return value.isoformat() if value else None

    return ReleaseAnnouncementItem(
        id=ann.id,
        environment=ann.environment,
        source_ref=ann.source_ref,
        source_branch=ann.source_branch,
        pr_number=ann.pr_number,
        issue_numbers=ann.issue_numbers,
        release_title=ann.release_title,
        change_type=ann.change_type,
        line_message_zh=ann.line_message_zh,
        line_message_en=ann.line_message_en,
        article_title_zh=ann.article_title_zh,
        article_body_zh=ann.article_body_zh,
        article_title_en=ann.article_title_en,
        article_body_en=ann.article_body_en,
        image_url=ann.image_url,
        status=ann.status,
        line_status=ann.line_status,
        line_error=ann.line_error,
        line_published_at=_iso(ann.line_published_at),
        website_status=ann.website_status,
        website_error=ann.website_error,
        website_published_at=_iso(ann.website_published_at),
        published_blog_url=_blog_url(db, ann.published_blog_post_id),
        published_blog_url_en=_blog_url(db, ann.published_blog_post_en_id),
        generation_error=ann.generation_error,
        merged_into_id=ann.merged_into_id,
        created_at=_iso(ann.created_at),
    )


def _get_or_404(db: Session, announcement_id: int) -> ReleaseAnnouncement:
    ann = (
        db.query(ReleaseAnnouncement)
        .filter(ReleaseAnnouncement.id == announcement_id)
        .first()
    )
    if ann is None:
        raise HTTPException(status_code=404, detail="Release announcement not found")
    return ann


# ============ Internal webhook（CI 呼叫） ============


@internal_router.post(
    "/release-announcements",
    response_model=ReleaseWebhookResponse,
    status_code=201,
)
async def create_release_announcement(
    body: ReleaseWebhookRequest,
    x_release_secret: str = Header(None),
    db: Session = Depends(get_db),
):
    """CI 在 release 部署後呼叫：產生一則更新公告草稿（不會自動對外發布）。"""
    configured = settings.RELEASE_WEBHOOK_SECRET
    if not configured:
        # 未設定密鑰時直接關閉端點，避免任何人都能新增草稿
        raise HTTPException(status_code=503, detail="Release webhook is not configured")
    if not x_release_secret or not secrets.compare_digest(x_release_secret, configured):
        logger.warning("更新公告 webhook 驗證失敗 ref=%s", body.source_ref)
        raise HTTPException(status_code=401, detail="Invalid release secret")

    announcement, created = await ReleaseAnnouncementService.create_draft_from_release(
        db,
        environment=body.environment or settings.ENVIRONMENT,
        source_ref=body.source_ref,
        release_title=body.release_title,
        source_branch=body.source_branch,
        pr_number=body.pr_number,
        issue_numbers=body.issue_numbers,
    )
    return ReleaseWebhookResponse(
        id=announcement.id, created=created, status=announcement.status
    )


# ============ Admin 端點 ============


@router.get("", response_model=List[ReleaseAnnouncementItem])
async def list_release_announcements(
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    """公告清單（新到舊）。預設隱藏已併入與已捨棄的草稿。"""
    query = db.query(ReleaseAnnouncement)
    if status:
        query = query.filter(ReleaseAnnouncement.status == status)
    else:
        query = query.filter(
            ~ReleaseAnnouncement.status.in_([STATUS_MERGED, STATUS_DISCARDED])
        )
    rows = (
        query.order_by(
            ReleaseAnnouncement.created_at.desc(), ReleaseAnnouncement.id.desc()
        )
        .limit(limit)
        .all()
    )
    return [_serialize(db, row) for row in rows]


@router.get("/{announcement_id}", response_model=ReleaseAnnouncementItem)
async def get_release_announcement(
    announcement_id: int,
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    return _serialize(db, _get_or_404(db, announcement_id))


@router.patch("/{announcement_id}", response_model=ReleaseAnnouncementItem)
async def update_release_announcement(
    announcement_id: int,
    body: ReleaseAnnouncementUpdate,
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    """編輯草稿（LINE 文案與官網文章各自獨立）。"""
    ann = _get_or_404(db, announcement_id)
    if ann.status not in EDITABLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"狀態 {ann.status} 的公告不可編輯",
        )
    updated = ReleaseAnnouncementService.update_draft(
        db, ann, body.model_dump(exclude_none=True)
    )
    return _serialize(db, updated)


@router.post("/{announcement_id}/merge", response_model=ReleaseAnnouncementItem)
async def merge_release_announcements(
    announcement_id: int,
    body: MergeRequest,
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    """把先前沒發布的草稿併進這一則，一起發布（省 LINE 訊息量）。"""
    ann = _get_or_404(db, announcement_id)
    if ann.status not in EDITABLE_STATUSES:
        raise HTTPException(status_code=400, detail=f"狀態 {ann.status} 的公告不可合併")
    try:
        merged = ReleaseAnnouncementService.merge_drafts(db, ann, body.source_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _serialize(db, merged)


@router.get("/{announcement_id}/line-preview")
async def preview_line_message(
    announcement_id: int,
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    """回傳實際會送出的 LINE Flex 訊息，供後台預覽（與文章草稿分開檢視）。"""
    ann = _get_or_404(db, announcement_id)
    return LinePublishService.build_release_flex(
        title_zh=ann.article_title_zh or "Duotopia 更新公告",
        body_zh=ann.line_message_zh or "",
        title_en=ann.article_title_en or "",
        body_en=ann.line_message_en or "",
        image_url=ann.image_url,
        link=_blog_url(db, ann.published_blog_post_id),
    )


@router.post("/{announcement_id}/publish", response_model=ReleaseAnnouncementItem)
async def publish_release_announcement(
    announcement_id: int,
    body: PublishRequest,
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    """發布到選定通道（line / website / 兩者）。

    只要有一個通道成功就回 200（另一個通道的錯誤在回應中可見）；
    要求的通道全部失敗才回 502。
    """
    ann = _get_or_404(db, announcement_id)
    if ann.status in (STATUS_MERGED, STATUS_DISCARDED):
        raise HTTPException(status_code=400, detail=f"狀態 {ann.status} 的公告不可發布")

    try:
        published = await ReleaseAnnouncementService.publish(
            db, ann, channels=list(body.channels), admin_id=admin.id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    item = _serialize(db, published)
    statuses = {
        "line": published.line_status,
        "website": published.website_status,
    }
    if all(statuses[channel] != CHANNEL_PUBLISHED for channel in body.channels):
        errors = {
            "line": published.line_error,
            "website": published.website_error,
        }
        raise HTTPException(
            status_code=502,
            detail={
                "message": "所有指定通道發布失敗",
                "errors": {c: errors[c] for c in body.channels},
                "announcement": item.model_dump(),
            },
        )
    return item


@router.post("/{announcement_id}/discard", response_model=ReleaseAnnouncementItem)
async def discard_release_announcement(
    announcement_id: int,
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    """捨棄草稿（這次更新不對外公告）。"""
    ann = _get_or_404(db, announcement_id)
    if ann.status not in EDITABLE_STATUSES:
        raise HTTPException(status_code=400, detail=f"狀態 {ann.status} 的公告不可捨棄")
    return _serialize(db, ReleaseAnnouncementService.discard(db, ann))
