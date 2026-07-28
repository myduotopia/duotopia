"""
TranslationService 單元測試（Vertex AI / Gemini 路徑）

Issue #947: OpenAI fallback 已移除，所有 AI 呼叫統一走 Vertex AI。
這些測試 mock ``TranslationService.vertex_ai`` 的 generate_text / generate_json，
它們回傳的是已解析的 Python 物件（不是原始 JSON 字串）。
"""
import os
import sys
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

import pytest  # noqa: E402
from services.translation import TranslationService  # noqa: E402


class TestTranslationService:
    """測試 TranslationService"""

    @pytest.fixture
    def service(self):
        """創建測試用 service，vertex_ai 以 mock 注入（避免真實初始化）"""
        svc = TranslationService()
        svc.vertex_ai = AsyncMock()
        return svc

    def test_init(self):
        """測試初始化：vertex_ai 延遲初始化為 None"""
        service = TranslationService()
        assert service.vertex_ai is None

    def test_ensure_client_initializes_vertex(self):
        """測試 _ensure_client 會初始化 Vertex AI service（延遲初始化）

        重置 module 級 singleton 並 mock VertexAIService，避免建立真實
        client 或污染其他測試（test_vertex_ai_service）。
        """
        import services.vertex_ai as vertex_module

        vertex_module._vertex_ai_service = None
        try:
            with patch.object(vertex_module, "VertexAIService") as MockVertex:
                service = TranslationService()
                assert service.vertex_ai is None

                service._ensure_client()

                assert service.vertex_ai is MockVertex.return_value
                MockVertex.assert_called_once()
        finally:
            # 還原 singleton，避免快取到 mock 影響後續測試
            vertex_module._vertex_ai_service = None

    def test_ensure_client_cached(self):
        """測試 client 快取機制：已初始化則不重複建立"""
        import services.vertex_ai as vertex_module

        service = TranslationService()
        existing = Mock()
        service.vertex_ai = existing

        with patch.object(vertex_module, "VertexAIService") as MockVertex:
            service._ensure_client()

        MockVertex.assert_not_called()
        assert service.vertex_ai is existing

    @pytest.mark.asyncio
    async def test_translate_text_zh_tw(self, service):
        """測試翻譯至繁體中文"""
        service.vertex_ai.generate_text = AsyncMock(return_value="翻譯結果")

        result = await service.translate_text("Hello", "zh-TW")

        assert result == "翻譯結果"
        service.vertex_ai.generate_text.assert_awaited_once()

        # 檢查呼叫參數
        kwargs = service.vertex_ai.generate_text.call_args.kwargs
        assert kwargs["model_type"] == "flash"
        assert kwargs["temperature"] == 0.3
        assert kwargs["max_tokens"] == 100
        assert kwargs["disable_thinking"] is True
        assert "繁體中文" in kwargs["prompt"]
        assert "Hello" in kwargs["prompt"]

    @pytest.mark.asyncio
    async def test_translate_text_english_definition(self, service):
        """測試英英釋義（更高 token 上限）"""
        service.vertex_ai.generate_text = AsyncMock(return_value="a common greeting")

        result = await service.translate_text("Hello", "en")

        assert result == "a common greeting"
        kwargs = service.vertex_ai.generate_text.call_args.kwargs
        assert kwargs["max_tokens"] == 200
        assert "English definitions" in kwargs["prompt"]

    @pytest.mark.asyncio
    async def test_translate_text_other_language(self, service):
        """測試翻譯至其他語言"""
        service.vertex_ai.generate_text = AsyncMock(return_value="Hola")

        result = await service.translate_text("Hello", "Spanish")

        assert result == "Hola"
        kwargs = service.vertex_ai.generate_text.call_args.kwargs
        assert "translate the following text to Spanish" in kwargs["prompt"]

    @pytest.mark.asyncio
    async def test_translate_text_strip_whitespace(self, service):
        """測試移除空白字元"""
        service.vertex_ai.generate_text = AsyncMock(return_value="  翻譯結果  \n\t")

        result = await service.translate_text("Hello", "zh-TW")

        assert result == "翻譯結果"

    @pytest.mark.asyncio
    async def test_translate_text_error_handling(self, service):
        """測試錯誤處理：失敗時返回原文"""
        service.vertex_ai.generate_text = AsyncMock(side_effect=Exception("API Error"))

        result = await service.translate_text("Hello", "zh-TW")

        assert result == "Hello"

    @pytest.mark.asyncio
    async def test_translate_text_error_logging(self, service, caplog):
        """測試錯誤記錄"""
        service.vertex_ai.generate_text = AsyncMock(side_effect=Exception("API Error"))

        await service.translate_text("Hello", "zh-TW")

        assert "Translation error: API Error" in caplog.text

    @pytest.mark.asyncio
    async def test_batch_translate_zh_tw(self, service):
        """測試批次翻譯至繁體中文（單次 generate_json 呼叫）"""
        service.vertex_ai.generate_json = AsyncMock(return_value=["你好", "再見", "謝謝"])

        texts = ["Hello", "Goodbye", "Thank you"]
        result = await service.batch_translate(texts, "zh-TW")

        assert result == ["你好", "再見", "謝謝"]
        kwargs = service.vertex_ai.generate_json.call_args.kwargs
        assert kwargs["disable_thinking"] is True

    @pytest.mark.asyncio
    async def test_batch_translate_english_definitions(self, service):
        """測試批次英英釋義"""
        service.vertex_ai.generate_json = AsyncMock(
            return_value=["A greeting", "A farewell", "Expression of gratitude"]
        )

        texts = ["Hello", "Goodbye", "Thank you"]
        result = await service.batch_translate(texts, "en")

        assert result == ["A greeting", "A farewell", "Expression of gratitude"]

    @pytest.mark.asyncio
    async def test_batch_translate_count_mismatch(self, service):
        """測試翻譯數量不匹配時返回原文列表"""
        # AI 只回傳 2 個，但輸入 3 個
        service.vertex_ai.generate_json = AsyncMock(return_value=["你好", "再見"])

        texts = ["Hello", "Goodbye", "Thank you"]
        result = await service.batch_translate(texts, "zh-TW")

        assert result == texts

    @pytest.mark.asyncio
    async def test_batch_translate_error_handling(self, service):
        """測試批次翻譯錯誤處理：失敗時返回原文列表"""
        service.vertex_ai.generate_json = AsyncMock(side_effect=Exception("API Error"))

        texts = ["Hello", "Goodbye"]
        result = await service.batch_translate(texts, "zh-TW")

        assert result == texts

    @pytest.mark.asyncio
    async def test_batch_translate_single_text(self, service):
        """測試批次翻譯單一文本"""
        service.vertex_ai.generate_json = AsyncMock(return_value=["你好"])

        result = await service.batch_translate(["Hello"], "zh-TW")

        assert result == ["你好"]

    @pytest.mark.asyncio
    async def test_batch_translate_empty_list(self, service):
        """測試批次翻譯空列表"""
        service.vertex_ai.generate_json = AsyncMock(return_value=[])

        result = await service.batch_translate([], "zh-TW")

        assert result == []

    def test_global_instance(self):
        """測試全局實例"""
        from services.translation import translation_service

        assert isinstance(translation_service, TranslationService)
