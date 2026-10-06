"""services.announcement_images 測試（issue #1100）。

公告圖片只信任我們自己的 GCS bucket；在 GitHub 網頁直接貼圖產生的
user-attachments 網址，建立草稿時轉存到 GCS。下載只允許 GitHub 圖片網域
（含 redirect 目的地），防止 SSRF。
"""

import httpx
import pytest

from services import announcement_images as ai

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
GIF = b"GIF89a" + b"0" * 64
TRUSTED = "https://storage.googleapis.com/duotopia-audio/announcements/issue-1/a.png"
GH = "https://github.com/user-attachments/assets/1a2b3c4d-0000-1111-2222-333344445555"


class TestUrlPolicy:
    def test_trusted_bucket(self):
        assert ai.is_trusted_image_url(TRUSTED)
        assert not ai.is_trusted_image_url("https://evil.example.com/a.png")
        assert not ai.is_trusted_image_url(
            "https://storage.googleapis.com/other-bucket/a.png"
        )
        # 只信任公告圖片資料夾，不是整個 bucket（bucket 內還有學生錄音等）
        assert not ai.is_trusted_image_url(
            "https://storage.googleapis.com/duotopia-audio/recordings/x.webm"
        )

    @pytest.mark.parametrize(
        "url, expected",
        [
            (GH, True),
            ("https://user-images.githubusercontent.com/1/abc.png", True),
            ("https://private-user-images.githubusercontent.com/1/abc.png?jwt=x", True),
            ("https://github.com/myduotopia/duotopia", False),
            ("http://github.com/user-attachments/assets/x", False),
            ("https://github.com.evil.com/user-attachments/assets/x", False),
            ("https://169.254.169.254/latest/meta-data", False),
            ("https://evil.com/?u=github.com/user-attachments/", False),
            # camo 是 GitHub 的圖片代理，會代抓任意外部網址 → 不能列入白名單
            ("https://camo.githubusercontent.com/abc/68747470", False),
        ],
    )
    def test_github_image_url(self, url, expected):
        assert ai.is_github_image_url(url) is expected


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class TestFetchGithubImage:
    @pytest.mark.asyncio
    async def test_follows_redirect_to_github_cdn(self):
        def handler(request):
            if request.url.host == "github.com":
                return httpx.Response(
                    302,
                    headers={
                        "location": "https://private-user-images.githubusercontent.com/1/x.png?jwt=t"
                    },
                )
            return httpx.Response(200, content=PNG)

        async with _client(handler) as client:
            data, mime, ext = await ai.fetch_github_image(GH, client=client)
        assert (mime, ext) == ("image/png", "png")
        assert data == PNG

    @pytest.mark.asyncio
    async def test_refuses_redirect_outside_github(self):
        def handler(request):
            return httpx.Response(
                302, headers={"location": "http://169.254.169.254/latest/meta-data"}
            )

        async with _client(handler) as client:
            with pytest.raises(ai.AnnouncementImageError):
                await ai.fetch_github_image(GH, client=client)

    @pytest.mark.asyncio
    async def test_refuses_non_github_url_without_request(self):
        def handler(request):  # pragma: no cover - 不應該被呼叫
            raise AssertionError("should not fetch")

        async with _client(handler) as client:
            with pytest.raises(ai.AnnouncementImageError):
                await ai.fetch_github_image("https://evil.com/a.png", client=client)

    @pytest.mark.asyncio
    async def test_rejects_non_image_and_oversize(self):
        async with _client(lambda r: httpx.Response(200, content=b"<html>")) as c:
            with pytest.raises(ai.AnnouncementImageError):
                await ai.fetch_github_image(GH, client=c)

        big = PNG + b"0" * (ai.MAX_IMAGE_BYTES + 1)
        async with _client(lambda r: httpx.Response(200, content=big)) as c:
            with pytest.raises(ai.AnnouncementImageError):
                await ai.fetch_github_image(GH, client=c)


class TestStoreAnnouncementImage:
    def test_local_mode_uses_shared_storage(self, monkeypatch):
        class FakeService:
            use_gcs = False

            def store_image_bytes(self, content, content_type):
                return f"/static/images/x.{content_type.split('/')[1]}"

        monkeypatch.setattr(ai, "get_image_upload_service", lambda: FakeService())
        assert ai.store_announcement_image(PNG, "image/png", "png") == (
            "/static/images/x.png"
        )

    def test_gcs_mode_writes_announcements_prefix(self, monkeypatch):
        uploaded = {}

        class Blob:
            def __init__(self, name):
                self.name = name

            def upload_from_string(self, content, content_type):
                uploaded[self.name] = content_type

        class Bucket:
            def blob(self, name):
                return Blob(name)

        class Client:
            def bucket(self, name):
                assert name == "duotopia-audio"
                return Bucket()

        class FakeService:
            use_gcs = True
            bucket_name = "duotopia-audio"

            def _get_storage_client(self):
                return Client()

        monkeypatch.setattr(ai, "get_image_upload_service", lambda: FakeService())
        monkeypatch.setenv("ENVIRONMENT", "staging")
        url = ai.store_announcement_image(PNG, "image/png", "png")
        (name,) = uploaded
        assert name.startswith("announcements/staging/") and name.endswith(".png")
        assert url == f"https://storage.googleapis.com/duotopia-audio/{name}"


