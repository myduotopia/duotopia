"""Blog admin routes for managing blog posts and categories."""

import logging
import os
import uuid
from datetime import datetime as dt
from typing import List, Optional

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    UploadFile,
    File,
)
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db
from models import Teacher
from routers.teachers import get_current_teacher
from services.blog_service import BlogService
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
    locale: str = "zh-TW"
    linked_post_id: Optional[int] = None
    category_ids: List[int] = []


class TranslatePostRequest(BaseModel):
    title: str
    summary: Optional[str] = None
    content: Optional[str] = None
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    target_locale: str = "en"


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
        "created_at": (post.created_at.isoformat() if post.created_at else None),
        "updated_at": (post.updated_at.isoformat() if post.updated_at else None),
    }


# ============ Post Endpoints ============


@router.get("", response_model=BlogPostListResponse)
def list_posts(
    page: int = 1,
    per_page: int = 20,
    db: Session = Depends(get_db),
    _admin: Teacher = Depends(get_current_admin),
):
    """List all blog posts (admin)."""
    result = BlogService.get_all_posts(db, page, per_page)
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
    post = BlogService.create_post(db, request.model_dump(), admin.id)
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
    # Reset file position after reading
    await file.seek(0)

    service = get_image_upload_service()
    # Override max_file_size for blog images
    original_max = service.max_file_size
    service.max_file_size = max_size

    try:
        # Use the image upload service with blog prefix
        environment = os.getenv("ENVIRONMENT", "development")
        file_id = str(uuid.uuid4())
        timestamp = dt.now().strftime("%Y%m%d_%H%M%S")

        content_type = file.content_type or ""
        base_content_type = content_type.split(";")[0].strip().lower()
        ext_map = {
            "image/jpeg": "jpg",
            "image/jpg": "jpg",
            "image/png": "png",
            "image/gif": "gif",
            "image/webp": "webp",
        }
        extension = ext_map.get(base_content_type, "jpg")
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
            blob.upload_from_string(content, content_type=base_content_type)
            blob.make_public()
            image_url = blob.public_url
        else:
            image_url = await service.upload_image(file)

        return {"url": image_url}
    finally:
        service.max_file_size = original_max


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
