"""更新公告圖片（issue #1100）。

規則：
- 公告圖片只信任我們自己的 GCS bucket（`storage.googleapis.com/<bucket>/`）
- 在 GitHub 網頁直接貼圖產生的 user-attachments 網址，建立草稿時轉存到 GCS；
  下載只允許 GitHub 圖片網域（每一次 redirect 的目的地都檢查），防止 SSRF
- 主圖（LINE hero）只接受 JPEG / PNG；內文圖片不限
- 轉存失敗不擋草稿：主圖改用預設圖、內文保留原網址，並回傳警告供記錄
"""

import logging
import os
import re
import uuid
from datetime import datetime
from typing import Awaitable, Callable, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import httpx

from services.image_upload import get_image_upload_service
from utils.image_types import detect_image_type

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 10 * 1024 * 1024
HERO_MIME_TYPES = ("image/jpeg", "image/png")
_MAX_REDIRECTS = 3
_FETCH_TIMEOUT = 15.0

_GITHUB_IMAGE_HOSTS = (
    "user-images.githubusercontent.com",
    "private-user-images.githubusercontent.com",
    "objects.githubusercontent.com",
    "camo.githubusercontent.com",
)
_BODY_FIELDS = ("article_body_zh", "article_body_en")
_MD_IMAGE_RE = re.compile(r"(!\[[^\]]*\]\(\s*<?)([^)\s>]+)(>?[^)]*\))")
_HTML_IMG_RE = re.compile(r"""(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'])""", re.I)

Fetcher = Callable[[str], Awaitable[Tuple[bytes, str, str]]]
Storer = Callable[[bytes, str, str], str]


class AnnouncementImageError(Exception):
    """圖片無法下載 / 驗證 / 儲存。"""


def _bucket_name() -> str:
    return os.getenv("GCS_BUCKET_NAME", "duotopia-audio")


def is_trusted_image_url(url: str) -> bool:
    return (url or "").startswith(f"https://storage.googleapis.com/{_bucket_name()}/")


def is_github_image_url(url: str) -> bool:
    parsed = urlparse(url or "")
    if parsed.scheme != "https":
        return False
    host = (parsed.hostname or "").lower()
    if host == "github.com":
        return parsed.path.startswith("/user-attachments/")
    return host in _GITHUB_IMAGE_HOSTS


async def fetch_github_image(
    url: str, *, client: Optional[httpx.AsyncClient] = None
) -> Tuple[bytes, str, str]:
    """下載 GitHub 圖片；redirect 逐跳檢查網域，大小與格式都驗證。"""
    if not is_github_image_url(url):
        raise AnnouncementImageError(f"不允許下載的網址：{url}")

    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=_FETCH_TIMEOUT)
    try:
        current = url
        for _ in range(_MAX_REDIRECTS + 1):
            async with client.stream("GET", current, follow_redirects=False) as resp:
                if resp.status_code in (301, 302, 303, 307, 308):
                    current = urljoin(current, resp.headers.get("location", ""))
                    if not is_github_image_url(current):
                        raise AnnouncementImageError(f"redirect 到不允許的網址：{current}")
                    continue
                if resp.status_code != 200:
                    raise AnnouncementImageError(f"下載失敗（HTTP {resp.status_code}）")
                data = bytearray()
                async for chunk in resp.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > MAX_IMAGE_BYTES:
                        raise AnnouncementImageError("圖片超過 10 MB")
                detected = detect_image_type(bytes(data))
                if not detected:
                    raise AnnouncementImageError("下載內容不是圖片")
                return bytes(data), detected[0], detected[1]
        raise AnnouncementImageError("redirect 次數過多")
    except httpx.HTTPError as exc:
        raise AnnouncementImageError(f"下載失敗：{exc}") from exc
    finally:
        if owns_client:
            await client.aclose()


def store_announcement_image(content: bytes, content_type: str, extension: str) -> str:
    """存到 GCS `announcements/<env>/`，回傳公開網址（本機開發退回共用的儲存路徑）。"""
    service = get_image_upload_service()
    if not service.use_gcs:
        return service.store_image_bytes(content, content_type)

    environment = os.getenv("ENVIRONMENT", "development")
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    blob_name = f"announcements/{environment}/{stamp}_{uuid.uuid4().hex}.{extension}"
    client = service._get_storage_client()
    if not client:
        raise AnnouncementImageError("GCS client initialization failed")
    blob = client.bucket(service.bucket_name).blob(blob_name)
    blob.upload_from_string(content, content_type=content_type)
    return f"https://storage.googleapis.com/{service.bucket_name}/{blob_name}"


async def rehost_content_images(
    content: Dict[str, Optional[str]],
    *,
    fetch: Optional[Fetcher] = None,
    store: Optional[Storer] = None,
) -> Tuple[Dict[str, Optional[str]], List[str]]:
    """把公告內容裡的 GitHub 圖片轉存到 GCS，回傳（新內容, 警告）。"""
    fetch = fetch or fetch_github_image
    store = store or store_announcement_image
    result = dict(content)
    warnings: List[str] = []
    cache: Dict[str, Tuple[str, str]] = {}  # GitHub 網址 → (GCS 網址, mime)

    async def rehost(url: str) -> Tuple[str, str]:
        if url not in cache:
            data, mime, ext = await fetch(url)
            cache[url] = (store(data, mime, ext), mime)
        return cache[url]

    hero = (result.get("image_url") or "").strip()
    result.pop("image_url", None)
    if hero:
        if is_trusted_image_url(hero):
            result["image_url"] = hero
        elif is_github_image_url(hero):
            try:
                stored_url, mime = await rehost(hero)
                if mime in HERO_MIME_TYPES:
                    result["image_url"] = stored_url
                else:
                    warnings.append(f"主圖只能是 JPEG / PNG（目前 {mime}），改用預設圖")
            except AnnouncementImageError as exc:
                warnings.append(f"主圖轉存失敗，改用預設圖：{exc}")
        else:
            warnings.append(f"主圖網址不是本站圖片，改用預設圖：{hero}")

    for field in _BODY_FIELDS:
        body = result.get(field)
        if not body:
            continue
        for pattern in (_MD_IMAGE_RE, _HTML_IMG_RE):
            for match in list(pattern.finditer(body)):
                url = match.group(2)
                if not is_github_image_url(url):
                    continue
                try:
                    stored_url, _ = await rehost(url)
                    body = body.replace(url, stored_url)
                except AnnouncementImageError as exc:
                    warnings.append(f"內文圖片轉存失敗，保留原網址：{exc}")
        result[field] = body

    for warning in warnings:
        logger.warning("更新公告圖片：%s", warning)
    return result, warnings
