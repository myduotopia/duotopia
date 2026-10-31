"""情境對話 AI 評分服務 — Issue #1035。

#1031 交付的是**純人工批改**：老師逐題聽錄音、對照參考答案給分。這個模組把 AI 建議
補上，讓老師不必聽完十題才給得出分數 —— 但**最終判定仍然是老師**，這裡只產生建議。

為什麼不能沿用既有的 AI 評分
----------------------------

專案裡的 AI 評分是兩層，情境對話兩層都接不上：

1. **逐題評分**是前端直呼 Azure Speech SDK 的
   ``PronunciationAssessmentConfig(referenceText, ..., enableMiscue=True)``，評的是
   「你把這句**已知的話**唸得多準」。
2. **作業層報告**（``services/analysis_service.py``）讀的是上面那些分數。

情境對話是開放式回答：「你上週末做了什麼？」有幾百種合理答案，沒有 referenceText
這種東西。硬把 ``reference_answer`` 塞進去，``enableMiscue`` 會把「講得跟範例不同」
判成漏字錯字，分數全趴。

所以這裡是另一條路徑：**音檔 → Gemini →（逐字稿 + 語言特徵評分）**。

一次呼叫，不需要獨立的 STT
--------------------------

Gemini 直接吃音檔（``Part.from_uri`` 讀 GCS，本機開發回退成下載後 ``from_data``），
一次拿到逐字稿與評分。原本規劃的「先 STT 再評分」兩段式因此省掉了。

評的是語言特徵，不是字面相似度
------------------------------

參考答案在 prompt 裡被明確標成**示範**，並要求模型不要逐字比對 —— 這是整個模組最
重要的一句話。評分面向依 #864 規格 3-3：

* **content** 資訊完整度：有沒有真的回答到問題
* **grammar** 時態／句型：是否符合老師設定的時態語態
* **vocabulary** 用字水準：是否符合題目難度
* **keywords** 必用字詞：有沒有用上

輸出是**建議**：``suggested_pass`` 給老師參考，批改頁不會自動定案。
"""

import json
import logging
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from core.config import settings
from utils.ai_cost import estimate_cost_usd

logger = logging.getLogger(__name__)

# 模型 ID 單一來源在 core/config.py（Issue #1119）—— gemini-2.5-* 已退役
MODEL = settings.VERTEX_AI_FLASH_MODEL

# 逐字稿 + 四個面向 + 回饋，抓寬一點避免截斷
MAX_OUTPUT_TOKENS = 2048

# 情境文章送進評分 prompt 的長度上限（#1146）。存檔端沒有上限，這裡截一刀避免
# 異常長的情境讓每一題評分都燒大量 token。出題端點的上限是 8000，這裡同值。
MAX_SCENARIO_CHARS_FOR_GRADING = 8000

# 音檔輸入也計在 input tokens。
# 模型單價：單一來源在 core/config.py（PR #1122 review 第 6 點），
# 避免像模型 ID 那樣散在多個檔案各自飄。以模型名為 key，換模型忘了加價格
# 會讓成本統計靜默變 0 —— 迴歸測試 tests/unit/test_issue_1119_model_migration.py
_PRICING_USD_PER_1M = settings.VERTEX_AI_PRICING_USD_PER_1M

_GCS_HOST = "storage.googleapis.com"

# 評分面向。key 與前端、資料庫共用，改名要同步。
SCORE_KEYS = ("content", "grammar", "vocabulary", "keywords")

# 動貌代碼 → 英文描述（與 services/scenario_dialogue_ai.py 同一套）
_ASPECT_WORDS = {
    "simple": "simple",
    "progressive": "progressive",
    "perfect": "perfect",
    "perfectProgressive": "perfect progressive",
}


class ScenarioGradingError(ValueError):
    """模型這次評不出來（逐字稿空白、輸出壞掉）。呼叫端轉成 502 —— 重試可能有用。"""


class ScenarioGradingInputError(ScenarioGradingError):
    """要評的資料本身有問題（例如題目是空的）。

    與 :class:`ScenarioGradingError` 分開，是因為對老師的意思完全不同：模型失敗時
    「稍後再試」是對的建議，但題目本身沒內容的話，重試一百次也不會變好 —— 那是教材
    要修。繼承自它，讓既有的 ``except ScenarioGradingError`` 仍能一併接住。
    """


