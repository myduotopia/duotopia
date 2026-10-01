"""Issue #1092: 打字類小考評分方式（utils/quiz_scoring.py）單元測試。

驗算例與計畫／前端 quizScoring.test.ts 同一組數字：每題 4 分（25 題）、正解
``look forward to``。另涵蓋上限、未作答、N=1、大小寫、空格、多打字、舊作答
（無 typed_words）與「method=NULL / whole_question 與 #1045 公式逐案相等」。
"""

import pytest

from utils.quiz_scoring import (
    FIXED_PER_LETTER,
    FIXED_PER_WORD,
    PER_WORD,
    PER_WORD_LENIENT,
    SCORING_METHODS,
    WHOLE_QUESTION,
    edit_distance,
    effective_method,
    evaluate_answer,
    evaluate_answer_data,
    question_deduction,
    round_half_up_1,
    split_slots,
    total_score,
)

CORRECT = "look forward to"
PER_Q = 4.0  # 100 / 25 題


def _ded(method, answer, points=None, per_q=PER_Q, correct=CORRECT, case=False):
    return question_deduction(
        method, points, per_q, evaluate_answer(answer, correct, case)
    )


# ---------------------------------------------------------------------------
# 基礎
# ---------------------------------------------------------------------------


def test_methods_and_effective_method():
    assert SCORING_METHODS == (
        "whole_question",
        "per_word",
        "per_word_lenient",
        "fixed_per_word",
        "fixed_per_letter",
    )
    assert effective_method(None) == WHOLE_QUESTION
    assert effective_method(PER_WORD) == PER_WORD


@pytest.mark.parametrize(
    "a,b,expected",
    [
        ("forward", "forward", 0),
        ("forwerd", "forward", 1),  # 打錯
        ("forwad", "forward", 1),  # 少打
        ("forwaard", "forward", 1),  # 多打
        ("", "forward", 7),  # 空格 = 單字字母數
        ("to", "", 2),
    ],
)
def test_edit_distance(a, b, expected):
    assert edit_distance(a, b) == expected


def test_round_half_up():
    assert round_half_up_1(0.25) == 0.3
    assert round_half_up_1(1.25) == 1.3
    assert round_half_up_1(2.65) == 2.7  # float 2.65 實為 2.6499…，經 str() 仍 half-up
    assert round_half_up_1(0.04) == 0.0


# ---------------------------------------------------------------------------
# 計畫驗算例（每題 4 分、look forward to）
# ---------------------------------------------------------------------------


def test_per_word_examples():
    assert _ded(PER_WORD, ["look", "forwerd", "to"]) == 1.3  # 錯 1 字
    assert _ded(PER_WORD, ["look", "forwerd", "too"]) == 2.7  # 錯 2 字


def test_per_word_lenient_examples():
    assert _ded(PER_WORD_LENIENT, ["look", "forwerd", "to"]) == 0.7
    assert _ded(PER_WORD_LENIENT, ["look", "forword", "too"]) == 1.3
    # 「look to」第 3 格空：to 對 forward 錯整字、空格錯整字
    assert _ded(PER_WORD_LENIENT, ["look", "to", ""]) == 2.7


def test_fixed_per_word_example():
    assert _ded(FIXED_PER_WORD, ["look", "forwerd", "too"], points=1) == 2.0


def test_fixed_per_letter_example():
    # lok(1) + forwad(1) + t(1) = 差 3 個字母
    assert _ded(FIXED_PER_LETTER, ["lok", "forwad", "t"], points=0.5) == 1.5


# ---------------------------------------------------------------------------
# 共用規則
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("method", SCORING_METHODS)
def test_all_correct_deducts_zero(method):
    assert _ded(method, ["look", "forward", "to"], points=1) == 0.0


@pytest.mark.parametrize("method", SCORING_METHODS)
def test_unanswered_deducts_full_per_q(method):
    per_q = 100 / 3
    assert question_deduction(method, 1, per_q, None) == per_q


@pytest.mark.parametrize("method", SCORING_METHODS)
def test_all_slots_empty_counts_as_unanswered(method):
    # 每格都空白 ＝ 未作答 → 整題扣（D 每字 1 分 × 3 = 3 也不會少扣）
    per_q = 100 / 3
    assert _ded(method, ["", "", ""], points=1, per_q=per_q) == per_q
    assert _ded(method, "", points=1, per_q=per_q) == per_q


def test_cap_at_per_q_returns_exact_per_q():
    per_q = 100 / 7  # 14.285714…
    # D：每錯一字 10 分 × 3 字 = 30 → 上限 per_q（原值、不捨入）
    assert _ded(FIXED_PER_WORD, ["a", "b", "c"], points=10, per_q=per_q) == per_q
    # E：每字母 5 分 × 3 字母 = 15 > 14.29 → per_q
    assert _ded(FIXED_PER_LETTER, ["lok", "forwad", "t"], 5, per_q=per_q) == per_q


def test_partial_rounding_up_to_per_q_counts_as_full():
    per_q = 100 / 7  # 14.2857
    # 14.27 → 捨入 14.3 ≥ per_q → 視為全扣
    assert (
        question_deduction(
            FIXED_PER_LETTER,
            14.27,
            per_q,
            evaluate_answer(["lok", "forward", "to"], CORRECT),
        )
        == per_q
    )


