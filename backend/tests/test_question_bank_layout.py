"""
題組 layout / glossary 驗證的純函式測試（Issue #1082）。

正向樣本：docs/design/question-bank-layout-samples/*.json（會考題本五組），
格式能表達這五組是開工前提，所以每一份都必須通過驗證。
"""

import copy
import json
from pathlib import Path

import pytest

from services.question_bank_layout import (
    MAX_BLOCKS_TOTAL,
    LayoutError,
    assert_no_cloze_blanks,
    layout_blank_indexes,
    layout_blank_occurrences,
    layout_to_plain_text,
    strip_inline_markup,
    validate_cloze_blanks,
    validate_glossary,
    validate_layout,
)

SAMPLES_DIR = (
    Path(__file__).resolve().parents[2]
    / "docs"
    / "design"
    / "question-bank-layout-samples"
)
SAMPLE_FILES = sorted(SAMPLES_DIR.glob("q*.json"))


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _minimal(block: dict) -> dict:
    return {"version": 1, "rows": [{"columns": [{"span": 1, "blocks": [block]}]}]}


# ---------------------------------------------------------------- 正向：五組驗收樣本


def test_samples_dir_has_five_samples():
    assert len(SAMPLE_FILES) == 5, [p.name for p in SAMPLE_FILES]


@pytest.mark.parametrize("path", SAMPLE_FILES, ids=[p.stem for p in SAMPLE_FILES])
def test_sample_layout_is_valid(path):
    doc = _load(path)
    validate_layout(doc)
    validate_glossary(doc.get("_glossary"))


def test_none_is_valid():
    validate_layout(None)
    validate_glossary(None)


# ---------------------------------------------------------------- 負向：結構


def _assert_error(layout, path_prefix: str):
    with pytest.raises(LayoutError) as exc:
        validate_layout(layout)
    assert exc.value.path.startswith(path_prefix), exc.value


def test_rows_must_be_list():
    _assert_error({"version": 1, "rows": "x"}, "layout.rows")


def test_unknown_version_rejected():
    _assert_error({"version": 2, "rows": []}, "layout.version")


def test_row_needs_columns():
    _assert_error({"version": 1, "rows": [{"columns": []}]}, "layout.rows[0].columns")


def test_span_must_be_positive_int():
    for bad in (0, -1, "1", 1.5, True, 4):
        _assert_error(
            {"version": 1, "rows": [{"columns": [{"span": bad, "blocks": []}]}]},
            "layout.rows[0].columns[0].span",
        )


def test_unknown_block_type():
    _assert_error(
        _minimal({"type": "video", "url": "x"}),
        "layout.rows[0].columns[0].blocks[0].type",
    )


def test_heading_level_and_text():
    _assert_error(
        _minimal({"type": "heading", "level": 1, "text": "x"}),
        "layout.rows[0].columns[0].blocks[0].level",
    )
    _assert_error(
        _minimal({"type": "heading", "level": 2, "text": "   "}),
        "layout.rows[0].columns[0].blocks[0].text",
    )


def test_paragraph_text_required_and_bounded():
    _assert_error(
        _minimal({"type": "paragraph"}), "layout.rows[0].columns[0].blocks[0].text"
    )
    _assert_error(
        _minimal({"type": "paragraph", "text": "x" * 5001}),
        "layout.rows[0].columns[0].blocks[0].text",
    )


def test_image_fields():
    _assert_error(
        _minimal({"type": "image"}), "layout.rows[0].columns[0].blocks[0].url"
    )
    _assert_error(
        _minimal({"type": "image", "url": "a.png", "align": "top"}),
        "layout.rows[0].columns[0].blocks[0].align",
    )
    _assert_error(
        _minimal({"type": "image", "url": "a.png", "maxWidth": 0}),
        "layout.rows[0].columns[0].blocks[0].maxWidth",
    )
    _assert_error(
        _minimal({"type": "image", "url": "a.png", "frame": "yes"}),
        "layout.rows[0].columns[0].blocks[0].frame",
    )
    validate_layout(
        _minimal(
            {
                "type": "image",
                "url": "a.png",
                "alt": "x",
                "caption": "c",
                "align": "center",
                "maxWidth": 480,
                "frame": True,
            }
        )
    )


def test_dialogue_lines():
    _assert_error(
        _minimal({"type": "dialogue", "lines": []}),
        "layout.rows[0].columns[0].blocks[0].lines",
    )
    _assert_error(
        _minimal({"type": "dialogue", "lines": [{"speaker": "A"}]}),
        "layout.rows[0].columns[0].blocks[0].lines[0].text",
    )


def test_section_only_holds_rows():
    _assert_error(
        {
            "version": 1,
            "rows": [
                {
                    "type": "section",
                    "rows": [{"type": "section", "rows": []}],
                }
            ],
        },
        "layout.rows[0].rows[0].type",
    )
    _assert_error(
        {"version": 1, "rows": [{"type": "section", "rows": []}]},
        "layout.rows[0].rows",
    )


