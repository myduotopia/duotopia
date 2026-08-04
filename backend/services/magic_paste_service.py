"""
魔術貼上 AI 擷取服務（issue #891）。

從上傳的圖片 / PDF 擷取單字教材內容（單字、翻譯、詞性、例句、例句翻譯），
一次 AI 呼叫同時完成「圖片擷取」與「資訊不足時 fallback 生成」。

統一走 Vertex AI（Gemini vision），原生支援圖片與 PDF。

回傳同時包含 token 用量與估算成本，對應 issue 的「測試每張圖片分析平均消耗成本」。
"""

import re
import json
import logging
from typing import List, Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)

FLASH_MODEL = "gemini-2.5-flash"

# 一整張單字表 + 每項的翻譯/詞性/例句/例句翻譯，4000 tokens 會被截斷（issue #891
# preview 實測 502）。拉高上限；若仍截斷，_parse_json 會救回已完整的項目。
MAX_OUTPUT_TOKENS = 8192

# 擷取模式：依教材類型決定 AI 要抓「單字」還是「句子」
# - vocabulary：單字集（一列 = 單字 + 翻譯 + 詞性 + 例句）
# - sentence  ：例句集 / 朗讀評測（一列 = 句子 + 翻譯）
EXTRACT_MODE_VOCABULARY = "vocabulary"
EXTRACT_MODE_SENTENCE = "sentence"
EXTRACT_MODES = {EXTRACT_MODE_VOCABULARY, EXTRACT_MODE_SENTENCE}

