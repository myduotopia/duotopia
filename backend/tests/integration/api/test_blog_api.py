"""
Blog API integration tests.
Tests admin CRUD endpoints and public read endpoints.
"""

from fastapi import status
from models.blog import BlogPost, BlogCategory, BlogPostCategory, BlogPostImage
from auth import create_access_token, get_password_hash
from models import Teacher
from services.blog_service import MAX_POST_IMAGES
from services.image_upload import get_image_upload_service


class TestBlogAdminAuth:
    """Test that blog admin endpoints require admin auth."""

    def test_list_posts_requires_auth(self, test_client):
        response = test_client.get("/api/blog")
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_list_posts_requires_admin(self, test_client, demo_teacher):
        token = create_access_token(
            data={"sub": str(demo_teacher.id), "type": "teacher"}
        )
        response = test_client.get(
            "/api/blog", headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_create_post_requires_admin(self, test_client, demo_teacher):
        token = create_access_token(
            data={"sub": str(demo_teacher.id), "type": "teacher"}
        )
        response = test_client.post(
            "/api/blog",
            json={"title": "Test"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN


class TestBlogAdminCRUD:
    """Test blog admin CRUD operations."""

    def _make_admin(self, session):
        """Create an admin teacher and return (teacher, headers)."""
        teacher = Teacher(
            email="admin-blog@duotopia.com",
            password_hash=get_password_hash("admin123"),
            name="Blog Admin",
            is_active=True,
            is_admin=True,
            email_verified=True,
        )
        session.add(teacher)
        session.commit()
        session.refresh(teacher)
        token = create_access_token(data={"sub": str(teacher.id), "type": "teacher"})
        return teacher, {"Authorization": f"Bearer {token}"}

    def test_create_post(self, test_client, shared_test_session):
        admin, headers = self._make_admin(shared_test_session)
        response = test_client.post(
            "/api/blog",
            json={
                "title": "First Blog Post",
                "summary": "A summary",
                "content": "# Hello World",
            },
            headers=headers,
        )
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["title"] == "First Blog Post"
        assert data["slug"] == "first-blog-post"
        assert data["summary"] == "A summary"
        assert data["content"] == "# Hello World"
        assert data["is_published"] is False
        assert data["author"]["id"] == admin.id

    def test_create_post_custom_slug(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)
        response = test_client.post(
            "/api/blog",
            json={"title": "My Post", "slug": "custom-slug"},
            headers=headers,
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["slug"] == "custom-slug"

    def test_create_post_duplicate_slug_auto_suffix(
        self, test_client, shared_test_session
    ):
        _, headers = self._make_admin(shared_test_session)
        # Create first post
        test_client.post(
            "/api/blog",
            json={"title": "Duplicate"},
            headers=headers,
        )
        # Create second post with same title
        response = test_client.post(
            "/api/blog",
            json={"title": "Duplicate"},
            headers=headers,
        )
        assert response.status_code == status.HTTP_200_OK
        slug = response.json()["slug"]
        assert slug.startswith("duplicate-")
        assert slug != "duplicate"

    def test_list_posts_admin(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)
        # Create a post
        test_client.post("/api/blog", json={"title": "Listed Post"}, headers=headers)
        response = test_client.get("/api/blog", headers=headers)
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "posts" in data
        assert "total" in data
        assert "page" in data
        assert "total_pages" in data
        assert data["total"] >= 1

    def test_get_post_by_id(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)
        create_res = test_client.post(
            "/api/blog", json={"title": "Get By ID"}, headers=headers
        )
        post_id = create_res.json()["id"]

        response = test_client.get(f"/api/blog/{post_id}", headers=headers)
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["title"] == "Get By ID"

    def test_get_nonexistent_post(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)
        response = test_client.get("/api/blog/99999", headers=headers)
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_update_post(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)
        create_res = test_client.post(
            "/api/blog", json={"title": "Before Update"}, headers=headers
        )
        post_id = create_res.json()["id"]

        response = test_client.put(
            f"/api/blog/{post_id}",
            json={"title": "After Update", "summary": "New summary"},
            headers=headers,
        )
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["title"] == "After Update"
        assert data["summary"] == "New summary"

    def test_delete_post(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)
        create_res = test_client.post(
            "/api/blog", json={"title": "To Delete"}, headers=headers
        )
        post_id = create_res.json()["id"]

        response = test_client.delete(f"/api/blog/{post_id}", headers=headers)
        assert response.status_code == status.HTTP_200_OK

        # Verify deleted
        get_res = test_client.get(f"/api/blog/{post_id}", headers=headers)
        assert get_res.status_code == status.HTTP_404_NOT_FOUND

    def test_publish_toggle(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)
        create_res = test_client.post(
            "/api/blog", json={"title": "Publish Test"}, headers=headers
        )
        post_id = create_res.json()["id"]
        assert create_res.json()["is_published"] is False

        # Publish
        pub_res = test_client.post(f"/api/blog/{post_id}/publish", headers=headers)
        assert pub_res.status_code == status.HTTP_200_OK
        assert pub_res.json()["is_published"] is True
        assert pub_res.json()["published_at"] is not None

        # Unpublish
        unpub_res = test_client.post(f"/api/blog/{post_id}/publish", headers=headers)
        assert unpub_res.status_code == status.HTTP_200_OK
        assert unpub_res.json()["is_published"] is False
        assert unpub_res.json()["published_at"] is None


class TestBlogAdminFilters:
    """Test admin list filters (status and category_id)."""

    def _make_admin(self, session):
        teacher = Teacher(
            email="admin-filter@duotopia.com",
            password_hash=get_password_hash("admin123"),
            name="Filter Admin",
            is_active=True,
            is_admin=True,
            email_verified=True,
        )
        session.add(teacher)
        session.commit()
        session.refresh(teacher)
        token = create_access_token(data={"sub": str(teacher.id), "type": "teacher"})
        return teacher, {"Authorization": f"Bearer {token}"}

    def test_filter_by_status_published(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)

        # Create a draft and a published post
        test_client.post("/api/blog", json={"title": "Filter Draft"}, headers=headers)
        pub = test_client.post(
            "/api/blog", json={"title": "Filter Published"}, headers=headers
        )
        test_client.post(f"/api/blog/{pub.json()['id']}/publish", headers=headers)

        res = test_client.get(
            "/api/blog", params={"status": "published"}, headers=headers
        )
        assert res.status_code == status.HTTP_200_OK
        titles = [p["title"] for p in res.json()["posts"]]
        assert "Filter Published" in titles
        assert "Filter Draft" not in titles

    def test_filter_by_status_draft(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)

        res = test_client.get("/api/blog", params={"status": "draft"}, headers=headers)
        assert res.status_code == status.HTTP_200_OK
        for p in res.json()["posts"]:
            assert p["is_published"] is False

    def test_filter_by_category_id(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)

        # Create a category
        cat_res = test_client.post(
            "/api/blog/categories",
            json={"name": "Filter Cat"},
            headers=headers,
        )
        cat_id = cat_res.json()["id"]

        # Create post with category and one without
        test_client.post(
            "/api/blog",
            json={"title": "With Category", "category_ids": [cat_id]},
            headers=headers,
        )
        test_client.post(
            "/api/blog",
            json={"title": "Without Category"},
            headers=headers,
        )

        res = test_client.get(
            "/api/blog", params={"category_id": cat_id}, headers=headers
        )
        assert res.status_code == status.HTTP_200_OK
        titles = [p["title"] for p in res.json()["posts"]]
        assert "With Category" in titles
        assert "Without Category" not in titles

    def test_combined_filters(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)

        cat_res = test_client.post(
            "/api/blog/categories",
            json={"name": "Combo Cat"},
            headers=headers,
        )
        cat_id = cat_res.json()["id"]

        # Published post with category
        pub = test_client.post(
            "/api/blog",
            json={"title": "Pub With Cat", "category_ids": [cat_id]},
            headers=headers,
        )
        test_client.post(f"/api/blog/{pub.json()['id']}/publish", headers=headers)

        # Draft post with same category
        test_client.post(
            "/api/blog",
            json={"title": "Draft With Cat", "category_ids": [cat_id]},
            headers=headers,
        )

        res = test_client.get(
            "/api/blog",
            params={"status": "published", "category_id": cat_id},
            headers=headers,
        )
        assert res.status_code == status.HTTP_200_OK
        titles = [p["title"] for p in res.json()["posts"]]
        assert "Pub With Cat" in titles
        assert "Draft With Cat" not in titles


class TestBlogCategories:
    """Test blog category management."""

    def _make_admin(self, session):
        teacher = Teacher(
            email="admin-cat@duotopia.com",
            password_hash=get_password_hash("admin123"),
            name="Category Admin",
            is_active=True,
            is_admin=True,
            email_verified=True,
        )
        session.add(teacher)
        session.commit()
        session.refresh(teacher)
        token = create_access_token(data={"sub": str(teacher.id), "type": "teacher"})
        return teacher, {"Authorization": f"Bearer {token}"}

    def test_create_category(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)
        response = test_client.post(
            "/api/blog/categories",
            json={"name": "Teaching Tips"},
            headers=headers,
        )
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["name"] == "Teaching Tips"
        assert data["slug"] == "teaching-tips"

    def test_create_category_custom_slug(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)
        response = test_client.post(
            "/api/blog/categories",
            json={"name": "AI Education", "slug": "ai-edu"},
            headers=headers,
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["slug"] == "ai-edu"

    def test_list_categories(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)
        test_client.post(
            "/api/blog/categories",
            json={"name": "Cat A"},
            headers=headers,
        )
        response = test_client.get("/api/blog/categories", headers=headers)
        assert response.status_code == status.HTTP_200_OK
        assert isinstance(response.json(), list)
        assert len(response.json()) >= 1

    def test_update_category(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)
        create_res = test_client.post(
            "/api/blog/categories",
            json={"name": "Old Name"},
            headers=headers,
        )
        cat_id = create_res.json()["id"]

        response = test_client.put(
            f"/api/blog/categories/{cat_id}",
            json={"name": "New Name"},
            headers=headers,
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["name"] == "New Name"

    def test_delete_category(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)
        create_res = test_client.post(
            "/api/blog/categories",
            json={"name": "To Delete Cat"},
            headers=headers,
        )
        cat_id = create_res.json()["id"]

        response = test_client.delete(f"/api/blog/categories/{cat_id}", headers=headers)
        assert response.status_code == status.HTTP_200_OK

    def test_create_post_with_categories(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)
        # Create categories
        cat1 = test_client.post(
            "/api/blog/categories",
            json={"name": "Cat 1"},
            headers=headers,
        ).json()
        cat2 = test_client.post(
            "/api/blog/categories",
            json={"name": "Cat 2"},
            headers=headers,
        ).json()

        # Create post with categories
        response = test_client.post(
            "/api/blog",
            json={
                "title": "Categorized Post",
                "category_ids": [cat1["id"], cat2["id"]],
            },
            headers=headers,
        )
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        cat_names = [c["name"] for c in data["categories"]]
        assert "Cat 1" in cat_names
        assert "Cat 2" in cat_names

    def test_create_post_with_invalid_category_id(
        self, test_client, shared_test_session
    ):
        _, headers = self._make_admin(shared_test_session)
        response = test_client.post(
            "/api/blog",
            json={
                "title": "Invalid Cat Post",
                "category_ids": [99999],
            },
            headers=headers,
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Invalid category IDs" in response.json()["detail"]


class TestBlogPublicAPI:
    """Test public blog read endpoints."""

    def _setup_published_post(self, session):
        """Create an admin, publish a post, return (admin, headers)."""
        teacher = Teacher(
            email="admin-pub@duotopia.com",
            password_hash=get_password_hash("admin123"),
            name="Public Admin",
            is_active=True,
            is_admin=True,
            email_verified=True,
        )
        session.add(teacher)
        session.commit()
        session.refresh(teacher)
        token = create_access_token(data={"sub": str(teacher.id), "type": "teacher"})
        return teacher, {"Authorization": f"Bearer {token}"}

    def test_public_list_empty(self, test_client):
        response = test_client.get("/api/public/blog")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["posts"] == []
        assert data["total"] == 0

    def test_public_list_only_published(self, test_client, shared_test_session):
        _, headers = self._setup_published_post(shared_test_session)

        # Create draft
        test_client.post(
            "/api/blog",
            json={"title": "Draft Post"},
            headers=headers,
        )

        # Create and publish
        pub_res = test_client.post(
            "/api/blog",
            json={"title": "Published Post", "content": "Hello"},
            headers=headers,
        )
        post_id = pub_res.json()["id"]
        test_client.post(f"/api/blog/{post_id}/publish", headers=headers)

        # Public list should only show published
        response = test_client.get("/api/public/blog")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["total"] == 1
        assert data["posts"][0]["title"] == "Published Post"

    def test_public_get_by_slug(self, test_client, shared_test_session):
        _, headers = self._setup_published_post(shared_test_session)

        # Create and publish
        create_res = test_client.post(
            "/api/blog",
            json={"title": "Slug Test", "content": "Content here"},
            headers=headers,
        )
        post_id = create_res.json()["id"]
        slug = create_res.json()["slug"]
        test_client.post(f"/api/blog/{post_id}/publish", headers=headers)

        # Get by slug
        response = test_client.get(f"/api/public/blog/{slug}")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["title"] == "Slug Test"

    def test_public_get_draft_by_slug_404(self, test_client, shared_test_session):
        _, headers = self._setup_published_post(shared_test_session)

        create_res = test_client.post(
            "/api/blog",
            json={"title": "Hidden Draft"},
            headers=headers,
        )
        slug = create_res.json()["slug"]

        response = test_client.get(f"/api/public/blog/{slug}")
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_public_categories(self, test_client, shared_test_session):
        _, headers = self._setup_published_post(shared_test_session)
        test_client.post(
            "/api/blog/categories",
            json={"name": "Public Cat"},
            headers=headers,
        )
        response = test_client.get("/api/public/blog/categories")
        assert response.status_code == status.HTTP_200_OK
        assert isinstance(response.json(), list)
        assert len(response.json()) >= 1

    def test_public_sitemap(self, test_client, shared_test_session):
        _, headers = self._setup_published_post(shared_test_session)

        # Create and publish a post
        create_res = test_client.post(
            "/api/blog",
            json={"title": "Sitemap Post"},
            headers=headers,
        )
        post_id = create_res.json()["id"]
        test_client.post(f"/api/blog/{post_id}/publish", headers=headers)

        response = test_client.get("/api/public/blog/sitemap.xml")
        assert response.status_code == status.HTTP_200_OK
        assert "xml" in response.headers.get("content-type", "")
        assert "sitemap-post" in response.text

    def test_public_meta_html(self, test_client, shared_test_session):
        _, headers = self._setup_published_post(shared_test_session)

        create_res = test_client.post(
            "/api/blog",
            json={
                "title": "Meta Test",
                "summary": "A meta summary",
                "meta_title": "Custom Meta Title",
            },
            headers=headers,
        )
        post_id = create_res.json()["id"]
        slug = create_res.json()["slug"]
        test_client.post(f"/api/blog/{post_id}/publish", headers=headers)

        response = test_client.get(f"/api/public/blog/{slug}/meta")
        assert response.status_code == status.HTTP_200_OK
        html = response.text
        assert "Custom Meta Title" in html
        assert "og:title" in html
        assert "og:description" in html

    def test_public_locale_filter(self, test_client, shared_test_session):
        _, headers = self._setup_published_post(shared_test_session)

        # Create zh-TW post and publish
        zh_res = test_client.post(
            "/api/blog",
            json={"title": "中文文章", "locale": "zh-TW"},
            headers=headers,
        )
        zh_id = zh_res.json()["id"]
        test_client.post(f"/api/blog/{zh_id}/publish", headers=headers)

        # Create en post and publish
        en_res = test_client.post(
            "/api/blog",
            json={"title": "English Article", "locale": "en"},
            headers=headers,
        )
        en_id = en_res.json()["id"]
        test_client.post(f"/api/blog/{en_id}/publish", headers=headers)

        # Filter by zh-TW
        zh_response = test_client.get("/api/public/blog?locale=zh-TW")
        zh_data = zh_response.json()
        zh_titles = [p["title"] for p in zh_data["posts"]]
        assert "中文文章" in zh_titles
        assert "English Article" not in zh_titles

        # Filter by en
        en_response = test_client.get("/api/public/blog?locale=en")
        en_data = en_response.json()
        en_titles = [p["title"] for p in en_data["posts"]]
        assert "English Article" in en_titles
        assert "中文文章" not in en_titles


class TestBlogSEOFields:
    """Test SEO-related fields on blog posts."""

    def _make_admin(self, session):
        teacher = Teacher(
            email="admin-seo@duotopia.com",
            password_hash=get_password_hash("admin123"),
            name="SEO Admin",
            is_active=True,
            is_admin=True,
            email_verified=True,
        )
        session.add(teacher)
        session.commit()
        session.refresh(teacher)
        token = create_access_token(data={"sub": str(teacher.id), "type": "teacher"})
        return teacher, {"Authorization": f"Bearer {token}"}

    def test_create_post_with_seo_fields(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)
        response = test_client.post(
            "/api/blog",
            json={
                "title": "SEO Post",
                "meta_title": "Custom SEO Title",
                "meta_description": "Custom SEO Description",
                "og_image_url": "https://example.com/og.jpg",
                "cover_image_url": "https://example.com/cover.jpg",
            },
            headers=headers,
        )
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["meta_title"] == "Custom SEO Title"
        assert data["meta_description"] == "Custom SEO Description"
        assert data["og_image_url"] == "https://example.com/og.jpg"
        assert data["cover_image_url"] == "https://example.com/cover.jpg"

    def test_update_seo_fields(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)
        create_res = test_client.post(
            "/api/blog", json={"title": "SEO Update"}, headers=headers
        )
        post_id = create_res.json()["id"]

        response = test_client.put(
            f"/api/blog/{post_id}",
            json={
                "meta_title": "Updated Title",
                "meta_description": "Updated Desc",
            },
            headers=headers,
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["meta_title"] == "Updated Title"
        assert response.json()["meta_description"] == "Updated Desc"


class TestBlogPostImages:
    """圖庫（blog_post_images）：多圖清單、排序、封面獨立性與刪除行為。"""

    def _make_admin(self, session):
        """Create an admin teacher and return (teacher, headers)."""
        teacher = Teacher(
            email="admin-blog-images@duotopia.com",
            password_hash=get_password_hash("admin123"),
            name="Blog Images Admin",
            is_active=True,
            is_admin=True,
            email_verified=True,
        )
        session.add(teacher)
        session.commit()
        session.refresh(teacher)
        token = create_access_token(data={"sub": str(teacher.id), "type": "teacher"})
        return teacher, {"Authorization": f"Bearer {token}"}

    def _url(self, name: str) -> str:
        """產生一個通過來源驗證的圖片網址（依實際 bucket 設定）。"""
        service = get_image_upload_service()
        return f"https://storage.googleapis.com/{service.bucket_name}/blog/test/{name}"

    def test_create_post_with_images(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)
        response = test_client.post(
            "/api/blog",
            json={
                "title": "Post With Gallery",
                "images": [
                    {"image_url": self._url("a.jpg"), "alt_text": "A"},
                    {"image_url": self._url("b.jpg"), "alt_text": "B"},
                    {"image_url": self._url("c.jpg")},
                ],
            },
            headers=headers,
        )
        assert response.status_code == status.HTTP_200_OK
        images = response.json()["images"]
        assert len(images) == 3
        assert [i["order_index"] for i in images] == [0, 1, 2]
        assert [i["image_url"] for i in images] == [
            self._url("a.jpg"),
            self._url("b.jpg"),
            self._url("c.jpg"),
        ]
        assert images[0]["alt_text"] == "A"
        assert images[2]["alt_text"] is None

    def test_create_post_without_images(self, test_client, shared_test_session):
        """未帶 images 的既有 payload 不受影響（回歸保護）。"""
        _, headers = self._make_admin(shared_test_session)
        response = test_client.post(
            "/api/blog", json={"title": "No Gallery"}, headers=headers
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["images"] == []

    def test_get_post_returns_images_ordered(self, test_client, shared_test_session):
        """DB 中 order_index 亂序寫入，讀取時仍依 order_index 遞增。"""
        _, headers = self._make_admin(shared_test_session)
        post_id = test_client.post(
            "/api/blog", json={"title": "Ordered Gallery"}, headers=headers
        ).json()["id"]

        for order_index, name in [
            (2, "third.jpg"),
            (0, "first.jpg"),
            (1, "second.jpg"),
        ]:
            shared_test_session.add(
                BlogPostImage(
                    post_id=post_id,
                    image_url=self._url(name),
                    order_index=order_index,
                )
            )
        shared_test_session.commit()

        response = test_client.get(f"/api/blog/{post_id}", headers=headers)
        assert response.status_code == status.HTTP_200_OK
        images = response.json()["images"]
        assert [i["order_index"] for i in images] == [0, 1, 2]
        assert [i["image_url"].rsplit("/", 1)[-1] for i in images] == [
            "first.jpg",
            "second.jpg",
            "third.jpg",
        ]

    def test_update_post_replaces_images(self, test_client, shared_test_session):
        """整批取代：舊列全刪、新列依陣列順序重排，且不撞唯一約束。"""
        _, headers = self._make_admin(shared_test_session)
        post_id = test_client.post(
            "/api/blog",
            json={
                "title": "Replace Gallery",
                "images": [
                    {"image_url": self._url("old1.jpg")},
                    {"image_url": self._url("old2.jpg")},
                    {"image_url": self._url("old3.jpg")},
                ],
            },
            headers=headers,
        ).json()["id"]

        response = test_client.put(
            f"/api/blog/{post_id}",
            json={
                "images": [
                    {"image_url": self._url("new1.jpg")},
                    {"image_url": self._url("new2.jpg")},
                ]
            },
            headers=headers,
        )
        assert response.status_code == status.HTTP_200_OK
        images = response.json()["images"]
        assert [i["image_url"].rsplit("/", 1)[-1] for i in images] == [
            "new1.jpg",
            "new2.jpg",
        ]
        assert [i["order_index"] for i in images] == [0, 1]

    def test_update_post_with_empty_images_clears_gallery(
        self, test_client, shared_test_session
    ):
        _, headers = self._make_admin(shared_test_session)
        post_id = test_client.post(
            "/api/blog",
            json={
                "title": "Clear Gallery",
                "images": [{"image_url": self._url("x.jpg")}],
            },
            headers=headers,
        ).json()["id"]

        response = test_client.put(
            f"/api/blog/{post_id}", json={"images": []}, headers=headers
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["images"] == []

    def test_update_post_without_images_key_keeps_gallery(
        self, test_client, shared_test_session
    ):
        _, headers = self._make_admin(shared_test_session)
        post_id = test_client.post(
            "/api/blog",
            json={
                "title": "Keep Gallery",
                "images": [{"image_url": self._url("keep.jpg")}],
            },
            headers=headers,
        ).json()["id"]

        response = test_client.put(
            f"/api/blog/{post_id}",
            json={"title": "Keep Gallery Renamed"},
            headers=headers,
        )
        assert response.status_code == status.HTTP_200_OK
        assert len(response.json()["images"]) == 1

    def test_delete_post_cascades_images(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)
        post_id = test_client.post(
            "/api/blog",
            json={
                "title": "Cascade Gallery",
                "images": [{"image_url": self._url("cascade.jpg")}],
            },
            headers=headers,
        ).json()["id"]

        response = test_client.delete(f"/api/blog/{post_id}", headers=headers)
        assert response.status_code == status.HTTP_200_OK
        remaining = (
            shared_test_session.query(BlogPostImage)
            .filter(BlogPostImage.post_id == post_id)
            .count()
        )
        assert remaining == 0

    def test_reject_external_image_url(self, test_client, shared_test_session):
        """擋掉外部 hotlink，只收本站上傳的圖。"""
        _, headers = self._make_admin(shared_test_session)
        response = test_client.post(
            "/api/blog",
            json={
                "title": "External Image",
                "images": [{"image_url": "https://evil.example.com/x.png"}],
            },
            headers=headers,
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_image_limit_exceeded(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)
        response = test_client.post(
            "/api/blog",
            json={
                "title": "Too Many Images",
                "images": [
                    {"image_url": self._url(f"{i}.jpg")}
                    for i in range(MAX_POST_IMAGES + 1)
                ],
            },
            headers=headers,
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_delete_image_keeps_file_when_referenced(
        self, test_client, shared_test_session, monkeypatch
    ):
        """圖已插進內文 → 只移除圖庫列，雲端檔保留。"""
        _, headers = self._make_admin(shared_test_session)
        url = self._url("referenced.jpg")
        post_id = test_client.post(
            "/api/blog",
            json={
                "title": "Referenced Image",
                "content": f"內文有這張圖 ![x]({url})",
                "images": [{"image_url": url}],
            },
            headers=headers,
        ).json()["id"]
        image_id = test_client.get(f"/api/blog/{post_id}", headers=headers).json()[
            "images"
        ][0]["id"]

        calls = []
        monkeypatch.setattr(
            get_image_upload_service(),
            "delete_image",
            lambda u: calls.append(u) or True,
        )

        response = test_client.delete(
            f"/api/blog/{post_id}/images/{image_id}", headers=headers
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json() == {"deleted": True, "storage_deleted": False}
        assert calls == []
        assert (
            shared_test_session.query(BlogPostImage)
            .filter(BlogPostImage.id == image_id)
            .count()
            == 0
        )

    def test_delete_image_removes_file_when_unreferenced(
        self, test_client, shared_test_session, monkeypatch
    ):
        """圖沒被任何文章引用 → 連雲端檔一起刪。"""
        _, headers = self._make_admin(shared_test_session)
        url = self._url("orphan.jpg")
        post_id = test_client.post(
            "/api/blog",
            json={
                "title": "Orphan Image",
                "content": "內文沒有引用任何圖",
                "images": [{"image_url": url}],
            },
            headers=headers,
        ).json()["id"]
        image_id = test_client.get(f"/api/blog/{post_id}", headers=headers).json()[
            "images"
        ][0]["id"]

        calls = []
        monkeypatch.setattr(
            get_image_upload_service(),
            "delete_image",
            lambda u: calls.append(u) or True,
        )

        response = test_client.delete(
            f"/api/blog/{post_id}/images/{image_id}", headers=headers
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json() == {"deleted": True, "storage_deleted": True}
        assert calls == [url]

    def test_delete_image_not_found(self, test_client, shared_test_session):
        _, headers = self._make_admin(shared_test_session)
        post_id = test_client.post(
            "/api/blog", json={"title": "No Such Image"}, headers=headers
        ).json()["id"]
        response = test_client.delete(
            f"/api/blog/{post_id}/images/999999", headers=headers
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_removing_gallery_row_keeps_cover_image_url(
        self, test_client, shared_test_session, monkeypatch
    ):
        """移除圖庫列不會動到 cover_image_url（封面以該欄位為單一真相來源）。"""
        _, headers = self._make_admin(shared_test_session)
        url = self._url("cover.jpg")
        post_id = test_client.post(
            "/api/blog",
            json={
                "title": "Cover Independence",
                "cover_image_url": url,
                "images": [{"image_url": url}],
            },
            headers=headers,
        ).json()["id"]
        image_id = test_client.get(f"/api/blog/{post_id}", headers=headers).json()[
            "images"
        ][0]["id"]

        monkeypatch.setattr(get_image_upload_service(), "delete_image", lambda u: True)
        test_client.delete(f"/api/blog/{post_id}/images/{image_id}", headers=headers)

        data = test_client.get(f"/api/blog/{post_id}", headers=headers).json()
        assert data["cover_image_url"] == url
        assert data["images"] == []

    def test_images_require_admin(self, test_client, demo_teacher):
        token = create_access_token(
            data={"sub": str(demo_teacher.id), "type": "teacher"}
        )
        response = test_client.post(
            "/api/blog",
            json={"title": "Nope", "images": [{"image_url": self._url("n.jpg")}]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN
