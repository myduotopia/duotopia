"""
Issue #957: 例句「整句翻譯」service 測試

例句翻譯必須整句自然翻譯，不可走「單字＋詞性」路徑（會逐字拆解、加詞性）。
本測試鎖定 translate_sentence / batch_translate_sentences 的 prompt 是整句導向，
且不含強制逐字詞性的格式指令。

以 Vertex AI 路徑測試（prod 走 Vertex），mock vertex_ai.generate_text /
generate_json 為 AsyncMock。
"""
import os
import sys
from unittest.mock import AsyncMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

import pytest  # noqa: E402
from services.translation import TranslationService  # noqa: E402


def _vertex_service():
    """建立一個走 Vertex 路徑、已注入 mock vertex_ai 的 service"""
    service = TranslationService()
    service.use_vertex_ai = True
    service.vertex_ai = AsyncMock()
    return service


class TestTranslateSentence:
    @pytest.mark.asyncio
    async def test_returns_whole_sentence_translation(self):
        """整句翻譯：回傳模型給的整句譯文"""
        service = _vertex_service()
        service.vertex_ai.generate_text = AsyncMock(return_value="我愛拍漂亮的風景照片")

        result = await service.translate_sentence(
            "I love to take pictures of beautiful scenery.", "zh-TW"
        )

        assert result == "我愛拍漂亮的風景照片"
        service.vertex_ai.generate_text.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_prompt_is_sentence_oriented_no_pos(self):
        """prompt 必須是整句導向，且不含強制逐字詞性的格式指令"""
        service = _vertex_service()
        service.vertex_ai.generate_text = AsyncMock(return_value="我愛拍漂亮的風景照片")

        await service.translate_sentence(
            "I love to take pictures of beautiful scenery.", "zh-TW"
        )

        kwargs = service.vertex_ai.generate_text.await_args.kwargs
        prompt = kwargs["prompt"]

        # 整句導向：明確要求整句、自然、不逐字、不標詞性
        assert "句子" in prompt
        assert "自然" in prompt
        assert "不要逐字翻譯" in prompt
        assert "不要標註詞性" in prompt
        # 不得含「單字＋詞性」路徑的強制格式指令
        assert "英文單字翻譯成" not in prompt
        assert "詞性縮寫" not in prompt
        assert "(詞性.)" not in prompt
        assert "n. v. adj." not in prompt

    @pytest.mark.asyncio
    async def test_strips_whitespace(self):
        service = _vertex_service()
        service.vertex_ai.generate_text = AsyncMock(return_value="  我愛拍照  \n")

        result = await service.translate_sentence("I love photos.", "zh-TW")

        assert result == "我愛拍照"

    @pytest.mark.asyncio
    async def test_japanese_label(self):
        service = _vertex_service()
        service.vertex_ai.generate_text = AsyncMock(return_value="写真を撮るのが好きです")

        await service.translate_sentence("I love taking photos.", "ja")

        prompt = service.vertex_ai.generate_text.await_args.kwargs["prompt"]
        assert "日文" in prompt

    @pytest.mark.asyncio
    async def test_error_returns_original(self):
        """模型出錯時回傳原文"""
        service = _vertex_service()
        service.vertex_ai.generate_text = AsyncMock(side_effect=Exception("boom"))

        original = "I love to take pictures."
        result = await service.translate_sentence(original, "zh-TW")

        assert result == original


class TestBatchTranslateSentences:
    @pytest.mark.asyncio
    async def test_batch_returns_translations(self):
        service = _vertex_service()
        service.vertex_ai.generate_json = AsyncMock(return_value=["我愛拍照", "她喜歡跑步"])

        texts = ["I love taking photos.", "She likes running."]
        result = await service.batch_translate_sentences(texts, "zh-TW")

        assert result == ["我愛拍照", "她喜歡跑步"]
        service.vertex_ai.generate_json.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_batch_prompt_sentence_oriented_no_pos(self):
        service = _vertex_service()
        service.vertex_ai.generate_json = AsyncMock(return_value=["我愛拍照", "她喜歡跑步"])

        await service.batch_translate_sentences(
            ["I love taking photos.", "She likes running."], "zh-TW"
        )

        prompt = service.vertex_ai.generate_json.await_args.kwargs["prompt"]
        assert "句子" in prompt
        assert "不要逐字翻譯" in prompt
        # 不得含「單字＋詞性」路徑的強制格式指令
        assert "詞性縮寫" not in prompt
        assert "(詞性.)" not in prompt

    @pytest.mark.asyncio
    async def test_batch_count_mismatch_returns_original(self):
        """數量不符時回傳原文列表"""
        service = _vertex_service()
        service.vertex_ai.generate_json = AsyncMock(return_value=["只有一個"])

        texts = ["one", "two"]
        result = await service.batch_translate_sentences(texts, "zh-TW")

        assert result == texts

    @pytest.mark.asyncio
    async def test_batch_error_returns_original(self):
        service = _vertex_service()
        service.vertex_ai.generate_json = AsyncMock(side_effect=Exception("boom"))

        texts = ["one", "two"]
        result = await service.batch_translate_sentences(texts, "zh-TW")

        assert result == texts
