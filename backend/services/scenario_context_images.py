"""情境圖 → Gemini Part — Issue #1146。

情境對話的情境圖（``scenario_settings.scenario_images``，最多 5 張）要同時給
**AI 出題**（``services/scenario_dialogue_ai``）與 **AI 評分**
（``services/scenario_grading_ai``）看。兩邊把網址轉成 Part 的規則必須一致，所以
放在這一處。

只讀「我們自己存的圖」
----------------------

網址是前端送上來的（出題端點），不能照單全收：

* 直接下載任意網址 = SSRF（伺服器替別人打內網）。
* ``gs://`` 任意 bucket 交給 Vertex 讀，等於用我們的服務帳號權限去讀別的 bucket。

所以只接受兩種來源，其餘一律略過（記 log，不讓整次出題失敗 —— 少一張圖仍可出題）：

1. 圖片上傳服務的 GCS bucket 的 ``images/`` 前綴（``storage.googleapis.com/<我們的 bucket>/images/...``）
   → ``Part.from_uri``，Vertex 直接讀，不經過我們下載。
2. 本機開發模式（沒有用 GCS）存在 ``/static/images/<檔名>`` 的檔案 → 直接從本機
   目錄讀檔（不發 HTTP 請求）。正式環境不接受這種網址。
"""

import logging
import os
from typing import Any, List, Optional
from urllib.parse import urlparse

from utils.scenario_dialogue import MAX_SCENARIO_IMAGES, classify_own_image_url

logger = logging.getLogger(__name__)

EXTENSION_TO_MIME = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif",
    "webp": "image/webp",
}
_DEFAULT_MIME = "image/jpeg"


def image_mime_for_url(url: str) -> str:
    """從網址副檔名推出圖片格式（上傳時就是依 content_type 決定副檔名的）。"""
    path = urlparse(url or "").path
    _, dot, ext = path.rpartition(".")
    if not dot or "/" in ext:
        return _DEFAULT_MIME
    return EXTENSION_TO_MIME.get(ext.lower(), _DEFAULT_MIME)


def resolve_image_source(
    url: str, bucket_name: str, use_gcs: bool = True
) -> Optional[tuple]:
    """判斷網址可以怎麼讀。

    回傳 ``("gcs", "gs://bucket/images/...")``、``("local", "<檔名>")`` 或 ``None``（不接受）。
    規則與存檔正規化共用 :func:`utils.scenario_dialogue.classify_own_image_url`：
    GCS 只收本站 bucket 的 ``images/`` 前綴；本機 static 只在沒有用 GCS 時接受。
    純函式，方便單元測試；實際讀取在 :func:`build_image_parts`。
    """
    return classify_own_image_url(url, bucket_name, use_gcs)


def build_image_parts(urls: Optional[List[str]]) -> List[Any]:
    """情境圖網址 → Gemini Part 清單（最多 MAX_SCENARIO_IMAGES 張）。

    讀不到的圖略過而不是丟錯：少一張情境圖，出題與評分仍然可以進行；整次失敗的話
    老師或學生什麼都拿不到。
    """
    if not urls:
        return []
    from vertexai.generative_models import Part

    from services.image_upload import get_image_upload_service

    uploader = get_image_upload_service()
    parts: List[Any] = []
    for url in urls[:MAX_SCENARIO_IMAGES]:
        source = resolve_image_source(url, uploader.bucket_name, uploader.use_gcs)
        if source is None:
            logger.warning("scenario_context_images | 略過非本站圖片：%s", url)
            continue
        kind, ref = source
        mime = image_mime_for_url(url)
        try:
            if kind == "gcs":
                parts.append(Part.from_uri(ref, mime_type=mime))
            else:
                local_path = os.path.join(uploader.local_image_dir, ref)
                with open(local_path, "rb") as f:
                    parts.append(Part.from_data(data=f.read(), mime_type=mime))
        except Exception:
            logger.warning("scenario_context_images | 讀圖失敗：%s", url, exc_info=True)
    return parts
