"""
上傳題本：題目卡 → 題庫 payload（``exam_import_convert``）與裁圖（``exam_import_images``）的純函式測試
（Issue #1112 C4a）。排版規則與前端 ``extractedGroup.ts`` ``paragraphsToLayout`` 相同。
"""

from __future__ import annotations

import io

from routers.question_bank_schemas import QuestionCreate, QuestionGroupCreate
from services.exam_import_convert import (
    apply_settings,
    card_to_payload,
    derive_stimulus_type,
    paragraphs_to_layout,
)
from services.exam_import_images import PageImage, card_needs_crops, crop_card

SETTINGS = {
    "grade_min": 7,
    "grade_max": 8,
    "visibility": "private",
    "source_id": 5,
    "program_links": [{"program_id": 9, "lesson_id": None}],
}


def _q(no, stem, options, correct, **kw):
    return {
        "source_question_no": no,
        "stem": stem,
        "options": options,
        "correct_indexes": correct,
        "explanation": "",
        "exam_point_codes": kw.get("codes", []),
        "exam_point_ids": kw.get("ids", []),
        "blank": kw.get("blank"),
        "status": "ok",
        "teacher_edited": [],
    }


def test_paragraphs_layout_one_block_per_row_with_figures():
    layout = paragraphs_to_layout(
        ["First.", "  ", "Second."],
        [
            {"after_paragraph": -1, "url": "u0", "caption": ""},
            {
                "after_paragraph": 0,
                "url": "u1",
                "placement": "beside",
                "side": "left",
                "width": 0.66,
                "caption": "Fig",
            },
            {"after_paragraph": 1, "url": "u2", "placement": "full"},
            {"after_paragraph": 9, "url": "u3"},
            {"after_paragraph": 0, "url": None},
        ],
    )
    rows = layout["rows"]
    assert rows[0]["columns"][0]["blocks"][0]["url"] == "u0"
    beside = rows[1]["columns"]
    assert [c["span"] for c in beside] == [2, 1]  # 圖在左、佔 2/3
    assert beside[0]["blocks"][0] == {
        "type": "image",
        "url": "u1",
        "align": "center",
        "caption": "Fig",
    }
    assert rows[2]["columns"][0]["blocks"][0]["text"] == "Second."
    assert rows[3]["columns"][0]["blocks"][0]["url"] == "u2"
    assert rows[4]["columns"][0]["blocks"][0]["url"] == "u3"
    assert len(rows) == 5
    assert paragraphs_to_layout([], []) is None


def test_single_card_payload_validates():
    card = {
        "kind": "single",
        "question": {
            **_q("1", "Pick.", ["a", "b", "c"], [0, 2], codes=["g"], ids=[7]),
            "image_url": "https://img/stem.png",
            "option_image_urls": [None, "https://img/b.png", None],
        },
    }
    kind, payload = card_to_payload(card, {"g": 3})
    model = QuestionCreate.model_validate(apply_settings(kind, payload, SETTINGS))
    assert kind == "single"
    assert model.allow_multiple_answers is True
    assert [o.is_correct for o in model.options] == [True, False, True]
    assert model.options[1].image_url == "https://img/b.png"
    assert model.exam_point_ids == [3, 7]
    assert model.source_ids == [5] and model.program_links[0].program_id == 9
    assert model.image_url == "https://img/stem.png"


def test_reading_group_strips_blank_tokens():
    card = {
        "kind": "group",
        "group": {
            "group_type": "reading",
            "title": "Story",
            "stimulus": {
                "kind": "text",
                "paragraphs": ["I {{1}} here."],
                "framed": True,
            },
            "glossary": [{"word": "here", "zh": "這裡"}, {"word": "x", "zh": ""}],
            "questions": [_q("1", "Why {{1}}?", ["a", "b"], [1], blank=1)],
        },
    }
    kind, payload = card_to_payload(card, {})
    model = QuestionGroupCreate.model_validate(apply_settings(kind, payload, SETTINGS))
    assert model.question_type == "reading"
    assert model.layout["frame"] is True
    assert model.layout["rows"][0]["columns"][0]["blocks"][0]["text"] == "I ____ here."
    assert model.questions[0].stem == "Why ____?"
    assert model.questions[0].blank_index is None
    assert model.glossary == [{"word": "here", "zh": "這裡"}]
    assert model.questions[0].source_ids == [5]


