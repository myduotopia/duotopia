"""
Issue #1051: /generate-sentences 的 generate_audio 旗標

單題「AI 生成例句」只要例句＋翻譯，不可順便產生音檔；
批次等既有呼叫不帶旗標（預設 True）時維持 Issue #757 的同步 TTS。
"""
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

import pytest  # noqa: E402
from routers.teachers import translation_ops  # noqa: E402
from routers.teachers.validators import GenerateSentencesRequest  # noqa: E402


def _sentences():
    return [{"word": "apple", "sentence": "I eat an apple.", "translation": "我吃蘋果。"}]


@pytest.mark.asyncio
async def test_generate_audio_false_skips_tts():
    request = GenerateSentencesRequest(words=["apple"], generate_audio=False)
    tts = MagicMock()
    tts.generate_tts = AsyncMock(return_value="https://cdn/a.mp3")

    with patch.object(
        translation_ops.translation_service,
        "generate_sentences",
        AsyncMock(return_value=_sentences()),
    ), patch("services.tts.get_tts_service", return_value=tts):
        result = await translation_ops.generate_sentences(
            request, current_teacher=MagicMock(), db=MagicMock()
        )

    tts.generate_tts.assert_not_awaited()
    assert result["sentences"][0]["audio_url"] is None
    assert result["sentences"][0]["sentence"] == "I eat an apple."


@pytest.mark.asyncio
async def test_generate_audio_defaults_to_true():
    request = GenerateSentencesRequest(words=["apple"])
    assert request.generate_audio is True
    tts = MagicMock()
    tts.generate_tts = AsyncMock(return_value="https://cdn/a.mp3")

    with patch.object(
        translation_ops.translation_service,
        "generate_sentences",
        AsyncMock(return_value=_sentences()),
    ), patch("services.tts.get_tts_service", return_value=tts):
        result = await translation_ops.generate_sentences(
            request, current_teacher=MagicMock(), db=MagicMock()
        )

    tts.generate_tts.assert_awaited_once()
    assert result["sentences"][0]["audio_url"] == "https://cdn/a.mp3"
