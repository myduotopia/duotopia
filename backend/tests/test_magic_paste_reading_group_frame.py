"""
閱讀題組擷取：原卷主圖文是否有框（stimulus.framed，#1084）。

test_magic_paste_endpoint.py 已近 1000 行，外框判斷的測試獨立成這個檔。
"""

import pytest

from services.magic_paste_service import (
    EXTRACT_MODE_READING_GROUP,
    MagicPasteService,
)


def test_reading_group_prompt_asks_whether_stimulus_is_framed():
    prompt = MagicPasteService._build_prompt("A1", EXTRACT_MODE_READING_GROUP)
    assert '"framed": false' in prompt
    assert "`stimulus.framed`" in prompt
    assert "printed inside one box" in prompt
    assert "or when you cannot tell" in prompt


@pytest.mark.parametrize(
    "value, expected",
    [
        (True, True),
        ("true", True),
        (" TRUE ", True),
        (False, False),
        ("false", False),
        ("yes", False),
        (1, False),
        (None, False),
    ],
)
def test_normalize_reading_group_framed_is_strict_bool(value, expected):
    raw = {"stimulus": {"kind": "text", "paragraphs": ["p"], "framed": value}}
    g = MagicPasteService._normalize_reading_group(raw)[0]
    assert g["stimulus"]["framed"] is expected


def test_normalize_reading_group_framed_missing_is_false():
    raw = {"stimulus": {"kind": "text", "paragraphs": ["p"]}}
    g = MagicPasteService._normalize_reading_group(raw)[0]
    assert g["stimulus"]["framed"] is False


def test_normalize_reading_group_image_kind_never_framed():
    """整張圖本身已是素材，外框不另外畫。"""
    raw = {
        "stimulus": {
            "kind": "image",
            "text": "poster",
            "box_2d": [0, 0, 500, 1000],
            "framed": True,
        }
    }
    g = MagicPasteService._normalize_reading_group(raw)[0]
    assert g["stimulus"]["framed"] is False
