"""
Test for Issue #874: generate_sentences 與 distractors 補上 disable_thinking=True

When USE_VERTEX_AI=true, gemini-2.5-flash runs with thinking ENABLED by default,
and max_output_tokens is shared between thinking and output tokens. The three AI
paths below previously omitted disable_thinking=True, which caused:
  1. 3~13x slower latency (model spends time thinking)
  2. JSON truncation ("Unterminated string") — thinking ate the token budget

These tests assert that every Vertex AI generate_json call made by the
sentence/distractor paths passes disable_thinking=True, matching the already-correct
translation paths.
"""
import os
import sys
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest  # noqa: E402
from services.translation import TranslationService  # noqa: E402


@pytest.mark.unit
class TestVertexDisableThinking:
    """Issue #874: Vertex AI 生成路徑必須關閉 thinking"""

    @pytest.fixture
    def vertex_service(self):
        """Service forced into Vertex AI mode with a mocked vertex client."""
        service = TranslationService()
        service.use_vertex_ai = True
        service.vertex_ai = AsyncMock()
        # _ensure_client() must not try to (re)initialise the real client
        service._ensure_client = lambda: None
        return service

    @pytest.mark.asyncio
    async def test_generate_sentences_disables_thinking(self, vertex_service):
        vertex_service.vertex_ai.generate_json = AsyncMock(
            return_value=[{"sentence": "I eat an apple.", "translation": "我吃蘋果。"}]
        )

        await vertex_service.generate_sentences(words=["apple"], level="A1")

        vertex_service.vertex_ai.generate_json.assert_awaited()
        kwargs = vertex_service.vertex_ai.generate_json.call_args.kwargs
        assert kwargs.get("disable_thinking") is True

    @pytest.mark.asyncio
    async def test_generate_distractors_disables_thinking(self, vertex_service):
        vertex_service.vertex_ai.generate_json = AsyncMock(return_value=["香蕉", "橘子"])

        await vertex_service.generate_distractors(
            word="apple", translation="蘋果", count=2
        )

        vertex_service.vertex_ai.generate_json.assert_awaited()
        kwargs = vertex_service.vertex_ai.generate_json.call_args.kwargs
        assert kwargs.get("disable_thinking") is True

    @pytest.mark.asyncio
    async def test_batch_generate_distractors_disables_thinking(self, vertex_service):
        vertex_service.vertex_ai.generate_json = AsyncMock(return_value=[["香蕉", "橘子"]])

        await vertex_service.batch_generate_distractors(
            words=[{"word": "apple", "translation": "蘋果"}], count=2
        )

        vertex_service.vertex_ai.generate_json.assert_awaited()
        kwargs = vertex_service.vertex_ai.generate_json.call_args.kwargs
        assert kwargs.get("disable_thinking") is True
