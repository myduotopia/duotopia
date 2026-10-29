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
2. 存入時補裁（``precrop`` → ``apply_crops``）：卡上有框、但沒有對應網址欄位（寫入時裁失敗、或 C3
   之前的舊草稿）→ **在匯入鎖外**讀回存好的頁圖再裁一次、上傳，結果記成「(頁, 框) → 網址」表；
   拿鎖後只查表寫回卡片（鎖內不碰 GCS，C4a 審查 3）。還是失敗就寫 None（沒有圖），不擋存入
   （驗證會照規則判斷缺不缺內容）。表裡沒有的框（鎖外裁完之後才出現，例如鎖內才併進來的延續頁）
   這次不動、欄位留空，下次存入再補裁。

每個框屬於哪一頁：題目看 ``question.page_no``；跨頁合併進來的插圖／主圖看 ``figure.page_no``／
``stimulus.page_no``（``exam_paper_cards.merge_group_cards`` 記下）；都沒有就是卡片的 ``page_no``。

頁圖太大（超過 ``MAX_PAGE_PIXELS``，解壓縮炸彈或異常掃描）不解碼、記 warning、當作裁不出來。
這些函式都是同步、會做影像處理與 GCS 上傳：從 async 流程呼叫時要丟到 threadpool。

欄位「存在」才算處理過：``"image_url" in question``。值為 None ＝ 沒有圖（裁不出來，或老師刪掉了）。
老師在編輯時換圖／刪圖，前端 PATCH 直接給這些欄位（``exam_import_edit``），之後不再自動裁。
"""

from __future__ import annotations

import io
import json
import logging
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Tuple

from services import exam_import_storage
from services.exam_paper_cards import CARD_KIND_GROUP, iter_card_questions

logger = logging.getLogger(__name__)

BOX_SCALE = 1000
CROP_MIME = "image/png"
# 頁圖像素上限：A4 300dpi 約 8.7M、600dpi 約 35M；再大就不解碼（防解壓縮炸彈、記憶體爆量）
MAX_PAGE_PIXELS = 40_000_000


class PageImage:
    """一頁頁圖（解碼一次、裁很多張）。打不開（格式不對、太大）時 ``crop`` 一律回 None。"""

    def __init__(self, image_bytes: Optional[bytes]):
        self._img = None
        if not image_bytes:
            return
        try:
            from PIL import Image

            img = Image.open(io.BytesIO(image_bytes))
            w, h = img.size
            if w * h > MAX_PAGE_PIXELS:
                logger.warning(
                    "[exam-import] page image too large to crop: %sx%s px", w, h
                )
                return
            img.load()
            self._img = img.convert("RGB")
        except Exception as e:  # 壞圖、格式不支援、PIL 判定解壓縮炸彈：當作裁不出來
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
# 框 → 裁好的圖網址（None ＝ 裁不出來）
Resolver = Callable[[Any], Optional[str]]
# (頁碼, 框的鍵) → 網址：鎖外先裁好，鎖內只查表
CropTable = Dict[Tuple[int, str], Optional[str]]
# resolver 回這個 ＝ 這個框這次沒有結果（不在表裡）：欄位不動，留給下次補裁
NOT_RESOLVED: Any = object()


def _upload(content: bytes) -> Optional[str]:
    try:
        return exam_import_storage.store_crop_image(content, CROP_MIME)
    except Exception as e:  # 上傳失敗：這張圖先沒有，存入時再補裁
        logger.warning("[exam-import] crop upload failed: %s", e)
        return None


def page_resolver(page: PageImage, upload: Uploader = _upload) -> Resolver:
    def resolve(box: Any) -> Optional[str]:
        data = page.crop(box)
        return upload(data) if data else None

    return resolve


def box_key(box: Any) -> str:
    return json.dumps(box, sort_keys=True, default=str)


def _box_page(item: Mapping[str, Any], card: Mapping[str, Any]) -> Any:
    return item.get("page_no") or card.get("page_no")


def crop_card(
    card: Dict[str, Any],
    page_no: int,
    resolve: Resolver,
    *,
    final: bool,
) -> int:
    """裁這張卡在第 ``page_no`` 頁上、還沒處理過的框。``final`` = True 時裁不出來也寫 None（不再試）。
    ``resolve`` 回 ``NOT_RESOLVED`` 的框不寫（欄位留空；圖片選項有任一個框沒結果就整組不寫）。
    回傳裁出幾張。"""
    made = 0

    def put(target: Dict[str, Any], key: str, box: Any) -> None:
        nonlocal made
        if key in target or not box:
            return
        url = resolve(box)
        if url is NOT_RESOLVED:
            return
        if url or final:
            target[key] = url
        made += 1 if url else 0

    for q in iter_card_questions(card):
        if _box_page(q, card) != page_no:
            continue
        put(q, "image_url", q.get("stem_box_2d"))
        boxes = q.get("option_boxes") or []
        if "option_image_urls" not in q and any(boxes):
            urls = [resolve(b) if b else None for b in boxes]
            if any(u is NOT_RESOLVED for u in urls):
                continue
            made += sum(1 for u in urls if u)
            if final or all(u for u, b in zip(urls, boxes) if b):
                q["option_image_urls"] = urls
    if card.get("kind") == CARD_KIND_GROUP:
        stim = (card.get("group") or {}).get("stimulus") or {}
        if stim.get("kind") == "image" and _box_page(stim, card) == page_no:
            put(stim, "image_url", stim.get("box_2d"))
        for fig in stim.get("figures") or []:
            if _box_page(fig, card) == page_no:
                put(fig, "url", fig.get("box_2d"))
    return made


def card_needs_crops(card: Dict[str, Any]) -> Iterable[int]:
    """這張卡還有哪幾頁的框沒處理過（存入前補裁用）。"""
    pages = set()
    for q in iter_card_questions(card):
        if (q.get("stem_box_2d") and "image_url" not in q) or (
            any(q.get("option_boxes") or []) and "option_image_urls" not in q
        ):
            pages.add(_box_page(q, card))
    if card.get("kind") == CARD_KIND_GROUP:
        stim = (card.get("group") or {}).get("stimulus") or {}
        if (
            stim.get("kind") == "image"
            and stim.get("box_2d")
            and "image_url" not in stim
        ):
            pages.add(_box_page(stim, card))
        for f in stim.get("figures") or []:
            if f.get("box_2d") and "url" not in f:
                pages.add(_box_page(f, card))
    return sorted(p for p in pages if p)


def attach_crops(cards: List[Dict[str, Any]], page_no: int, image_bytes: bytes) -> int:
    """寫入一頁結果前：裁這一頁所有卡的圖（失敗的留給存入時補裁）。回傳裁出幾張。"""
    if not any(card_needs_crops(c) for c in cards):
        return 0
    resolve = page_resolver(PageImage(image_bytes))
    return sum(crop_card(c, page_no, resolve, final=False) for c in cards)


def precrop(
    import_id: int,
    cards: Iterable[Dict[str, Any]],
    page_image_urls: Mapping[int, Optional[str]],
) -> CropTable:
    """存入前、**匯入鎖外**：讀回存好的頁圖補裁 ``cards`` 還沒處理的框，回傳「(頁, 框) → 網址」表。

    ``cards`` 依頁碼排序（存入順序）；頁圖一次只留需要的幾頁：卡片從第 N 頁開始時，N 之前的頁圖
    之後不會再用到，先放掉（C4a 審查 7）。``cards`` 會被就地寫上網址，呼叫端傳複本。
    """
    table: CropTable = {}
    cache: Dict[int, PageImage] = {}
    for card in cards:
        start = card.get("page_no") or 0
        for no in [n for n in cache if n < start]:
            del cache[no]
        for no in card_needs_crops(card):
            if no not in cache:
                loaded = exam_import_storage.read_page_image(
                    import_id, page_image_urls.get(no) or ""
                )
                cache[no] = PageImage(loaded[0] if loaded else None)
            inner = page_resolver(cache[no])

            def record(box: Any, _no: int = no, _inner: Resolver = inner):
                key = (_no, box_key(box))
                if key not in table:
                    table[key] = _inner(box)
                return table[key]

            crop_card(card, no, record, final=True)
    return table


def apply_crops(card: Dict[str, Any], table: CropTable) -> None:
    """鎖內：用 ``precrop`` 的表把網址寫回卡片（不碰 GCS）。只寫表裡有的框（含裁失敗的 None）；
    表裡沒有的框（鎖外之後才出現）不動，欄位留空，下次存入再補裁。"""
    for no in card_needs_crops(card):
        crop_card(
            card,
            no,
            lambda box, _no=no: table.get((_no, box_key(box)), NOT_RESOLVED),
            final=True,
        )
