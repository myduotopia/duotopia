"""情境對話 AI 生成服務 — Issue #1021。

#944 做畫面、#1013 做儲存、#1014 做入口，AI 這段一直是前端 stub：產題其實是一個
``setTimeout`` 加上寫死的示範題陣列。老師填的訓練目標、題目難度、整體時態語態、
作答指引**完全沒有被讀取**，但畫面會轉 spinner、會長出題目，操作上看不出是假的。
這個模組把那段接成真的。

三個能力，都走 Vertex（Gemini），沿用 ``services/magic_paste_service.py`` 的既有作法
（同一顆模型、同一套 JSON 截斷救援、同一種用量與成本紀錄）：

* :meth:`generate_article` —— 依訓練目標與文章難度生成情境文章
* :meth:`generate_questions` —— 依情境文章與出題設定產生題目
* :meth:`extract_article` —— 從老師上傳的圖片 / PDF 擷取情境文章

沒有做的：**逐題 AI 生圖**。後端目前完全沒有圖片生成能力（不是接線問題，是要從零
建一個新能力：模型、儲存、成本、配額），與本單要解的問題無關，另案處理。

配額
----

這一版**不擋配額**，只記錄 token 用量與估算成本（同 magic_paste 的欄位），等實際用量
數據出來再決定免費額度。所以呼叫端不需要處理 402。

穩定代碼
--------

時態／語態存的是穩定代碼（``past`` / ``simple`` / ``active``），送進 prompt 前一律翻成
英文描述（``past simple`` / ``active voice``）。中文標籤直接擋下 —— 老師的介面語言不該
影響出題結果，這與 ``utils/scenario_dialogue.py`` 是同一條規則。
"""

import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from utils.scenario_dialogue import (
    CEFR_LEVELS,
    MAX_ITEMS,
    TENSE_ASPECTS,
    TENSE_TIMES,
    VOICES,
)
from core.config import settings

logger = logging.getLogger(__name__)

# 模型 ID 單一來源在 core/config.py（Issue #1119）—— gemini-2.5-* 已退役
FLASH_MODEL = settings.VERTEX_AI_FLASH_MODEL

# 一次最多 10 題，每題含題目／翻譯／參考答案／必用字詞／生圖 prompt，
# 抓寬一點避免截斷（截斷仍有 _salvage_objects 兜底）
MAX_OUTPUT_TOKENS = 8192

# 情境文章不會太長（要讓學生讀得完），但中日韓字元吃 token，留點餘裕
ARTICLE_MAX_OUTPUT_TOKENS = 2048

# 粗略的每百萬 token 美元單價（僅供成本觀測，非計費用途）。
#
# gemini-3.5-flash 官方定價 $1.50 / $9.00（global endpoint）；我們跑在
# asia-northeast1（非 global）要 +10% → $1.65 / $9.90。Issue #1119 查證於
# 2026-10-16：https://cloud.google.com/vertex-ai/generative-ai/pricing
#
# ⚠️ 這張表以模型名為 key，換模型但忘了加價格會讓成本統計靜默變 0。
# 迴歸測試：tests/unit/test_issue_1119_model_migration.py
_PRICING_USD_PER_1M = {
    FLASH_MODEL: {"input": 1.65, "output": 9.90},
}

# 翻譯語言的長度上限。這個欄位**不能**用白名單擋 —— 老師選「其他」時存的是他自己打的
# 語言名字（#1016），白名單會直接把那個功能弄壞。所以改成「限長 + 壓成單行」。
MAX_TRANSLATE_LANGUAGE_CHARS = 50

# 動貌代碼 → 英文描述。camelCase 的 perfectProgressive 要拆成兩個字，
# 直接丟給模型看會讓它以為是專有名詞。
_ASPECT_WORDS = {
    "simple": "simple",
    "progressive": "progressive",
    "perfect": "perfect",
    "perfectProgressive": "perfect progressive",
}


class ScenarioDialogueAIError(ValueError):
    """參數不合法（呼叫端該擋而沒擋）。端點轉成 400。"""


class ScenarioDialogueAIOutputError(ScenarioDialogueAIError):
    """呼叫成功但模型沒給出可用的東西（格式壞掉、一題都沒產出）。

    與參數錯誤分開是因為兩者對老師的意思完全不同：參數錯是「你填的東西有問題」，
    這個是「這次不巧，再按一次」。端點轉成 502，訊息也是「請稍後再試」。

    繼承 ScenarioDialogueAIError，所以既有只攔父類的呼叫端不會漏接（PR #1023 review）。
    """


