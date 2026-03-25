"""
Blog API integration tests.
Tests admin CRUD endpoints and public read endpoints.
"""

from fastapi import status
from models.blog import BlogPost, BlogCategory, BlogPostCategory
from auth import create_access_token, get_password_hash
from models import Teacher


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
