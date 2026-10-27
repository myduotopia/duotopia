"""
上傳題本題目卡純函式測試（Issue #1112 C2 review 修正）：跨頁合併（克漏字空格編號、跨三頁）、
口音計數排除延續卡、AI 回應被擋時照記用量。不打 Vertex、不碰 DB。
"""

import random

import pytest

from services.exam_import_service import assign_accents
from services.exam_paper_cards import merge_continuations, merge_group_cards
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
