"""Unit tests for VertexAIService"""

import json
import pytest
from unittest.mock import patch, MagicMock, AsyncMock


# Mock vertexai before importing the service
with patch.dict("sys.modules", {"vertexai": MagicMock()}):
    from services.vertex_ai import (
        VertexAIService,
        FLASH_MODEL,
        PRO_MODEL,
        get_vertex_ai_service,
    )


class TestVertexAIServiceInit:
    """Test VertexAIService initialization"""

    def test_default_config(self):
        service = VertexAIService()
        assert service.project_id == "duotopia-472708"
        assert service.location == "us-central1"
        assert service._initialized is False
        assert service._flash_model is None
        assert service._pro_model is None

    @patch.dict("os.environ", {"VERTEX_AI_PROJECT_ID": "test-proj", "VERTEX_AI_LOCATION": "us-west1"})
    def test_custom_config(self):
        service = VertexAIService()
        assert service.project_id == "test-proj"
        assert service.location == "us-west1"

    def test_model_constants(self):
        assert FLASH_MODEL == "gemini-2.5-flash"
        assert PRO_MODEL == "gemini-2.5-pro"


class TestGetModel:
    """Test _get_model method - cached vs new instances"""

    def setup_method(self):
        self.service = VertexAIService()
        self.service._initialized = True  # skip vertexai.init()

    @patch("services.vertex_ai.VertexAIService._ensure_initialized")
    def test_flash_model_cached(self, mock_init):
        """Without system_instruction, flash model should be cached"""
        with patch("vertexai.generative_models.GenerativeModel") as MockModel:
            mock_instance = MagicMock()
            MockModel.return_value = mock_instance

            model1 = self.service._get_model("flash")
            model2 = self.service._get_model("flash")

            assert model1 is model2
            MockModel.assert_called_once_with(FLASH_MODEL)

    @patch("services.vertex_ai.VertexAIService._ensure_initialized")
    def test_pro_model_cached(self, mock_init):
        """Without system_instruction, pro model should be cached"""
        with patch("vertexai.generative_models.GenerativeModel") as MockModel:
            mock_instance = MagicMock()
            MockModel.return_value = mock_instance

            model1 = self.service._get_model("pro")
            model2 = self.service._get_model("pro")

            assert model1 is model2
            MockModel.assert_called_once_with(PRO_MODEL)

    @patch("services.vertex_ai.VertexAIService._ensure_initialized")
    def test_system_instruction_creates_new_model(self, mock_init):
        """With system_instruction, a new model should be created each time"""
        with patch("vertexai.generative_models.GenerativeModel") as MockModel:
            mock_instance = MagicMock()
            MockModel.return_value = mock_instance

            model1 = self.service._get_model("flash", system_instruction="instruction A")
            model2 = self.service._get_model("flash", system_instruction="instruction B")

            assert MockModel.call_count == 2
            MockModel.assert_any_call(FLASH_MODEL, system_instruction="instruction A")
            MockModel.assert_any_call(FLASH_MODEL, system_instruction="instruction B")

    @patch("services.vertex_ai.VertexAIService._ensure_initialized")
    def test_flash_and_pro_are_separate_caches(self, mock_init):
        """Flash and pro models should have separate caches"""
        with patch("vertexai.generative_models.GenerativeModel") as MockModel:
            flash_mock = MagicMock(name="flash")
            pro_mock = MagicMock(name="pro")
            MockModel.side_effect = [flash_mock, pro_mock]

            flash = self.service._get_model("flash")
            pro = self.service._get_model("pro")

            assert flash is not pro
            assert MockModel.call_count == 2


class TestGenerateText:
    """Test generate_text async method"""

    def setup_method(self):
        self.service = VertexAIService()
        self.service._initialized = True

    @pytest.mark.asyncio
    async def test_generate_text_returns_response(self):
        """generate_text should return the model's text response"""
        mock_response = MagicMock()
        mock_response.text = "Hello world"

        mock_model = MagicMock()
        mock_model.generate_content_async = AsyncMock(return_value=mock_response)

        with patch.object(self.service, "_get_model", return_value=mock_model):
            result = await self.service.generate_text("test prompt")

        assert result == "Hello world"
        mock_model.generate_content_async.assert_called_once()

    @pytest.mark.asyncio
    async def test_generate_text_passes_system_instruction(self):
        """system_instruction should be forwarded to _get_model"""
        mock_response = MagicMock()
        mock_response.text = "result"
        mock_model = MagicMock()
        mock_model.generate_content_async = AsyncMock(return_value=mock_response)

        with patch.object(self.service, "_get_model", return_value=mock_model) as mock_get:
            await self.service.generate_text(
                "prompt", system_instruction="be helpful"
            )

        mock_get.assert_called_once_with("flash", "be helpful")

    @pytest.mark.asyncio
    async def test_generate_text_uses_pro_model(self):
        """model_type='pro' should request pro model"""
        mock_response = MagicMock()
        mock_response.text = "result"
        mock_model = MagicMock()
        mock_model.generate_content_async = AsyncMock(return_value=mock_response)

        with patch.object(self.service, "_get_model", return_value=mock_model) as mock_get:
            await self.service.generate_text("prompt", model_type="pro")

        mock_get.assert_called_once_with("pro", None)

    @pytest.mark.asyncio
    async def test_generate_text_raises_on_error(self):
        """Errors from model should propagate"""
        mock_model = MagicMock()
        mock_model.generate_content_async = AsyncMock(side_effect=RuntimeError("API error"))

        with patch.object(self.service, "_get_model", return_value=mock_model):
            with pytest.raises(RuntimeError, match="API error"):
                await self.service.generate_text("prompt")


