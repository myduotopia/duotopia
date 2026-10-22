"""情境對話「學生答完一題的 AI 建議」服務 — Issue #1140 Stage 1。

與 #1035 的老師端評分（`scenario_grading_ai`）是**兩件不同的事**，共用的只有「Gemini
直讀 GCS 音檔」那段管線：

| | 老師端（#1035） | 學生端（本模組） |
|---|---|---|
| 誰觸發 | 老師在批改頁按 | 學生答完一題自動 |
| 產出 | 逐字稿＋四面向分數＋建議通過 | verdict＋鼓勵式評語＋建議說法 |
| 分數 | 給老師看 | **一律不產生**（學生畫面不顯示分數） |

這支測試最不能出錯的兩件事：

1. **參考答案不可以外洩給學生**。它只能進 prompt 當語言特徵對照 —— 直接回給學生就是
   把答案送給他抄。
2. **不可以逐字比對**。開放式口說同一題每個學生講的內容本來就不同，拿範例逐字比對會
   把所有「不一樣但正確」的回答判成要改進。
"""
import pytest

from services.scenario_student_feedback_ai import (
    ScenarioStudentFeedbackError,
    ScenarioStudentFeedbackInputError,
    ScenarioStudentFeedbackService as Svc,
)


CRITERIA = {
    "question": "What did you do last weekend?",
    "reference_answer": "I went to the park with my family.",
    "keywords": ["went", "park"],
    "tense": {"time": "past", "aspect": "simple"},
    "voice": "active",
    "rubric_note": "要說出地點",
    "global_rubric": "請用完整句子回答",
    "question_level": "B1",
}


class TestBuildPrompt:
    def test_includes_question_keywords_tense_and_rubric(self):
        prompt = Svc.build_prompt(CRITERIA, "zh-TW")
        assert "What did you do last weekend?" in prompt
        assert "went" in prompt and "park" in prompt
        assert "past" in prompt
        assert "要說出地點" in prompt
        assert "請用完整句子回答" in prompt

    def test_reference_answer_is_for_the_model_only(self):
        """參考答案要進 prompt（當語言特徵對照），但必須明講**禁止**逐字比對。

        斷言要綁在「禁止」這件事上，不能只檢查 "word-for-word" 這個詞出現過 ——
        那樣連 "Please compare it word-for-word" 都會通過（mutation 檢查抓到的）。
        """
        prompt = Svc.build_prompt(CRITERIA, "zh-TW")
        assert "I went to the park with my family." in prompt
        assert "NEVER compare" in prompt
        never_idx = prompt.index("NEVER compare")
        sentence = prompt[never_idx : never_idx + 160].lower()
        assert "word-for-word" in sentence
        # 反面：不可以有任何「要求比對」的指示
        assert "please compare" not in prompt.lower()
        assert "compare the student's answer to it word-for-word" in prompt.lower()

    def test_asks_for_the_comment_in_the_students_language(self):
        zh = Svc.build_prompt(CRITERIA, "zh-TW")
        en = Svc.build_prompt(CRITERIA, "en")
        assert "Traditional Chinese" in zh
        assert "English" in en
        assert zh != en

    def test_suggestion_stays_english(self):
        """建議說法是「學生應該怎麼說」—— 永遠是英文，不跟著介面語言變。"""
        for lang in ("zh-TW", "en", "ja", "ko"):
            assert "suggestion" in Svc.build_prompt(CRITERIA, lang)
        assert "in English" in Svc.build_prompt(CRITERIA, "zh-TW")

    def test_no_question_is_an_input_error(self):
        with pytest.raises(ScenarioStudentFeedbackInputError):
            Svc.build_prompt({**CRITERIA, "question": "  "}, "zh-TW")

    def test_unknown_language_falls_back_without_raising(self):
        """介面語言是前端傳來的，不能因為沒見過的值就讓學生卡在等建議。"""
        prompt = Svc.build_prompt(CRITERIA, "klingon")
        assert "What did you do last weekend?" in prompt

    def test_never_asks_for_a_score(self):
        """學生畫面不顯示分數，所以回傳格式裡沒有分數欄位，而且明文禁止提到分數。

        （不能直接斷言 prompt 裡沒有 "score" —— 「不要提到分數」那句本身就含這個字。）
        """
        prompt = Svc.build_prompt(CRITERIA, "zh-TW")
        shape_start = prompt.index("Reply with JSON only")
        shape_end = prompt.index('Use "great" when')
        json_shape = prompt[shape_start:shape_end].lower()
        assert "score" not in json_shape
        assert "overall" not in json_shape
        assert "Never mention scores" in prompt


class TestNormalizeResult:
    def test_happy_path(self):
        out = Svc.normalize_result(
            {
                "verdict": "improve",
                "comment": "意思有傳達到！試著說成完整的句子。",
                "suggestion": "I went to the park with my family.",
            }
        )
        assert out == {
            "verdict": "improve",
            "comment": "意思有傳達到！試著說成完整的句子。",
            "suggestion": "I went to the park with my family.",
        }

    def test_great_needs_no_suggestion(self):
        out = Svc.normalize_result({"verdict": "great", "comment": "很棒！"})
        assert out["verdict"] == "great"
        assert out["suggestion"] is None

    def test_unknown_verdict_falls_back_to_improve(self):
        """認不得的 verdict 一律當「可以更好」—— 誤誇比誤糾更難補救。"""
        out = Svc.normalize_result({"verdict": "perfect", "comment": "嗯"})
        assert out["verdict"] == "improve"

    def test_missing_comment_is_an_error(self):
        """評語是對話裡唯一要顯示的東西，空的就等於一顆空泡泡。"""
        with pytest.raises(ScenarioStudentFeedbackError):
            Svc.normalize_result({"verdict": "great", "comment": "   "})

    def test_non_dict_is_an_error(self):
        with pytest.raises(ScenarioStudentFeedbackError):
            Svc.normalize_result(["improve"])

    def test_scores_from_the_model_are_dropped(self):
        """就算模型自己多給了分數也不往外帶 —— 學生畫面不顯示分數。"""
        out = Svc.normalize_result(
            {"verdict": "great", "comment": "很棒！", "score": 92, "overall": 88}
        )
        assert "score" not in out
        assert "overall" not in out

    def test_reference_answer_echoed_by_the_model_is_dropped(self):
        out = Svc.normalize_result(
            {
                "verdict": "improve",
                "comment": "再試一次",
                "reference_answer": "I went to the park with my family.",
            }
        )
        assert "reference_answer" not in out
