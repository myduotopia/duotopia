"""
Test for Issue #203: Batch AI Sentence Generation Array Misalignment

This test file validates that the generate_sentences method:
1. Returns array matching input length
2. Each sentence object contains the original word field
3. Handles array misalignment scenarios correctly
4. Maintains 1:1 correspondence even when AI fails partially

All AI generation now goes through Vertex AI (Gemini), so these tests mock
``TranslationService.vertex_ai.generate_json`` which returns already-parsed
Python objects (not raw JSON strings).
"""
import os
import sys
from unittest.mock import AsyncMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest  # noqa: E402
from services.translation import TranslationService  # noqa: E402


def _make_vertex_service():
    """Create a TranslationService wired to a mocked Vertex AI client."""
    service = TranslationService()
    service.vertex_ai = AsyncMock()
    # _ensure_client() must not try to (re)initialise the real client
    service._ensure_client = lambda: None
    return service


@pytest.mark.unit
class TestSentenceGenerationMisalignment:
    """Test cases for sentence generation array misalignment issue (#203)"""

    @pytest.fixture
    def service(self):
        """Create test service instance"""
        return _make_vertex_service()

    @pytest.mark.asyncio
    async def test_generate_sentences_returns_matching_array_length(self, service):
        """Test that generate_sentences returns array matching input word count"""
        words = ["apple", "banana", "cherry", "date", "elderberry"]

        service.vertex_ai.generate_json = AsyncMock(
            return_value=[
                {"sentence": "I eat an apple every day.", "word": "apple"},
                {"sentence": "The banana is yellow.", "word": "banana"},
                {"sentence": "I love cherry pie.", "word": "cherry"},
                {"sentence": "A date is a sweet fruit.", "word": "date"},
                {"sentence": "Elderberry is good for health.", "word": "elderberry"},
            ]
        )

        results = await service.generate_sentences(words=words, level="A1")

        # Verify length matches
        assert len(results) == len(
            words
        ), f"Expected {len(words)} sentences, got {len(results)}"

        # Verify each result has a word field
        for i, result in enumerate(results):
            assert "word" in result, f"Sentence at index {i} missing 'word' field"
            assert (
                result["word"] == words[i]
            ), f"Expected word '{words[i]}', got '{result.get('word')}'"

    @pytest.mark.asyncio
    async def test_generate_sentences_includes_word_field(self, service):
        """Test that each sentence object contains the original word field for verification"""
        words = ["like", "change", "run"]

        service.vertex_ai.generate_json = AsyncMock(
            return_value=[
                {"sentence": "I like to read books.", "word": "like"},
                {"sentence": "Change is inevitable.", "word": "change"},
                {"sentence": "I run every morning.", "word": "run"},
            ]
        )

        results = await service.generate_sentences(words=words)

        # Each result must have word field matching input
        for i, result in enumerate(results):
            assert "word" in result, f"Result {i} missing 'word' field"
            assert "sentence" in result, f"Result {i} missing 'sentence' field"
            assert result["word"] == words[i], f"Word mismatch at index {i}"

    @pytest.mark.asyncio
    async def test_generate_sentences_handles_incomplete_ai_response(self, service):
        """Test array misalignment scenario when AI returns fewer sentences than words"""
        words = ["word1", "word2", "word3", "word4", "word5"]

        # AI returns only 3 sentences instead of 5
        service.vertex_ai.generate_json = AsyncMock(
            return_value=[
                {"sentence": "This is word1 example."},
                {"sentence": "This is word2 example."},
                {"sentence": "This is word3 example."},
            ]
        )

        results = await service.generate_sentences(words=words)

        # Must still return 5 results with fallback for missing ones
        assert len(results) == len(
            words
        ), f"Expected {len(words)} results, got {len(results)}"

        # All results must have word field
        for i, result in enumerate(results):
            assert "word" in result, f"Result {i} missing 'word' field"
            assert (
                result["word"] == words[i]
            ), f"Expected word '{words[i]}' at index {i}, got '{result.get('word')}'"

    @pytest.mark.asyncio
    async def test_generate_sentences_handles_excess_ai_response(self, service):
        """Test when AI returns more sentences than requested"""
        words = ["cat", "dog"]

        # AI returns 4 sentences instead of 2
        service.vertex_ai.generate_json = AsyncMock(
            return_value=[
                {"sentence": "The cat is sleeping.", "word": "cat"},
                {"sentence": "The dog is barking.", "word": "dog"},
                {"sentence": "Extra sentence 1."},
                {"sentence": "Extra sentence 2."},
            ]
        )

        results = await service.generate_sentences(words=words)

        # Should truncate to match input length
        assert len(results) == len(
            words
        ), f"Expected {len(words)} results, got {len(results)}"

    @pytest.mark.asyncio
    async def test_generate_sentences_fallback_maintains_correspondence(self, service):
        """Test that fallback mechanism maintains 1:1 word correspondence on error"""
        words = ["test1", "test2", "test3"]

        # Exception triggers fallback
        service.vertex_ai.generate_json = AsyncMock(side_effect=Exception("API Error"))

        results = await service.generate_sentences(words=words)

        # Fallback should still return correct length
        assert len(results) == len(
            words
        ), f"Expected {len(words)} fallback results, got {len(results)}"

        # Each fallback result should have word field
        for i, result in enumerate(results):
            assert "word" in result, f"Fallback result {i} missing 'word' field"
            assert result["word"] == words[i], f"Fallback word mismatch at index {i}"
            assert "sentence" in result, f"Fallback result {i} missing 'sentence' field"

    @pytest.mark.asyncio
    async def test_generate_sentences_with_translation(self, service):
        """Test that translations are preserved with word correspondence"""
        words = ["hello", "world"]

        service.vertex_ai.generate_json = AsyncMock(
            return_value=[
                {
                    "sentence": "Hello everyone!",
                    "translation": "大家好！",
                    "word": "hello",
                },
                {
                    "sentence": "The world is beautiful.",
                    "translation": "世界很美麗。",
                    "word": "world",
                },
            ]
        )

        results = await service.generate_sentences(words=words, translate_to="zh-TW")

        assert len(results) == len(words)
        for i, result in enumerate(results):
            assert result["word"] == words[i]
            assert "translation" in result

    @pytest.mark.asyncio
    async def test_generate_sentences_ai_missing_word_field(self, service):
        """Test backend adds word field when AI response doesn't include it"""
        words = ["apple", "banana"]

        # AI returns sentences WITHOUT word field
        service.vertex_ai.generate_json = AsyncMock(
            return_value=[
                {"sentence": "I like apples."},
                {"sentence": "Bananas are yellow."},
            ]
        )

        results = await service.generate_sentences(words=words)

        # Backend should add word field even if AI didn't include it
        assert len(results) == len(words)
        for i, result in enumerate(results):
            assert "word" in result, f"Result {i} missing 'word' field"
            assert (
                result["word"] == words[i]
            ), f"Expected word '{words[i]}', got '{result['word']}'"