class TestGenerateJson:
    """Test generate_json async method and JSON parsing fallbacks"""

    def setup_method(self):
        self.service = VertexAIService()
        self.service._initialized = True

    def _make_mock_model(self, response_text):
        mock_response = MagicMock()
        mock_response.text = response_text
        mock_model = MagicMock()
        mock_model.generate_content_async = AsyncMock(return_value=mock_response)
        return mock_model

    @pytest.mark.asyncio
    async def test_clean_json_response(self):
        """Clean JSON should parse directly"""
        mock_model = self._make_mock_model('{"key": "value"}')
        with patch.object(self.service, "_get_model", return_value=mock_model):
            result = await self.service.generate_json("prompt")
        assert result == {"key": "value"}

    @pytest.mark.asyncio
    async def test_json_array_response(self):
        """JSON array should parse correctly"""
        mock_model = self._make_mock_model('[{"a": 1}, {"b": 2}]')
        with patch.object(self.service, "_get_model", return_value=mock_model):
            result = await self.service.generate_json("prompt")
        assert result == [{"a": 1}, {"b": 2}]

    @pytest.mark.asyncio
    async def test_json_with_markdown_prefix(self):
        """JSON prefixed with ```json marker should be cleaned"""
        mock_model = self._make_mock_model('```json\n{"key": "value"}')
        with patch.object(self.service, "_get_model", return_value=mock_model):
            result = await self.service.generate_json("prompt")
        assert result == {"key": "value"}

    @pytest.mark.asyncio
    async def test_json_with_prefix_text(self):
        """JSON with prefix text should be extracted via bracket matching"""
        mock_model = self._make_mock_model('Here is the result: {"key": "value"}')
        with patch.object(self.service, "_get_model", return_value=mock_model):
            result = await self.service.generate_json("prompt")
        assert result == {"key": "value"}

    @pytest.mark.asyncio
    async def test_json_array_with_prefix(self):
        """JSON array with prefix should be extracted"""
        mock_model = self._make_mock_model('Result: [1, 2, 3]')
        with patch.object(self.service, "_get_model", return_value=mock_model):
            result = await self.service.generate_json("prompt")
        assert result == [1, 2, 3]

    @pytest.mark.asyncio
    async def test_nested_json_bracket_matching(self):
        """Nested JSON should be parsed correctly via bracket counting"""
        nested = '{"outer": {"inner": [1, 2]}}'
        mock_model = self._make_mock_model(f"Some text {nested} more text")
        with patch.object(self.service, "_get_model", return_value=mock_model):
            result = await self.service.generate_json("prompt")
        assert result == {"outer": {"inner": [1, 2]}}

    @pytest.mark.asyncio
    async def test_invalid_json_raises(self):
        """Completely invalid JSON should raise JSONDecodeError"""
        mock_model = self._make_mock_model("not json at all")
        with patch.object(self.service, "_get_model", return_value=mock_model):
            with pytest.raises(json.JSONDecodeError):
                await self.service.generate_json("prompt")

    @pytest.mark.asyncio
    async def test_passes_system_instruction(self):
        """system_instruction should be forwarded to _get_model"""
        mock_model = self._make_mock_model('{"ok": true}')
        with patch.object(self.service, "_get_model", return_value=mock_model) as mock_get:
            await self.service.generate_json("prompt", system_instruction="be precise")
        mock_get.assert_called_once_with("flash", "be precise")


class TestGenerateTextSync:
    """Test generate_text_sync method"""

    def setup_method(self):
        self.service = VertexAIService()
        self.service._initialized = True

    def test_sync_returns_response(self):
        """generate_text_sync should return the model's text response"""
        mock_response = MagicMock()
        mock_response.text = "sync result"
        mock_model = MagicMock()
        mock_model.generate_content.return_value = mock_response

        with patch.object(self.service, "_get_model", return_value=mock_model):
            result = self.service.generate_text_sync("prompt")

        assert result == "sync result"

    def test_sync_passes_system_instruction(self):
        """system_instruction should be forwarded"""
        mock_response = MagicMock()
        mock_response.text = "result"
        mock_model = MagicMock()
        mock_model.generate_content.return_value = mock_response

        with patch.object(self.service, "_get_model", return_value=mock_model) as mock_get:
            self.service.generate_text_sync("prompt", system_instruction="be brief")

        mock_get.assert_called_once_with("flash", "be brief")


class TestGetVertexAIService:
    """Test the singleton factory function"""

    def test_returns_same_instance(self):
        """get_vertex_ai_service should return the same instance"""
        import services.vertex_ai as module

        module._vertex_ai_service = None  # reset
        svc1 = get_vertex_ai_service()
        svc2 = get_vertex_ai_service()
        assert svc1 is svc2
        module._vertex_ai_service = None  # cleanup
