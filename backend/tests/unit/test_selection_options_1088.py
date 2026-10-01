"""Issue #1088: `_build_selection_options` 未開例句時行為必須與舊版完全相同。"""

from types import SimpleNamespace

from routers.students.quiz_assignments import _build_selection_options


def _item(i, text, translation, distractors=None, **kw):
    return SimpleNamespace(
        id=i,
        text=text,
        translation=translation,
        image_url=None,
        distractors=distractors,
        example_sentence=kw.get("example_sentence"),
        cloze_answer=kw.get("cloze_answer"),
    )


def _assignment(**kw):
    base = dict(show_image=False, show_example_sentence=False)
    base.update(kw)
    return SimpleNamespace(**base)


def test_off_path_uses_stored_distractors_and_translation():
    stored = [
        {"text": "干擾一", "image_url": None},
        {"text": "干擾二", "image_url": None},
        {"text": "干擾三", "image_url": None},
        {"text": "干擾四", "image_url": None},
    ]
    items = [_item(1, "apple", "蘋果", stored), _item(2, "banana", "香蕉", None)]
    opts = _build_selection_options(items, _assignment(show_image=False))
    # 有 ≥3 個 stored distractors → 正解＝翻譯 + stored[:3]，順序由 seed 決定
    assert sorted(o["text"] for o in opts[1]) == sorted(["蘋果", "干擾一", "干擾二", "干擾三"])
    # 無 stored → 其他單字翻譯 + 補位選項
    assert sorted(o["text"] for o in opts[2]) == sorted(["香蕉", "蘋果", "選項B", "選項C"])


def test_off_path_show_image_uses_english_text():
    items = [_item(1, "apple", "蘋果"), _item(2, "banana", "香蕉")]
    opts = _build_selection_options(items, _assignment(show_image=True))
    assert sorted(o["text"] for o in opts[1]) == sorted(
        ["apple", "banana", "選項B", "選項C"]
    )


def test_off_path_is_deterministic_and_keeps_duplicates():
    # 舊版 pool 不去重：兩個同翻譯單字，另一題的干擾可同時含兩者
    items = [
        _item(1, "cup", "杯子"),
        _item(2, "mug", "杯子"),
        _item(3, "pen", "筆"),
    ]
    a = _build_selection_options(items, _assignment(show_image=False))
    b = _build_selection_options(items, _assignment(show_image=False))
    assert a == b
    assert [o["text"] for o in a[3]].count("杯子") == 2


def test_on_path_uses_cloze_forms_deduped():
    items = [
        _item(1, "tell", "告訴", example_sentence="He told me.", cloze_answer="told me"),
        _item(2, "say", "說", example_sentence="Told me twice.", cloze_answer="told me"),
        _item(3, "cup", "杯子", example_sentence="Two cups.", cloze_answer=""),
    ]
    opts = _build_selection_options(items, _assignment(show_example_sentence=True))
    texts3 = [o["text"] for o in opts[3]]
    assert "cups" in texts3
    assert texts3.count("told me") == 1  # 去重
    assert "tell" not in texts3 and "say" not in texts3