def to_gcs_uri(url: Optional[str]) -> Optional[str]:
    """公開的 GCS 網址 → ``gs://`` URI，讓 Gemini 直接讀，不必下載。

    回傳 ``None`` 代表這不是 GCS 網址（本機開發把錄音存在自己的 static 目錄），
    呼叫端要改用「下載成 bytes」的方式。
    """
    if not url:
        return None
    parsed = urlparse(url)
    if parsed.netloc != _GCS_HOST:
        return None
    path = parsed.path.lstrip("/")
    if not path or "/" not in path:
        return None
    return f"gs://{path}"


# 存檔副檔名 → 送給 Gemini 的格式。
#
# 為什麼不能寫死 audio/webm（PR #1036 review 抓到）：macOS Safari 只錄得出 audio/mp4，
# 而且前端對認不出來的裝置也是預設 audio/mp4（audioRecordingStrategy.ts），這不是邊角
# 案例。最糟的情況不是失敗而是**半成功** —— Gemini 勉強解出一段破碎的逐字稿，通過了
# normalize_result 的非空檢查，老師就看到一個看起來很正常、其實是格式錯誤造成的低分。
#
# 副檔名是上傳時依真實 content_type 決定的（RECORDING_CONTENT_TYPE_TO_EXT），所以反推
# 得回來，不必多打一次 GCS 讀 blob metadata。
EXTENSION_TO_MIME = {
    "webm": "audio/webm",
    "m4a": "audio/mp4",
    "mp4": "video/mp4",
    "ogg": "audio/ogg",
    # opus 存在 ogg 容器裡
    "opus": "audio/ogg",
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
}

# 認不得的副檔名落回 webm —— 上傳端對認不得的 content_type 也是落成 .webm，兩邊一致。
_DEFAULT_MIME = "audio/webm"


def mime_type_for_recording(url: Optional[str]) -> str:
    """從錄音網址推出真實格式。

    刻意做成從網址推導、而不是讓呼叫端傳參數：呼叫端「記得傳對」是會忘的，忘了就是
    靜靜地送錯格式。
    """
    if not url:
        return _DEFAULT_MIME
    path = urlparse(url).path
    _, dot, ext = path.rpartition(".")
    if not dot or "/" in ext:
        return _DEFAULT_MIME
    return EXTENSION_TO_MIME.get(ext.lower(), _DEFAULT_MIME)


async def build_audio_part(recording_url: str, mime_type: str) -> Any:
    """把錄音變成 Gemini 的 Part。

    GCS 上的檔案用 ``from_uri`` 直接引用（不必下載，省頻寬也省記憶體）；本機開發
    把錄音存在自己的 static 目錄，只能抓下來用 ``from_data``。

    下載走 ``asyncio.to_thread``：requests 是同步的，直接在 async 路徑上呼叫會把
    整個 event loop 卡住最長 30 秒（timeout），同一個 process 上其他請求全部跟著
    停。production 走 GCS 那條不下載，但本機開發與未來的非 GCS 來源會踩到。

    放在模組層是因為學生端的逐題建議（`scenario_student_feedback_ai`，#1140）要用
    同一段管線。上面那個「同步 requests 會卡住 event loop」的陷阱不可以被複製一份。
    """
    from vertexai.generative_models import Part

    gcs_uri = to_gcs_uri(recording_url)
    if gcs_uri:
        return Part.from_uri(gcs_uri, mime_type=mime_type)

    import asyncio

    import requests

    response = await asyncio.to_thread(requests.get, recording_url, timeout=30)
    response.raise_for_status()
    return Part.from_data(data=response.content, mime_type=mime_type)


def _describe_tense(tense: Optional[Dict[str, str]]) -> str:
    """時態穩定代碼 → 英文描述。時間與動貌都要有才算指定（同前端 isTenseSet）。"""
    if not isinstance(tense, dict):
        return ""
    time = (tense.get("time") or "").strip()
    aspect = (tense.get("aspect") or "").strip()
    if not time or not aspect:
        return ""
    return f"{time} {_ASPECT_WORDS.get(aspect, aspect)}"