def describe_tense(tense: Optional[Dict[str, str]]) -> str:
    """時態穩定代碼 → 給模型看的英文描述。

    時間與動貌**兩者都有**才算指定（與前端 ``isTenseSet`` 同規則）——「過去」但沒說
    哪一種是半套條件，送進 prompt 只會讓模型自由發揮，不如當作沒指定。
    """
    if not isinstance(tense, dict):
        return ""
    time = (tense.get("time") or "").strip()
    aspect = (tense.get("aspect") or "").strip()
    if time and time not in TENSE_TIMES:
        raise ScenarioDialogueAIError(f"時態 time 不是合法代碼：{time!r}")
    if aspect and aspect not in TENSE_ASPECTS:
        raise ScenarioDialogueAIError(f"時態 aspect 不是合法代碼：{aspect!r}")
    if not time or not aspect:
        return ""
    return f"{time} {_ASPECT_WORDS[aspect]}"


def describe_voice(voice: Optional[str]) -> str:
    """語態穩定代碼 → 英文描述。空值代表不指定。"""
    value = (voice or "").strip()
    if not value:
        return ""
    if value not in VOICES:
        raise ScenarioDialogueAIError(f"語態不是合法代碼：{value!r}")
    return f"{value} voice"


def sanitize_free_text(value: Optional[str], max_chars: int) -> str:
    """自由文字進 prompt 前的收斂：壓成單行 + 限長。

    情境對話裡大部分欄位存的都是穩定代碼（時態／語態／CEFR），進 prompt 前會被翻譯或
    驗證；只有翻譯語言的「其他」是老師自己打的自由文字（#1016），沒有白名單可用。
    換行會被吃掉是因為 prompt 是靠換行分段的 —— 留著換行等於讓這個欄位可以改寫 prompt
    結構。內容本身保留（不是靜靜整段丟掉），只是壓成一行。

    **為什麼 goal 與 global_rubric 不走這支**（PR #1023 review 問到，這裡記下判斷）：

    * 它們**本來就是多行長文** —— 訓練目標可以列點、作答指引可以分條。壓成一行會破壞
      老師正常的輸入，代價比風險大。
    * 風險本身也不同：這兩個欄位只影響**老師自己**這一次的產出（產出來還要他過目、
      可以改、可以重產），既不跨租戶、也不會回寫任何資料。而 `translate_language`
      被壓平是因為它是**單一短詞**（語言名稱），壓平沒有任何損失。
    * 成本面已由端點的長度上限擋住（見 routers/scenario_dialogue_ai.py）。

    也就是說：這是有意識的取捨，不是漏掉。若哪天這些欄位會被存進共用的地方、或被
    別人的請求讀到，就要重新評估。
    """
    text = (value or "").strip()
    if not text:
        return ""
    # 換行、tab 等控制字元一律壓成空白
    text = re.sub(r"\s+", " ", text)
    return text[:max_chars]


