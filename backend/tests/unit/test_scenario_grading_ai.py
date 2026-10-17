"""情境對話 AI 評分 — Issue #1035。

這張單最容易做錯的一件事：**把參考答案當標準答案去逐字比對**。

口說同一題每個學生講的內容本來就不同（「你上週末做了什麼？」有幾百種合理回答）。
既有的 Azure 發音評測之所以不能用，就是因為它的 `enableMiscue` 會把「講得跟範例不同」
判成漏字錯字。所以這裡的測試重點是 **prompt 有沒有把評分標準講對**：評語言特徵
（時態、句型、用字水準、資訊完整度），不是評字面相似度。

Vertex 一律 mock —— 驗的是我們自己的 prompt 組法與輸出收斂，不是模型的判斷品質。
"""
import pytest

# 一般 import 即可：本模組對 vertexai 的 import 全都在函式內（見服務模組的說明），
# 匯入時不會碰到 SDK。
#
# 不要用 `with patch.dict("sys.modules", {"vertexai": MagicMock()})` 包住這個 import：
# patch.dict 離開時會把「在 with 內才被載入」的模組從 sys.modules 移除，但
# services 套件上的屬性仍指向舊的模組物件。之後 mock.patch("services.scenario_grading_ai
# .ScenarioGradingService.grade") 會 patch 到那個舊 class，而端點在 request 時
# 重新 import 拿到的是新 class —— 於是那次呼叫會真的打 Vertex。這個坑只會讓「同時跑
# 這個檔和端點測試時的第一個測試」壞掉，非常難查。
from services.scenario_grading_ai import (
    ScenarioGradingError,
    ScenarioGradingService,
    mime_type_for_recording,
    to_gcs_uri,
)


CRITERIA = {
    "question": "What did you do last weekend?",
    "reference_answer": "I went to the park with my family last Saturday.",
    "keywords": ["went", "park"],
    "tense": {"time": "past", "aspect": "simple"},
    "voice": "active",
    "rubric_note": "要說出地點",
    "global_rubric": "請用完整句子回答",
    "question_level": "B1",
}


class TestPromptSaysWhatToGradeOn:
    def _prompt(self, **over):
        return ScenarioGradingService.build_prompt({**CRITERIA, **over})

    def test_question_and_reference_are_in_the_prompt(self):
        prompt = self._prompt()
        assert CRITERIA["question"] in prompt
        assert CRITERIA["reference_answer"] in prompt

    def test_prompt_forbids_literal_comparison(self):
        """參考答案必須被標成『示範』，而且明講不要比對字面。

        這是整張單的核心 —— 少了這段，模型會很自然地拿學生的話去對範例。
        """
        prompt = self._prompt().lower()
        assert "do not" in prompt or "don't" in prompt
        # 明確提到「不要逐字／字面比對」的意思
        assert "word-for-word" in prompt or "literal" in prompt
        # 並說明範例的正確用途
        assert "example" in prompt or "sample" in prompt

    def test_prompt_lists_the_language_features(self):
        prompt = self._prompt().lower()
        for feature in ["tense", "vocabulary", "complete"]:
            assert feature in prompt, f"評分面向缺少 {feature}"

    def test_teacher_settings_reach_the_prompt(self):
        prompt = self._prompt()
        assert "past simple" in prompt
        assert "active voice" in prompt
        assert CRITERIA["rubric_note"] in prompt
        assert CRITERIA["global_rubric"] in prompt
        assert "B1" in prompt

    def test_keywords_reach_the_prompt(self):
        prompt = self._prompt()
        for word in CRITERIA["keywords"]:
            assert word in prompt

    def test_unspecified_settings_do_not_become_empty_instructions(self):
        """老師沒指定的東西不該變成空指令去干擾模型（同 #1021 的作法）。"""
        prompt = self._prompt(
            tense={"time": "", "aspect": ""},
            voice="",
            rubric_note="",
            global_rubric="",
            keywords=[],
            question_level="",
        ).lower()
        assert "tense:" not in prompt
        assert "keywords:" not in prompt

    def test_missing_question_is_rejected(self):
        with pytest.raises(ScenarioGradingError):
            self._prompt(question="   ")

    def test_reference_answer_is_optional(self):
        """老師沒寫參考答案也要評得動 —— 靠題目、必用字詞與時態語態即可。"""
        prompt = ScenarioGradingService.build_prompt(
            {**CRITERIA, "reference_answer": ""}
        )
        assert CRITERIA["question"] in prompt


