"""
Unit tests for SEO endpoints (robots.txt, sitemap-index, sitemap-static).
These endpoints have no database dependency.
"""

from unittest.mock import patch

from fastapi import status
from fastapi.testclient import TestClient

from routers.public import router, SITE_DOMAIN

# Minimal app for testing SEO endpoints (no DB needed)
from fastapi import FastAPI

_app = FastAPI()
_app.include_router(router)
client = TestClient(_app)


class TestRobotsTxt:
    """Test robots.txt endpoint."""

    def test_production_allows_public(self):
        with patch.dict("os.environ", {"ENVIRONMENT": "production"}):
            response = client.get("/api/public/robots.txt")
        assert response.status_code == status.HTTP_200_OK
        assert "text/plain" in response.headers.get("content-type", "")
        assert "Allow: /" in response.text

    def test_production_disallows_private_paths(self):
        with patch.dict("os.environ", {"ENVIRONMENT": "production"}):
            response = client.get("/api/public/robots.txt")
        assert "Disallow: /api/" in response.text
        assert "Disallow: /teacher/" in response.text
        assert "Disallow: /student/" in response.text
        assert "Disallow: /admin/" in response.text
        assert "Disallow: /organization/" in response.text

    def test_production_includes_sitemap(self):
        with patch.dict("os.environ", {"ENVIRONMENT": "production"}):
            response = client.get("/api/public/robots.txt")
        assert "Sitemap:" in response.text
        assert "sitemap-index.xml" in response.text

    def test_production_has_cache_control(self):
        with patch.dict("os.environ", {"ENVIRONMENT": "production"}):
            response = client.get("/api/public/robots.txt")
        assert "max-age=3600" in response.headers.get("cache-control", "")

    def test_staging_disallows_all(self):
        with patch.dict("os.environ", {"ENVIRONMENT": "staging"}):
            response = client.get("/api/public/robots.txt")
        assert response.status_code == status.HTTP_200_OK
        assert response.text.strip() == "User-agent: *\nDisallow: /"

    def test_develop_disallows_all(self):
        with patch.dict("os.environ", {"ENVIRONMENT": "develop"}):
            response = client.get("/api/public/robots.txt")
        assert response.status_code == status.HTTP_200_OK
        assert response.text.strip() == "User-agent: *\nDisallow: /"


class TestSitemapIndex:
    """Test sitemap index endpoint."""

    def test_returns_valid_xml(self):
        response = client.get("/api/public/sitemap-index.xml")
        assert response.status_code == status.HTTP_200_OK
        assert "xml" in response.headers.get("content-type", "")

    def test_references_sub_sitemaps(self):
        response = client.get("/api/public/sitemap-index.xml")
        assert "sitemapindex" in response.text
        assert "sitemap-static.xml" in response.text
        assert "blog/sitemap.xml" in response.text

    def test_uses_correct_domain(self):
        response = client.get("/api/public/sitemap-index.xml")
        assert SITE_DOMAIN in response.text

    def test_has_cache_control(self):
        response = client.get("/api/public/sitemap-index.xml")
        assert "max-age=3600" in response.headers.get("cache-control", "")


class TestSitemapStatic:
    """Test static pages sitemap endpoint."""

    def test_returns_valid_xml(self):
        response = client.get("/api/public/sitemap-static.xml")
        assert response.status_code == status.HTTP_200_OK
        assert "xml" in response.headers.get("content-type", "")

    def test_contains_public_pages(self):
        response = client.get("/api/public/sitemap-static.xml")
        text = response.text
        assert f"{SITE_DOMAIN}/</loc>" in text
        assert f"{SITE_DOMAIN}/pricing</loc>" in text
        assert f"{SITE_DOMAIN}/blog</loc>" in text
        assert f"{SITE_DOMAIN}/terms</loc>" in text
        assert f"{SITE_DOMAIN}/privacy</loc>" in text

    def test_has_valid_structure(self):
        response = client.get("/api/public/sitemap-static.xml")
        text = response.text
        assert '<?xml version="1.0"' in text
        assert "<urlset" in text
        assert "<loc>" in text
        assert "<lastmod>" in text
        assert "<changefreq>" in text
        assert "<priority>" in text

    def test_has_cache_control(self):
        response = client.get("/api/public/sitemap-static.xml")
        assert "max-age=3600" in response.headers.get("cache-control", "")

    def test_excludes_private_routes(self):
        response = client.get("/api/public/sitemap-static.xml")
        text = response.text
        assert "/teacher/" not in text
        assert "/student/" not in text
        assert "/admin/" not in text
        assert "/dashboard" not in text