@pytest.mark.unit
class TestSentenceGenerationChunking:
    """Test cases for batch chunking to avoid token truncation (#505)"""

    @pytest.fixture
    def service(self):
        """Create test service instance with mocked Vertex client"""
        return _make_vertex_service()

    @pytest.mark.asyncio
    async def test_large_batch_is_chunked(self, service):
        """10 words should be split into 2 chunks of 5, each getting its own API call"""
        words = [f"word{i}" for i in range(10)]

        call_count = 0

        async def mock_generate_json(**kwargs):
            nonlocal call_count
            call_count += 1
            prompt = kwargs.get("prompt", "")
            chunk_words = [w for w in words if f'"word": "{w}"' in prompt]
            return [{"sentence": f"Example with {w}.", "word": w} for w in chunk_words]

        service.vertex_ai.generate_json = AsyncMock(side_effect=mock_generate_json)

        results = await service.generate_sentences(words=words, level="A1")

        assert len(results) == 10, f"Expected 10 sentences, got {len(results)}"
        assert call_count == 2, f"Expected 2 API calls (chunks), got {call_count}"
        for i, result in enumerate(results):
            assert result["word"] == words[i]

    @pytest.mark.asyncio
    async def test_small_batch_no_chunking(self, service):
        """3 words should NOT be chunked (under SENTENCE_CHUNK_SIZE)"""
        words = ["cat", "dog", "bird"]

        service.vertex_ai.generate_json = AsyncMock(
            return_value=[
                {"sentence": "The cat is sleeping.", "word": "cat"},
                {"sentence": "The dog is barking.", "word": "dog"},
                {"sentence": "The bird is singing.", "word": "bird"},
            ]
        )

        results = await service.generate_sentences(words=words, level="A1")

        assert len(results) == 3
        assert service.vertex_ai.generate_json.call_count == 1

    @pytest.mark.asyncio
    async def test_chunk_failure_isolation(self, service):
        """If one chunk fails, other chunks should still return valid results"""
        words = [f"word{i}" for i in range(10)]

        call_number = 0

        async def mock_generate_json(**kwargs):
            nonlocal call_number
            call_number += 1
            if call_number == 2:
                raise Exception("API rate limit exceeded")
            prompt = kwargs.get("prompt", "")
            chunk_words = [w for w in words if f'"word": "{w}"' in prompt]
            return [
                {"sentence": f"Good sentence for {w}.", "word": w} for w in chunk_words
            ]

        service.vertex_ai.generate_json = AsyncMock(side_effect=mock_generate_json)

        results = await service.generate_sentences(words=words, level="A1")

        # All 10 words should have results
        assert len(results) == 10

        # First 5 should have real sentences
        for i in range(5):
            assert "Good sentence" in results[i]["sentence"]
            assert results[i]["word"] == words[i]

        # Last 5 should have fallback sentences (from failed chunk)
        for i in range(5, 10):
            assert "example with" in results[i]["sentence"].lower()
            assert results[i]["word"] == words[i]

    @pytest.mark.asyncio
    async def test_large_batch_chunked_vertex_ai(self):
        """Vertex AI path: 10 words should be chunked into 2 batches"""
        svc = _make_vertex_service()

        words = [f"word{i}" for i in range(10)]
        call_count = 0

        async def mock_generate_json(**kwargs):
            nonlocal call_count
            call_count += 1
            prompt = kwargs.get("prompt", "")
            chunk_words = [w for w in words if f'"word": "{w}"' in prompt]
            return [
                {"sentence": f"Vertex example with {w}.", "word": w}
                for w in chunk_words
            ]

        svc.vertex_ai.generate_json = AsyncMock(side_effect=mock_generate_json)

        results = await svc.generate_sentences(words=words, level="A1")

        assert len(results) == 10
        assert call_count == 2, f"Expected 2 Vertex AI calls, got {call_count}"
        for i, result in enumerate(results):
            assert result["word"] == words[i]
            assert "Vertex example" in result["sentence"]