class TestRecordingUri:
    def test_public_gcs_url_becomes_gs_uri(self):
        assert (
            to_gcs_uri(
                "https://storage.googleapis.com/duotopia-audio/recordings/a.webm"
            )
            == "gs://duotopia-audio/recordings/a.webm"
        )

    def test_nested_path_is_preserved(self):
        assert (
            to_gcs_uri("https://storage.googleapis.com/b/x/y/z.mp3")
            == "gs://b/x/y/z.mp3"
        )

    @pytest.mark.parametrize(
        "url",
        [
            "http://localhost:8080/static/recordings/a.webm",  # 本機開發
            "https://example.com/a.webm",
            "",
            None,
        ],
    )
    def test_non_gcs_urls_return_none(self, url):
        """非 GCS 的網址回 None，呼叫端才知道要改用下載的方式（本機開發會走到）。"""
        assert to_gcs_uri(url) is None


class TestNormalizeResult:
    def _raw(self, **over):
        return {
            "transcript": "I went to the park with my friends.",
            "scores": {
                "content": 80,
                "grammar": 70,
                "vocabulary": 75,
                "keywords": 100,
            },
            "overall": 78,
            "feedback": "時態正確，可以多描述細節",
            "suggested_pass": True,
            **over,
        }

    def test_maps_all_fields(self):
        out = ScenarioGradingService.normalize_result(self._raw())
        assert out["transcript"] == "I went to the park with my friends."
        assert out["scores"]["grammar"] == 70
        assert out["overall"] == 78
        assert out["suggested_pass"] is True

    def test_scores_are_clamped_to_0_100(self):
        out = ScenarioGradingService.normalize_result(
            self._raw(scores={"content": 140, "grammar": -20}, overall=999)
        )
        assert out["scores"]["content"] == 100
        assert out["scores"]["grammar"] == 0
        assert out["overall"] == 100

    def test_missing_scores_become_none_not_zero(self):
        """沒評到的面向要留白，不能當成 0 分 —— 0 分和「沒評」意思差很多。"""
        out = ScenarioGradingService.normalize_result(self._raw(scores={"content": 80}))
        assert out["scores"]["content"] == 80
        assert out["scores"]["grammar"] is None

    def test_non_numeric_score_is_treated_as_missing(self):
        out = ScenarioGradingService.normalize_result(
            self._raw(scores={"content": "很好"})
        )
        assert out["scores"]["content"] is None

    def test_empty_transcript_raises(self):
        """一個字都沒轉出來代表這次不可用，要讓老師知道，而不是給一份空評分。"""
        with pytest.raises(ScenarioGradingError):
            ScenarioGradingService.normalize_result(self._raw(transcript="  "))

    def test_bare_json_without_scores_raises(self):
        with pytest.raises(ScenarioGradingError):
            ScenarioGradingService.normalize_result({"transcript": "hello"})


class TestCost:
    def test_cost_is_positive_and_scales(self):
        small = ScenarioGradingService.estimate_cost(
            {"input_tokens": 1000, "output_tokens": 200}
        )
        big = ScenarioGradingService.estimate_cost(
            {"input_tokens": 8000, "output_tokens": 800}
        )
        assert 0 < small < big

    def test_missing_usage_is_zero(self):
        assert ScenarioGradingService.estimate_cost({}) == 0.0


