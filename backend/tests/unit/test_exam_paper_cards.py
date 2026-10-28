"""
上傳題本題目卡純函式測試（Issue #1112 C2 review 修正）：跨頁合併（克漏字空格編號、跨三頁）、
口音計數排除延續卡、AI 回應被擋時照記用量；跨過的頁後來有了卡片時拆回重算（C3 review 4）。
不打 Vertex、不碰 DB。
"""

import random

import pytest

from services.exam_import_service import assign_accents
from services.exam_paper_cards import (
    MERGE_PARTS_KEY,
    MERGE_PRE_KEY,
    merge_continuations,
    merge_group_cards,
    renumber_cloze_blanks,
    renumber_cloze_cards,
    strip_merge_records,
    unmerge_invalid_continuations,
)
from services.exam_paper_service import (
    ExamPaperOutputError,
    normalize_page,
    response_text_and_usage,
)

pytestmark = [pytest.mark.unit, pytest.mark.no_db]


def _q(no, blank=None, stem=""):
    return {
        "no": no,
        "box_2d": [100, 50, 200, 950],
        "stem": stem,
        "options": ["a", "b"],
        "ai_answer_indexes": [0],
        "blank": blank,
    }


def _group_card(page_no, paragraphs, questions, cont=False, group_type="cloze"):
    unit = {
        "kind": "group",
        "group_type": group_type,
        "continues_previous": cont,
        "title": "T",
        "stimulus": {"kind": "text", "paragraphs": paragraphs},
        "questions": questions,
    }
    _, _, cards = normalize_page({"units": [unit]}, page_no=page_no)
    return cards[0]


def _single_card(page_no, no):
    _, _, cards = normalize_page(
        {"units": [{"kind": "single", "question": _q(no, stem="Q?")}]},
        page_no=page_no,
    )
    return cards[0]


# ---------------------------------------------------------------- 克漏字空格編號


def test_cloze_continuation_with_only_questions_keeps_passage_numbering():
    """文章全在上一頁、下一頁只有小題（AI 從 1 編）：不加位移，依閱讀順序對到文章空格。"""
    target = _group_card(
        1, ["I {{1}} a cat, {{2}} a dog and {{3}} a bird."], [_q("40", 1), _q("41", 2)]
    )
    cont = _group_card(2, [], [_q("42", 1)], cont=True)
    merge_group_cards(target, cont)
    g = target["group"]
    assert [q["source_question_no"] for q in g["questions"]] == ["40", "41", "42"]
    assert [q["blank"] for q in g["questions"]] == [1, 2, 3]
    assert g["stimulus"]["paragraphs"] == [
        "I {{1}} a cat, {{2}} a dog and {{3}} a bird."
    ]


def test_cloze_continuation_already_numbered_is_not_offset_twice():
    target = _group_card(
        1, ["I {{1}} a cat and {{2}} a dog."], [_q("40", 1), _q("41", 2)]
    )
    cont = _group_card(2, ["They {{3}} friends."], [_q("42", 3)], cont=True)
    merge_group_cards(target, cont)
    g = target["group"]
    assert g["stimulus"]["paragraphs"][-1] == "They {{3}} friends."
    assert [q["blank"] for q in g["questions"]] == [1, 2, 3]


def test_cloze_continuation_restarting_at_one_is_offset():
    target = _group_card(
        1, ["I {{1}} a cat and {{2}} a dog."], [_q("40", 1), _q("41", 2)]
    )
    cont = _group_card(2, ["They {{1}} friends."], [_q("42", 1)], cont=True)
    merge_group_cards(target, cont)
    g = target["group"]
    assert g["stimulus"]["paragraphs"][-1] == "They {{3}} friends."
    assert [q["blank"] for q in g["questions"]] == [1, 2, 3]


def test_cloze_offset_ignores_bogus_question_blanks():
    """位移只看文章空格：上一頁小題 blank 亂填（9）不會讓下一頁位移過頭。"""
    target = _group_card(
        1, ["I {{1}} a cat and {{2}} a dog."], [_q("40", 1), _q("41", 2)]
    )
    target["group"]["questions"][1]["blank"] = 9
    cont = _group_card(2, ["They {{1}} friends."], [_q("42", 1)], cont=True)
    merge_group_cards(target, cont)
    g = target["group"]
    assert g["stimulus"]["paragraphs"] == [
        "I {{1}} a cat and {{2}} a dog.",
        "They {{3}} friends.",
    ]
    assert [q["blank"] for q in g["questions"]] == [1, 2, 3]


def test_cloze_merge_renumbers_whole_group_from_one():
    """AI 用原卷題號當空格編號（41 起）：合併後整組依閱讀順序重編 1..k。"""
    target = _group_card(
        1, ["I {{41}} a cat and {{42}} a dog."], [_q("41", 41), _q("42", 42)]
    )
    cont = _group_card(2, ["They {{43}} friends."], [_q("43", 43)], cont=True)
    merge_group_cards(target, cont)
    g = target["group"]
    assert g["stimulus"]["paragraphs"] == [
        "I {{1}} a cat and {{2}} a dog.",
        "They {{3}} friends.",
    ]
    assert [q["blank"] for q in g["questions"]] == [1, 2, 3]


def test_renumber_cloze_blanks_maps_questions_and_drops_unknown():
    paragraphs = ["A {{5}} b {{9}}.", "C {{5}} d {{12}}."]
    questions = [{"blank": 12}, {"blank": 5}, {"blank": 7}, {"blank": None}]
    out = renumber_cloze_blanks(paragraphs, questions)
    assert out == ["A {{1}} b {{2}}.", "C {{1}} d {{3}}."]
    assert [q["blank"] for q in questions] == [3, 1, None, None]


def test_renumber_cloze_cards_single_page_cloze_from_one():
    """單頁克漏字（原卷第 41 題起）寫入時也重編 1..k；閱讀題組、沒有空格的題組不動。"""
    import copy

    cloze = _group_card(
        1, ["I {{41}} a cat and {{42}} a dog."], [_q("41", 41), _q("42", 42)]
    )
    reading = _group_card(1, ["Plain text."], [_q("7", 7)], group_type="reading")
    no_blanks = _group_card(1, ["No blanks here."], [_q("50", 50)])
    single = _single_card(1, "60")
    untouched = copy.deepcopy([reading, no_blanks, single])
    renumber_cloze_cards([cloze, reading, no_blanks, single])
    assert cloze["group"]["stimulus"]["paragraphs"] == [
        "I {{1}} a cat and {{2}} a dog."
    ]
    assert [q["blank"] for q in cloze["group"]["questions"]] == [1, 2]
    assert [reading, no_blanks, single] == untouched


# ---------------------------------------------------------------- 跨頁合併


def test_group_spanning_three_pages_is_merged_into_first_page():
    pages = {
        1: [
            _single_card(1, "1"),
            _group_card(1, ["Part one."], [_q("2")], group_type="reading"),
        ],
        2: [_group_card(2, ["Part two."], [_q("3")], cont=True, group_type="reading")],
        3: [
            _group_card(3, ["Part three."], [_q("4")], cont=True, group_type="reading"),
            _single_card(3, "5"),
        ],
    }
    changed = merge_continuations(pages)
    assert changed == {1, 2, 3}
    merged = pages[1][-1]
    assert merged["pages"] == [1, 2, 3]
    assert [q["source_question_no"] for q in merged["group"]["questions"]] == [
        "2",
        "3",
        "4",
    ]
    assert merged["group"]["stimulus"]["paragraphs"] == [
        "Part one.",
        "Part two.",
        "Part three.",
    ]
    assert pages[2] == []
    assert [c["kind"] for c in pages[3]] == ["single"]


