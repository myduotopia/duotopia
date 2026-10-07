"""圖片格式偵測（以 magic bytes 判斷，不信任 Content-Type / 副檔名）。

blog 與更新公告（#1100）的圖片上傳共用。
"""

from typing import Optional, Tuple

_IMAGE_SIGNATURES = {
    b"\xff\xd8\xff": ("image/jpeg", "jpg"),
    b"\x89PNG\r\n\x1a\n": ("image/png", "png"),
    b"GIF87a": ("image/gif", "gif"),
    b"GIF89a": ("image/gif", "gif"),
    b"RIFF": ("image/webp", "webp"),  # RIFF....WEBP (checked with extra logic)
}


def detect_image_type(content: bytes) -> Optional[Tuple[str, str]]:
    """Detect image type from magic bytes. Returns (mime_type, extension) or None."""
    for sig, result in _IMAGE_SIGNATURES.items():
        if content.startswith(sig):
            # Extra check for WEBP: RIFF header must also contain WEBP
            if sig == b"RIFF" and content[8:12] != b"WEBP":
                continue
            return result
    return None
