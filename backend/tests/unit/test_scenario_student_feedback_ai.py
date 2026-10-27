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
    MAX_OUTPUT_TOKENS,
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


def _install_fake_vertex(monkeypatch):
    """把 vertexai.generative_models 換成假模組，回傳 (fake, captured)。

    與 `test_scenario_grading_ai` 同一套手法：用 `monkeypatch.setitem(sys.modules, ...)`
    而不是 patch 真模組 —— 後者會觸發真正的 import，而本機／CI 不見得裝得起
    google.cloud.aiplatform（裝不起來時錯誤還會被誤認成程式壞了）。
    """
    import sys
    import types
    from unittest.mock import AsyncMock, MagicMock

    captured = {}

    part = MagicMock()
    part.from_uri.side_effect = lambda uri, mime_type: captured.update(
        uri=uri, mime_type=mime_type
    )
    part.from_data.side_effect = lambda data, mime_type: captured.update(
        data=data, mime_type=mime_type
    )

    response = MagicMock()
    response.text = (
        '{"verdict": "improve", "comment": "再完整一點", '
        '"suggestion": "I went to the park."}'
    )
    response.usage_metadata.prompt_token_count = 3000
    response.usage_metadata.candidates_token_count = 120
    # thinking token 併進 output_tokens（#1119），要明確給值，否則 MagicMock 會流進成本計算
    response.usage_metadata.thoughts_token_count = 0

    model = MagicMock()
    model.generate_content_async = AsyncMock(return_value=response)

    fake = types.ModuleType("vertexai.generative_models")
    fake.Part = part
    fake.GenerativeModel = MagicMock(return_value=model)
    fake.GenerationConfig = MagicMock()

    monkeypatch.setitem(sys.modules, "vertexai.generative_models", fake)
    monkeypatch.setattr("services.vertex_ai.get_vertex_ai_service", lambda: MagicMock())
    return fake, captured


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

    def test_improve_without_suggestion_parses(self):
        """學生是在問單字而不是回答時，prompt 要求模型省略 `suggestion`（#1140 2A）。

        所以 verdict=improve 但沒有 suggestion 是**正常輸出**，不是壞資料 ——
        若解析把它當必填就會整包失敗（PR #1148 review 第 3 點）。
        """
        out = Svc.normalize_result(
            {"verdict": "improve", "comment": "spot 是「地點」的意思，試著回答看看！"}
        )
        assert out["verdict"] == "improve"
        assert out["suggestion"] is None

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


class TestCommentLanguage:
    """評語要用學生看得懂的語言寫；認不得的值回預設而不是丟錯。"""

    def test_known_prefixes(self):
        from services.scenario_student_feedback_ai import comment_language

        assert comment_language("zh-TW") == "Traditional Chinese"
        assert comment_language("zh-CN") == "Traditional Chinese"
        assert comment_language("en") == "English"
        assert comment_language("en-US") == "English"
        assert comment_language("ja") == "Japanese"
        assert comment_language("ko-KR") == "Korean"

    def test_matches_primary_subtag_not_prefix(self):
        """`startswith` 會讓 "enx" 命中 "en"，primary subtag 比對不會。

        用 **非預設** 的語言來驗：拿 "zhx" 驗沒有意義 —— 預設值本來就是
        Traditional Chinese，不管有沒有修都會通過（我第一版就是這樣寫的空測試）。
        """
        from services.scenario_student_feedback_ai import comment_language

        assert comment_language("en") == "English"
        # "enx" 的 primary subtag 是 "enx"，不是 "en" → 應該落到預設，不是 English
        assert comment_language("enx") != "English"
        assert comment_language("japanese-ish") != "Japanese"

    def test_unknown_and_empty_fall_back(self):
        from services.scenario_student_feedback_ai import comment_language

        assert comment_language("klingon") == "Traditional Chinese"
        assert comment_language("") == "Traditional Chinese"
        assert comment_language(None) == "Traditional Chinese"


class TestOutputBudget:
    """截斷事故的回歸測試（staging 實測）。

    `gemini-3.5-flash` 的 thinking token 算在輸出預算裡，而它的 thinking 量比 2.5 大
    很多（#1119）。原本 `MAX_OUTPUT_TOKENS = 1024` 又沒關 thinking，JSON 被截成
    `Unterminated string` → 整包解析失敗 → 學生看到「AI 建議暫時拿不到」。
    """

    def test_output_budget_is_not_tighter_than_the_teacher_side(self):
        """老師端評分（#1035）用 2048 且在 production 穩定，這支不該更緊。"""
        from services import scenario_grading_ai as grading
        from services.scenario_student_feedback_ai import MAX_OUTPUT_TOKENS

        assert MAX_OUTPUT_TOKENS >= grading.MAX_OUTPUT_TOKENS

    @pytest.mark.asyncio
    async def test_generate_disables_thinking_and_asks_for_the_bigger_budget(
        self, monkeypatch
    ):
        """關掉 thinking 是這個修正的**主體**，不是只把上限調大就好。

        thinking 以輸出價計費，而這個任務（聽完說一句鼓勵＋一句建議說法）不需要推理。
        沒關的話預算一樣會被吃掉，只是晚一點才截斷。

        第一版這條測試是用 `inspect.getsource` 比對字串 —— 改個變數名就誤報，而且驗的
        是字串不是行為（PR #1145 review 指出）。改成把整條 generate 跑過一次，直接看
        送進 Vertex 的設定。
        """
        from unittest.mock import MagicMock

        fake, _ = _install_fake_vertex(monkeypatch)
        budgets = []
        monkeypatch.setattr(
            "services.vertex_ai.VertexAIService._set_thinking_budget",
            staticmethod(lambda config, budget: budgets.append(budget)),
        )

        await Svc().generate(
            "https://storage.googleapis.com/b/recordings/a.webm",
            {"question": "What did you do last weekend?"},
        )

        # thinking 關掉
        assert budgets == [0]
        # 輸出上限用的是模組常數，不是某個寫死的小數字
        assert fake.GenerationConfig.call_args.kwargs["max_output_tokens"] == (
            MAX_OUTPUT_TOKENS
        )
        assert isinstance(fake.GenerationConfig, MagicMock)


class TestStudentAsksInsteadOfAnswering:
    """夥伴 staging 回報的兩件事（#1140 2A）。

    1. 學生看不懂某個字時會**逐字母拼出來**問 AI（例如把 "spot" 唸成 S-P-O-T）。
    2. 那不是在回答 —— 照原本的 prompt，模型會把它當成一個很差的回答來評分。

    prompt 層的處理有效果上限（模型對拼讀的辨識本來就不穩），但成本幾乎是零；真正治本
    的是讓學生不需要問（必用字詞顯示字義）或做一個明確的「問 AI」功能，都另外評估。
    """

    def test_prompt_tells_the_model_to_read_spelled_out_words(self):
        prompt = Svc.build_prompt(CRITERIA, "zh-TW")
        assert "letter by letter" in prompt
        assert "S-P-O-T" in prompt

    def test_prompt_handles_the_student_asking_a_question(self):
        prompt = Svc.build_prompt(CRITERIA, "zh-TW")
        assert "not answering at all" in prompt
        # 不要把提問當成差勁的回答來評分
        assert "do not judge their answer" in prompt
        # 問單字意思的時候不給「建議說法」（那會答錯方向）
        assert "Leave `suggestion` out in that case." in prompt