class TestRehostContentImages:
    @staticmethod
    def _fakes(data=PNG, mime="image/png", ext="png", fail=False):
        stored = []

        async def fetch(url):
            if fail:
                raise ai.AnnouncementImageError("boom")
            return data, mime, ext

        def store(content, content_type, extension):
            stored.append((content_type, extension))
            return f"https://storage.googleapis.com/duotopia-audio/announcements/x/{len(stored)}.{extension}"

        return fetch, store, stored

    @pytest.mark.asyncio
    async def test_rehosts_github_hero_and_body_images(self):
        fetch, store, stored = self._fakes()
        content = {
            "image_url": GH,
            "article_body_zh": f"說明\n\n![步驟]({GH})\n\n"
            f'<img width="300" alt="x" src="{GH}">',
            "article_body_en": f"![trusted]({TRUSTED})",
        }
        result, warnings = await ai.rehost_content_images(
            content, fetch=fetch, store=store
        )
        assert result["image_url"].startswith(
            "https://storage.googleapis.com/duotopia-audio/"
        )
        assert GH not in result["article_body_zh"]
        assert result["article_body_zh"].count("storage.googleapis.com") == 2
        assert result["article_body_en"] == f"![trusted]({TRUSTED})"
        assert warnings == []
        # 同一張 GitHub 圖只下載、儲存一次
        assert len(stored) == 1

    @pytest.mark.asyncio
    async def test_trusted_hero_kept_untrusted_hero_dropped(self):
        fetch, store, _ = self._fakes()
        kept, _ = await ai.rehost_content_images(
            {"image_url": TRUSTED}, fetch=fetch, store=store
        )
        assert kept["image_url"] == TRUSTED

        dropped, warnings = await ai.rehost_content_images(
            {"image_url": "https://evil.example.com/a.png"}, fetch=fetch, store=store
        )
        assert "image_url" not in dropped
        assert warnings

    @pytest.mark.asyncio
    async def test_hero_must_be_jpeg_or_png(self):
        fetch, store, _ = self._fakes(data=GIF, mime="image/gif", ext="gif")
        result, warnings = await ai.rehost_content_images(
            {"image_url": GH}, fetch=fetch, store=store
        )
        assert "image_url" not in result
        assert any("JPEG" in w for w in warnings)

    @pytest.mark.asyncio
    async def test_hero_over_1mb_is_dropped(self):
        """LINE hero 圖片保守限制 1 MB；內文圖片仍可到 10 MB"""
        big = PNG + b"0" * ai.HERO_MAX_BYTES
        fetch, store, _ = self._fakes(data=big)
        result, warnings = await ai.rehost_content_images(
            {"image_url": GH, "article_body_zh": f"![a]({GH})"},
            fetch=fetch,
            store=store,
        )
        assert "image_url" not in result
        assert any("1 MB" in w for w in warnings)
        assert "storage.googleapis.com" in result["article_body_zh"]

    @pytest.mark.asyncio
    async def test_replacement_does_not_touch_longer_urls(self):
        """只換整個網址，不會把以它為前綴的另一個網址改壞"""
        longer = GH + "-v2"
        stored = {}

        async def fetch(url):
            return PNG, "image/png", "png"

        def store(content, content_type, extension):
            url = f"https://storage.googleapis.com/duotopia-audio/announcements/{len(stored)}.png"
            stored[url] = True
            return url

        body = f"![a]({GH})\n\n![b]({longer})"
        result, _ = await ai.rehost_content_images(
            {"article_body_zh": body}, fetch=fetch, store=store
        )
        new_body = result["article_body_zh"]
        assert GH not in new_body
        assert "-v2" not in new_body
        assert len(stored) == 2

    @pytest.mark.asyncio
    async def test_rehosts_at_most_10_images(self):
        """每則草稿最多轉存 10 張，避免 webhook 逾時；其餘保留原網址並警告"""
        fetch, store, stored = self._fakes()
        urls = [f"{GH}{i:02d}" for i in range(12)]
        body = "\n\n".join(f"![{i}]({u})" for i, u in enumerate(urls))
        result, warnings = await ai.rehost_content_images(
            {"article_body_zh": body}, fetch=fetch, store=store
        )
        assert len(stored) == ai.MAX_REHOST_IMAGES == 10
        assert result["article_body_zh"].count(GH) == 2
        assert any("10" in w for w in warnings)

    @pytest.mark.asyncio
    async def test_failed_download_keeps_draft_going(self):
        fetch, store, _ = self._fakes(fail=True)
        result, warnings = await ai.rehost_content_images(
            {"image_url": GH, "article_body_zh": f"![a]({GH})"},
            fetch=fetch,
            store=store,
        )
        assert "image_url" not in result
        # 內文圖片轉存失敗時保留原網址（至少在 GitHub 公開 repo 上看得到）
        assert result["article_body_zh"] == f"![a]({GH})"
        assert len(warnings) == 2
