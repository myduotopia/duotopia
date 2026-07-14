"""
魔術貼上 AI 擷取服務（issue #891）。

從上傳的圖片 / PDF 擷取單字教材內容（單字、翻譯、詞性、例句、例句翻譯），
一次 AI 呼叫同時完成「圖片擷取」與「資訊不足時 fallback 生成」。

依 USE_VERTEX_AI 環境變數切換：
- prod：Vertex AI（Gemini vision），原生支援圖片與 PDF。
- preview / 未設定：OpenAI（gpt-4o-mini vision），支援圖片；PDF 需改用 Vertex。

回傳同時包含 token 用量與估算成本，對應 issue 的「測試每張圖片分析平均消耗成本」。
"""

import os
import re
import json
import base64
import logging
from typing import List, Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)

FLASH_MODEL = "gemini-2.5-flash"
OPENAI_VISION_MODEL = "gpt-4o-mini"

# 擷取模式：依教材類型決定 AI 要抓「單字」還是「句子」
# - vocabulary：單字集（一列 = 單字 + 翻譯 + 詞性 + 例句）
# - sentence  ：例句集 / 朗讀評測（一列 = 句子 + 翻譯）
EXTRACT_MODE_VOCABULARY = "vocabulary"
EXTRACT_MODE_SENTENCE = "sentence"
EXTRACT_MODES = {EXTRACT_MODE_VOCABULARY, EXTRACT_MODE_SENTENCE}

# 粗略的每百萬 token 美元單價（僅供成本觀測，非計費用途）
_PRICING_USD_PER_1M = {
    FLASH_MODEL: {"input": 0.30, "output": 2.50},
    OPENAI_VISION_MODEL: {"input": 0.15, "output": 0.60},
}


class MagicPasteError(ValueError):
    """檔案驗證 / 供應商能力不符等可預期錯誤（endpoint 轉 4xx）。"""


