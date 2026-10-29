"""
上傳題本擷取服務單元測試（Issue #1112 C2）：純函式＋mock 的 AI 呼叫，不打 Vertex、不碰 DB。
"""

import asyncio
import json
import random

import pytest

from services import magic_paste_service as mps
from services.exam_import_dedup import card_signature, norm_key
from services.exam_import_service import assign_accents, taipei_day_bounds
from services.exam_paper_service import (
    CallUsage,
    ExamPaperError,
    ExamPaperService,
    apply_answer_key,
    build_prompt,
    label_to_indexes,
    normalize_answer_key,
    normalize_page,
    normalize_question_no,
    normalize_speakers,
    usage_from_response,
)

pytestmark = [pytest.mark.unit, pytest.mark.no_db]

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def test_existing_magic_paste_modes_unchanged():
    """exam_paper／cloze_group 不可混進既有 /api/programs/magic-paste 的模式清單。"""
    assert mps.EXTRACT_MODES == {
        "vocabulary",
        "sentence",
        "multiple_choice",
        "reading_group",
    }
    assert mps.EXAM_IMPORT_EXTRACT_MODES == {"exam_paper", "cloze_group"}


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("B", [1]),
        ("(c)", [2]),
        ("AC", [0, 2]),
        ("A, D", [0, 3]),
        ("2", [1]),
        ("乙", [1]),
        ("③", [2]),
        ([1, "D"], [1, 3]),
        ("because", []),
        ("", []),
        (None, []),
    ],
)
def test_label_to_indexes(raw, expected):
    assert label_to_indexes(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [("12.", "12"), ("(3)", "3"), (40, "40"), ("  ", None), (None, None)],
)
def test_normalize_question_no(raw, expected):
    assert normalize_question_no(raw) == expected


def test_normalize_answer_key_drops_unreadable():
    key = normalize_answer_key(
        [{"no": "1", "answer": "B"}, {"no": "2", "answer": "??"}, {"answer": "A"}]
    )
    assert key == {"1": [1]}


def _q(no, **kw):
    return {
        "no": no,
        "box_2d": [10, 10, 100, 900],
        "stem": kw.get("stem", f"Question {no}?"),
        "options": kw.get("options", ["a", "b", "c"]),
        "printed_answer_indexes": kw.get("printed", []),
        "ai_answer_indexes": kw.get("ai", []),
        "exam_point_codes": kw.get("codes", []),
        "blank": kw.get("blank"),
        "unreadable": kw.get("unreadable", False),
    }


def test_answer_priority_known_then_printed_then_ai():
    raw = {
        "units": [
            {"kind": "single", "question": _q("1", printed=[2], ai=[0])},
            {"kind": "single", "question": _q("2", printed=[2], ai=[0])},
            {"kind": "single", "question": _q("3", ai=[0])},
            {"kind": "single", "question": _q("4")},
        ]
    }
    is_answer, key, cards = normalize_page(raw, page_no=1, known_answers={"1": [1]})
    assert is_answer is False and key == {}
    got = [
        (c["question"]["correct_indexes"], c["question"]["answer_source"])
        for c in cards
    ]
    assert got == [
        ([1], "answer_page"),
        ([2], "answer_page"),
        ([0], "ai"),
        ([], None),
    ]


def test_unreadable_question_becomes_failed_card():
    raw = {
        "units": [
            {
                "kind": "single",
                "question": {"no": "7", "box_2d": [1, 1, 50, 50], "unreadable": True},
            }
        ]
    }
    _, _, cards = normalize_page(raw, page_no=2)
    assert cards[0]["status"] == "failed"
    assert cards[0]["question"]["source_question_no"] == "7"
    assert cards[0]["bbox"] == [1, 1, 50, 50]


def test_answer_page_detection_requires_no_cards():
    raw = {
        "is_answer_page": True,
        "answer_key": [{"no": "1", "answer": "A"}],
        "units": [],
    }
    assert normalize_page(raw, page_no=16)[:2] == (True, {"1": [0]})
    raw["units"] = [{"kind": "single", "question": _q("1")}]
    assert normalize_page(raw, page_no=16)[0] is False


