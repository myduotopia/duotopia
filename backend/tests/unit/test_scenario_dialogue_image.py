"""情境對話 AI 生圖服務 — Issue #1024 起，#1158 改用 Gemini 生圖模型（REST）。

生圖 API 一律 mock。這裡驗的是我們自己的邏輯：

1. **人物年齡依描述**（#1158 使用者定案）：描述原樣送出，不再把 students／kids
   改寫成場景；``personGeneration`` 用 ``ALLOW_ALL``（2026-10-29 實測 global 可用）。
2. **畫風統一**（#1158）：黑白線稿、不上色、白底、不放文字，並要求畫面合理，
   只有描述明確要求荒謬畫面時才例外。
3. **被擋下時要能分辨**，不能跟「呼叫失敗」混在一起：前者要告訴老師換個描述，
   後者是「再試一次」。
"""
import asyncio
import base64

import pytest

from services.scenario_dialogue_image import (
    IMAGE_LOCATION,
    IMAGE_MODEL,
    ScenarioDialogueImageService,
    ScenarioImageBlockedError,
    ScenarioImageError,
    ScenarioImageUpstreamError,
    build_image_prompt,
)


class TestPromptKeepsDescription:
    """人物年齡依描述：描述原樣保留，不改寫兒童字詞（#1158 使用者定案）。"""

    @pytest.mark.parametrize(
        "raw",
        [
            "students talking in a classroom",
            "two kids playing basketball",
            "a child waiting for the bus",
            "schoolchildren in the playground",
            "a boy and a girl doing homework",
        ],
    )
    def test_people_words_are_kept_as_written(self, raw):
        assert raw in build_image_prompt(raw)

    def test_no_classroom_scene_rewrite(self):
        """#1024 的「students → a classroom scene」改寫已拿掉。"""
        prompt = build_image_prompt("students at the zoo").lower()
        assert "a classroom scene" not in prompt
        assert "students at the zoo" in prompt

    def test_scene_without_people_is_kept_as_is(self):
        raw = "a yellow school bus on a street"
        assert raw in build_image_prompt(raw)

    def test_extra_whitespace_is_collapsed(self):
        assert "two kids at a park" in build_image_prompt("two   kids\n at a park")

    def test_blank_prompt_is_rejected(self):
        with pytest.raises(ScenarioImageError):
            build_image_prompt("   ")

    def test_unknown_kind_is_rejected(self):
        with pytest.raises(ScenarioImageError):
            build_image_prompt("a park", kind="poster")

    def test_prompt_is_length_capped(self):
        prompt = build_image_prompt("a park " * 500)
        assert len(prompt) <= ScenarioDialogueImageService.MAX_PROMPT_CHARS

    def test_style_hint_survives_a_very_long_prompt(self):
        """原文接近上限時，風格提示不該被切掉半句。"""
        prompt = build_image_prompt("a park " * 500, kind="scenario")
        assert prompt.endswith("no text or letters in the image.")


class TestLineArtStyle:
    """#1158：黑白線稿＋畫面合理（使用者定案）。"""

    def test_black_and_white_line_art(self):
        prompt = build_image_prompt("a park").lower()
        assert "black-and-white" in prompt
        assert "line-art" in prompt
        assert "no color" in prompt
        assert "no gray shading" in prompt
        assert "white background" in prompt
        assert "no text or letters" in prompt
        # 人物年齡依描述，未指明時依情境自然判斷；不再一律畫成人
        assert "adults" not in prompt
        assert "ages follow the description" in prompt
        assert "fit the situation naturally" in prompt

    def test_asks_for_a_sensible_picture_unless_told_otherwise(self):
        prompt = build_image_prompt("a park").lower()
        assert "sensible" in prompt
        assert "proportions" in prompt
        # 老師明確要求荒謬畫面時照畫
        assert "explicitly asks for something absurd" in prompt

    def test_kind_changes_the_lead(self):
        scenario = build_image_prompt("a park", kind="scenario")
        question = build_image_prompt("a park", kind="question")
        assert scenario != question
        assert "situation" in scenario
        assert "question" in question


class TestRequestShape:
    def test_body_asks_for_an_image_in_4_3_allowing_all_ages(self):
        body = ScenarioDialogueImageService.build_request_body("p")
        config = body["generationConfig"]
        assert config["responseModalities"] == ["IMAGE"]
        assert config["imageConfig"]["aspectRatio"] == "4:3"
        # 人物年齡依描述，成人與兒童都要能畫（2026-10-29 實測 ALLOW_ALL 可用）
        assert config["imageConfig"]["personGeneration"] == "ALLOW_ALL"

    def test_global_endpoint_has_no_region_prefix(self):
        url = ScenarioDialogueImageService.endpoint_url(
            model="m", location="global", project="p"
        )
        assert url.startswith("https://aiplatform.googleapis.com/")
        assert "/locations/global/" in url
        assert url.endswith("/models/m:generateContent")

    def test_regional_endpoint_has_region_prefix(self):
        url = ScenarioDialogueImageService.endpoint_url(
            model="m", location="us-central1", project="p"
        )
        assert url.startswith("https://us-central1-aiplatform.googleapis.com/")

    def test_model_and_location_come_from_settings(self):
        from core.config import settings

        assert IMAGE_MODEL == settings.VERTEX_IMAGE_MODEL
        assert IMAGE_LOCATION == settings.VERTEX_IMAGE_LOCATION


