"""
Public API endpoints for student login flow
不需要認證的公開端點
"""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import Response, HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional  # noqa: F401
from pydantic import BaseModel, EmailStr
from database import get_db
from models import Teacher, Classroom, Student, ClassroomStudent
from services.blog_service import BlogService
import logging
import os

SITE_DOMAIN = os.getenv("SITE_DOMAIN", "https://duotopia.co")

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/public", tags=["public"])


class ValidateTeacherRequest(BaseModel):
    email: EmailStr


class ValidateTeacherResponse(BaseModel):
    valid: bool
    name: Optional[str] = None
    id: Optional[int] = None


class ClassroomResponse(BaseModel):
    id: int
    name: str
    studentCount: int


class StudentResponse(BaseModel):
    id: int
    name: str
    email: Optional[str] = None
    avatar: Optional[str] = None


class TeacherResponse(BaseModel):
    id: int
    name: str
    email: str


class ConfigResponse(BaseModel):
    """系統配置與 feature flags"""

    enablePayment: bool
    environment: str


@router.post("/validate-teacher", response_model=ValidateTeacherResponse)
def validate_teacher(request: ValidateTeacherRequest, db: Session = Depends(get_db)):
    """驗證教師 email 是否存在"""
    try:
        teacher = (
            db.query(Teacher)
            .filter(func.lower(Teacher.email) == func.lower(request.email))
            .first()
        )

        if teacher:
            return ValidateTeacherResponse(valid=True, name=teacher.name, id=teacher.id)
        return ValidateTeacherResponse(valid=False)
    except Exception as e:
        # 記錄錯誤但返回友善訊息（不洩漏資料庫細節）
        logger.error("validate_teacher error: %s", e)
        raise HTTPException(
            status_code=503,
            detail="Database temporarily unavailable. Please try again.",
        )


@router.get("/teachers", response_model=List[TeacherResponse])
def get_teachers(db: Session = Depends(get_db)):
    """獲取所有活躍教師的公開資訊"""
    teachers = db.query(Teacher).filter(Teacher.is_active.is_(True)).all()

    result = []
    for teacher in teachers:
        result.append(
            TeacherResponse(id=teacher.id, name=teacher.name, email=teacher.email)
        )

    return result


@router.get("/teacher-classrooms", response_model=List[ClassroomResponse])
def get_teacher_classrooms(email: str, db: Session = Depends(get_db)):
    """獲取教師的所有班級（公開資訊）"""
    # 先找到教師
    teacher = (
        db.query(Teacher).filter(func.lower(Teacher.email) == func.lower(email)).first()
    )

    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    # 獲取該教師的所有班級和學生數量 - 使用 JOIN 和 GROUP BY 優化
    # 原本：1 + N 次查詢（1次班級 + N次學生數）
    # 現在：1次查詢（JOIN + GROUP BY）

    classrooms_with_count = (
        db.query(
            Classroom.id,
            Classroom.name,
            func.count(ClassroomStudent.id).label("student_count"),
        )
        .outerjoin(ClassroomStudent)  # 使用 outerjoin 以包含沒有學生的班級
        .filter(Classroom.teacher_id == teacher.id, Classroom.is_active.is_(True))
        .group_by(Classroom.id, Classroom.name)
        .all()
    )

    result = []
    for classroom_id, classroom_name, student_count in classrooms_with_count:
        result.append(
            ClassroomResponse(
                id=classroom_id, name=classroom_name, studentCount=student_count or 0
            )
        )

    return result


@router.get("/classroom-students/{classroom_id}", response_model=List[StudentResponse])
def get_classroom_students(classroom_id: int, db: Session = Depends(get_db)):
    """獲取班級的所有學生（只顯示名字和頭像，不顯示敏感資訊）"""
    # 確認班級存在
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id, Classroom.is_active.is_(True))
        .first()
    )

    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    # 獲取班級的所有學生
    students = (
        db.query(Student)
        .join(ClassroomStudent)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )

    # 只返回必要的公開資訊
    result = []
    for student in students:
        result.append(
            StudentResponse(
                id=student.id,
                name=student.name,
                email=student.email,  # 用於登入
                avatar=None,  # 未來可以加入頭像
            )
        )

    return result


@router.get("/config", response_model=ConfigResponse)
def get_config():
    """獲取系統配置與 feature flags（公開端點，不需認證）"""
    enable_payment = os.getenv("ENABLE_PAYMENT", "false").lower() == "true"
    environment = os.getenv("ENVIRONMENT", "development")

    return ConfigResponse(enablePayment=enable_payment, environment=environment)


# ============ SEO Endpoints ============