def test_exam_point_codes_only_from_catalog():
    raw = {
        "units": [
            {
                "kind": "single",
                "question": _q("1", codes=["a.b", "nope", "c", "d", "a.b"]),
            }
        ]
    }
    _, _, cards = normalize_page(
        raw,
        page_no=1,
        exam_point_codes=["a.b", "c", "d", "e"],
        code_to_id={"a.b": 5, "c": 6, "d": 7},
    )
    q = cards[0]["question"]
    assert q["exam_point_codes"] == ["a.b", "c", "d"]
    assert q["exam_point_ids"] == [5, 6, 7]


def test_cloze_group_blanks_fall_back_to_reading_order():
    raw = {
        "units": [
            {
                "kind": "group",
                "group_type": "cloze",
                "stimulus": {"kind": "text", "paragraphs": ["A {{1}} B {{2}} C."]},
                "questions": [
                    _q("40", stem="", blank=None),
                    _q("41", stem="", blank=None),
                    _q("42", stem="", blank=None),
                ],
            }
        ]
    }
    _, _, cards = normalize_page(raw, page_no=1)
    group = cards[0]["group"]
    assert group["group_type"] == "cloze"
    assert [q["blank"] for q in group["questions"]] == [1, 2, None]
    assert [q["source_question_no"] for q in group["questions"]] == ["40", "41", "42"]


def test_group_with_blanks_is_forced_to_cloze_and_reading_clears_blanks():
    raw = {
        "units": [
            {
                "kind": "group",
                "group_type": "reading",
                "stimulus": {"kind": "text", "paragraphs": ["X {{1}}."]},
                "questions": [_q("1", stem="", blank=1)],
            },
            {
                "kind": "group",
                "group_type": "reading",
                "stimulus": {"kind": "text", "paragraphs": ["Plain passage."]},
                "questions": [_q("2", blank=3)],
            },
        ]
    }
    _, _, cards = normalize_page(raw, page_no=1)
    assert cards[0]["group"]["group_type"] == "cloze"
    assert cards[1]["group"]["group_type"] == "reading"
    assert cards[1]["group"]["questions"][0]["blank"] is None


def test_speakers_default_to_female_then_male():
    dialogue = [
        {"speaker": "Kim", "text": "Hi"},
        {"speaker": "Lee", "text": "Hello"},
        {"speaker": "Kim", "text": "Bye"},
    ]
    speakers = normalize_speakers(
        [{"speaker": "Mr. Wang", "gender": "male", "age": "adult"}], dialogue
    )
    assert speakers == [
        {"speaker": "Mr. Wang", "gender": "male", "age": "adult", "inferred": False},
        {"speaker": "Kim", "gender": "female", "age": "young", "inferred": True},
        {"speaker": "Lee", "gender": "male", "age": "young", "inferred": True},
    ]
    only_unknown = normalize_speakers([], dialogue)
    assert [s["gender"] for s in only_unknown] == ["female", "male"]


def test_apply_answer_key_skips_teacher_edits():
    cards = [
        {
            "kind": "single",
            "question": {
                "source_question_no": "1",
                "options": ["a", "b"],
                "correct_indexes": [0],
                "answer_source": "ai",
                "teacher_edited": [],
            },
        },
        {
            "kind": "single",
            "question": {
                "source_question_no": "2",
                "options": ["a", "b"],
                "correct_indexes": [0],
                "answer_source": "teacher",
                "teacher_edited": ["correct_indexes"],
            },
        },
        {
            "kind": "single",
            "question": {
                "source_question_no": "3",
                "options": ["a", "b"],
                "correct_indexes": [],
                "answer_source": None,
                "teacher_edited": [],
            },
        },
        {
            "kind": "single",
            "question": {
                "source_question_no": "4",
                "options": ["a", "b"],
                "correct_indexes": [0],
                "answer_source": "ai",
                "teacher_edited": [],
            },
        },
    ]
    changed = apply_answer_key(cards, {"1": [1], "2": [1], "3": [1], "4": [5]})
    assert changed == 2
    assert [c["question"]["correct_indexes"] for c in cards] == [[1], [0], [1], [0]]
    assert [c["question"]["answer_source"] for c in cards] == [
        "answer_page",
        "teacher",
        "answer_page",
        "ai",
    ]


