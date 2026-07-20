"""
Distractor shape helpers for vocab-MC (Issue #631).

ContentItem.distractors historically stored list[str]. To support optional
per-distractor images, the canonical shape is now list[{text, image_url}].
These helpers read both shapes and always emit the new one.
"""

import random
from typing import Any, Iterable, List, Optional, TypedDict


class Distractor(TypedDict):
    text: str
    image_url: Optional[str]


def effective_show_image(
    show_image: Optional[bool], show_example_sentence: Optional[bool] = False
) -> bool:
    """Issue #860: 例句挖空題的選項固定為英文單字 → 等同 show_image=True。

    題目是「挖空的英文例句」，正解是被挖掉的英文字，因此選項語言必須是英文
    （text）。若仍讓 show_image 決定，直接呼 API 只送 show_example_sentence=true
    的路徑（PATCH / 即刻練習 reconfigure / demo query override）會出現
    「英文挖空題 + 中文選項」的語意不一致。在寫入端收斂，讀取端就不必各自記得配對。
    """
    if show_example_sentence:
        return True
    return True if show_image is None else bool(show_image)


def text_field_for_show_image(show_image: bool) -> str:
    """Which ContentItem field provides the displayed option text.

    When the question shows an image, options/answer must be in the foreign
    language (`text`) so the picture doesn't trivially reveal the answer.
    Otherwise the legacy behaviour applies: options show the translation.
    """
    return "text" if show_image else "translation"


def normalize_distractors(value: Any) -> List[Distractor]:
    """Coerce a stored distractors value into the canonical object shape.

    Accepts None, list[str] (legacy), list[dict] (new), or a mix.
    Drops entries that aren't strings or dicts with a non-empty 'text' field.
    """
    if not isinstance(value, list):
        return []

    result: List[Distractor] = []
    for entry in value:
        if isinstance(entry, str):
            text = entry.strip()
            if text:
                result.append({"text": text, "image_url": None})
        elif isinstance(entry, dict):
            text = (entry.get("text") or "").strip()
            if not text:
                continue
            image_url = entry.get("image_url")
            if image_url is not None and not isinstance(image_url, str):
                image_url = None
            result.append({"text": text, "image_url": image_url or None})
    return result


def make_distractor(text: str, image_url: Optional[str] = None) -> Distractor:
    return {"text": text, "image_url": image_url or None}


def regenerate_word_selection_distractors(items: Iterable, show_image: bool) -> int:
    """Overwrite each item's distractors using `show_image`-appropriate text.

    For PATCH-time toggling: switching show_image flips option language between
    translation and English, so existing distractors must be rebuilt.
    Returns the number of items updated.
    """
    field = text_field_for_show_image(show_image)
    items_list = list(items)
    candidates: List[tuple] = []
    for item in items_list:
        value = getattr(item, field, None)
        if not value:
            continue
        candidates.append((value, item.image_url))

    updated = 0
    for item in items_list:
        target = getattr(item, field, None)
        if not target:
            continue
        target_norm = target.lower().strip()
        pool = [(t, img) for (t, img) in candidates if t.lower().strip() != target_norm]
        random.shuffle(pool)
        item.distractors = [
            make_distractor(text=t, image_url=img) for (t, img) in pool[:3]
        ]
        updated += 1
    return updated


def distractor_text(entry: Any) -> str:
    """Extract the text field from either legacy str or new dict shape."""
    if isinstance(entry, dict):
        return (entry.get("text") or "").strip()
    if isinstance(entry, str):
        return entry.strip()
    return ""