def test_whole_question_any_wrong_is_full():
    assert _ded(WHOLE_QUESTION, ["look", "forwerd", "to"]) == PER_Q
    assert _ded(None, ["look", "forwerd", "to"]) == PER_Q  # NULL ＝ 整題計分


def test_single_word_question():
    # N=1：B 錯即全扣；C 差 1 字母扣一半
    assert _ded(PER_WORD, ["appel"], correct="apple") == PER_Q
    assert _ded(PER_WORD_LENIENT, ["appl"], correct="apple") == 2.0
    # C：單字長度 1 不給一半
    assert _ded(PER_WORD_LENIENT, ["b"], correct="a") == PER_Q


def test_lenient_empty_slot_never_half():
    # 正解 "to"（長度 2）漏填：d=2 → 整字；長度 > 1 的單字只差 1 字母才給一半
    ev = evaluate_answer(["look", "forward", ""], CORRECT)
    assert ev["per_word_half"] == [False, False, False]
    assert _ded(PER_WORD_LENIENT, ["look", "forward", ""]) == 1.3


def test_case_sensitivity():
    assert evaluate_answer(["Apple"], "apple", case_sensitive=False)["is_correct"]
    ev = evaluate_answer(["Apple"], "apple", case_sensitive=True)
    assert ev["is_correct"] is False
    assert ev["wrong_letters"] == 1
    # 舊作答（字串）同樣吃開關
    assert evaluate_answer(" Apple ", "apple")["is_correct"] is True
    assert (
        evaluate_answer(" Apple ", "apple", case_sensitive=True)["is_correct"] is False
    )


def test_blank_slot_keeps_position():
    # 跳過第 1 格直接填第 2、3 格：B 只扣第 1 個單字
    ev = evaluate_answer(["", "forward", "to"], CORRECT)
    assert ev["wrong_words"] == 1
    assert ev["per_word_distance"] == [4, 0, 0]
    assert _ded(PER_WORD, ["", "forward", "to"]) == 1.3
    assert _ded(FIXED_PER_LETTER, ["", "forward", "to"], points=0.5) == 2.0


def test_fewer_slots_than_words_pads_with_blanks():
    ev = evaluate_answer(["look"], CORRECT)
    assert ev["wrong_words"] == 2
    assert ev["wrong_letters"] == 7 + 2


def test_extra_words_are_merged_into_last_slot():
    # 多打字（API 誤用／舊資料）：多出的併入最後一格 → 最後一格錯、整題不對
    ev = evaluate_answer(["look", "forward", "to", "it"], CORRECT)
    assert ev["is_correct"] is False
    assert ev["wrong_words"] == 1
    assert ev["per_word_distance"] == [0, 0, 3]  # "to it" vs "to"
    # 多出的空字串忽略
    assert evaluate_answer(["look", "forward", "to", ""], CORRECT)["is_correct"]


def test_legacy_typed_answer_without_typed_words():
    # 舊作答沒有 typed_words → typed_answer.split()（盡力而為），is_correct 用整串比對
    data = {"typed_answer": "look forwerd to"}
    ev = evaluate_answer_data(data, CORRECT)
    assert ev["is_correct"] is False
    assert ev["wrong_words"] == 1
    assert split_slots(data, CORRECT) == (
        ["look", "forwerd", "to"],
        ["look", "forward", "to"],
    )
    # typed_words 存在時優先
    data2 = {"typed_answer": "forward to", "typed_words": ["", "forward", "to"]}
    assert split_slots(data2, CORRECT)[0] == ["", "forward", "to"]
    assert evaluate_answer_data(data2, CORRECT)["per_word_distance"] == [4, 0, 0]


@pytest.mark.parametrize(
    "typed,correct",
    [
        ("apple", "apple"),
        ("Apple ", "apple"),
        ("  look forward to", "look forward to"),
        ("look  forward to", "look forward to"),  # 中間兩個空白：舊判定為錯
        ("look forward", "look forward to"),
        ("", "apple"),
        ("apple", ""),
        ("", ""),
    ],
)
def test_legacy_string_is_correct_matches_828(typed, correct):
    """沒送 typed_words、不分大小寫 → 與 #828 的 strip().lower() 整串比對完全相同。"""
    expected = typed.strip().lower() == correct.strip().lower()
    assert evaluate_answer(typed, correct, False)["is_correct"] is expected


# ---------------------------------------------------------------------------
# 總分
# ---------------------------------------------------------------------------


def test_total_score_matches_legacy_formula_exactly():
    """method=NULL / whole_question：每題只有 0 或 per_q → 與 #1045 公式逐案相等。"""
    for n in range(1, 61):
        per_q = 100 / n
        for wrong in range(n + 1):
            deductions = [per_q] * wrong + [0.0] * (n - wrong)
            legacy = round(max(0.0, min(100.0, 100.0 - wrong * per_q)), 1)
            assert total_score(per_q, deductions) == legacy, (n, wrong)


def test_total_score_with_partial_deductions():
    per_q = 4.0
    # 1.3 + 0.7 + 全扣 4 → 100 − 6 = 94.0
    assert total_score(per_q, [1.3, 0.7, per_q, 0.0]) == 94.0
    per_q = 100 / 3
    # 33.33… + 2.7 → 100 − 36.0333… = 63.97 → 64.0
    assert total_score(per_q, [per_q, 2.7, 0.0]) == 64.0


def test_total_score_clamps_at_zero():
    per_q = 50.0
    assert total_score(per_q, [per_q, per_q]) == 0.0