def test_total_block_limit():
    para = {"type": "paragraph", "text": "x"}
    col = {"span": 1, "blocks": [copy.deepcopy(para) for _ in range(50)]}
    rows = [{"columns": [copy.deepcopy(col)]} for _ in range(4)]
    validate_layout({"version": 1, "rows": rows})  # 剛好 200
    rows.append({"columns": [{"span": 1, "blocks": [para]}]})
    with pytest.raises(LayoutError) as exc:
        validate_layout({"version": 1, "rows": rows})
    assert str(MAX_BLOCKS_TOTAL) in exc.value.message


# ---------------------------------------------------------------- glossary


def test_glossary_shape():
    validate_glossary([{"word": "note", "zh": "筆記"}])
    with pytest.raises(LayoutError) as exc:
        validate_glossary([{"word": "note"}])
    assert exc.value.path == "glossary[0].zh"
    with pytest.raises(LayoutError):
        validate_glossary("x")
    with pytest.raises(LayoutError):
        validate_glossary([{"word": "note", "zh": "筆記"}] * 51)


# ---------------------------------------------------------------- 純文字副本／克漏字


def test_strip_inline_markup():
    assert strip_inline_markup("an **exhilarating** __experience__ {{40}}") == (
        "an exhilarating experience ____"
    )


def test_layout_to_plain_text_and_blank_indexes():
    cloze = _load(SAMPLES_DIR / "q40-43-cloze.json")
    text = layout_to_plain_text(cloze)
    assert "Every Christmas" in text
    assert "{{40}}" not in text and "____" in text
    assert layout_blank_indexes(cloze) == [40, 41, 42, 43]

    dialogue = _load(SAMPLES_DIR / "q20-21-dialogue-map.json")
    text = layout_to_plain_text(dialogue)
    assert "Roger: Excuse me." in text
    assert "Below is the street map" in text
    assert layout_blank_indexes(dialogue) == []
    assert layout_to_plain_text(None) == ""


# ---------------------------------------------------------------- cloze (#1085)


def test_validate_cloze_blanks_accepts_matching_sets():
    cloze = _load(SAMPLES_DIR / "q40-43-cloze.json")
    # 小題順序與空格順序無關，只看集合是否相等
    validate_cloze_blanks(cloze, [43, 40, 42, 41])


@pytest.mark.parametrize(
    "blank_indexes, expect",
    [
        ([40, 41, 42], "沒有對應小題"),  # 缺 43
        ([40, 41, 42, 43, 44], "不在文章裡"),  # 多出 44
        ([40, 40, 42, 43], "同一個空格"),  # 重複
        ([40, 41, 42, None], "空格編號"),  # 沒填
    ],
)
def test_validate_cloze_blanks_rejects_mismatch(blank_indexes, expect):
    cloze = _load(SAMPLES_DIR / "q40-43-cloze.json")
    with pytest.raises(LayoutError) as e:
        validate_cloze_blanks(cloze, blank_indexes)
    assert expect in e.value.message


def test_validate_cloze_blanks_requires_at_least_one_blank():
    reading = _load(SAMPLES_DIR / "q25-27-inline-figure.json")
    with pytest.raises(LayoutError) as e:
        validate_cloze_blanks(reading, [])
    assert "至少一個" in e.value.message


def test_layout_blank_occurrences_keeps_duplicates():
    cloze = _load(SAMPLES_DIR / "q40-43-cloze.json")
    assert layout_blank_occurrences(cloze) == [40, 41, 42, 43]
    dup = {
        "version": 1,
        "rows": [
            {
                "columns": [
                    {
                        "span": 1,
                        "blocks": [
                            {"type": "paragraph", "text": "a {{1}} b {{2}}"},
                            {"type": "paragraph", "text": "c {{1}}"},
                        ],
                    }
                ]
            }
        ],
    }
    assert layout_blank_occurrences(dup) == [1, 2, 1]
    # 去重版本看不出重複，所以兩個函式要並存
    assert layout_blank_indexes(dup) == [1, 2]


def test_validate_cloze_blanks_rejects_duplicate_blank_in_passage():
    """同一個 {{1}} 在文章裡出現兩次 —— 兩個空格卻只能對一張小題。"""
    dup = {
        "version": 1,
        "rows": [
            {
                "columns": [
                    {
                        "span": 1,
                        "blocks": [
                            {"type": "paragraph", "text": "a {{1}} b {{2}} c {{1}}"}
                        ],
                    }
                ]
            }
        ],
    }
    with pytest.raises(LayoutError) as e:
        validate_cloze_blanks(dup, [1, 2])
    assert "出現了兩次" in e.value.message
    assert e.value.path == "layout"


def test_assert_no_cloze_blanks():
    assert_no_cloze_blanks(_load(SAMPLES_DIR / "q25-27-inline-figure.json"))
    assert_no_cloze_blanks(None)
    with pytest.raises(LayoutError) as e:
        assert_no_cloze_blanks(_load(SAMPLES_DIR / "q40-43-cloze.json"))
    assert "克漏字" in e.value.message