@pytest.mark.unit
class TestSentenceTranslationBackfill:
    """Issue #873: ensure every sentence has a translation when translate_to is set.

    The AI intermittently omits the ``translation`` field for some sentences
    (most often the first word during magic-paste), which left the example
    sentence translation blank in the UI. The service must backfill any missing
    translation via ``translate_text``.
    """

    @pytest.fixture
    def service(self):
        return _make_vertex_service()

    @pytest.mark.asyncio
    async def test_missing_translation_is_backfilled(self, service):
        """When AI omits translation for the first word, it is filled via translate_text."""
        words = ["grape", "passionfruit"]

        # AI response: first sentence has NO translation, second one does.
        service.vertex_ai.generate_json = AsyncMock(
            return_value=[
                {"sentence": "I ate a grape.", "word": "grape"},
                {
                    "sentence": "Passionfruit is sweet.",
                    "translation": "百香果很甜。",
                    "word": "passionfruit",
                },
            ]
        )

        # Mock the fallback single-sentence translator.
        service.translate_text = AsyncMock(return_value="我吃了一顆葡萄。")

        results = await service.generate_sentences(words=words, translate_to="zh-TW")

        # Fallback called exactly once, for the missing (first) sentence.
        service.translate_text.assert_awaited_once_with("I ate a grape.", "zh-TW")

        # Both sentences now have a non-empty translation.
        assert results[0]["translation"] == "我吃了一顆葡萄。"
        assert results[1]["translation"] == "百香果很甜。"

    @pytest.mark.asyncio
    async def test_empty_string_translation_is_backfilled(self, service):
        """A present-but-empty translation is also treated as missing."""
        words = ["grape"]

        service.vertex_ai.generate_json = AsyncMock(
            return_value=[
                {"sentence": "I ate a grape.", "translation": "  ", "word": "grape"}
            ]
        )
        service.translate_text = AsyncMock(return_value="我吃了一顆葡萄。")

        results = await service.generate_sentences(words=words, translate_to="zh-TW")

        service.translate_text.assert_awaited_once_with("I ate a grape.", "zh-TW")
        assert results[0]["translation"] == "我吃了一顆葡萄。"

    @pytest.mark.asyncio
    async def test_no_backfill_when_translate_to_is_none(self, service):
        """When no translation is requested, no fallback runs and no translation key is added."""
        words = ["grape", "passionfruit"]

        service.vertex_ai.generate_json = AsyncMock(
            return_value=[
                {"sentence": "I ate a grape.", "word": "grape"},
                {"sentence": "Passionfruit is sweet.", "word": "passionfruit"},
            ]
        )
        service.translate_text = AsyncMock(return_value="should-not-be-used")

        results = await service.generate_sentences(words=words, translate_to=None)

        service.translate_text.assert_not_awaited()
        for result in results:
            assert "translation" not in result

    @pytest.mark.asyncio
    async def test_backfill_failure_leaves_empty_translation(self, service):
        """If the fallback translate_text raises, the sentence keeps an empty translation
        rather than propagating the error."""
        words = ["grape"]

        service.vertex_ai.generate_json = AsyncMock(
            return_value=[{"sentence": "I ate a grape.", "word": "grape"}]
        )
        service.translate_text = AsyncMock(side_effect=Exception("translate down"))

        results = await service.generate_sentences(words=words, translate_to="zh-TW")

        assert results[0]["translation"] == ""
