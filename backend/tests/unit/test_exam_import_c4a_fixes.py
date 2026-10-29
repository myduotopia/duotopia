"""
上傳題本 C4a 審查修正的純函式測試（Issue #1112）：

- 跨頁合併接上延續頁的插圖（``after_paragraph`` 位移、記 ``page_no``）與以圖為準的主圖（審查 2）
- 老師編輯過主圖文的題組不再併入延續卡（審查 4）
- 補裁圖：每個框用自己那一頁的頁圖；鎖外先裁、鎖內查表（審查 3）；頁圖像素上限（審查 7）
- IntegrityError 只有唯一索引 ``uq_questions_teacher_normalized_stem`` 算題目文字相同（審查 6）

不打 Vertex、不碰 DB、不碰 GCS。
"""

from __future__ import annotations

import io

import pytest
from sqlalchemy.exc import IntegrityError

from services import exam_import_images, exam_import_storage
from services.exam_import_convert import card_to_payload
from services.exam_import_images import (
    PageImage,
    apply_crops,
    card_needs_crops,
    precrop,
)
from services.exam_import_save import is_stem_unique_violation
from services.exam_paper_cards import merge_continuations, merge_group_cards

pytestmark = [pytest.mark.unit, pytest.mark.no_db]


def _group(page_no, paragraphs, figures=None, cont=False, kind="text", **stim):
    return {
        "card_id": f"g{page_no}",
        "kind": "group",
        "page_no": page_no,
        "pages": [page_no],
        "continues_previous": cont,
        "group": {
            "group_type": "reading",
            "title": "T",
            "stimulus": {
                "kind": kind,
                "paragraphs": paragraphs,
                "figures": figures or [],
                **stim,
            },
            "glossary": [],
            "speakers": [],
            "questions": [
                {
                    "source_question_no": str(page_no),
                    "page_no": page_no,
                    "stem": f"Q{page_no}?",
                    "options": ["a", "b"],
                    "correct_indexes": [0],
                }
            ],
        },
    }


def _png(w=100, h=100):
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (w, h), (255, 255, 255)).save(out, format="PNG")
    return out.getvalue()


# ---------------------------------------------------------------- 審查 2：插圖跨頁


def test_merge_carries_continuation_figures_with_offset_and_page():
    target = _group(
        1, ["P1a.", "P1b."], [{"box_2d": [0, 0, 10, 10], "after_paragraph": 0}]
    )
    cont = _group(
        2,
        ["P2a.", "P2b."],
        [
            {"box_2d": [1, 1, 20, 20], "after_paragraph": 0, "url": "u2"},
            {"box_2d": [2, 2, 30, 30], "after_paragraph": -1},
        ],
        cont=True,
    )
    merge_group_cards(target, cont)
    figs = target["group"]["stimulus"]["figures"]
    assert [(f["after_paragraph"], f.get("page_no")) for f in figs] == [
        (0, None),  # 上一頁自己的插圖不動（裁圖用卡片的頁）
        (2, 2),  # 延續頁第 1 段之後 → 合併後第 3 段之後
        (1, 2),  # 延續頁最前面 → 接在上一頁最後一段之後
    ]
    # 存入時插圖跟著段落進排版（有網址的才放）
    _, payload = card_to_payload(target, {})
    rows = payload["layout"]["rows"]
    kinds = [r["columns"][0]["blocks"][0]["type"] for r in rows]
    assert kinds == ["paragraph", "paragraph", "paragraph", "image", "paragraph"]


def test_merge_image_continuation_becomes_figure_or_fills_empty_image():
    # 上一頁是文章：延續頁的主圖改成整列插圖接在最後
    target = _group(1, ["Text."])
    cont = _group(2, [], cont=True, kind="image", box_2d=[0, 0, 500, 500])
    cont["group"]["stimulus"]["image_url"] = "img2"
    merge_group_cards(target, cont)
    fig = target["group"]["stimulus"]["figures"][-1]
    assert fig["url"] == "img2" and fig["page_no"] == 2
    assert fig["placement"] == "full" and fig["after_paragraph"] == 0

    # 上一頁是以圖為準但還沒有圖：直接用延續頁的圖
    target = _group(1, [], kind="image")
    cont = _group(2, [], cont=True, kind="image", box_2d=[0, 0, 500, 500])
    merge_group_cards(target, cont)
    stim = target["group"]["stimulus"]
    assert stim["box_2d"] == [0, 0, 500, 500] and stim["page_no"] == 2
    assert card_needs_crops(target) == [2]


def test_merged_figure_is_cropped_from_its_own_page(monkeypatch):
    target = _group(1, ["P1."])
    cont = _group(
        2, ["P2."], [{"box_2d": [0, 0, 500, 500], "after_paragraph": 0}], cont=True
    )
    merge_group_cards(target, cont)
    assert card_needs_crops(target) == [2]

    reads = []

    def read(import_id, url):
        reads.append(url)
        return _png(), "image/png"

    monkeypatch.setattr(exam_import_storage, "read_page_image", read)
    monkeypatch.setattr(
        exam_import_storage, "store_crop_image", lambda c, t: "https://x/fig.png"
    )
    work = {**target}
    table = precrop(7, [work], {1: "page_1.png", 2: "page_2.png"})
    assert reads == ["page_2.png"]
    # 鎖內查表寫回（不碰 GCS）
    monkeypatch.setattr(
        exam_import_storage,
        "store_crop_image",
        lambda c, t: pytest.fail("no upload inside the lock"),
    )
    apply_crops(target, table)
    assert target["group"]["stimulus"]["figures"][0]["url"] == "https://x/fig.png"