def test_cloze_group_keeps_blanks():
    card = {
        "kind": "group",
        "group": {
            "group_type": "cloze",
            "stimulus": {"kind": "text", "paragraphs": ["I {{1}} a {{2}}."]},
            "questions": [
                _q("41", "", ["am", "is"], [0], blank=1),
                _q("42", "", ["cat", "cats"], [0], blank=2),
            ],
        },
    }
    kind, payload = card_to_payload(card, {})
    model = QuestionGroupCreate.model_validate(apply_settings(kind, payload, SETTINGS))
    assert [q.blank_index for q in model.questions] == [1, 2]


def test_image_group_with_dialogue_uses_segments():
    card = {
        "kind": "group",
        "group": {
            "group_type": "reading",
            "title": "",
            "stimulus": {
                "kind": "image",
                "text": "At the shop",
                "image_url": "https://img/poster.png",
                "dialogue": [
                    {"speaker": "Amy", "text": "Hi!"},
                    {"speaker": "", "text": "dropped"},
                ],
            },
            "questions": [_q("1", "Where?", ["shop", "school"], [0])],
        },
    }
    kind, payload = card_to_payload(card, {})
    assert payload["stimulus_type"] == "image"
    assert payload["segments"] == [{"speaker_label": "Amy", "transcript": "Hi!"}]
    assert payload["passage_text"] == "At the shop\n\nAmy: Hi!"
    block = payload["layout"]["rows"][0]["columns"][0]["blocks"][0]
    assert block == {
        "type": "image",
        "url": "https://img/poster.png",
        "alt": "stimulus",
        "align": "center",
    }
    QuestionGroupCreate.model_validate(apply_settings(kind, payload, SETTINGS))


def test_derive_stimulus_type():
    assert derive_stimulus_type(None) == "passage"
    mixed = paragraphs_to_layout(["a"], [{"after_paragraph": 0, "url": "u"}])
    assert derive_stimulus_type(mixed) == "mixed"


def _png(w, h):
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (w, h), (0, 0, 0)).save(out, format="PNG")
    return out.getvalue()


def test_crop_card_and_needs():
    page = PageImage(_png(1000, 2000))
    uploaded = []

    def upload(data):
        from PIL import Image

        uploaded.append(Image.open(io.BytesIO(data)).size)
        return f"u{len(uploaded)}"

    card = {
        "kind": "group",
        "page_no": 1,
        "group": {
            "stimulus": {"kind": "text", "figures": [{"box_2d": [0, 0, 100, 500]}]},
            "questions": [
                {
                    "page_no": 2,  # 跨頁合併來的小題：不在第 1 頁 → 這次不裁
                    "stem_box_2d": [0, 0, 10, 10],
                    "option_boxes": [None, [0, 0, 10, 10]],
                },
                {"page_no": 1, "option_boxes": [[0, 0, 500, 500], None]},
            ],
        },
    }
    assert card_needs_crops(card) == [1, 2]
    crop_card(card, 1, page, final=False, upload=upload)
    stim = card["group"]["stimulus"]
    assert stim["figures"][0]["url"] == "u2"
    assert card["group"]["questions"][1]["option_image_urls"] == ["u1", None]
    assert sorted(uploaded) == [(500, 200), (500, 1000)]
    assert card_needs_crops(card) == [2]
    # 壞圖：final 時寫 None，不再試
    crop_card(card, 2, PageImage(b"not an image"), final=True, upload=upload)
    q = card["group"]["questions"][0]
    assert q["image_url"] is None and q["option_image_urls"] == [None, None]
    assert card_needs_crops(card) == []