class TestRecordingMimeType:
    """送給 Gemini 的格式必須是**錄音的真實格式**（PR #1036 review）。

    原本寫死 audio/webm。但 macOS Safari 只錄得出 audio/mp4，而且
    frontend/src/utils/audioRecordingStrategy.ts 對認不出來的裝置也是預設 audio/mp4 ——
    這不是邊角案例。

    最糟的情況不是失敗而是**半成功**：Gemini 勉強解出一段破碎的逐字稿，通過
    normalize_result 的非空檢查，於是老師看到一個看起來很正常、其實是格式錯誤造成的
    低分建議。所以格式要從錄音檔本身推導，不能讓呼叫端自己記得傳。
    """

    @pytest.mark.parametrize(
        "url,expected",
        [
            ("https://storage.googleapis.com/b/recordings/a.webm", "audio/webm"),
            ("https://storage.googleapis.com/b/recordings/a.m4a", "audio/mp4"),
            ("https://storage.googleapis.com/b/recordings/a.mp4", "video/mp4"),
            ("https://storage.googleapis.com/b/recordings/a.ogg", "audio/ogg"),
            ("https://storage.googleapis.com/b/recordings/a.opus", "audio/ogg"),
            ("https://storage.googleapis.com/b/recordings/a.mp3", "audio/mpeg"),
            ("https://storage.googleapis.com/b/recordings/a.wav", "audio/wav"),
        ],
    )
    def test_mime_type_comes_from_the_recording_extension(self, url, expected):
        assert mime_type_for_recording(url) == expected

    def test_uppercase_extension_still_resolves(self):
        assert (
            mime_type_for_recording("https://storage.googleapis.com/b/r/A.M4A")
            == "audio/mp4"
        )

    def test_query_string_does_not_break_detection(self):
        assert (
            mime_type_for_recording(
                "https://storage.googleapis.com/b/r/a.m4a?generation=17"
            )
            == "audio/mp4"
        )

    @pytest.mark.parametrize("url", ["", None, "https://x.com/nofile", "a"])
    def test_unknown_falls_back_to_webm(self, url):
        """上傳端對認不得的 content_type 也是落成 .webm，兩邊保持一致。"""
        assert mime_type_for_recording(url) == "audio/webm"

    def test_every_uploadable_format_can_be_graded(self):
        """上傳端支援的每一種格式都要評得動 —— 兩張表不可以各自漂移。

        新增一種錄音格式時，只改 audio_upload 而忘了這裡，會讓那個格式的學生拿到
        用錯格式跑出來的分數。這條測試就是那道閘門。
        """
        from services.audio_upload import RECORDING_CONTENT_TYPE_TO_EXT
        from services.scenario_grading_ai import EXTENSION_TO_MIME

        for content_type, ext in RECORDING_CONTENT_TYPE_TO_EXT.items():
            assert ext in EXTENSION_TO_MIME, (
                f"audio_upload 會產生 .{ext}（{content_type}），"
                f"但 EXTENSION_TO_MIME 沒有這個副檔名"
            )