def _image_response(data=b"JPEGDATA", mime="image/jpeg", tokens=1120):
    return {
        "candidates": [
            {
                "finishReason": "STOP",
                "content": {
                    "parts": [
                        {
                            "inlineData": {
                                "mimeType": mime,
                                "data": base64.b64encode(data).decode(),
                            }
                        }
                    ]
                },
            }
        ],
        "usageMetadata": {"promptTokenCount": 29, "candidatesTokenCount": tokens},
    }


class TestResponseHandling:
    def test_returns_first_image_and_mime_type(self):
        image = ScenarioDialogueImageService.extract_image(_image_response())
        assert image == {"image_bytes": b"JPEGDATA", "mime_type": "image/jpeg"}

    def test_output_tokens_include_thoughts(self):
        response = _image_response(tokens=1120)
        response["usageMetadata"]["thoughtsTokenCount"] = 30
        assert ScenarioDialogueImageService.output_tokens_of(response) == 1150

    def test_output_tokens_missing_is_zero(self):
        assert ScenarioDialogueImageService.output_tokens_of({}) == 0

    def test_prompt_block_is_blocked_error(self):
        with pytest.raises(ScenarioImageBlockedError):
            ScenarioDialogueImageService.extract_image(
                {"promptFeedback": {"blockReason": "SAFETY"}}
            )

    def test_no_candidates_is_blocked_error(self):
        with pytest.raises(ScenarioImageBlockedError):
            ScenarioDialogueImageService.extract_image({"candidates": []})

    @pytest.mark.parametrize("reason", ["SAFETY", "IMAGE_SAFETY", "PROHIBITED_CONTENT"])
    def test_safety_finish_reason_is_blocked_error(self, reason):
        response = {"candidates": [{"finishReason": reason, "content": {"parts": []}}]}
        with pytest.raises(ScenarioImageBlockedError):
            ScenarioDialogueImageService.extract_image(response)

    def test_text_only_answer_is_blocked_error(self):
        """模型拒絕畫、改回一段文字 → 對老師而言就是「換個描述」。"""
        response = {
            "candidates": [
                {
                    "finishReason": "STOP",
                    "content": {"parts": [{"text": "I can't draw that."}]},
                }
            ]
        }
        with pytest.raises(ScenarioImageBlockedError):
            ScenarioDialogueImageService.extract_image(response)

    def test_unexpected_shape_is_not_reported_as_safety_block(self):
        """回應形狀變了（API 改版）不能被講成「你的描述有問題」。"""
        with pytest.raises(ScenarioImageError) as exc:
            ScenarioDialogueImageService.extract_image(["not", "a", "dict"])
        assert not isinstance(exc.value, ScenarioImageBlockedError)


class TestBlockedIsNotAGenericFailure:
    def test_blocked_error_is_a_scenario_image_error(self):
        """繼承關係要在：既有只攔父類的呼叫端不會漏接。"""
        assert issubclass(ScenarioImageBlockedError, ScenarioImageError)

    def test_upstream_error_is_not_a_bad_request(self):
        """Vertex HTTP 錯誤不能被端點當成 400「參數不合法」。"""
        assert not issubclass(ScenarioImageUpstreamError, ScenarioImageError)


class _FakeResponse:
    def __init__(self, status_code, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        return self._payload


class _FakeSession:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def post(self, url, json=None, timeout=None):
        self.calls.append({"url": url, "json": json, "timeout": timeout})
        return self.response


class TestGenerate:
    def _service(self, response):
        service = ScenarioDialogueImageService()
        service._session = _FakeSession(response)
        return service

    def test_returns_bytes_mime_and_tokens(self):
        service = self._service(_FakeResponse(200, _image_response(tokens=1120)))
        result = asyncio.run(service.generate("a park", kind="scenario"))
        assert result["image_bytes"] == b"JPEGDATA"
        assert result["mime_type"] == "image/jpeg"
        assert result["output_tokens"] == 1120
        sent = service._session.calls[0]["json"]["contents"][0]["parts"][0]["text"]
        assert "a park" in sent
        assert "black-and-white" in sent

    def test_http_error_is_upstream_error(self):
        service = self._service(_FakeResponse(404, text="model not found"))
        with pytest.raises(ScenarioImageUpstreamError):
            asyncio.run(service.generate("a park"))

    def test_blocked_response_is_blocked_error(self):
        service = self._service(
            _FakeResponse(200, {"promptFeedback": {"blockReason": "SAFETY"}})
        )
        with pytest.raises(ScenarioImageBlockedError):
            asyncio.run(service.generate("a park"))
