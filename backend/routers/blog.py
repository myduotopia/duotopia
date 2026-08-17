"""Blog admin routes for managing blog posts and categories."""

import logging
import os
import uuid
from datetime import datetime as dt
from typing import List, Literal, Optional

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    UploadFile,
    File,
)
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db
from models import Teacher
from routers.teachers import get_current_teacher
from services.blog_service import BlogService, MAX_POST_IMAGES
from services.image_upload import get_image_upload_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/blog", tags=["blog-admin"])


# ============ Admin Auth ============


async def get_current_admin(
    current_teacher: Teacher = Depends(get_current_teacher),
) -> Teacher:
    """確認當前用戶是 Admin"""
    if not current_teacher.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_teacher


# ============ Pydantic Schemas ============


class CategoryResponse(BaseModel):
    id: int
    name: str
    slug: str

    class Config:
        from_attributes = True


class AuthorResponse(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


class BlogImageInput(BaseModel):
    """圖庫的單張圖（排序由陣列順序決定，不由前端指定 order_index）"""

    image_url: str
    alt_text: Optional[str] = None


class BlogImageResponse(BaseModel):
    id: int
    image_url: str
    alt_text: Optional[str] = None
    order_index: int

    class Config:
        from_attributes = True


class DeleteImageResponse(BaseModel):
    deleted: bool
    storage_deleted: bool


class BlogPostResponse(BaseModel):
    id: int
    title: str
    slug: str
    summary: Optional[str] = None
    content: Optional[str] = None
    cover_image_url: Optional[str] = None
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    og_image_url: Optional[str] = None
    is_published: bool
    published_at: Optional[str] = None
    locale: str = "zh-TW"
    linked_post_id: Optional[int] = None
    linked_post_slug: Optional[str] = None
    author: Optional[AuthorResponse] = None
    categories: List[CategoryResponse] = []
    images: List[BlogImageResponse] = []
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True


class BlogPostListResponse(BaseModel):
    posts: List[BlogPostResponse]
    total: int
    page: int
    per_page: int
    total_pages: int


class CreatePostRequest(BaseModel):
    title: str
    slug: Optional[str] = None
    summary: Optional[str] = None
    content: Optional[str] = None
    cover_image_url: Optional[str] = None
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    og_image_url: Optional[str] = None
    is_published: bool = False
    locale: Literal["zh-TW", "en"] = "zh-TW"
    linked_post_id: Optional[int] = None
    category_ids: List[int] = []
    images: Optional[List[BlogImageInput]] = None


class TranslatePostRequest(BaseModel):
    title: str
    summary: Optional[str] = None
    content: Optional[str] = None
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    target_locale: Literal["zh-TW", "en"] = "en"


class UpdatePostRequest(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    summary: Optional[str] = None
    content: Optional[str] = None
    cover_image_url: Optional[str] = None
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    og_image_url: Optional[str] = None
    category_ids: Optional[List[int]] = None
    images: Optional[List[BlogImageInput]] = None


class CreateCategoryRequest(BaseModel):
    name: str
    slug: Optional[str] = None


class UpdateCategoryRequest(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None


class ImageUploadResponse(BaseModel):
    url: str


# ============ Helper ============


def _serialize_post(post) -> dict:
    """Serialize a BlogPost to dict for response."""
    return {
        "id": post.id,
        "title": post.title,
        "slug": post.slug,
        "summary": post.summary,
        "content": post.content,
        "cover_image_url": post.cover_image_url,
        "meta_title": post.meta_title,
        "meta_description": post.meta_description,
        "og_image_url": post.og_image_url,
        "is_published": post.is_published,
        "published_at": (post.published_at.isoformat() if post.published_at else None),
        "locale": getattr(post, "locale", "zh-TW"),
        "linked_post_id": getattr(post, "linked_post_id", None),
        "linked_post_slug": (
            post.linked_post.slug if getattr(post, "linked_post", None) else None
        ),
        "author": (
            {"id": post.author.id, "name": post.author.name} if post.author else None
        ),
        "categories": [
            {"id": c.id, "name": c.name, "slug": c.slug}
            for c in (post.categories or [])
        ],
        "images": [
            {
                "id": i.id,
                "image_url": i.image_url,
                "alt_text": i.alt_text,
                "order_index": i.order_index,
            }
            for i in (post.images or [])
        ],
        "created_at": (post.created_at.isoformat() if post.created_at else None),
        "updated_at": (post.updated_at.isoformat() if post.updated_at else None),
    }


def _validate_gallery_images(images: Optional[List[BlogImageInput]]) -> Optional[list]:
    """驗證圖庫並轉成 service 用的 dict list。

    只接受本站自己上傳的圖（GCS bucket 或本地 static），擋掉管理者誤貼的外部
    hotlink —— 外部網址隨時可能失效，且會讓「刪除時檢查是否被引用」的判斷失去意義。
    """
    if images is None:
        return None

    if len(images) > MAX_POST_IMAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many images (max {MAX_POST_IMAGES})",
        )

    service = get_image_upload_service()
    allowed_prefixes = (
        f"https://storage.googleapis.com/{service.bucket_name}/",
        "/static/images/",
    )
    backend_url = getattr(service, "backend_url", None)
    if backend_url:
        allowed_prefixes += (f"{backend_url.rstrip('/')}/static/images/",)

    result = []
    for img in images:
        url = (img.image_url or "").strip()
        if not url.startswith(allowed_prefixes):
            raise HTTPException(
                status_code=400,
                detail="Invalid image URL: only images uploaded to this site are allowed",
            )
        if len(url) > 500:
            raise HTTPException(status_code=400, detail="Image URL too long")
        result.append({"image_url": url, "alt_text": img.alt_text})
    return result


# ============ Post Endpoints ============


@router.get("", response_model=BlogPostListResponse)
def list_posts(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    status: Optional[Literal["published", "draft"]] = None,
    category_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _admin: Teacher = Depends(get_current_admin),
):
    """List all blog posts (admin), with optional status/category filters."""
    result = BlogService.get_all_posts(db, page, per_page, status, category_id)
    return {
        "posts": [_serialize_post(p) for p in result["posts"]],
        "total": result["total"],
        "page": result["page"],
        "per_page": result["per_page"],
        "total_pages": result["total_pages"],
    }


@router.post("", response_model=BlogPostResponse)
def create_post(
    request: CreatePostRequest,
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    """Create a new blog post."""
    # Validate category IDs exist
    if request.category_ids:
        from models.blog import BlogCategory

        existing = (
            db.query(BlogCategory.id)
            .filter(BlogCategory.id.in_(request.category_ids))
            .all()
        )
        existing_ids = {row.id for row in existing}
        invalid = set(request.category_ids) - existing_ids
        if invalid:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid category IDs: {sorted(invalid)}",
            )
    data = request.model_dump()
    data["images"] = _validate_gallery_images(request.images)
    post = BlogService.create_post(db, data, admin.id)
    return _serialize_post(post)


@router.get("/categories", response_model=List[CategoryResponse])
def list_categories(
    db: Session = Depends(get_db),
    _admin: Teacher = Depends(get_current_admin),
):
    """List all blog categories (admin)."""
    categories = BlogService.get_categories(db)
    return [{"id": c.id, "name": c.name, "slug": c.slug} for c in categories]


@router.post("/categories", response_model=CategoryResponse)
def create_category(
    request: CreateCategoryRequest,
    db: Session = Depends(get_db),
    _admin: Teacher = Depends(get_current_admin),
):
    """Create a new blog category."""
    category = BlogService.create_category(db, request.name, request.slug)
    return {"id": category.id, "name": category.name, "slug": category.slug}


@router.put(
    "/categories/{category_id}",
    response_model=CategoryResponse,
)
def update_category(
    category_id: int,
    request: UpdateCategoryRequest,
    db: Session = Depends(get_db),
    _admin: Teacher = Depends(get_current_admin),
):
    """Update a blog category."""
    category = BlogService.update_category(db, category_id, request.name, request.slug)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"id": category.id, "name": category.name, "slug": category.slug}


@router.delete("/categories/{category_id}")
def delete_category(
    category_id: int,
    db: Session = Depends(get_db),
    _admin: Teacher = Depends(get_current_admin),
):
    """Delete a blog category."""
    if not BlogService.delete_category(db, category_id):
        raise HTTPException(status_code=404, detail="Category not found")
    return {"message": "Category deleted"}


# Magic-byte signatures for allowed image types
_IMAGE_SIGNATURES = {
    b"\xff\xd8\xff": ("image/jpeg", "jpg"),
    b"\x89PNG\r\n\x1a\n": ("image/png", "png"),
    b"GIF87a": ("image/gif", "gif"),
    b"GIF89a": ("image/gif", "gif"),
    b"RIFF": ("image/webp", "webp"),  # RIFF....WEBP (checked with extra logic)
}


def _detect_image_type(content: bytes) -> tuple[str, str] | None:
    """Detect image type from magic bytes. Returns (mime_type, extension) or None."""
    for sig, result in _IMAGE_SIGNATURES.items():
        if content.startswith(sig):
            # Extra check for WEBP: RIFF header must also contain WEBP
            if sig == b"RIFF" and content[8:12] != b"WEBP":
                continue
            return result
    return None


@router.post("/upload-image", response_model=ImageUploadResponse)
async def upload_image(
    file: UploadFile = File(...),
    _admin: Teacher = Depends(get_current_admin),
):
    """Upload an image for blog posts. Max 20MB."""
    # Validate file size (20MB)
    max_size = 20 * 1024 * 1024
    content = await file.read()
    if len(content) > max_size:
        raise HTTPException(
            status_code=400,
            detail="File too large. Maximum size: 20MB",
        )

    # Validate actual file type via magic bytes (don't trust Content-Type header)
    detected = _detect_image_type(content)
    if not detected:
        raise HTTPException(
            status_code=400,
            detail="Invalid image format. Allowed: JPEG, PNG, GIF, WebP",
        )
    detected_mime, extension = detected

    service = get_image_upload_service()

    # Use the image upload service with blog prefix
    environment = os.getenv("ENVIRONMENT", "development")
    file_id = str(uuid.uuid4())
    timestamp = dt.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{timestamp}_{file_id}.{extension}"

    if service.use_gcs:
        blob_name = f"blog/{environment}/{filename}"
        client = service._get_storage_client()
        if not client:
            raise HTTPException(
                status_code=500,
                detail="GCS client initialization failed",
            )
        bucket = client.bucket(service.bucket_name)
        blob = bucket.blob(blob_name)
        blob.upload_from_string(content, content_type=detected_mime)
        # Use bucket-level public access instead of per-object ACL
        image_url = f"https://storage.googleapis.com/{service.bucket_name}/{blob_name}"
    else:
        await file.seek(0)
        image_url = await service.upload_image(file)

    return {"url": image_url}


@router.get("/{post_id}", response_model=BlogPostResponse)
def get_post(
    post_id: int,
    db: Session = Depends(get_db),
    _admin: Teacher = Depends(get_current_admin),
):
    """Get a single blog post by ID (admin)."""
    post = BlogService.get_post_by_id(db, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return _serialize_post(post)


@router.put("/{post_id}", response_model=BlogPostResponse)
def update_post(
    post_id: int,
    request: UpdatePostRequest,
    db: Session = Depends(get_db),
    _admin: Teacher = Depends(get_current_admin),
):
    """Update a blog post."""
    data = request.model_dump(exclude_none=True)
    # images 送 [] 代表清空圖庫、不送則不動（exclude_none 已濾掉未送的情況）
    if request.images is not None:
        data["images"] = _validate_gallery_images(request.images)
    post = BlogService.update_post(db, post_id, data)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return _serialize_post(post)


@router.delete("/{post_id}")
def delete_post(
    post_id: int,
    db: Session = Depends(get_db),
    _admin: Teacher = Depends(get_current_admin),
):
    """Delete a blog post."""
    if not BlogService.delete_post(db, post_id):
        raise HTTPException(status_code=404, detail="Post not found")
    return {"message": "Post deleted"}


@router.delete("/{post_id}/images/{image_id}", response_model=DeleteImageResponse)
def delete_post_image(
    post_id: int,
    image_id: int,
    db: Session = Depends(get_db),
    _admin: Teacher = Depends(get_current_admin),
):
    """從圖庫移除單張圖；確認沒被任何文章引用時，連雲端檔一起刪。

    已插進內文（或仍是封面 / OG 圖）的圖只移除圖庫關聯，實體檔保留，
    避免已發布文章變破圖。
    """
    result = BlogService.delete_post_image(db, post_id, image_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Image not found")
    return result


@router.post("/{post_id}/publish", response_model=BlogPostResponse)
def publish_post(
    post_id: int,
    db: Session = Depends(get_db),
    _admin: Teacher = Depends(get_current_admin),
):
    """Toggle publish status of a blog post."""
    post = BlogService.publish_post(db, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return _serialize_post(post)


@router.post("/{post_id}/translate", response_model=BlogPostResponse)
def translate_post(
    post_id: int,
    request: TranslatePostRequest,
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    """Create a translated version of a post."""
    translated = BlogService.create_translated_post(
        db,
        source_post_id=post_id,
        target_locale=request.target_locale,
        translated_data=request.model_dump(exclude={"target_locale"}),
        author_id=admin.id,
    )
    if not translated:
        raise HTTPException(status_code=404, detail="Source post not found")
    return _serialize_post(translated)