class MagicPasteService:
    ALLOWED_MIME_TYPES = {
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "image/gif",
        "application/pdf",
    }
    # PDF 可能比圖片大，統一上限 10MB
    MAX_FILE_BYTES = 10 * 1024 * 1024

    def __init__(self):
        self.use_vertex_ai = os.getenv("USE_VERTEX_AI", "false").lower() == "true"

    # ---------------------------------------------------------------- 驗證

    @classmethod
    def validate_file(cls, file_bytes: bytes, mime_type: str) -> None:
        """驗證單一上傳檔（類型、非空、大小）。不符丟 MagicPasteError。"""
        normalized = (mime_type or "").split(";")[0].strip().lower()
        if normalized not in cls.ALLOWED_MIME_TYPES:
            raise MagicPasteError(f"不支援的檔案類型：{mime_type or '未知'}（僅支援圖片或 PDF）")
        if not file_bytes:
            raise MagicPasteError("檔案內容為空")
        if len(file_bytes) > cls.MAX_FILE_BYTES:
            raise MagicPasteError(f"檔案過大（上限 {cls.MAX_FILE_BYTES // (1024 * 1024)}MB）")

    # ---------------------------------------------------------------- prompt

    @staticmethod
    def _system_instruction() -> str:
        return (
            "You are an assistant that extracts English teaching material "
            "from an uploaded image or PDF for a language-learning app. "
            "Always respond with a valid JSON object only, no markdown, no prose. "
            "When translating to Chinese you MUST use Traditional Chinese (繁體中文), "
            "NOT Simplified Chinese."
        )

    @staticmethod
    def _translate_rule(translate_mode: str) -> str:
        if translate_mode == "ai":
            return (
                "For `translation`: IGNORE any translation shown in the file and "
                "ALWAYS generate the Traditional Chinese translation yourself."
            )
        return (
            "For `translation`: use the translation shown in the file when "
            "present; if it is missing or unclear, generate the Traditional "
            "Chinese translation yourself (AI fallback)."
        )

    @classmethod
    def _build_prompt(
        cls,
        translate_mode: str,
        example_mode: str,
        level: str,
        extract_mode: str = EXTRACT_MODE_VOCABULARY,
    ) -> str:
        """
        extract_mode:
        - "vocabulary"（單字集）：一列 = 單字 + 翻譯 + 詞性 + 例句 + 例句翻譯
        - "sentence"（例句集 / 朗讀評測）：一列 = 句子 + 翻譯
        translate_mode / example_mode: "image_first" | "ai"
        """
        translate_rule = cls._translate_rule(translate_mode)

        if extract_mode == EXTRACT_MODE_SENTENCE:
            return (
                "Extract every English sentence from the uploaded file.\n"
                "Return JSON of the exact shape: "
                '{"items": [{"text": "...", "translation": "..."}]}\n'
                "Rules:\n"
                "- `text`: one complete English sentence exactly as it appears in "
                "the file. Do NOT split a sentence, do NOT merge two sentences, "
                "and do NOT rewrite it.\n"
                f"- {translate_rule}\n"
                "- Extract sentences only. Do NOT output single words or phrases "
                "that are not full sentences.\n"
                "- Preserve the order the sentences appear in the file.\n"
                '- If the file contains no sentences, return {"items": []}.'
            )

        if example_mode == "ai":
            example_rule = (
                "For `example_sentence`: IGNORE any example in the file and ALWAYS "
                f"generate a natural CEFR {level} example sentence yourself."
            )
        else:
            example_rule = (
                "For `example_sentence`: use the example sentence shown in the file "
                "when present; if it is missing, generate a natural CEFR "
                f"{level} example sentence yourself (AI fallback)."
            )
        return (
            "Extract every vocabulary entry from the uploaded file.\n"
            "Return JSON of the exact shape: "
            '{"items": [{"text": "...", "translation": "...", '
            '"part_of_speech": "...", "example_sentence": "...", '
            '"example_sentence_translation": "..."}]}\n'
            "Rules:\n"
            "- `text`: the English word or phrase being taught.\n"
            f"- {translate_rule}\n"
            "- `part_of_speech`: abbreviation such as n. / v. / adj. / adv. "
            "(empty string if unknown).\n"
            f"- {example_rule}\n"
            "- `example_sentence_translation`: Traditional Chinese translation of "
            "the example sentence.\n"
            "- Every example sentence MUST contain the exact `text`.\n"
            "- Preserve the order the entries appear in the file.\n"
            '- If the file contains no vocabulary, return {"items": []}.'
        )

    # ---------------------------------------------------------------- 擷取

    async def extract(
        self,
        file_bytes: bytes,
        mime_type: str,
        translate_mode: str = "image_first",
        example_mode: str = "image_first",
        level: str = "A1",
        extract_mode: str = EXTRACT_MODE_VOCABULARY,
    ) -> Dict[str, Any]:
        """
        擷取教材內容。

        extract_mode:
        - "vocabulary"（單字集）
        - "sentence"（例句集 / 朗讀評測）

        Returns:
            {"items": [...], "usage": {...}, "estimated_cost_usd": float,
             "provider": "vertex"|"openai", "model": str}
        """
        self.validate_file(file_bytes, mime_type)
        if extract_mode not in EXTRACT_MODES:
            extract_mode = EXTRACT_MODE_VOCABULARY
        normalized_mime = (mime_type or "").split(";")[0].strip().lower()
        if normalized_mime == "image/jpg":
            normalized_mime = "image/jpeg"
        prompt = self._build_prompt(translate_mode, example_mode, level, extract_mode)

        if self.use_vertex_ai:
            raw, usage, model = await self._extract_vertex(
                file_bytes, normalized_mime, prompt
            )
            provider = "vertex"
        else:
            if normalized_mime == "application/pdf":
                raise MagicPasteError(
                    "目前 preview 環境的 AI 供應商不支援 PDF，請改用圖片，"
                    "或啟用 Vertex AI（USE_VERTEX_AI）。"
                )
            raw, usage, model = await self._extract_openai(
                file_bytes, normalized_mime, prompt
            )
            provider = "openai"

        items = self._normalize_items(raw)
        cost = self._estimate_cost(model, usage)
        logger.info(
            "[magic-paste] provider=%s model=%s items=%d tokens(in/out)=%s/%s "
            "cost≈$%.5f",
            provider,
            model,
            len(items),
            usage.get("input_tokens"),
            usage.get("output_tokens"),
            cost,
        )
        return {
            "items": items,
            "usage": usage,
            "estimated_cost_usd": cost,
            "provider": provider,
            "model": model,
        }

    async def _extract_vertex(
        self, file_bytes: bytes, mime_type: str, prompt: str
    ) -> Tuple[Any, Dict[str, int], str]:
        from vertexai.generative_models import (
            GenerativeModel,
            Part,
            GenerationConfig,
        )
        from services.vertex_ai import get_vertex_ai_service

        # 確保 vertexai.init 已呼叫
        get_vertex_ai_service()._ensure_initialized()

        model = GenerativeModel(
            FLASH_MODEL, system_instruction=self._system_instruction()
        )
        part = Part.from_data(data=file_bytes, mime_type=mime_type)
        config = GenerationConfig(
            max_output_tokens=4000,
            temperature=0.3,
            response_mime_type="application/json",
        )
        response = await model.generate_content_async(
            [part, prompt], generation_config=config
        )
        usage = {"input_tokens": 0, "output_tokens": 0}
        meta = getattr(response, "usage_metadata", None)
        if meta is not None:
            usage = {
                "input_tokens": getattr(meta, "prompt_token_count", 0) or 0,
                "output_tokens": getattr(meta, "candidates_token_count", 0) or 0,
            }
        return self._parse_json(response.text), usage, FLASH_MODEL

    async def _extract_openai(
        self, file_bytes: bytes, mime_type: str, prompt: str
    ) -> Tuple[Any, Dict[str, int], str]:
        from openai import AsyncOpenAI
        from utils.http_client import get_http_client

        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise MagicPasteError("OPENAI_API_KEY 未設定，無法進行 AI 擷取")
        client = AsyncOpenAI(api_key=api_key, http_client=get_http_client())

        b64 = base64.b64encode(file_bytes).decode("ascii")
        data_url = f"data:{mime_type};base64,{b64}"
        response = await client.chat.completions.create(
            model=OPENAI_VISION_MODEL,
            messages=[
                {"role": "system", "content": self._system_instruction()},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                },
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=4000,
        )
        usage = {"input_tokens": 0, "output_tokens": 0}
        if response.usage:
            usage = {
                "input_tokens": response.usage.prompt_tokens or 0,
                "output_tokens": response.usage.completion_tokens or 0,
            }
        content = response.choices[0].message.content
        return self._parse_json(content), usage, OPENAI_VISION_MODEL

    # ---------------------------------------------------------------- helpers

    @staticmethod
    def _parse_json(content: str) -> Any:
        content = (content or "").strip()
        content = re.sub(r"^.*?```json\s*", "", content, flags=re.DOTALL)
        content = re.sub(r"^.*?```\s*", "", content, flags=re.DOTALL)
        content = re.sub(r"\s*```$", "", content).strip()
        return json.loads(content)

    @staticmethod
    def _normalize_items(raw: Any) -> List[Dict[str, str]]:
        """把 AI 回傳整理成穩定的 item 陣列，欄位齊全、丟掉無 text 的項目。"""
        if isinstance(raw, dict):
            raw_items = raw.get("items", [])
        elif isinstance(raw, list):
            raw_items = raw
        else:
            raw_items = []

        items: List[Dict[str, str]] = []
        for entry in raw_items:
            if not isinstance(entry, dict):
                continue
            text = str(entry.get("text") or "").strip()
            if not text:
                continue
            items.append(
                {
                    "text": text,
                    "translation": str(entry.get("translation") or "").strip(),
                    "part_of_speech": str(entry.get("part_of_speech") or "").strip(),
                    "example_sentence": str(
                        entry.get("example_sentence") or ""
                    ).strip(),
                    "example_sentence_translation": str(
                        entry.get("example_sentence_translation") or ""
                    ).strip(),
                }
            )
        return items

    @staticmethod
    def _estimate_cost(model: str, usage: Dict[str, int]) -> float:
        pricing = _PRICING_USD_PER_1M.get(model)
        if not pricing:
            return 0.0
        return round(
            usage.get("input_tokens", 0) / 1_000_000 * pricing["input"]
            + usage.get("output_tokens", 0) / 1_000_000 * pricing["output"],
            6,
        )


_magic_paste_service: Optional[MagicPasteService] = None


def get_magic_paste_service() -> MagicPasteService:
    global _magic_paste_service
    if _magic_paste_service is None:
        _magic_paste_service = MagicPasteService()
    return _magic_paste_service