def _install_fake_vertex(monkeypatch):
    """把 vertexai.generative_models 換成假模組，回傳 (fake, captured)。

    刻意用 ``monkeypatch.setitem(sys.modules, ...)`` 而不是
    ``patch("vertexai.generative_models.Part")``：後者會觸發真正的 import，而 CI／本機
    不見得裝得起 google.cloud.aiplatform（裝不起來時錯誤還會被誤認成程式壞了）。
    直接塞假模組則完全不碰真的 SDK。

    ``captured`` 會記下送進 Part 的 uri／data 與 mime_type，讓測試驗「送出去的是什麼」。
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
        '{"transcript": "I went to the park.", '
        '"scores": {"content": 80, "grammar": 70, '
        '"vocabulary": 75, "keywords": 100}, '
        '"overall": 78, "feedback": "ok", "suggested_pass": true}'
    )
    response.usage_metadata.prompt_token_count = 4000
    response.usage_metadata.candidates_token_count = 300
    # thinking token 現在會併進 output_tokens（Issue #1119），fixture 要明確給值，
    # 否則 MagicMock 會流進成本計算
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


class TestAudioPartCarriesTheRealFormat:
    """推導出來的格式要真的送到 Gemini —— 只在函式裡算對沒有用。"""

    @pytest.mark.asyncio
    async def test_gcs_recording_is_referenced_by_uri_with_its_own_mime_type(
        self, monkeypatch
    ):
        _, captured = _install_fake_vertex(monkeypatch)
        await ScenarioGradingService._audio_part(
            "https://storage.googleapis.com/b/recordings/a.m4a", "audio/mp4"
        )
        assert captured == {
            "uri": "gs://b/recordings/a.m4a",
            "mime_type": "audio/mp4",
        }

    @pytest.mark.asyncio
    async def test_non_gcs_recording_is_downloaded_with_its_own_mime_type(
        self, monkeypatch
    ):
        """本機開發的錄音沒有 gs:// 可用，只能抓下來 —— 格式一樣不能弄錯。"""
        from unittest.mock import MagicMock, patch

        _, captured = _install_fake_vertex(monkeypatch)
        response = MagicMock()
        response.content = b"fake-audio"

        with patch("requests.get", return_value=response):
            await ScenarioGradingService._audio_part(
                "http://localhost:8080/static/recordings/a.m4a", "audio/mp4"
            )
        assert captured == {"data": b"fake-audio", "mime_type": "audio/mp4"}


class TestGradeWiring:
    """grade() 整條路走過一次（Vertex 全 mock）。

    為什麼需要這條：mime_type_for_recording 自己算得對、_audio_part 自己收得對，
    都不代表 grade() 有把前者接到後者。第一版的 bug 就長在這個接縫上 —— 兩端都對，
    中間寫死 audio/webm。
    """

    @pytest.mark.asyncio
    async def test_mp4_recording_is_sent_to_gemini_as_mp4(self, monkeypatch):
        _, captured = _install_fake_vertex(monkeypatch)

        result = await ScenarioGradingService().grade(
            "https://storage.googleapis.com/b/recordings/a.m4a",
            {"question": "What did you do last weekend?"},
        )

        # Safari 錄的 m4a 不能被標成 webm 送出去
        assert captured["mime_type"] == "audio/mp4"
        assert captured["uri"] == "gs://b/recordings/a.m4a"
        assert result["transcript"] == "I went to the park."
        assert result["estimated_cost_usd"] > 0

    @pytest.mark.asyncio
    async def test_webm_recording_still_works(self, monkeypatch):
        _, captured = _install_fake_vertex(monkeypatch)

        await ScenarioGradingService().grade(
            "https://storage.googleapis.com/b/recordings/a.webm",
            {"question": "Q?"},
        )
        assert captured["mime_type"] == "audio/webm"


class TestDownloadDoesNotBlockTheEventLoop:
    """本機下載那條路不可以卡住 event loop（PR #1036 review R2）。

    `grade()` 是 async，但下載用的 requests 是同步的。直接呼叫會把整個 event loop
    卡住最長 30 秒（timeout），同一個 process 上其他請求全部跟著停。
    production 走 GCS 的 from_uri 不受影響，但本機開發與未來的非 GCS 來源會踩到。
    """

    @pytest.mark.asyncio
    async def test_other_tasks_still_run_while_the_recording_downloads(
        self, monkeypatch
    ):
        import asyncio
        import time
        from unittest.mock import MagicMock

        _install_fake_vertex(monkeypatch)
        order = []

        def slow_get(url, timeout):
            time.sleep(0.3)
            response = MagicMock()
            response.content = b"audio"
            return response

        monkeypatch.setattr("requests.get", slow_get)

        async def download():
            await ScenarioGradingService._audio_part(
                "http://localhost:8080/static/recordings/a.webm", "audio/webm"
            )
            order.append("download")

        async def other_request():
            await asyncio.sleep(0.05)
            order.append("other")

        await asyncio.gather(download(), other_request())

        # 卡住 event loop 的話，other_request 連跑都跑不起來，順序會反過來
        assert order == ["other", "download"]