class ScenarioGradingService:
    @staticmethod
    def _system_instruction() -> str:
        return (
            "You are an experienced EFL teacher grading a young learner's spoken "
            "answer. You are fair and encouraging, and you always answer with valid "
            "JSON only, no commentary."
        )

    @classmethod
    def build_prompt(cls, criteria: Dict[str, Any]) -> str:
        """組出評分 prompt。

        ``criteria`` 來自資料庫（#1013 就存好了）：題目、參考答案、必用字詞、生效的
        時態語態、本題說明、整份作答指引、題目難度。
        """
        question = (criteria.get("question") or "").strip()
        if not question:
            raise ScenarioGradingInputError("這一題沒有題目內容，請先回教材補上")

        reference = (criteria.get("reference_answer") or "").strip()
        keywords: List[str] = [
            str(w).strip() for w in (criteria.get("keywords") or []) if str(w).strip()
        ]
        tense_text = _describe_tense(criteria.get("tense"))
        voice = (criteria.get("voice") or "").strip()
        voice_text = f"{voice} voice" if voice else ""
        rubric_note = (criteria.get("rubric_note") or "").strip()
        global_rubric = (criteria.get("global_rubric") or "").strip()
        level = (criteria.get("question_level") or "").strip()
        scenario = (criteria.get("scenario_content") or "").strip()[
            :MAX_SCENARIO_CHARS_FOR_GRADING
        ]
        image_count = int(criteria.get("scenario_image_count") or 0)

        lines = [
            "Listen to the student's recorded answer and grade it.",
        ]
        # #1146：題目常是「圖中的人在做什麼？」這類離開情境就答不出來的問題，評分端
        # 看不到情境的話只能瞎猜學生答得對不對。情境文字與情境圖都是學生作答時看得到
        # 的東西，所以拿來當判斷「有沒有答到問題」的依據。
        if scenario:
            lines += [
                "",
                "Scenario the student read before answering:",
                scenario,
            ]
        if image_count > 0:
            lines += [
                "",
                f"The student also saw {image_count} scenario picture(s), attached "
                "above. Use them to judge whether the answer fits the scenario.",
            ]
        lines += [
            "",
            f"Question the student was answering: {question}",
        ]

        if reference:
            lines += [
                "",
                f"Example of a good answer: {reference}",
                "",
                # 這三行是整個模組最重要的部分。少了它們，模型會拿學生的話去對範例，
                # 而口說同一題每個學生講的內容本來就不同（#864 規格 3-3）。
                "IMPORTANT: the example above is only to show you the expected "
                "language level and the kind of information a good answer contains. "
                "Do NOT compare the student's answer to it word-for-word, and do not "
                "lower the score just because the student said something different. "
                "A completely different but appropriate answer deserves full marks.",
            ]

        lines += ["", "Grade these four aspects, each 0-100:"]
        lines.append(
            "- content: did the student actually answer the question, and is the "
            "answer complete enough?"
        )
        if tense_text or voice_text:
            expected = " and ".join(
                x
                for x in [f"{tense_text} tense" if tense_text else "", voice_text]
                if x
            )
            lines.append(
                f"- grammar: sentence structure, and whether the answer is in the "
                f"{expected} the teacher asked for"
            )
        else:
            lines.append("- grammar: sentence structure and grammatical accuracy")
        if level:
            lines.append(
                f"- vocabulary: is the word choice appropriate for CEFR level {level}?"
            )
        else:
            lines.append("- vocabulary: is the word choice appropriate and varied?")
        if keywords:
            lines.append(
                "- keywords: did the student use these words? " + ", ".join(keywords)
            )
        else:
            # 老師沒指定必用字詞時不留一條空條目 —— 直接說明這個面向給滿分就好，
            # 免得模型自己想像出一組「應該要用」的字（#1021 的教訓）。
            lines.append(
                "This question has no required words, so give a full score for that "
                "fourth aspect."
            )

        if rubric_note:
            lines += ["", f"Teacher's note for this question: {rubric_note}"]
        if global_rubric:
            lines.append(f"Teacher's guidance for the whole activity: {global_rubric}")

        lines += [
            "",
            "Also transcribe what the student said.",
            "",
            'Return JSON: {"transcript": "...", "scores": {"content": 0-100, '
            '"grammar": 0-100, "vocabulary": 0-100, "keywords": 0-100}, '
            '"overall": 0-100, "feedback": "one or two sentences for the '
            'teacher, in Traditional Chinese", "suggested_pass": true/false}',
        ]
        return "\n".join(lines)

    # ------------------------------------------------------------- 輸出收斂

    @staticmethod
    def parse_json(content: str) -> Any:
        text = (content or "").strip()
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text).strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            raise ScenarioGradingError("AI 回傳的內容不是可用的 JSON")

    @staticmethod
    def _score(value: Any) -> Optional[int]:
        """分數收斂到 0~100。

        非數字一律當成「沒評到」回 ``None`` —— **不可以當成 0 分**：0 分是「答得很差」，
        沒評到是「這次沒有這個面向的資訊」，對老師的意思完全不同。
        """
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        return max(0, min(100, int(round(value))))

    @classmethod
    def normalize_result(cls, raw: Any) -> Dict[str, Any]:
        if not isinstance(raw, dict):
            raise ScenarioGradingError("AI 回傳格式不正確")

        transcript = (raw.get("transcript") or "").strip()
        if not transcript:
            # 一個字都沒轉出來 = 這次不可用（收音失敗、全靜音…）。給一份空評分只會
            # 讓老師以為學生答得很差。
            raise ScenarioGradingError("AI 沒有辨識出任何內容，請確認錄音是否正常")

        raw_scores = raw.get("scores")
        if not isinstance(raw_scores, dict):
            raise ScenarioGradingError("AI 這次沒有產出評分")

        # 個別面向評不出來就留白（見 _score）；整個 scores 缺席才算失敗，那個情況
        # 上面已經擋掉了。
        scores = {key: cls._score(raw_scores.get(key)) for key in SCORE_KEYS}

        feedback = raw.get("feedback")
        return {
            "transcript": transcript,
            "scores": scores,
            "overall": cls._score(raw.get("overall")),
            "feedback": feedback.strip() if isinstance(feedback, str) else "",
            # 建議而已 —— 批改頁不會自動定案，老師仍是最終判定者
            "suggested_pass": bool(raw.get("suggested_pass")),
        }

    @staticmethod
    def estimate_cost(usage: Dict[str, int], model: str = MODEL) -> float:
        return estimate_cost_usd(model, usage)

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
    async def _audio_part(cls, recording_url: str, mime_type: str) -> Any:
        """保留原本的呼叫方式；實作搬到模組層的 :func:`build_audio_part`。"""
        return await build_audio_part(recording_url, mime_type)

    async def grade(
        self,
        recording_url: str,
        criteria: Dict[str, Any],
    ) -> Dict[str, Any]:
        """評一題。呼叫端負責取出 criteria 與寫回結果。

        音檔格式由網址自己推導（見 :func:`mime_type_for_recording`），不開放呼叫端傳
        —— 那是個會忘的參數，忘了就是靜靜地把 mp4 標成 webm 送出去。
        """
        if not recording_url:
            raise ScenarioGradingInputError("這一題沒有錄音，無法評分")

        # #1146 情境圖：讀不到的圖略過（見 scenario_context_images），張數以實際
        # 送出的為準寫進 prompt，避免叫模型看一張不存在的圖。
        from services.scenario_context_images import build_image_parts

        image_parts = build_image_parts(criteria.get("scenario_images"))
        prompt = self.build_prompt(
            {**criteria, "scenario_image_count": len(image_parts)}
        )

        from vertexai.generative_models import GenerationConfig, GenerativeModel
        from services.vertex_ai import get_vertex_ai_service

        get_vertex_ai_service()._ensure_initialized()

        model = GenerativeModel(MODEL, system_instruction=self._system_instruction())
        config = GenerationConfig(
            max_output_tokens=MAX_OUTPUT_TOKENS,
            # 評分要穩定 —— 同一份錄音重跑不該差很多
            temperature=0.2,
            response_mime_type="application/json",
        )
        response = await model.generate_content_async(
            [
                *image_parts,
                await self._audio_part(
                    recording_url, mime_type_for_recording(recording_url)
                ),
                prompt,
            ],
            generation_config=config,
        )

        usage = self._usage_of(response)
        result = self.normalize_result(self.parse_json(response.text))
        cost = self.estimate_cost(usage)
        logger.info(
            "scenario_grading_ai | in=%s out=%s | cost≈$%.5f",
            usage.get("input_tokens"),
            usage.get("output_tokens"),
            cost,
        )
        return {**result, "usage": usage, "estimated_cost_usd": cost}


_service: Optional[ScenarioGradingService] = None


def get_scenario_grading_service() -> ScenarioGradingService:
    global _service
    if _service is None:
        _service = ScenarioGradingService()
    return _service