# 粗略的每百萬 token 美元單價（僅供成本觀測，非計費用途）
_PRICING_USD_PER_1M = {
    FLASH_MODEL: {"input": 0.30, "output": 2.50},
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

    # ---------------------------------------------------------------- 驗證

    @staticmethod
    def _sniff_mime(data: bytes) -> Optional[str]:
        """用檔頭 magic bytes 判斷實際檔案類型；認不出回 None。"""
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            return "image/png"
        if data[:3] == b"\xff\xd8\xff":
            return "image/jpeg"
        if data[:6] in (b"GIF87a", b"GIF89a"):
            return "image/gif"
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            return "image/webp"
        if data[:5] == b"%PDF-":
            return "application/pdf"
        return None

    @classmethod
    def validate_file(cls, file_bytes: bytes, mime_type: str) -> None:
        """
        驗證單一上傳檔（類型、非空、大小、內容簽章）。不符丟 MagicPasteError。

        以 magic bytes 嗅探實際內容，不能只信 client 送來的 Content-Type，避免偽造
        content-type 把任意位元組送進 AI 供應商（review PR #943 round-4 #1；比照
        speech_assessment.py 的做法）。
        """
        normalized = (mime_type or "").split(";")[0].strip().lower()
        if normalized not in cls.ALLOWED_MIME_TYPES:
            raise MagicPasteError(f"不支援的檔案類型：{mime_type or '未知'}（僅支援圖片或 PDF）")
        if not file_bytes:
            raise MagicPasteError("檔案內容為空")
        if len(file_bytes) > cls.MAX_FILE_BYTES:
            raise MagicPasteError(f"檔案過大（上限 {cls.MAX_FILE_BYTES // (1024 * 1024)}MB）")
        # 實際內容必須是支援的圖片 / PDF 簽章
        if cls._sniff_mime(file_bytes) is None:
            raise MagicPasteError("檔案內容不是支援的圖片或 PDF（可能副檔名/類型不符）")

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

    # 擷取一律「只抄圖上有的」，不在此步 AI 生成翻譯 / 例句。
    # 缺的欄位留空字串，改由前端「插入時」依共用設定補洞（見 issue #891 redesign spec）。
    _TRANSLATE_RULE = (
        "For `translation`: copy ONLY the translation printed in the file. "
        "If no translation is shown, leave it as an empty string. "
        "Do NOT generate a translation yourself."
    )

    @classmethod
    def _build_prompt(
        cls,
        level: str,
        extract_mode: str = EXTRACT_MODE_VOCABULARY,
    ) -> str:
        """
        extract_mode:
        - "vocabulary"（單字集）：一列 = 單字 + 翻譯 + 詞性 + 例句 + 例句翻譯
        - "sentence"（例句集 / 朗讀評測）：一列 = 句子 + 翻譯

        `level` 目前保留供未來使用；擷取本身不生成例句故不參考。
        """
        if extract_mode == EXTRACT_MODE_SENTENCE:
            return (
                "Extract every English sentence from the uploaded file.\n"
                "Return JSON of the exact shape: "
                '{"items": [{"text": "...", "translation": "..."}]}\n'
                "Rules:\n"
                "- `text`: one complete English sentence exactly as it appears in "
                "the file. Do NOT split a sentence, do NOT merge two sentences, "
                "and do NOT rewrite it.\n"
                f"- {cls._TRANSLATE_RULE}\n"
                "- Extract sentences only. Do NOT output single words or phrases "
                "that are not full sentences.\n"
                "- Preserve the order the sentences appear in the file.\n"
                '- If the file contains no sentences, return {"items": []}.'
            )

        return (
            "Extract every vocabulary entry from the uploaded file.\n"
            "Return JSON of the exact shape: "
            '{"items": [{"text": "...", "translation": "...", '
            '"part_of_speech": "...", "example_sentence": "...", '
            '"example_sentence_translation": "..."}]}\n'
            "Rules:\n"
            "- `text`: the English word or phrase being taught.\n"
            "- `translation`: the word's meaning as PRINTED in the file. This is "
            "often a translation in another language, but it may also be an "
            "English definition / explanation (e.g. a monolingual dictionary such "
            "as '4000 Essential English Words'). ALWAYS copy whichever meaning is "
            "printed, keeping its original language. Do NOT include the leading "
            "part-of-speech abbreviation (e.g. 'adj.', 'n.') in this field. "
            "If no meaning is printed, leave it empty. Do NOT invent one.\n"
            "- `part_of_speech`: abbreviation such as n. / v. / adj. / adv. "
            "printed before the meaning (empty string if none).\n"
            "- `example_sentence`: the example sentence that USES the word (a full "
            "sentence containing the word), NOT the definition line. Copy ONLY what "
            "is printed; if none is shown, leave it empty. Do NOT generate one.\n"
            "- `example_sentence_translation`: copy ONLY the example's translation "
            "printed in the file; otherwise leave it empty.\n"
            "- Preserve the order the entries appear in the file.\n"
            '- If the file contains no vocabulary, return {"items": []}.'
        )

    # ---------------------------------------------------------------- 擷取

    async def extract(
        self,
        file_bytes: bytes,
        mime_type: str,
        level: str = "A1",
        extract_mode: str = EXTRACT_MODE_VOCABULARY,
    ) -> Dict[str, Any]:
        """
        擷取教材內容（只抄圖上有的，不 AI 生成翻譯/例句）。

        extract_mode:
        - "vocabulary"（單字集）
        - "sentence"（例句集 / 朗讀評測）

        Returns:
            {"items": [...], "usage": {...}, "estimated_cost_usd": float,
             "provider": "vertex", "model": str}
        """
        self.validate_file(file_bytes, mime_type)
        if extract_mode not in EXTRACT_MODES:
            extract_mode = EXTRACT_MODE_VOCABULARY
        normalized_mime = (mime_type or "").split(";")[0].strip().lower()
        if normalized_mime == "image/jpg":
            normalized_mime = "image/jpeg"
        prompt = self._build_prompt(level, extract_mode)

        raw, usage, model = await self._extract_vertex(
            file_bytes, normalized_mime, prompt
        )
        provider = "vertex"

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
        from services.vertex_ai import get_vertex_ai_service, VertexAIService

        # 確保 vertexai.init 已呼叫
        get_vertex_ai_service()._ensure_initialized()

        model = GenerativeModel(
            FLASH_MODEL, system_instruction=self._system_instruction()
        )
        part = Part.from_data(data=file_bytes, mime_type=mime_type)
        config = GenerationConfig(
            max_output_tokens=MAX_OUTPUT_TOKENS,
            temperature=0.3,
            response_mime_type="application/json",
        )
        # 擷取是「照抄 + 翻譯」的結構化任務，不需要 thinking。關掉可加速
        # 並把整個 token 預算留給實際輸出，降低截斷風險。
        VertexAIService._set_thinking_budget(config, 0)
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

    # ---------------------------------------------------------------- helpers

    @classmethod
    def _parse_json(cls, content: str) -> Any:
        content = (content or "").strip()
        # 去掉開頭 / 結尾的 markdown 圍欄（```json ... ```）。
        # 只錨定首尾，避免把內容一路吃到結尾圍欄（會誤刪整包）。
        content = re.sub(r"^```[a-zA-Z]*\s*", "", content)
        content = re.sub(r"\s*```$", "", content).strip()
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            # AI 輸出可能因 token 上限被截斷（尾端 JSON 不完整）。
            # 盡量救回已完整輸出的 item 物件，而不是整包擷取失敗。
            salvaged = cls._salvage_objects(content)
            if salvaged:
                logger.warning("[magic-paste] JSON 疑似截斷，救回 %d 個完整項目", len(salvaged))
                return {"items": salvaged}
            raise

    @staticmethod
    def _salvage_objects(text: str) -> List[Dict[str, Any]]:
        """
        從（可能被截斷的）文字中掃出所有「完整且平衡」的 JSON 物件，
        逐一 json.loads，保留看起來像 item（有 text 欄位）的物件。

        括號配對時忽略字串內的大括號與跳脫字元，避免誤判。
        外層被截斷的 {"items":[...]} 因缺對應的 } 而不會被收錄，
        因此只會回收到完整的 item 物件。
        """
        objects: List[str] = []
        stack: List[int] = []
        in_str = False
        escaped = False
        for i, ch in enumerate(text):
            if in_str:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                stack.append(i)
            elif ch == "}":
                if stack:
                    start = stack.pop()
                    objects.append(text[start : i + 1])

        items: List[Dict[str, Any]] = []
        for snippet in objects:
            try:
                parsed = json.loads(snippet)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict) and str(parsed.get("text") or "").strip():
                items.append(parsed)
        return items

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