class ScenarioDialogueAIService:
    # 圖片 / PDF 上限。magic_paste 是單張教材照片，情境文章可能是一整頁講義，抓 10MB
    MAX_FILE_BYTES = 10 * 1024 * 1024
    ALLOWED_MIME_TYPES = frozenset(
        {
            "application/pdf",
            "image/png",
            "image/jpeg",
            "image/webp",
            "image/heic",
        }
    )

    # ------------------------------------------------------------------ prompt

    @staticmethod
    def _system_instruction() -> str:
        return (
            "You are an experienced EFL teacher creating speaking practice material "
            "for young learners in Taiwan. You write natural, age-appropriate English. "
            "You always answer with valid JSON only, no commentary."
        )

    @classmethod
    def build_article_prompt(cls, goal: str, level: str) -> str:
        """情境文章的 prompt。

        ``goal`` 是老師寫的訓練目標（例如「這週上課學到的：交通工具與問路」），
        它是這張單的核心 —— 舊的 stub 完全沒用到它，老師才會看到牛頭不對馬嘴的結果。
        """
        goal_text = (goal or "").strip()
        if not goal_text:
            raise ScenarioDialogueAIError("訓練目標不可為空")
        level_text = (level or "").strip()
        if level_text and level_text not in CEFR_LEVELS:
            raise ScenarioDialogueAIError(f"文章難度不是合法的 CEFR 代碼：{level_text!r}")

        lines = [
            "Write a short everyday scenario passage that a teacher will use as the "
            "context for a speaking practice activity.",
            "",
            f"Teaching goal (write the passage so it practises this): {goal_text}",
        ]
        if level_text:
            lines.append(f"CEFR level of the passage: {level_text}")
        lines += [
            "",
            "Requirements:",
            "- 3 to 6 short paragraphs, at most about 150 words in total.",
            "- Concrete, everyday situation the student can picture.",
            "- Do not include any questions; this is the context only.",
            "",
            'Return JSON: {"content": "<the passage>"}',
        ]
        return "\n".join(lines)

    @classmethod
    def build_question_prompt(
        cls,
        scenario_content: str,
        count: int,
        question_level: str = "",
        global_tense: Optional[Dict[str, str]] = None,
        global_voice: str = "",
        global_rubric: str = "",
        translate_language: str = "",
        existing_questions: Optional[List[str]] = None,
    ) -> str:
        """產題的 prompt。

        老師在面板上填的每一項都要出現在這裡 —— 這正是 #1021 要修的問題。沒指定的
        設定則**整行不放**，而不是放一行空的 ``Tense: ``；空指令只會讓模型多想。
        """
        material = (scenario_content or "").strip()
        if not material:
            raise ScenarioDialogueAIError("情境內容不可為空（產題的素材）")
        # 下限刻意是 1 而不是 MIN_ITEMS：#864 的「一份 3~10 題」是**內容存檔時**的規則
        # （由 utils.scenario_dialogue.validate_item_count 在存檔路徑把關），不是單次
        # 生成的規則 —— 老師按「重新生成這一題」時要的就是 1 題。上限仍然是 MAX_ITEMS，
        # 一次要超過一份的題數沒有意義，只是白花 token。
        if not isinstance(count, bool) and isinstance(count, int):
            if not (1 <= count <= MAX_ITEMS):
                raise ScenarioDialogueAIError(f"一次產生的題數需介於 1~{MAX_ITEMS}，收到 {count!r}")
        else:
            raise ScenarioDialogueAIError(f"題數需為整數，收到 {count!r}")

        level = (question_level or "").strip()
        if level and level not in CEFR_LEVELS:
            raise ScenarioDialogueAIError(f"題目難度不是合法的 CEFR 代碼：{level!r}")

        tense_text = describe_tense(global_tense)
        voice_text = describe_voice(global_voice)
        rubric = (global_rubric or "").strip()
        language = sanitize_free_text(translate_language, MAX_TRANSLATE_LANGUAGE_CHARS)

        lines = [
            f"Write {count} spoken-response questions about the scenario below.",
            "",
            "Scenario:",
            material,
            "",
            "Requirements:",
            "- Each question must be answerable by speaking a few sentences aloud.",
            "- Questions must be answerable from the scenario, not general knowledge.",
        ]
        if level:
            lines.append(f"- CEFR level of the questions: {level}")
        if tense_text:
            lines.append(
                f"- Write questions that naturally elicit answers in the {tense_text}."
            )
        if voice_text:
            lines.append(f"- Answers are expected in the {voice_text}.")
        if rubric:
            lines.append(f"- Teacher's answering guidance for students: {rubric}")
        if existing_questions:
            lines += [
                "",
                "Do NOT repeat or paraphrase any of these existing questions:",
            ]
            lines += [f"- {q}" for q in existing_questions if str(q).strip()]

        lines += [
            "",
            "For each question also provide:",
            "- translation: the question translated into "
            + (language if language else "the student's first language (Chinese)"),
            "- keywords: 0-3 words the student should try to use",
            "- reference_answer: one sample spoken answer (for the teacher and the "
            "AI grader only; the student never sees it)",
            "- image_prompt: a short English description for illustrating the question",
            "",
            'Return JSON: {"questions": [{"question": "...", "translation": "...", '
            '"keywords": ["..."], "reference_answer": "...", "image_prompt": "..."}]}',
        ]
        return "\n".join(lines)

    @classmethod
    def build_extract_prompt(cls) -> str:
        """從圖片 / PDF 擷取情境文章。

        擷取是「照抄」不是「重寫」—— 老師上傳講義是希望用自己那份內容，模型自由發揮
        會讓他發現對不上。
        """
        return "\n".join(
            [
                "Extract the English passage from this file so it can be used as the "
                "context of a speaking practice activity.",
                "",
                "Requirements:",
                "- Copy the wording from the file; do not rewrite or summarise it.",
                "- Keep paragraph breaks; drop page numbers, headers and exercise "
                "numbering.",
                "- If the file contains questions or exercises, ignore them and keep "
                "only the passage.",
                "",
                'Return JSON: {"content": "<the passage>"}',
            ]
        )

    # ------------------------------------------------------------- 驗證 / 收斂

    @classmethod
    def validate_file(cls, file_bytes: bytes, mime_type: str) -> None:
        if not file_bytes:
            raise ScenarioDialogueAIError("檔案是空的")
        if len(file_bytes) > cls.MAX_FILE_BYTES:
            mb = cls.MAX_FILE_BYTES // (1024 * 1024)
            raise ScenarioDialogueAIError(f"檔案超過 {mb}MB")
        if mime_type not in cls.ALLOWED_MIME_TYPES:
            raise ScenarioDialogueAIError(f"不支援的檔案類型：{mime_type}")

    @classmethod
    def parse_json(cls, content: str) -> Any:
        """解析模型輸出。沿用 magic_paste 的作法：先去 markdown 圍欄，失敗再救援。"""
        text = (content or "").strip()
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text).strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # 輸出可能因 token 上限被截斷，尾端 JSON 不完整。盡量救回已完整的物件，
            # 讓老師拿到 8 題，而不是整包失敗一題都沒有。
            salvaged = cls._salvage_objects(text)
            if salvaged:
                logger.warning("scenario_dialogue_ai: JSON 截斷，救回 %d 個物件", len(salvaged))
                return {"questions": salvaged}
            raise ScenarioDialogueAIOutputError("AI 回傳的內容不是可用的 JSON")

    @staticmethod
    def _salvage_objects(text: str) -> List[Dict[str, Any]]:
        """從截斷的 JSON 裡掃出所有完整的 ``{...}`` 物件。

        用 stack 而不是只看最外層：截斷發生時，最外層的 ``{"questions": [...``
        永遠不會閉合，只盯 depth 0 的話一個都撿不到，救援等於沒做。
        """
        objects: List[Dict[str, Any]] = []
        stack: List[int] = []
        in_string = False
        escaped = False
        for i, ch in enumerate(text):
            if in_string:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
            elif ch == "{":
                stack.append(i)
            elif ch == "}" and stack:
                start = stack.pop()
                try:
                    parsed = json.loads(text[start : i + 1])
                except json.JSONDecodeError:
                    continue
                if isinstance(parsed, dict):
                    objects.append(parsed)
        # 只留看起來像題目的物件 —— 巢狀掃描也會撿到外層或其他結構
        return [o for o in objects if "question" in o]

    @staticmethod
    def _text(value: Any) -> str:
        return value.strip() if isinstance(value, str) else ""

    @classmethod
    def _keywords(cls, raw: Any) -> List[str]:
        """模型偶爾回字串而不是陣列，容忍掉，不要整包失敗。"""
        if isinstance(raw, list):
            values = [cls._text(x) for x in raw]
        elif isinstance(raw, str):
            values = [part.strip() for part in raw.split(",")]
        else:
            return []
        return [v for v in values if v]

    @classmethod
    def normalize_questions(
        cls,
        raw: Any,
        count: int,
        existing_questions: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """模型輸出 → 前端 row 需要的欄位。

        模型偶爾會直接回陣列、少給欄位、給重複題目或多給幾題，這裡一次收斂掉；
        一題都不剩就丟錯，讓呼叫端能明確告訴老師「這次沒產出來，再試一次」，而不是
        安靜地回空陣列讓他以為是自己操作錯。
        """
        if isinstance(raw, dict):
            items = raw.get("questions")
        else:
            items = raw
        if not isinstance(items, list):
            raise ScenarioDialogueAIOutputError("AI 回傳格式不正確（找不到題目陣列）")

        seen = {q.strip() for q in (existing_questions or []) if str(q).strip()}
        out: List[Dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            question = cls._text(item.get("question"))
            if not question or question in seen:
                continue
            seen.add(question)
            out.append(
                {
                    "question": question,
                    "translation": cls._text(item.get("translation")),
                    "keywords": cls._keywords(item.get("keywords")),
                    # 只給老師與 AI 評分用，學生端看不到（見 utils/scenario_dialogue）
                    "reference_answer": cls._text(item.get("reference_answer")),
                    "image_prompt": cls._text(item.get("image_prompt")),
                }
            )
            if len(out) >= count:
                break

        if not out:
            raise ScenarioDialogueAIOutputError("AI 這次沒有產出可用的題目")
        return out

    @classmethod
    def normalize_article(cls, raw: Any) -> str:
        content = cls._text(raw) if isinstance(raw, str) else ""
        if not content and isinstance(raw, dict):
            content = cls._text(raw.get("content"))
        if not content:
            raise ScenarioDialogueAIOutputError("AI 這次沒有產出情境內容")
        return content

    @staticmethod
    def estimate_cost(usage: Dict[str, int], model: str = FLASH_MODEL) -> float:
        pricing = _PRICING_USD_PER_1M.get(model)
        if not pricing:
            return 0.0
        return round(
            usage.get("input_tokens", 0) / 1_000_000 * pricing["input"]
            + usage.get("output_tokens", 0) / 1_000_000 * pricing["output"],
            6,
        )

    # ---------------------------------------------------------------- Vertex

    @staticmethod
    def _usage_of(response: Any) -> Dict[str, int]:
        meta = getattr(response, "usage_metadata", None)
        if meta is None:
            return {"input_tokens": 0, "output_tokens": 0}
        # thinking token 以**輸出價**計費，必須併入 output_tokens，否則成本嚴重
        # 低估（Issue #1119）。gemini-3.5-flash 的 thinking 量比 2.5 大很多：
        # 批改路徑實測單次 thoughts=330，與實際輸出 76 同一個量級。
        # 舊 response 沒有這個欄位時 getattr 取 0，行為不變。
        return {
            "input_tokens": getattr(meta, "prompt_token_count", 0) or 0,
            "output_tokens": (getattr(meta, "candidates_token_count", 0) or 0)
            + (getattr(meta, "thoughts_token_count", 0) or 0),
        }

    @classmethod
    async def _call_vertex(
        cls,
        prompt: str,
        max_output_tokens: int,
        file_part: Any = None,
    ) -> Tuple[Any, Dict[str, int]]:
        from vertexai.generative_models import GenerationConfig, GenerativeModel
        from services.vertex_ai import get_vertex_ai_service

        # 確保 vertexai.init 已呼叫（同 magic_paste）
        get_vertex_ai_service()._ensure_initialized()

        model = GenerativeModel(
            FLASH_MODEL, system_instruction=cls._system_instruction()
        )
        config = GenerationConfig(
            max_output_tokens=max_output_tokens,
            # 出題要有一點變化，但不能天馬行空跑掉情境
            temperature=0.7,
            response_mime_type="application/json",
        )
        contents = [file_part, prompt] if file_part is not None else prompt
        response = await model.generate_content_async(
            contents, generation_config=config
        )
        return response, cls._usage_of(response)

    @classmethod
    def _log_usage(cls, what: str, usage: Dict[str, int]) -> float:
        cost = cls.estimate_cost(usage)
        logger.info(
            "scenario_dialogue_ai %s | in=%s out=%s | cost≈$%.5f",
            what,
            usage.get("input_tokens"),
            usage.get("output_tokens"),
            cost,
        )
        return cost

    async def generate_article(self, goal: str, level: str = "") -> Dict[str, Any]:
        prompt = self.build_article_prompt(goal, level)
        response, usage = await self._call_vertex(prompt, ARTICLE_MAX_OUTPUT_TOKENS)
        content = self.normalize_article(self.parse_json(response.text))
        return {
            "content": content,
            "usage": usage,
            "estimated_cost_usd": self._log_usage("article", usage),
        }

    async def generate_questions(
        self,
        scenario_content: str,
        count: int,
        question_level: str = "",
        global_tense: Optional[Dict[str, str]] = None,
        global_voice: str = "",
        global_rubric: str = "",
        translate_language: str = "",
        existing_questions: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        prompt = self.build_question_prompt(
            scenario_content=scenario_content,
            count=count,
            question_level=question_level,
            global_tense=global_tense,
            global_voice=global_voice,
            global_rubric=global_rubric,
            translate_language=translate_language,
            existing_questions=existing_questions,
        )
        response, usage = await self._call_vertex(prompt, MAX_OUTPUT_TOKENS)
        questions = self.normalize_questions(
            self.parse_json(response.text),
            count=count,
            existing_questions=existing_questions,
        )
        return {
            "questions": questions,
            "usage": usage,
            "estimated_cost_usd": self._log_usage("questions", usage),
        }

    async def extract_article(
        self, file_bytes: bytes, mime_type: str
    ) -> Dict[str, Any]:
        self.validate_file(file_bytes, mime_type)

        from vertexai.generative_models import Part

        part = Part.from_data(data=file_bytes, mime_type=mime_type)
        response, usage = await self._call_vertex(
            self.build_extract_prompt(), ARTICLE_MAX_OUTPUT_TOKENS, file_part=part
        )
        content = self.normalize_article(self.parse_json(response.text))
        return {
            "content": content,
            "usage": usage,
            "estimated_cost_usd": self._log_usage("extract", usage),
        }


_service: Optional[ScenarioDialogueAIService] = None


def get_scenario_dialogue_ai_service() -> ScenarioDialogueAIService:
    global _service
    if _service is None:
        _service = ScenarioDialogueAIService()
    return _service
