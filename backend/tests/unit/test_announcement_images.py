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
