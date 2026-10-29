"""
上傳題本：從頁圖裁出題目用的圖（Issue #1112 C4，cold-read B1「裁圖改後端」）。

裁哪些（座標都是 AI 回的 ``[ymin, xmin, ymax, xmax]``，0–1000，相對那一頁）：
- 題目 ``stem_box_2d`` → ``question["image_url"]``（題幹圖）
- 題目 ``option_boxes[i]`` → ``question["option_image_urls"][i]``（圖片選項；沒框的位置 None）
- 題組 ``stimulus.kind == "image"`` 的 ``stimulus.box_2d`` → ``stimulus["image_url"]``（以圖為準題組）
- 題組 ``stimulus.figures[i].box_2d`` → ``figures[i]["url"]``（文章插圖）
題目卡本身的 ``bbox``（整題位置）不裁：「原卷這一題的截圖」由前端用頁圖顯示即可。

**什麼時候裁**
1. 寫入一頁結果時（``attach_crops``）：AI 回來後、拿鎖之前，用手上的頁圖 bytes 裁，結果直接寫在卡上，
   前端編輯（QuestionCard／GroupCard）拿到的就是一般圖片網址，略過核對也不用等前端。
2. 存入時補裁（``ensure_crops``）：卡上有框、但沒有對應網址欄位（寫入時裁失敗、或 C3 之前的舊草稿）
   → 讀回存好的頁圖再裁一次；還是失敗就寫 None（沒有圖），不擋存入（驗證會照規則判斷缺不缺內容）。

欄位「存在」才算處理過：``"image_url" in question``。值為 None ＝ 沒有圖（裁不出來，或老師刪掉了）。
老師在編輯時換圖／刪圖，前端 PATCH 直接給這些欄位（``exam_import_edit``），之後不再自動裁。
"""

from __future__ import annotations

import io
import logging
from typing import Any, Callable, Dict, Iterable, List, Optional

from services import exam_import_storage
from services.exam_paper_cards import CARD_KIND_GROUP, iter_card_questions

logger = logging.getLogger(__name__)

BOX_SCALE = 1000
CROP_MIME = "image/png"


class PageImage:
    """一頁頁圖（解碼一次、裁很多張）。打不開（格式不對）時 ``crop`` 一律回 None。"""

    def __init__(self, image_bytes: Optional[bytes]):
        self._img = None
        if not image_bytes:
            return
        try:
            from PIL import Image

            img = Image.open(io.BytesIO(image_bytes))
            img.load()
            self._img = img.convert("RGB")
        except Exception as e:  # 壞圖、格式不支援：當作裁不出來
            logger.info("[exam-import] page image not decodable: %s", e)

    def crop(self, box: Any) -> Optional[bytes]:
        if self._img is None or not isinstance(box, (list, tuple)) or len(box) != 4:
            return None
        try:
            ymin, xmin, ymax, xmax = (min(BOX_SCALE, max(0.0, float(v))) for v in box)
        except (TypeError, ValueError):
            return None
        w, h = self._img.size
        left, right = round(xmin / BOX_SCALE * w), round(xmax / BOX_SCALE * w)
        top, bottom = round(ymin / BOX_SCALE * h), round(ymax / BOX_SCALE * h)
        if right - left < 1 or bottom - top < 1:
            return None
        out = io.BytesIO()
        self._img.crop((left, top, right, bottom)).save(out, format="PNG")
        return out.getvalue()


Uploader = Callable[[bytes], Optional[str]]


def _upload(content: bytes) -> Optional[str]:
    try:
        return exam_import_storage.store_crop_image(content, CROP_MIME)
    except Exception as e:  # 上傳失敗：這張圖先沒有，存入時再補裁
        logger.warning("[exam-import] crop upload failed: %s", e)
        return None


def _crop_url(page: PageImage, box: Any, upload: Uploader) -> Optional[str]:
    data = page.crop(box)
    return upload(data) if data else None


def crop_card(
    card: Dict[str, Any],
    page_no: int,
    page: PageImage,
    *,
    final: bool,
    upload: Uploader = _upload,
) -> int:
    """裁這張卡在第 ``page_no`` 頁上、還沒處理過的框。``final`` = True 時裁不出來也寫 None（不再試）。
    回傳裁出幾張。"""
    made = 0

    def put(target: Dict[str, Any], key: str, box: Any) -> None:
        nonlocal made
        if key in target or not box:
            return
        url = _crop_url(page, box, upload)
        if url or final:
            target[key] = url
        made += 1 if url else 0

    for q in iter_card_questions(card):
        if (q.get("page_no") or card.get("page_no")) != page_no:
            continue
        put(q, "image_url", q.get("stem_box_2d"))
        boxes = q.get("option_boxes") or []
        if "option_image_urls" not in q and any(boxes):
            urls = [_crop_url(page, b, upload) if b else None for b in boxes]
            made += sum(1 for u in urls if u)
            if final or all(u for u, b in zip(urls, boxes) if b):
                q["option_image_urls"] = urls
    if card.get("kind") == CARD_KIND_GROUP and card.get("page_no") == page_no:
        stim = (card.get("group") or {}).get("stimulus") or {}
        if stim.get("kind") == "image":
            put(stim, "image_url", stim.get("box_2d"))
        for fig in stim.get("figures") or []:
            put(fig, "url", fig.get("box_2d"))
    return made


def card_needs_crops(card: Dict[str, Any]) -> Iterable[int]:
    """這張卡還有哪幾頁的框沒處理過（存入前補裁用）。"""
    pages = set()
    for q in iter_card_questions(card):
        no = q.get("page_no") or card.get("page_no")
        if (q.get("stem_box_2d") and "image_url" not in q) or (
            any(q.get("option_boxes") or []) and "option_image_urls" not in q
        ):
            pages.add(no)
    if card.get("kind") == CARD_KIND_GROUP:
        stim = (card.get("group") or {}).get("stimulus") or {}
        if (
            stim.get("kind") == "image"
            and stim.get("box_2d")
            and "image_url" not in stim
        ):
            pages.add(card.get("page_no"))
        if any(f.get("box_2d") and "url" not in f for f in stim.get("figures") or []):
            pages.add(card.get("page_no"))
    return sorted(p for p in pages if p)


def attach_crops(cards: List[Dict[str, Any]], page_no: int, image_bytes: bytes) -> int:
    """寫入一頁結果前：裁這一頁所有卡的圖（失敗的留給存入時補裁）。回傳裁出幾張。"""
    if not any(card_needs_crops(c) for c in cards):
        return 0
    page = PageImage(image_bytes)
    return sum(crop_card(c, page_no, page, final=False) for c in cards)


def ensure_crops(
    import_id: int,
    card: Dict[str, Any],
    page_image_urls: Dict[int, Optional[str]],
    cache: Dict[int, PageImage],
) -> None:
    """存入前補裁：讀回存好的頁圖（同一批存入共用 ``cache``），裁不出來寫 None。"""
    for no in card_needs_crops(card):
        if no not in cache:
            loaded = exam_import_storage.read_page_image(
                import_id, page_image_urls.get(no) or ""
            )
            cache[no] = PageImage(loaded[0] if loaded else None)
        crop_card(card, no, cache[no], final=True)
