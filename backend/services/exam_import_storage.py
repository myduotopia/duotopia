"""
上傳題本頁圖儲存（Issue #1112 C2）。

每頁圖片送出擷取時就存起來（續做、整頁對照、單題截圖用），路徑含匯入 id：
``exam_imports/{environment}/{import_id}/page_{n}_{uuid}.{ext}``。放棄匯入時依前綴整批刪除。

「空白頁仍要送出這一頁」用 ``read_page_image`` 讀回存好的頁圖（只讀這份匯入前綴下的檔）。

沿用 ``services/image_upload.ImageUploadService`` 的 GCS 認證、bucket、``USE_GCS_STORAGE``
本機模式設定，不另做一套。

TODO(#1112 清理排程，另議)：目前**沒有**自動清理。超過 30 天的未完成匯入只是不顯示、不擋重新上傳，
頁圖仍留在 GCS；放棄匯入時刪除失敗也只記 log。之後要加排程：清掉過期匯入的頁圖，並重刪放棄時
沒刪成功的前綴。
"""

from __future__ import annotations

import logging
import os
import shutil
import uuid
from typing import Optional, Tuple
from urllib.parse import unquote, urlparse

from services.image_upload import get_image_upload_service

logger = logging.getLogger(__name__)

_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
_MIME = {ext: mime for mime, ext in _EXT.items()}
_PREFIX = "exam_imports"


def _local_dir(import_id: int) -> str:
    svc = get_image_upload_service()
    return os.path.join(svc.local_image_dir, _PREFIX, str(import_id))


def _gcs_prefix(import_id: int) -> str:
    svc = get_image_upload_service()
    return f"{_PREFIX}/{svc.environment}/{import_id}/"


def store_page_image(
    import_id: int, page_no: int, content: bytes, content_type: str
) -> str:
    """存一頁頁圖，回傳公開網址。同一頁重送會產生新檔（舊網址由呼叫端換掉）。"""
    svc = get_image_upload_service()
    ext = _EXT.get(content_type, "png")
    filename = f"page_{page_no}_{uuid.uuid4().hex}.{ext}"
    if svc.use_gcs:
        client = svc._get_storage_client()
        if not client:
            raise RuntimeError("GCS client initialization failed")
        blob = client.bucket(svc.bucket_name).blob(_gcs_prefix(import_id) + filename)
        blob.upload_from_string(content, content_type=content_type)
        blob.make_public()
        return blob.public_url
    folder = _local_dir(import_id)
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, filename), "wb") as f:
        f.write(content)
    backend_url = svc.backend_url or "http://localhost:8080"
    return f"{backend_url}/static/images/{_PREFIX}/{import_id}/{filename}"


def read_page_image(import_id: int, image_url: str) -> Optional[Tuple[bytes, str]]:
    """讀回存好的頁圖（空白頁「仍要送出這一頁」用，不必請老師重選檔案）。回傳 (內容, mime)；
    網址不屬於這份匯入、或檔案不見了回 None。"""
    svc = get_image_upload_service()
    filename = os.path.basename(unquote(urlparse(image_url or "").path))
    mime = _MIME.get(filename.rsplit(".", 1)[-1].lower()) if filename else None
    if not mime or not filename.startswith("page_"):
        return None
    try:
        if svc.use_gcs:
            client = svc._get_storage_client()
            if not client:
                return None
            blob = client.bucket(svc.bucket_name).blob(
                _gcs_prefix(import_id) + filename
            )
            if not blob.exists():
                return None
            return blob.download_as_bytes(), mime
        path = os.path.join(_local_dir(import_id), filename)
        if not os.path.isfile(path):
            return None
        with open(path, "rb") as f:
            return f.read(), mime
    except Exception as e:
        logger.warning(
            "[exam-import] read page image failed import=%s: %s", import_id, e
        )
        return None


def delete_import_images(import_id: int) -> int:
    """刪除這份匯入的所有頁圖（放棄匯入時）。回傳刪了幾個檔；失敗只記 log，不中斷放棄流程。"""
    svc = get_image_upload_service()
    try:
        if svc.use_gcs:
            client = svc._get_storage_client()
            if not client:
                return 0
            bucket = client.bucket(svc.bucket_name)
            blobs = list(bucket.list_blobs(prefix=_gcs_prefix(import_id)))
            for blob in blobs:
                blob.delete()
            return len(blobs)
        folder = _local_dir(import_id)
        if not os.path.isdir(folder):
            return 0
        count = len(os.listdir(folder))
        shutil.rmtree(folder, ignore_errors=True)
        return count
    except Exception as e:  # 刪不掉不影響放棄；目前沒有排程補刪（見模組說明的 TODO）
        logger.warning("[exam-import] delete images failed import=%s: %s", import_id, e)
        return 0


def store_crop_image(content: bytes, content_type: str) -> str:
    """存一張從頁圖裁下來的圖（題幹圖、選項圖、題組主圖、文章插圖；C4 cold-read B1），回傳公開網址。

    走一般圖片路徑（``ImageUploadService.store_image_bytes``，``images/{environment}/…``），
    **不放在匯入前綴下**：這些網址會寫進存入題庫的題目，放棄匯入（刪匯入前綴）時不能跟著刪
    （cold-read B7：已存入的題目保留）。沒存入就放棄時留下的裁圖目前不清，見上方清理 TODO。
    """
    svc = get_image_upload_service()
    return svc.store_image_bytes(content, content_type)
