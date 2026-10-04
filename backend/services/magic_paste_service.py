"""
魔術貼上 AI 擷取服務（issue #891）。

從上傳的圖片 / PDF 擷取單字教材內容（單字、翻譯、詞性、例句、例句翻譯），
一次 AI 呼叫同時完成「圖片擷取」與「資訊不足時 fallback 生成」。
題庫用的 multiple_choice（單題選擇題）與 reading_group（一份檔 → 一個閱讀題組：
文章素材／海報座標 + 單字註解 + 小題，issue #1084）也走同一條路徑。

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
# multiple_choice：題庫從考卷圖片擷取選擇題（issue #1061 / #1065）
EXTRACT_MODE_MULTIPLE_CHOICE = "multiple_choice"
# reading_group：一份檔（圖或 PDF）→ 一個閱讀題組（文章素材 + 小題）（issue #1084）
EXTRACT_MODE_READING_GROUP = "reading_group"
EXTRACT_MODES = {
    EXTRACT_MODE_VOCABULARY,
    EXTRACT_MODE_SENTENCE,
    EXTRACT_MODE_MULTIPLE_CHOICE,
    EXTRACT_MODE_READING_GROUP,
}
MC_MIN_OPTIONS = 2
MC_MAX_OPTIONS = 6
# reading_group 的素材區域座標：Gemini 慣用 [ymin, xmin, ymax, xmax]，0–1000 正規化
BOX_2D_MAX = 1000
STIMULUS_KINDS = ("text", "image")
# 克漏字空格編號上限：與 routers/question_bank_schemas.BLANK_INDEX_MAX 一致
# （services 不 import routers，避免反向依賴）
BLANK_INDEX_MAX = 999
# 題組標題上限：對齊 DB `question_groups.title` VARCHAR(200)
GROUP_TITLE_MAX_CHARS = 200

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
        - "multiple_choice"（題庫）：一題 = 題幹 + 選項 + （圖上有標才給）答案 + 解析
        - "reading_group"（題庫）：整份檔 = 一個閱讀題組（文章素材 + 單字註解 + 小題）

        `level` 目前保留供未來使用；擷取本身不生成例句故不參考。
        """
        if extract_mode == EXTRACT_MODE_READING_GROUP:
            return (
                "The uploaded file contains ONE reading-comprehension question group: "
                "a shared stimulus (a passage, or a poster / comic / map / timetable / "
                "advertisement) followed by several multiple-choice questions about it.\n"
                "Return JSON of the exact shape: "
                '{"title": "...", '
                '"stimulus": {"kind": "text" | "image", "paragraphs": ["..."], '
                '"text": "...", "box_2d": [ymin, xmin, ymax, xmax], "page": 1, '
                '"blanks_renumbered": true, '
                '"figures": [{"box_2d": [ymin, xmin, ymax, xmax], '
                '"after_paragraph": 0, "caption": "..."}]}, '
                '"glossary": [{"word": "...", "zh": "..."}], '
                '"questions": [{"stem": "...", "blank": 1, '
                '"stem_box_2d": [ymin, xmin, ymax, xmax], '
                '"options": ["...", "..."], '
                '"option_boxes": [[ymin, xmin, ymax, xmax], null], '
                '"correct_indexes": [0], "explanation": "..."}]}\n'
                "Rules:\n"
                "- `title`: ALWAYS return a title. If a title is printed for the "
                "passage, copy it exactly. Otherwise write a short English title of "
                "your own that names what the material is about, at most 8 words, no "
                "surrounding quotes, and NOT starting with a generic word such as "
                '"Reading", "Passage", "Article" or "Question". For an image-based '
                "stimulus, name it after what the picture shows and its format "
                '(e.g. "Lantern Festival Poster", "Soccer Practice Comic", '
                '"Taipei Zoo Map").\n'
                '- `stimulus.kind`: "text" when the stimulus is prose (paragraphs, a '
                'letter, an article, a dialogue). "image" when the layout itself '
                "carries the meaning and must be shown as a picture: a poster, comic "
                "strip, map, menu, timetable, chart, advertisement, or any block with "
                "drawings.\n"
                '- When kind is "text": `paragraphs` = the passage split into its '
                "printed paragraphs, in order, text exactly as printed. You may mark "
                "printed bold as **bold** and printed underline as __underlined__. Set "
                '`text` to "" and omit `box_2d`.\n'
                "- BLANKS (cloze / fill-in-the-blank passages): if the passage contains "
                'printed answer blanks — written as "__40__", "___(40)___", "(40)", '
                '"40.____" or similar — rewrite EVERY one of them as "{{n}}" where n '
                "numbers the blanks 1, 2, 3 ... in reading order (the FIRST blank in the "
                'passage is always "{{1}}", no matter which number is printed on the '
                "paper). Use each number exactly once. Keep the surrounding words "
                "unchanged, and do not leave any printed underscores or printed blank "
                "numbers behind. Set `blanks_renumbered` to true when you did this, "
                "false otherwise.\n"
                "- `stimulus.figures`: pictures that are printed INSIDE a prose passage "
                '(only when kind is "text"); [] when there are none. For each picture: '
                "`box_2d` = its bounding box as [ymin, xmin, ymax, xmax] on a 0-1000 "
                "scale relative to the page, covering the drawing / photo ONLY and no "
                "surrounding passage text; `after_paragraph` = the 0-based index of the "
                "paragraph in `paragraphs` that the picture comes after (use -1 for a "
                "picture printed before the first paragraph); `caption` = the caption "
                'printed under the picture, or "" if none.\n'
                '- When kind is "image": `box_2d` = the bounding box of the stimulus '
                "area ONLY (exclude the questions and their options), as "
                "[ymin, xmin, ymax, xmax] on a 0-1000 scale relative to the page. "
                "`page` = 1-based page number the box is on (1 for a single image). "
                "`text` = all readable text inside that area, in reading order, as one "
                "plain string (used for search, not shown to students). Set "
                "`paragraphs` to [].\n"
                "- `glossary`: word-meaning pairs printed as a footnote box for the "
                'group (e.g. "timeline 時間軸"); `zh` must be Traditional Chinese. '
                "[] if none.\n"
                "- `questions`: every multiple-choice question that belongs to this "
                "group, in printed order. `stem`: the question text exactly as printed, "
                "without the leading number. `options`: the choices in printed order "
                f"({MC_MIN_OPTIONS}–{MC_MAX_OPTIONS}), without leading labels such as "
                "(A) B. (C). Do NOT invent options; skip a question with fewer than "
                f"{MC_MIN_OPTIONS} choices. `correct_indexes`: 0-based indexes ONLY if "
                "the answer is printed (answer key, circled / ticked / bold choice); "
                "otherwise []. Never guess. `explanation`: copy ONLY a printed "
                'explanation; otherwise "".\n'
                "- `questions[i].blank`: for a cloze / fill-in-the-blank passage, the "
                "NEW number of the blank this question answers, matching the "
                '"{{n}}" you wrote in the passage (so the question for the first blank '
                "gets 1). This is REQUIRED for every question of a cloze paper — those "
                "questions usually print only choices and no question text, so match "
                "them to the blanks by their printed order. Use null when the group is "
                "an ordinary reading-comprehension group with no blanks.\n"
                "- `questions[i].stem_box_2d`: bounding box of a picture or diagram "
                "printed as part of THAT question's own text (e.g. a Venn diagram above "
                "the choices), [ymin, xmin, ymax, xmax] on the same 0-1000 scale; null "
                "when the question has no picture of its own.\n"
                "- `questions[i].option_boxes`: an array the SAME length as `options`. "
                "For a choice that is a picture, put its bounding box (covering the "
                'picture only, not the "(A)" label); for a text choice put null. Return '
                "[] when no choice in this question is a picture. When a choice is a "
                'picture with no words, keep its `options` entry as the empty string "" '
                "and its box in `option_boxes` at the same position — never invent words "
                "for a picture choice.\n"
                "- Do NOT put the passage or the picture text into any `stem`.\n"
                "- If the file contains no reading group at all, return "
                '{"title": "", "stimulus": {"kind": "text", "paragraphs": [], '
                '"text": ""}, "glossary": [], "questions": []}.'
            )

        if extract_mode == EXTRACT_MODE_MULTIPLE_CHOICE:
            return (
                "Extract every multiple-choice question from the uploaded file.\n"
                "Return JSON of the exact shape: "
                '{"items": [{"stem": "...", '
                '"stem_box_2d": [ymin, xmin, ymax, xmax], '
                '"options": ["...", "..."], '
                '"option_boxes": [[ymin, xmin, ymax, xmax], null], '
                '"correct_indexes": [0], "explanation": "..."}]}\n'
                "Rules:\n"
                "- `stem`: the question text exactly as printed. Keep blanks such as "
                '"____" as-is. Remove the leading question number (e.g. "12." or "(3)").\n'
                "- `stem_box_2d`: bounding box of a picture or diagram printed as part "
                "of the question text (e.g. a still-life drawing, a Venn diagram), as "
                "[ymin, xmin, ymax, xmax] on a 0-1000 scale relative to the page, "
                "covering the picture ONLY and no text; null when the question has no "
                "picture.\n"
                f"- `options`: the choices in printed order ({MC_MIN_OPTIONS}–{MC_MAX_OPTIONS}). "
                "Remove leading labels such as (A) B. (C) 甲 乙. Do NOT invent options; "
                f"if a question has fewer than {MC_MIN_OPTIONS} choices, skip it.\n"
                "- `option_boxes`: an array the SAME length as `options`. For a choice "
                "that is a picture, put its bounding box (covering the picture only, not "
                'the "(A)" label); for a text choice put null. Return [] when no choice '
                "in this question is a picture. When a choice is a picture with no "
                'words, keep its `options` entry as the empty string "" and its box in '
                "`option_boxes` at the same position — never invent words for a picture "
                "choice.\n"
                "- `correct_indexes`: 0-based indexes of the correct options ONLY if the "
                "answer is printed in the file (an answer key, a circled/ticked choice, "
                "bold or underlined choice). Otherwise return []. Never guess.\n"
                "- `explanation`: copy ONLY an explanation printed in the file; "
                'otherwise "".\n'
                "- If a passage or dialogue is shared by several questions, do NOT put it "
                "in `stem`; skip such question groups and return only stand-alone "
                "questions.\n"
                "- Preserve the order the questions appear in the file.\n"
                '- If the file contains no multiple-choice questions, return {"items": []}.'
            )

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

        if extract_mode == EXTRACT_MODE_MULTIPLE_CHOICE:
            items = self._normalize_mc_items(raw)
        elif extract_mode == EXTRACT_MODE_READING_GROUP:
            items = self._normalize_reading_group(raw)
        else:
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

    @classmethod
    def _normalize_mc_items(cls, raw: Any) -> List[Dict[str, Any]]:
        """
        選擇題擷取結果整理（單題與題組小題共用）。

        - 選項「有字 or 有座標」才留（圖片選項無字時 text 為 ""，#1084）；< 2 個就丟掉整題
        - 題幹可以空，但必須有別的東西認得這一題：題幹圖座標，或克漏字的 `blank`
          （克漏字小題題本上通常只印選項，#1086）
        - `option_boxes` 與回傳的 options 等長（不是圖的位置為 None）
        - `stem_box_2d` / `option_boxes` 內不合法的座標丟成 None（前端改由老師自己補圖）
        - `correct_indexes` 只留合法範圍
        """
        if isinstance(raw, dict):
            raw_items = raw.get("items", [])
        elif isinstance(raw, list):
            raw_items = raw
        else:
            raw_items = []

        items: List[Dict[str, Any]] = []
        for entry in raw_items:
            if not isinstance(entry, dict):
                continue
            stem = str(entry.get("stem") or "").strip()
            options_raw = entry.get("options")
            options_raw = options_raw if isinstance(options_raw, list) else []
            boxes_raw = entry.get("option_boxes")
            boxes_raw = boxes_raw if isinstance(boxes_raw, list) else []
            pairs: List[Tuple[str, Optional[List[int]]]] = []
            for i, o in enumerate(options_raw):
                text = str(o or "").strip()
                box = (
                    cls._normalize_box_2d(boxes_raw[i]) if i < len(boxes_raw) else None
                )
                # 有字或有圖才是一個選項；兩者都沒有的位置是模型多給的空殼
                if text or box:
                    pairs.append((text, box))
            pairs = pairs[:MC_MAX_OPTIONS]
            options = [p[0] for p in pairs]
            option_boxes = [p[1] for p in pairs]
            stem_box = cls._normalize_box_2d(entry.get("stem_box_2d"))
            blank = cls._normalize_blank_index(entry.get("blank"))
            if len(options) < MC_MIN_OPTIONS:
                continue
            if not stem and stem_box is None and blank is None:
                continue
            idx_raw = entry.get("correct_indexes")
            correct = (
                sorted(
                    {
                        int(i)
                        for i in idx_raw
                        if isinstance(i, (int, float))
                        and not isinstance(i, bool)
                        and 0 <= int(i) < len(options)
                    }
                )
                if isinstance(idx_raw, list)
                else []
            )
            items.append(
                {
                    "stem": stem,
                    "blank": blank,
                    "stem_box_2d": stem_box,
                    "options": options,
                    "option_boxes": option_boxes,
                    "correct_indexes": correct,
                    "explanation": str(entry.get("explanation") or "").strip(),
                }
            )
        return items

    @staticmethod
    def _normalize_blank_index(raw: Any) -> Optional[int]:
        """克漏字空格編號：1..BLANK_INDEX_MAX 的整數；其他一律 None。"""
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            return None
        n = int(raw)
        return n if 1 <= n <= BLANK_INDEX_MAX else None

    @staticmethod
    def _normalize_box_2d(raw: Any) -> Optional[List[int]]:
        """[ymin, xmin, ymax, xmax]，四個 0–1000 整數且 ymin<ymax、xmin<xmax；否則 None。"""
        if not isinstance(raw, list) or len(raw) != 4:
            return None
        box: List[int] = []
        for v in raw:
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                return None
            n = int(round(v))
            if n < 0 or n > BOX_2D_MAX:
                return None
            box.append(n)
        ymin, xmin, ymax, xmax = box
        if ymin >= ymax or xmin >= xmax:
            return None
        return box

    @classmethod
    def _normalize_figures(cls, raw: Any, paragraph_count: int) -> List[Dict[str, Any]]:
        """
        文章內插圖（#1084）：座標不合法就整項丟掉（沒有座標就裁不出圖）。

        `after_paragraph` 夾在 -1（第一段之前）到 paragraph_count - 1；缺值當 -1。
        """
        if not isinstance(raw, list):
            return []
        figures: List[Dict[str, Any]] = []
        upper = paragraph_count - 1
        for item in raw:
            if not isinstance(item, dict):
                continue
            box = cls._normalize_box_2d(item.get("box_2d"))
            if box is None:
                continue
            after_raw = item.get("after_paragraph")
            after = (
                int(after_raw)
                if isinstance(after_raw, (int, float))
                and not isinstance(after_raw, bool)
                else -1
            )
            after = max(-1, min(after, upper))
            figures.append(
                {
                    "box_2d": box,
                    "after_paragraph": after,
                    "caption": str(item.get("caption") or "").strip(),
                }
            )
        return figures

    @classmethod
    def _normalize_reading_group(cls, raw: Any) -> List[Dict[str, Any]]:
        """
        閱讀題組擷取結果整理：回傳 0 或 1 個元素的 list（沿用 endpoint 的 items 形狀）。

        - stimulus.kind 只接受 text / image；缺或不合法時依內容推斷（有段落→text，否則→image）
        - box_2d 不合法就丟掉（前端改用整張圖）；page 只留正整數
        - figures（文章內插圖）只在 kind=text 保留；座標不合法整項丟掉
        - blanks_renumbered：模型是否把印刷空格改寫成 `{{n}}`（克漏字用，#1086）
        - title 截到 GROUP_TITLE_MAX_CHARS（DB 上限）；模型沒給時留空字串不視為錯誤
        - glossary 兩欄皆非空才留；questions 沿用 _normalize_mc_items 規則
        - 完全沒素材也沒小題 → []（不扣配額）
        """
        if not isinstance(raw, dict):
            return []
        stim_raw = raw.get("stimulus")
        stim = stim_raw if isinstance(stim_raw, dict) else {}

        paragraphs_raw = stim.get("paragraphs")
        paragraphs = (
            [str(p or "").strip() for p in paragraphs_raw]
            if isinstance(paragraphs_raw, list)
            else []
        )
        paragraphs = [p for p in paragraphs if p]
        text = str(stim.get("text") or "").strip()
        box = cls._normalize_box_2d(stim.get("box_2d"))
        page_raw = stim.get("page")
        page = (
            int(page_raw)
            if isinstance(page_raw, (int, float))
            and not isinstance(page_raw, bool)
            and int(page_raw) >= 1
            else None
        )

        kind = str(stim.get("kind") or "").strip().lower()
        if kind not in STIMULUS_KINDS:
            kind = "text" if paragraphs else "image"
        figures = cls._normalize_figures(stim.get("figures"), len(paragraphs))
        if kind == "text":
            box = None
            page = None
        else:
            paragraphs = []
            # 整塊當圖時沒有「第幾段之後」可以掛，插圖一律併進那張圖裡
            figures = []

        glossary: List[Dict[str, str]] = []
        glossary_raw = raw.get("glossary")
        if isinstance(glossary_raw, list):
            for g in glossary_raw:
                if not isinstance(g, dict):
                    continue
                word = str(g.get("word") or "").strip()
                zh = str(g.get("zh") or "").strip()
                if word and zh:
                    glossary.append({"word": word, "zh": zh})

        questions = cls._normalize_mc_items({"items": raw.get("questions") or []})

        has_stimulus = bool(paragraphs or text or box)
        if not has_stimulus and not questions:
            return []
        return [
            {
                "title": str(raw.get("title") or "").strip()[:GROUP_TITLE_MAX_CHARS],
                "stimulus": {
                    "kind": kind,
                    "paragraphs": paragraphs,
                    "text": text,
                    "box_2d": box,
                    "page": page,
                    "figures": figures,
                    "blanks_renumbered": bool(stim.get("blanks_renumbered")),
                },
                "glossary": glossary,
                "questions": questions,
            }
        ]

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