@router.get("/robots.txt")
def get_robots_txt():
    """Generate robots.txt based on environment."""
    environment = os.getenv("ENVIRONMENT", "development")
    sitemap_url = f"{SITE_DOMAIN}/api/public/sitemap-index.xml"

    if environment == "production":
        content = (
            "User-agent: *\n"
            "Allow: /\n"
            "Disallow: /api/\n"
            "Disallow: /teacher/\n"
            "Disallow: /student/\n"
            "Disallow: /admin/\n"
            "Disallow: /organization/\n"
            "Disallow: /debug\n"
            f"\nSitemap: {sitemap_url}\n"
        )
    else:
        content = "User-agent: *\nDisallow: /\n"

    return Response(
        content=content,
        media_type="text/plain",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/sitemap-index.xml")
def get_sitemap_index():
    """Generate sitemap index referencing sub-sitemaps."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        "  <sitemap>\n"
        f"    <loc>{SITE_DOMAIN}/api/public/sitemap-static.xml</loc>\n"
        f"    <lastmod>{now}</lastmod>\n"
        "  </sitemap>\n"
        "  <sitemap>\n"
        f"    <loc>{SITE_DOMAIN}/api/public/blog/sitemap.xml</loc>\n"
        f"    <lastmod>{now}</lastmod>\n"
        "  </sitemap>\n"
        "</sitemapindex>"
    )
    return Response(
        content=xml,
        media_type="application/xml",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/sitemap-static.xml")
def get_sitemap_static():
    """Generate sitemap for static public pages."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    pages = [
        ("/", "daily", "1.0"),
        ("/pricing", "weekly", "0.8"),
        ("/blog", "daily", "0.8"),
        ("/terms", "monthly", "0.3"),
        ("/privacy", "monthly", "0.3"),
    ]

    urls = []
    for path, changefreq, priority in pages:
        urls.append(
            f"  <url>\n"
            f"    <loc>{SITE_DOMAIN}{path}</loc>\n"
            f"    <lastmod>{now}</lastmod>\n"
            f"    <changefreq>{changefreq}</changefreq>\n"
            f"    <priority>{priority}</priority>\n"
            f"  </url>"
        )

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls)
        + "\n</urlset>"
    )
    return Response(
        content=xml,
        media_type="application/xml",
        headers={"Cache-Control": "public, max-age=3600"},
    )


# ============ Blog Public Endpoints ============


@router.get("/blog")
def get_blog_posts(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=12, ge=1, le=100),
    category: Optional[str] = None,
    locale: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Get published blog posts (public)."""
    result = BlogService.get_published_posts(db, page, per_page, category, locale)
    posts = []
    for p in result["posts"]:
        posts.append(
            {
                "id": p.id,
                "title": p.title,
                "slug": p.slug,
                "summary": p.summary,
                "cover_image_url": p.cover_image_url,
                "is_published": p.is_published,
                "published_at": (
                    p.published_at.isoformat() if p.published_at else None
                ),
                "locale": getattr(p, "locale", "zh-TW"),
                "linked_post_slug": (
                    p.linked_post.slug if getattr(p, "linked_post", None) else None
                ),
                "author": (
                    {"id": p.author.id, "name": p.author.name} if p.author else None
                ),
                "categories": [
                    {"id": c.id, "name": c.name, "slug": c.slug}
                    for c in (p.categories or [])
                ],
            }
        )
    return {
        "posts": posts,
        "total": result["total"],
        "page": result["page"],
        "per_page": result["per_page"],
        "total_pages": result["total_pages"],
    }


@router.get("/blog/categories")
def get_blog_categories(db: Session = Depends(get_db)):
    """Get all blog categories (public)."""
    categories = BlogService.get_categories(db)
    return [{"id": c.id, "name": c.name, "slug": c.slug} for c in categories]


@router.get("/blog/sitemap.xml")
def get_blog_sitemap(db: Session = Depends(get_db)):
    """Generate blog sitemap XML."""
    xml = BlogService.generate_sitemap(db)
    return Response(content=xml, media_type="application/xml")


@router.get("/blog/{slug}")
def get_blog_post(slug: str, db: Session = Depends(get_db)):
    """Get a single published blog post by slug (public)."""
    post = BlogService.get_post_by_slug(db, slug)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
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


@router.get("/blog/{slug}/meta")
def get_blog_post_meta(slug: str, db: Session = Depends(get_db)):
    """Return minimal HTML with OG meta tags for prerender/crawlers."""
    html = BlogService.get_post_meta_html(db, slug)
    if not html:
        raise HTTPException(status_code=404, detail="Post not found")
    return HTMLResponse(content=html)