def test_prompt_carries_known_answers_catalog_and_focus():
    prompt = build_prompt(
        known_answers={"12": [1]},
        exam_point_catalog=[{"code": "grammar.tense", "name": "時態"}],
        focus_question_no="12",
    )
    assert '{"12": [1]}' in prompt
    assert "grammar.tense: 時態" in prompt
    assert 'question number "12"' in prompt
    assert "cloze" in build_prompt(extract_mode="cloze_group").lower()


def test_usage_keeps_thinking_separate_and_costs_it_as_output():
    class Meta:
        prompt_token_count = 1_000_000
        candidates_token_count = 0
        thoughts_token_count = 1_000_000

    class Resp:
        usage_metadata = Meta()

    usage = usage_from_response(Resp(), "gemini-3.5-flash")
    assert (usage.input_tokens, usage.output_tokens, usage.thinking_tokens) == (
        1_000_000,
        0,
        1_000_000,
    )
    # input 1.65 + thinking 以輸出價 9.90
    assert usage.estimated_cost_usd == pytest.approx(1.65 + 9.90)


def test_extract_page_with_mocked_model(monkeypatch):
    async def fake_call(self, image_bytes, mime_type, prompt):
        payload = {"units": [{"kind": "single", "question": _q("1", ai=[2])}]}
        return json.dumps(payload), CallUsage(
            model="gemini-3.5-flash",
            input_tokens=10,
            output_tokens=5,
            thinking_tokens=3,
        )

    monkeypatch.setattr(ExamPaperService, "_call_model", fake_call)
    result = asyncio.run(ExamPaperService().extract_page(PNG, "image/png", page_no=3))
    assert result.page_no == 3
    assert result.cards[0]["question"]["correct_indexes"] == [2]
    assert result.cards[0]["page_no"] == 3
    assert result.usage.thinking_tokens == 3


def test_page_must_be_image():
    with pytest.raises(ExamPaperError):
        ExamPaperService.validate_page_image(b"%PDF-1.4 x", "application/pdf")
    with pytest.raises(Exception):
        ExamPaperService.validate_page_image(b"not an image", "image/png")


def test_norm_key_ignores_space_case_punctuation_and_blanks():
    assert norm_key("What  time, is it?") == norm_key("what time is it")
    assert norm_key("I {{1}} a cat.") == norm_key("I ____ a cat")
    assert norm_key("ＡＢＣ") == norm_key("abc")


def test_group_signature_ignores_options():
    def group(options):
        return {
            "kind": "group",
            "group": {
                "stimulus": {"paragraphs": ["Hello world."], "dialogue": []},
                "questions": [{"stem": "Q1?", "options": options}],
            },
        }

    assert card_signature(group(["a", "b"])) == card_signature(group(["c", "d"]))


def test_assign_accents_balances():
    accents = ["American English", "British English", "Indian English"]
    cards = [{} for _ in range(9)]
    assign_accents(accents, [], cards, random.Random(1))
    counts = {a: sum(c["tts_accent"] == a for c in cards) for a in accents}
    assert set(counts.values()) == {3}
    # 已有口音的卡不改
    fixed = [{"tts_accent": "British English"}]
    assign_accents(accents, [], fixed, random.Random(2))
    assert fixed[0]["tts_accent"] == "British English"


def test_taipei_day_bounds():
    from datetime import datetime, timezone

    start, end = taipei_day_bounds(datetime(2026, 10, 27, 3, 0, tzinfo=timezone.utc))
    assert start == datetime(2026, 10, 26, 16, 0, tzinfo=timezone.utc)
    assert (end - start).total_seconds() == 86400