def test_unmerge_and_remerge_when_skipped_page_gets_cards():
    """第 2 頁原本是空的（空白頁略過），第 3 頁越過它併到第 1 頁；第 2 頁後來擷取到延續卡 →
    拆回各頁再合併，題組順序 1→2→3。"""
    pages = {
        1: [_group_card(1, ["Part one."], [_q("2")], group_type="reading")],
        2: [],
        3: [
            _group_card(3, ["Part three."], [_q("4")], cont=True, group_type="reading"),
            _single_card(3, "5"),
        ],
    }
    assert merge_continuations(pages, record=True) == {1, 3}
    assert MERGE_PRE_KEY in pages[1][0] and MERGE_PARTS_KEY in pages[1][0]
    # 跨過的頁還是空的：不拆
    assert unmerge_invalid_continuations(pages) == set()

    pages[2] = [
        _group_card(2, ["Part two."], [_q("3")], cont=True, group_type="reading")
    ]
    assert unmerge_invalid_continuations(pages) == {1, 3}
    assert pages[1][0]["group"]["stimulus"]["paragraphs"] == ["Part one."]
    assert [c["kind"] for c in pages[3]] == ["group", "single"]

    merge_continuations(pages, record=True)
    merged = pages[1][0]
    assert merged["pages"] == [1, 2, 3]
    assert [q["source_question_no"] for q in merged["group"]["questions"]] == [
        "2",
        "3",
        "4",
    ]
    assert pages[2] == [] and [c["kind"] for c in pages[3]] == ["single"]
    assert all(not k.startswith("_merge") for k in strip_merge_records([merged])[0])


def test_merge_without_record_leaves_no_bookkeeping():
    pages = {
        1: [_group_card(1, ["Part one."], [_q("2")], group_type="reading")],
        2: [_group_card(2, ["Part two."], [_q("3")], cont=True, group_type="reading")],
    }
    merge_continuations(pages)
    assert MERGE_PRE_KEY not in pages[1][0] and MERGE_PARTS_KEY not in pages[1][0]


def test_continuation_waits_for_unprocessed_middle_page():
    pages = {
        1: [_group_card(1, ["Part one."], [_q("2")], group_type="reading")],
        2: None,  # 還沒處理完
        3: [
            _group_card(3, ["Part three."], [_q("4")], cont=True, group_type="reading")
        ],
    }
    assert merge_continuations(pages) == set()
    assert pages[3][0]["continues_previous"] is True


def test_continuation_not_merged_into_single():
    pages = {
        1: [_single_card(1, "1")],
        2: [_group_card(2, ["x"], [_q("2")], cont=True, group_type="reading")],
    }
    assert merge_continuations(pages) == set()


# ---------------------------------------------------------------- 口音


def test_continuation_cards_do_not_count_for_accent_balance():
    accents = ["American English", "British English"]
    existing = [
        {"tts_accent": "American English"},
        {"tts_accent": "British English", "continues_previous": True},
    ]
    new = [{}]
    assign_accents(accents, existing, new, random.Random(0))
    # 延續卡不算：美式 1、英式 0 → 新卡一定抽英式
    assert new[0]["tts_accent"] == "British English"

    # 新的延續卡自己仍有口音，但不影響下一張的平均分配
    batch = [{"continues_previous": True}, {}, {}]
    assign_accents(accents, [], batch, random.Random(3))
    assert batch[0]["tts_accent"] in accents
    assert {batch[1]["tts_accent"], batch[2]["tts_accent"]} == set(accents)


# ---------------------------------------------------------------- AI 回應被擋


class _Meta:
    prompt_token_count = 1200
    candidates_token_count = 0
    thoughts_token_count = 300


class _BlockedResponse:
    usage_metadata = _Meta()

    @property
    def text(self):
        raise ValueError("Response has no candidates (blocked by safety filters)")


class _EmptyResponse:
    usage_metadata = _Meta()
    text = "   "


@pytest.mark.parametrize("response", [_BlockedResponse(), _EmptyResponse()])
def test_blocked_or_empty_response_raises_with_usage(response):
    with pytest.raises(ExamPaperOutputError) as info:
        response_text_and_usage(response, "gemini-3.5-flash")
    usage = info.value.usage
    assert (usage.input_tokens, usage.thinking_tokens) == (1200, 300)
    assert usage.estimated_cost_usd > 0