# ---------------------------------------------------------------- 審查 4：老師改過排版


@pytest.mark.parametrize("key", ["layout", "passage_text", "segments"])
def test_teacher_edited_stimulus_is_not_merged_into(key):
    target = _group(1, ["Part one."])
    target["group"][key] = {"version": 1, "rows": []} if key == "layout" else "x"
    target["teacher_edited"] = [key]
    cont = _group(2, ["Part two."], cont=True)
    pages = {1: [target], 2: [cont]}
    assert merge_continuations(pages, record=True) == set()
    # 延續卡原樣留在第 2 頁，文章與小題都在（存入時當獨立題組，不會遺失）
    assert pages[2] == [cont]
    assert pages[1][0]["group"]["stimulus"]["paragraphs"] == ["Part one."]
    _, payload = card_to_payload(pages[2][0], {})
    texts = [r["columns"][0]["blocks"][0]["text"] for r in payload["layout"]["rows"]]
    assert texts == ["Part two."]


def test_teacher_edited_questions_only_still_merges():
    target = _group(1, ["Part one."])
    target["group"]["questions"][0]["teacher_edited"] = ["stem"]
    cont = _group(2, ["Part two."], cont=True)
    pages = {1: [target], 2: [cont]}
    merge_continuations(pages)
    assert pages[2] == []
    assert pages[1][0]["group"]["stimulus"]["paragraphs"] == ["Part one.", "Part two."]


# ---------------------------------------------------------------- 審查 7：像素上限、頁圖快取


def test_page_image_over_pixel_limit_is_not_decoded(monkeypatch, caplog):
    monkeypatch.setattr(exam_import_images, "MAX_PAGE_PIXELS", 100 * 100 - 1)
    with caplog.at_level("WARNING"):
        page = PageImage(_png(100, 100))
    assert page.crop([0, 0, 500, 500]) is None
    assert "too large" in caplog.text
    assert PageImage(_png(99, 100)).crop([0, 0, 500, 500]) is not None


def test_precrop_reads_each_page_once_and_releases_earlier_pages(monkeypatch):
    reads = []
    alive = []

    class Spy(PageImage):
        def __init__(self, data):
            super().__init__(data)
            alive.append(self)

    def read(import_id, url):
        reads.append(url)
        return _png(), "image/png"

    monkeypatch.setattr(exam_import_images, "PageImage", Spy)
    monkeypatch.setattr(exam_import_storage, "read_page_image", read)
    monkeypatch.setattr(exam_import_storage, "store_crop_image", lambda c, t: "u")
    cards = [
        {
            "card_id": f"c{n}",
            "kind": "single",
            "page_no": n,
            "question": {"page_no": n, "stem_box_2d": [0, 0, 500, 500 + i]},
        }
        for i, n in enumerate((1, 1, 2, 3))
    ]
    import gc
    import weakref

    refs = []
    orig_init = Spy.__init__

    def tracking_init(self, data):
        orig_init(self, data)
        refs.append(weakref.ref(self))

    monkeypatch.setattr(Spy, "__init__", tracking_init)
    alive.clear()
    table = precrop(1, cards, {1: "a", 2: "b", 3: "c"})
    assert reads == ["a", "b", "c"]  # 同一頁的兩張卡共用一次讀取
    assert len(table) == 4
    alive.clear()
    gc.collect()
    # precrop 結束後不留頁圖（快取逐頁放掉、函式結束整個釋放）
    assert all(r() is None for r in refs)


# ---------------------------------------------------------------- 審查 6：IntegrityError 分辨


class _Diag:
    def __init__(self, name):
        self.constraint_name = name


class _Orig(Exception):
    def __init__(self, msg, name=None):
        super().__init__(msg)
        if name is not None:
            self.diag = _Diag(name)


@pytest.mark.parametrize(
    "orig, expected",
    [
        (_Orig("dup", "uq_questions_teacher_normalized_stem"), True),
        (_Orig("dup", "question_source_links_pkey"), False),
        (
            _Orig('violates unique constraint "uq_questions_teacher_normalized_stem"'),
            True,
        ),
        (_Orig("violates foreign key constraint fk_x"), False),
        (
            _Orig(
                "UNIQUE constraint failed: questions.teacher_id, "
                "questions.normalized_stem"
            ),
            True,
        ),
        (_Orig("UNIQUE constraint failed: question_sources.name"), False),
    ],
)
def test_is_stem_unique_violation(orig, expected):
    assert is_stem_unique_violation(IntegrityError("stmt", {}, orig)) is expected
