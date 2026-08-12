"""
Blog service: business logic for blog posts and categories.
"""

import html as html_lib
import logging
import re
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session, contains_eager, joinedload
from sqlalchemy import desc, func as sa_func

from models.blog import BlogPost, BlogCategory, BlogPostCategory, BlogPostImage

logger = logging.getLogger(__name__)

# 圖庫單篇上限（防止誤送巨量資料）
MAX_POST_IMAGES = 100


def _generate_slug(text: str) -> str:
    """Generate URL-friendly slug from text."""
    slug = text.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    slug = slug.strip("-")
    return slug


class BlogService:
    """Blog service for managing posts and categories."""

    # ============ Public Post Methods ============

    @staticmethod
    def get_published_posts(
        db: Session,
        page: int = 1,
        per_page: int = 12,
        category_slug: Optional[str] = None,
        locale: Optional[str] = None,
    ) -> dict:
        """Get paginated published posts, ordered by published_at DESC."""
        if category_slug:
            query = (
                db.query(BlogPost)
                .join(BlogPost.categories)
                .options(contains_eager(BlogPost.categories))
                .options(joinedload(BlogPost.author))
                .filter(
                    BlogPost.is_published.is_(True),
                    BlogCategory.slug == category_slug,
                )
            )
        else:
            query = (
                db.query(BlogPost)
                .options(joinedload(BlogPost.categories))
                .options(joinedload(BlogPost.author))
                .filter(BlogPost.is_published.is_(True))
            )

        if locale:
            query = query.filter(BlogPost.locale == locale)

        # Use distinct count to avoid inflation from joins
        if category_slug:
            total = query.with_entities(
                sa_func.count(sa_func.distinct(BlogPost.id))
            ).scalar()
        else:
            total = query.count()
        posts = (
            query.order_by(desc(BlogPost.published_at))
            .offset((page - 1) * per_page)
            .limit(per_page)
            .all()
        )

        return {
            "posts": posts,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": (total + per_page - 1) // per_page,
        }

    @staticmethod
    def get_post_by_slug(db: Session, slug: str) -> Optional[BlogPost]:
        """Get a single published post by slug with categories."""
        return (
            db.query(BlogPost)
            .options(joinedload(BlogPost.categories))
            .options(joinedload(BlogPost.author))
            .filter(BlogPost.slug == slug, BlogPost.is_published.is_(True))
            .first()
        )

    # ============ Admin Post Methods ============

    @staticmethod
    def get_all_posts(
        db: Session,
        page: int = 1,
        per_page: int = 20,
        status: Optional[str] = None,
        category_id: Optional[int] = None,
    ) -> dict:
        """Get all posts including drafts (admin), with optional filters."""
        if category_id is not None:
            query = (
                db.query(BlogPost)
                .join(BlogPost.categories)
                .options(contains_eager(BlogPost.categories))
                .options(joinedload(BlogPost.author))
                .filter(BlogCategory.id == category_id)
            )
        else:
            query = (
                db.query(BlogPost)
                .options(joinedload(BlogPost.categories))
                .options(joinedload(BlogPost.author))
            )

        if status == "published":
            query = query.filter(BlogPost.is_published.is_(True))
        elif status == "draft":
            query = query.filter(BlogPost.is_published.is_(False))

        # Use distinct count to avoid inflation from joins
        if category_id is not None:
            total = query.with_entities(
                sa_func.count(sa_func.distinct(BlogPost.id))
            ).scalar()
        else:
            total = query.count()
        posts = (
            query.order_by(desc(BlogPost.created_at))
            .offset((page - 1) * per_page)
            .limit(per_page)
            .all()
        )

        return {
            "posts": posts,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": (total + per_page - 1) // per_page,
        }

    @staticmethod
    def get_post_by_id(db: Session, post_id: int) -> Optional[BlogPost]:
        """Get a single post by ID (admin)."""
        return (
            db.query(BlogPost)
            .options(joinedload(BlogPost.categories))
            .options(joinedload(BlogPost.author))
            .options(joinedload(BlogPost.images))
            .filter(BlogPost.id == post_id)
            .first()
        )

    # ============ Post Images (圖庫) ============

    @staticmethod
    def _replace_post_images(db: Session, post_id: int, images: list) -> None:
        """整批取代一篇文章的圖庫。

        採「全刪再全插」而非逐列 UPDATE —— (post_id, order_index) 有唯一約束，
        逐列改順序會在中途撞約束。DELETE 後必須 flush 讓刪除先落地才 INSERT。

        注意：這裡**只動 DB 列，絕不刪 GCS 圖檔**。每次儲存文章都會走這條路徑，
        若順手刪雲端檔就會把整個圖庫的實體檔案清空。實體檔刪除只發生在
        delete_post_image()（使用者明確按刪除，且確認沒被引用時）。
        """
        db.query(BlogPostImage).filter(BlogPostImage.post_id == post_id).delete()
        db.flush()
        for idx, img in enumerate(images):
            db.add(
                BlogPostImage(
                    post_id=post_id,
                    image_url=img["image_url"],
                    alt_text=img.get("alt_text"),
                    order_index=idx,
                )
            )

    @staticmethod
    def is_image_url_referenced(db: Session, image_url: str) -> bool:
        """檢查圖片網址是否仍被任何文章引用（內文 / 封面 / OG 圖）。

        跨全部文章查（不限單篇）—— 同一張圖可能被別篇引用，誤刪會造成他篇破圖。
        """
        if not image_url:
            return False
        return (
            db.query(BlogPost.id)
            .filter(
                (BlogPost.content.contains(image_url))
                | (BlogPost.cover_image_url == image_url)
                | (BlogPost.og_image_url == image_url)
            )
            .first()
            is not None
        )

    @staticmethod
    def delete_post_image(db: Session, post_id: int, image_id: int) -> Optional[dict]:
        """刪除圖庫中的單張圖；確認沒被任何文章引用時，連 GCS 實體檔一起刪。

        回傳 {"deleted": True, "storage_deleted": bool}，找不到則回 None。
        """
        image = (
            db.query(BlogPostImage)
            .filter(
                BlogPostImage.id == image_id,
                BlogPostImage.post_id == post_id,
            )
            .first()
        )
        if not image:
            return None

        image_url = image.image_url
        db.delete(image)
        db.commit()

        storage_deleted = False
        if not BlogService.is_image_url_referenced(db, image_url):
            try:
                from services.image_upload import get_image_upload_service

                storage_deleted = get_image_upload_service().delete_image(image_url)
            except Exception as exc:  # pragma: no cover - 外部儲存失敗不影響 API
                logger.warning(
                    "Failed to delete blog image from storage: url=%s err=%s",
                    image_url,
                    exc,
                )
        else:
            logger.info(
                "Blog image row removed but file kept (still referenced): url=%s",
                image_url,
            )

        logger.info(
            "Blog image deleted: post=%s image=%s storage_deleted=%s",
            post_id,
            image_id,
            storage_deleted,
        )
        return {"deleted": True, "storage_deleted": storage_deleted}

    @staticmethod
    def create_post(db: Session, data: dict, author_id: int) -> BlogPost:
        """Create a new blog post."""
        raw_slug = data.get("slug")
        slug = _generate_slug(raw_slug) if raw_slug else _generate_slug(data["title"])

        # Ensure slug uniqueness
        existing = db.query(BlogPost).filter(BlogPost.slug == slug).first()
        if existing:
            slug = f"{slug}-{int(datetime.now().timestamp())}"

        post = BlogPost(
            title=data["title"],
            slug=slug,
            summary=data.get("summary"),
            content=data.get("content"),
            cover_image_url=data.get("cover_image_url"),
            meta_title=data.get("meta_title"),
            meta_description=data.get("meta_description"),
            og_image_url=data.get("og_image_url"),
            is_published=data.get("is_published", False),
            locale=data.get("locale", "zh-TW"),
            linked_post_id=data.get("linked_post_id"),
            author_id=author_id,
        )

        if post.is_published:
            post.published_at = datetime.now(timezone.utc)

        db.add(post)
        db.flush()

        # Handle categories
        category_ids = data.get("category_ids", [])
        for cat_id in category_ids:
            assoc = BlogPostCategory(post_id=post.id, category_id=cat_id)
            db.add(assoc)

        # Handle gallery images
        if data.get("images"):
            BlogService._replace_post_images(db, post.id, data["images"])

        db.commit()
        db.refresh(post)
        logger.info("Blog post created: id=%s slug=%s", post.id, post.slug)
        return post

    @staticmethod
    def update_post(db: Session, post_id: int, data: dict) -> Optional[BlogPost]:
        """Update an existing blog post."""
        post = db.query(BlogPost).filter(BlogPost.id == post_id).first()
        if not post:
            return None

        # Guard against self-referencing linked_post_id
        if "linked_post_id" in data and data["linked_post_id"] == post_id:
            data.pop("linked_post_id")

        updatable_fields = [
            "title",
            "slug",
            "summary",
            "content",
            "cover_image_url",
            "meta_title",
            "meta_description",
            "og_image_url",
        ]
        for field in updatable_fields:
            if field in data:
                value = data[field]
                if field == "slug" and value:
                    value = _generate_slug(value)
                setattr(post, field, value)

        # Handle category update
        if "category_ids" in data:
            db.query(BlogPostCategory).filter(
                BlogPostCategory.post_id == post_id
            ).delete()
            for cat_id in data["category_ids"]:
                assoc = BlogPostCategory(post_id=post_id, category_id=cat_id)
                db.add(assoc)

        # Handle gallery update（送 [] 代表清空；不送則不動）
        # 注意：images 刻意不放進 updatable_fields，避免 setattr 到 relationship
        if "images" in data:
            BlogService._replace_post_images(db, post_id, data["images"])

        db.commit()
        db.refresh(post)
        logger.info("Blog post updated: id=%s", post.id)
        return post

    @staticmethod
    def delete_post(db: Session, post_id: int) -> bool:
        """Delete a blog post."""
        post = db.query(BlogPost).filter(BlogPost.id == post_id).first()
        if not post:
            return False

        db.delete(post)
        db.commit()
        logger.info("Blog post deleted: id=%s", post_id)
        return True

    @staticmethod
    def publish_post(db: Session, post_id: int) -> Optional[BlogPost]:
        """Toggle publish status of a blog post."""
        post = db.query(BlogPost).filter(BlogPost.id == post_id).first()
        if not post:
            return None

        post.is_published = not post.is_published
        if post.is_published:
            post.published_at = datetime.now(timezone.utc)
        else:
            post.published_at = None

        db.commit()
        db.refresh(post)
        logger.info(
            "Blog post publish toggled: id=%s is_published=%s",
            post.id,
            post.is_published,
        )
        return post

    # ============ Translation Methods ============

    @staticmethod
    def create_translated_post(
        db: Session,
        source_post_id: int,
        target_locale: str,
        translated_data: dict,
        author_id: int,
    ) -> Optional[BlogPost]:
        """Create a translated version of a post and link them together."""
        source = db.query(BlogPost).filter(BlogPost.id == source_post_id).first()
        if not source:
            return None

        # Guard: don't overwrite an existing translation link
        if source.linked_post_id is not None:
            logger.warning(
                "Post %s already has a translation linked (id=%s), skipping",
                source.id,
                source.linked_post_id,
            )
            return None

        # Build slug: source slug + locale suffix
        locale_suffix = target_locale.split("-")[0]  # "en" from "en"
        target_slug = f"{source.slug}-{locale_suffix}"

        # Ensure slug uniqueness
        existing = db.query(BlogPost).filter(BlogPost.slug == target_slug).first()
        if existing:
            target_slug = f"{target_slug}-{int(datetime.now().timestamp())}"

        translated_post = BlogPost(
            title=translated_data.get("title", source.title),
            slug=target_slug,
            summary=translated_data.get("summary", source.summary),
            content=translated_data.get("content", source.content),
            cover_image_url=source.cover_image_url,
            meta_title=translated_data.get("meta_title"),
            meta_description=translated_data.get("meta_description"),
            og_image_url=source.og_image_url,
            is_published=False,  # Always start as draft
            locale=target_locale,
            linked_post_id=source.id,
            author_id=author_id,
        )
        db.add(translated_post)
        db.flush()

        # Link source back to translated post
        source.linked_post_id = translated_post.id

        # Copy categories
        source_cats = (
            db.query(BlogPostCategory)
            .filter(BlogPostCategory.post_id == source.id)
            .all()
        )
        for cat in source_cats:
            assoc = BlogPostCategory(
                post_id=translated_post.id, category_id=cat.category_id
            )
            db.add(assoc)

        db.commit()
        db.refresh(translated_post)
        logger.info(
            "Translated post created: id=%s locale=%s from=%s",
            translated_post.id,
            target_locale,
            source.id,
        )
        return translated_post

    # ============ Category Methods ============

    @staticmethod
    def get_categories(db: Session) -> list:
        """List all categories."""
        return db.query(BlogCategory).order_by(BlogCategory.name).all()

    @staticmethod
    def create_category(
        db: Session, name: str, slug: Optional[str] = None
    ) -> BlogCategory:
        """Create a new category."""
        if not slug:
            slug = _generate_slug(name)

        category = BlogCategory(name=name, slug=slug)
        db.add(category)
        db.commit()
        db.refresh(category)
        logger.info(
            "Blog category created: id=%s name=%s",
            category.id,
            category.name,
        )
        return category

    @staticmethod
    def update_category(
        db: Session,
        category_id: int,
        name: Optional[str] = None,
        slug: Optional[str] = None,
    ) -> Optional[BlogCategory]:
        """Update a category."""
        category = db.query(BlogCategory).filter(BlogCategory.id == category_id).first()
        if not category:
            return None

        if name is not None:
            category.name = name
        if slug is not None:
            category.slug = slug

        db.commit()
        db.refresh(category)
        logger.info("Blog category updated: id=%s", category.id)
        return category

    @staticmethod
    def delete_category(db: Session, category_id: int) -> bool:
        """Delete a category."""
        category = db.query(BlogCategory).filter(BlogCategory.id == category_id).first()
        if not category:
            return False

        db.delete(category)
        db.commit()
        logger.info("Blog category deleted: id=%s", category_id)
        return True

    # ============ SEO / Sitemap Methods ============

    @staticmethod
    def generate_sitemap(db: Session) -> str:
        """Generate sitemap XML string for published posts."""
        posts = (
            db.query(BlogPost)
            .filter(BlogPost.is_published.is_(True))
            .order_by(desc(BlogPost.published_at))
            .all()
        )

        urls = []
        for post in posts:
            lastmod = post.updated_at or post.published_at or post.created_at
            lastmod_str = lastmod.strftime("%Y-%m-%d") if lastmod else ""
            urls.append(
                f"  <url>\n"
                f"    <loc>https://duotopia.co/blog/{post.slug}</loc>\n"
                f"    <lastmod>{lastmod_str}</lastmod>\n"
                f"    <changefreq>weekly</changefreq>\n"
                f"    <priority>0.7</priority>\n"
                f"  </url>"
            )

        xml = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + "\n".join(urls)
            + "\n</urlset>"
        )
        return xml

    @staticmethod
    def get_post_meta_html(db: Session, slug: str) -> Optional[str]:
        """Generate minimal HTML with OG meta tags for prerender."""
        post = (
            db.query(BlogPost)
            .filter(
                BlogPost.slug == slug,
                BlogPost.is_published.is_(True),
            )
            .first()
        )
        if not post:
            return None

        title = html_lib.escape(post.meta_title or post.title)
        description = html_lib.escape(post.meta_description or post.summary or "")
        og_image = html_lib.escape(post.og_image_url or post.cover_image_url or "")
        url = f"https://duotopia.co/blog/{html_lib.escape(post.slug)}"

        html = (
            "<!DOCTYPE html>\n"
            "<html>\n<head>\n"
            f"  <title>{title}</title>\n"
            f'  <meta name="description" content="{description}" />\n'
            f'  <meta property="og:title" content="{title}" />\n'
            f'  <meta property="og:description"'
            f' content="{description}" />\n'
            f'  <meta property="og:url" content="{url}" />\n'
            f'  <meta property="og:type" content="article" />\n'
        )
        if og_image:
            html += f'  <meta property="og:image"' f' content="{og_image}" />\n'
        html += "</head>\n<body></body>\n</html>"
        return html
