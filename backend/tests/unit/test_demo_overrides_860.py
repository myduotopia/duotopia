"""Issue #860: demo overlay 的 show_example_sentence 必須 fallback 到已存值。

demo_overrides() 只會保留 query string 實際帶到的 key，所以 _apply_overrides
判斷這個旗標時如果直接用 effective.get()，一個已開啟例句挖空的作業只要連結
沒重帶參數就會被當成 False —— 互斥守衛與 show_image 收斂會雙雙失效。
"""

import pytest
from fastapi import HTTPException

from routers.demo import _apply_overrides


class _FakeAssignment:
    """最小替身：只要有 _apply_overrides 讀到的屬性即可。"""

    def __init__(self, show_example_sentence=False, show_image=False):
        self.practice_mode = "word_selection_quiz"
        self.play_audio = False
        self.show_example_sentence = show_example_sentence
        self.show_image = show_image
        self.show_option_images = False


def test_persisted_example_flag_forces_english_options():
    """已存 show_example_sentence=True，query 只帶 show_image=false →
    仍須收斂成 show_image=True（否則英文挖空題配中文選項）。"""
    overlay = _apply_overrides(
        _FakeAssignment(show_example_sentence=True), {"show_image": False}
    )
    assert overlay.show_image is True


def test_persisted_example_flag_still_blocks_option_images():
    """已存 show_example_sentence=True，query 只帶 show_option_images=true →
    互斥守衛仍須擋下（先前因未 fallback 而漏擋）。"""
    with pytest.raises(HTTPException) as exc:
        _apply_overrides(
            _FakeAssignment(show_example_sentence=True), {"show_option_images": True}
        )
    assert exc.value.status_code == 400


def test_query_override_can_turn_example_flag_off():
    """query 明確帶 false 時要能覆寫已存的 True（不可被 fallback 蓋掉）。"""
    overlay = _apply_overrides(
        _FakeAssignment(show_example_sentence=True),
        {"show_example_sentence": False, "show_image": False},
    )
    assert overlay.show_image is False
