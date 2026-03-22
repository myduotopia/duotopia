"""
Test for Issue #203: Batch AI Sentence Generation Array Misalignment

This test file validates that the generate_sentences method:
1. Returns array matching input length
2. Each sentence object contains the original word field
3. Handles array misalignment scenarios correctly
4. Maintains 1:1 correspondence even when AI fails partially
"""
import os
import sys
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest  # noqa: E402
from services.translation import TranslationService  # noqa: E402


@pytest.mark.unit
class TestSentenceGenerationMisalignment:
    """Test cases for sentence generation array misalignment issue (#203)"""

    @pytest.fixture
    def service(self):
        """Create test service instance"""
        return TranslationService()

    @pytest.mark.asyncio
    async def test_generate_sentences_returns_matching_array_length(self, service):
        """Test that generate_sentences returns array matching input word count"""
        words = ["apple", "banana", "cherry", "date", "elderberry"]

        # Mock OpenAI response with correct number of sentences
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[
            0
        ].message.content = """[
            {"sentence": "I eat an apple every day.", "word": "apple"},
            {"sentence": "The banana is yellow.", "word": "banana"},
            {"sentence": "I love cherry pie.", "word": "cherry"},
            {"sentence": "A date is a sweet fruit.", "word": "date"},
            {"sentence": "Elderberry is good for health.", "word": "elderberry"}
        ]"""

        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}):
            with patch("services.translation.OpenAI") as mock_openai:
                mock_client = Mock()
                mock_client.chat.completions.create = AsyncMock(
                    return_value=mock_response
                )
                mock_openai.return_value = mock_client

                service._ensure_client()
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

        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[
            0
        ].message.content = """[
            {"sentence": "I like to read books.", "word": "like"},
            {"sentence": "Change is inevitable.", "word": "change"},
            {"sentence": "I run every morning.", "word": "run"}
        ]"""

        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}):
            with patch("services.translation.OpenAI") as mock_openai:
                mock_client = Mock()
                mock_client.chat.completions.create = AsyncMock(
                    return_value=mock_response
                )
                mock_openai.return_value = mock_client

                service._ensure_client()
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

        # Mock OpenAI returning only 3 sentences instead of 5
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[
            0
        ].message.content = """[
            {"sentence": "This is word1 example."},
            {"sentence": "This is word2 example."},
            {"sentence": "This is word3 example."}
        ]"""

        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}):
            with patch("services.translation.OpenAI") as mock_openai:
                mock_client = Mock()
                mock_client.chat.completions.create = AsyncMock(
                    return_value=mock_response
                )
                mock_openai.return_value = mock_client

                service._ensure_client()
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

        # Mock OpenAI returning 4 sentences instead of 2
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[
            0
        ].message.content = """[
            {"sentence": "The cat is sleeping.", "word": "cat"},
            {"sentence": "The dog is barking.", "word": "dog"},
            {"sentence": "Extra sentence 1."},
            {"sentence": "Extra sentence 2."}
        ]"""

        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}):
            with patch("services.translation.OpenAI") as mock_openai:
                mock_client = Mock()
                mock_client.chat.completions.create = AsyncMock(
                    return_value=mock_response
                )
                mock_openai.return_value = mock_client

                service._ensure_client()
                results = await service.generate_sentences(words=words)

        # Should truncate to match input length
        assert len(results) == len(
            words
        ), f"Expected {len(words)} results, got {len(results)}"

    @pytest.mark.asyncio
    async def test_generate_sentences_fallback_maintains_correspondence(self, service):
        """Test that fallback mechanism maintains 1:1 word correspondence on error"""
        words = ["test1", "test2", "test3"]

        # Mock exception to trigger fallback
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}):
            with patch("services.translation.OpenAI") as mock_openai:
                mock_client = Mock()
                mock_client.chat.completions.create = AsyncMock(
                    side_effect=Exception("API Error")
                )
                mock_openai.return_value = mock_client

                service._ensure_client()
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

        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[
            0
        ].message.content = """[
            {"sentence": "Hello everyone!", "translation": "大家好！", "word": "hello"},
            {"sentence": "The world is beautiful.", "translation": "世界很美麗。", "word": "world"}
        ]"""

        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}):
            with patch("services.translation.OpenAI") as mock_openai:
                mock_client = Mock()
                mock_client.chat.completions.create = AsyncMock(
                    return_value=mock_response
                )
                mock_openai.return_value = mock_client

                service._ensure_client()
                results = await service.generate_sentences(
                    words=words, translate_to="zh-TW"
                )

        assert len(results) == len(words)
        for i, result in enumerate(results):
            assert result["word"] == words[i]
            assert "translation" in result

    @pytest.mark.asyncio
    async def test_generate_sentences_ai_missing_word_field(self, service):
        """Test backend adds word field when AI response doesn't include it"""
        words = ["apple", "banana"]

        # Mock AI returning sentences WITHOUT word field
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[
            0
        ].message.content = """[
            {"sentence": "I like apples."},
            {"sentence": "Bananas are yellow."}
        ]"""

        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}):
            with patch("services.translation.OpenAI") as mock_openai:
                mock_client = Mock()
                mock_client.chat.completions.create = AsyncMock(
                    return_value=mock_response
                )
                mock_openai.return_value = mock_client

                service._ensure_client()
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
        """Create test service instance with mocked client"""
        svc = TranslationService()
        svc.use_vertex_ai = False
        return svc

    @pytest.mark.asyncio
    async def test_large_batch_is_chunked(self, service):
        """10 words should be split into 2 chunks of 5, each getting its own API call"""
        words = [f"word{i}" for i in range(10)]

        call_count = 0

        async def mock_create(**kwargs):
            nonlocal call_count
            call_count += 1
            import json

            prompt_content = kwargs["messages"][1]["content"]
            chunk_words = [w for w in words if f'"word": "{w}"' in prompt_content]
            sentences = [
                {"sentence": f"Example with {w}.", "word": w} for w in chunk_words
            ]
            mock_resp = Mock()
            mock_resp.choices = [Mock()]
            mock_resp.choices[0].message.content = json.dumps(sentences)
            return mock_resp

        mock_client = Mock()
        mock_client.chat.completions.create = AsyncMock(side_effect=mock_create)
        service.client = mock_client

        results = await service.generate_sentences(words=words, level="A1")

        assert len(results) == 10, f"Expected 10 sentences, got {len(results)}"
        assert call_count == 2, f"Expected 2 API calls (chunks), got {call_count}"
        for i, result in enumerate(results):
            assert result["word"] == words[i]

    @pytest.mark.asyncio
    async def test_small_batch_no_chunking(self, service):
        """3 words should NOT be chunked (under SENTENCE_CHUNK_SIZE)"""
        words = ["cat", "dog", "bird"]

        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[
            0
        ].message.content = """[
            {"sentence": "The cat is sleeping.", "word": "cat"},
            {"sentence": "The dog is barking.", "word": "dog"},
            {"sentence": "The bird is singing.", "word": "bird"}
        ]"""

        mock_client = Mock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
        service.client = mock_client

        results = await service.generate_sentences(words=words, level="A1")

        assert len(results) == 3
        assert mock_client.chat.completions.create.call_count == 1

    @pytest.mark.asyncio
    async def test_chunk_failure_isolation(self, service):
        """If one chunk fails, other chunks should still return valid results"""
        words = [f"word{i}" for i in range(10)]

        call_number = 0

        async def mock_create(**kwargs):
            nonlocal call_number
            call_number += 1
            if call_number == 2:
                raise Exception("API rate limit exceeded")
            import json

            prompt_content = kwargs["messages"][1]["content"]
            chunk_words = [w for w in words if f'"word": "{w}"' in prompt_content]
            sentences = [
                {"sentence": f"Good sentence for {w}.", "word": w} for w in chunk_words
            ]
            mock_resp = Mock()
            mock_resp.choices = [Mock()]
            mock_resp.choices[0].message.content = json.dumps(sentences)
            return mock_resp

        mock_client = Mock()
        mock_client.chat.completions.create = AsyncMock(side_effect=mock_create)
        service.client = mock_client

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
