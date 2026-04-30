"""
Distractor shape helpers for vocab-MC (Issue #631).

ContentItem.distractors historically stored list[str]. To support optional
per-distractor images, the canonical shape is now list[{text, image_url}].
These helpers read both shapes and always emit the new one.
"""

from typing import Any, List, Optional, TypedDict


class Distractor(TypedDict):
    text: str
    image_url: Optional[str]


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


def distractor_text(entry: Any) -> str:
    """Extract the text field from either legacy str or new dict shape."""
    if isinstance(entry, dict):
        return (entry.get("text") or "").strip()
    if isinstance(entry, str):
        return entry.strip()
    return ""
