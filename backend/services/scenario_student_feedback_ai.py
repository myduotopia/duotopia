"""情境對話：學生答完一題的 AI 建議（Issue #1140 Stage 1）。

#1133 的對話式作答 UI 裡，AI 建議是**流程的一環**：學生送出答案 → 出現建議 → 可以
再試一次或進下一題。`useScenarioChat` 的狀態機沒有建議就停在 `awaitingFeedback`，
所以這支服務是那個 UI 能上線的前提。

## 與 #1035 老師端評分的關係

兩件不同的事，共用的只有「Gemini 直讀 GCS 音檔」那段管線（從
`scenario_grading_ai.build_audio_part` 匯入，不複製 —— 那段藏著「同步 requests 會卡住
整個 event loop」的教訓）：

| | 老師端（`scenario_grading_ai`） | 學生端（本模組） |
|---|---|---|
| 誰觸發 | 老師在批改頁按 | 學生答完一題自動 |
| 產出 | 逐字稿＋四面向分數＋建議通過 | verdict＋鼓勵式評語＋建議說法 |
| 分數 | 給老師參考 | **一律不產生** |

學生畫面不顯示分數（設計稿只有老師預覽模式顯示 mock 分數），所以這裡連「要分數」都
不寫進 prompt —— 模型自己多給也會在 :func:`normalize_result` 被丟掉。

## 兩條不能破的線

1. **參考答案不外洩**。它只進 prompt 當語言特徵對照；回給學生等於把答案送他抄。
2. **不逐字比對**。開放式口說同一題每個人講的都不同，拿範例逐字比會把「不一樣但
   正確」的回答全判成要改進。prompt 明文禁止，與 #1035 同一條規則。
"""
import logging
from typing import Any, Dict, List, Optional

from services.scenario_grading_ai import (
    MODEL,
    build_audio_part,
    mime_type_for_recording,
)

logger = logging.getLogger(__name__)

# 這支只要回三個短欄位（verdict／兩句評語／一句建議說法），但 **gemini-3.5-flash 的
# thinking token 算在輸出預算裡**，而它的 thinking 量比 2.5 大很多（#1119）。
# 1024 加上預設開著的 thinking，實測在 staging 會把 JSON 截斷成
# `Unterminated string` → 整包解析失敗 → 學生看到「AI 建議暫時拿不到」。
#
# 所以兩件事一起做：**關掉 thinking**（這個任務不需要推理，而且 thinking 以輸出價
# 計費）＋ 留到 2048（與老師端評分同一個量級）當餘裕。
MAX_OUTPUT_TOKENS = 2048

VERDICTS = ("improve", "great")
#: 認不得的 verdict 落在這裡。誤誇比誤糾難補救：學生以為講對了就不會再練。
DEFAULT_VERDICT = "improve"

#: 評語要用學生看得懂的語言寫。值是給模型看的語言名稱。
_COMMENT_LANGUAGE = {
    "zh": "Traditional Chinese",
    "en": "English",
    "ja": "Japanese",
    "ko": "Korean",
}
_DEFAULT_COMMENT_LANGUAGE = "Traditional Chinese"


class ScenarioStudentFeedbackError(ValueError):
    """模型回了不能用的東西。"""


class ScenarioStudentFeedbackInputError(ScenarioStudentFeedbackError):
    """題目資料本身不完整（例如沒有題目內容），不是模型的問題。"""


def comment_language(ui_language: Optional[str]) -> str:
    """介面語言代碼 → 給模型看的語言名稱。

    認不得的值回預設而不是丟錯：這個值是前端傳來的，不該讓一個沒見過的語言代碼
    把學生卡在「等建議」那一格。
    """
    # 比對 **primary subtag**（BCP 47 的第一段），不是 startswith：
    # startswith 會讓 "zhx"、"english-ish" 這種值也命中（PR #1141 review）。
    code = (ui_language or "").strip().lower()
    primary = code.split("-", 1)[0]
    return _COMMENT_LANGUAGE.get(primary, _DEFAULT_COMMENT_LANGUAGE)


def _describe_tense(tense: Optional[Dict[str, str]]) -> str:
    if not isinstance(tense, dict):
        return ""
    time = (tense.get("time") or "").strip()
    aspect = (tense.get("aspect") or "").strip()
    if not time or not aspect:
        return ""
    return f"{time} {aspect}"


class ScenarioStudentFeedbackService:
    @staticmethod
    def _system_instruction() -> str:
        return (
            "You are a warm, encouraging EFL teacher talking directly to a young "
            "learner right after they spoke. You always answer with valid JSON only, "
            "no commentary."
        )

    @classmethod
    def build_prompt(cls, criteria: Dict[str, Any], ui_language: str) -> str:
        """組出「給學生的建議」prompt。

        ``criteria`` 用的是 `utils/scenario_dialogue.grading_criteria` 的輸出（題目、
        參考答案、必用字詞、生效時態語態、本題說明、整份作答指引、題目難度）—— 與老師端
        同一個來源，資料形狀只有一處。
        """
        question = (criteria.get("question") or "").strip()
        if not question:
            raise ScenarioStudentFeedbackInputError("這一題沒有題目內容，請先回教材補上")

        reference = (criteria.get("reference_answer") or "").strip()
        keywords: List[str] = [
            str(w).strip() for w in (criteria.get("keywords") or []) if str(w).strip()
        ]
        tense_text = _describe_tense(criteria.get("tense"))
        voice = (criteria.get("voice") or "").strip()
        rubric_note = (criteria.get("rubric_note") or "").strip()
        global_rubric = (criteria.get("global_rubric") or "").strip()
        level = (criteria.get("question_level") or "").strip()
        language = comment_language(ui_language)

        lines = [
            "Listen to the student's recorded answer to the question below, then "
            "reply to the student.",
            "",
            f"Question the student was answering: {question}",
        ]

        if reference:
            lines += [
                "",
                f"One example of a good answer: {reference}",
                "",
                "This example is only a reference for language features (tense, "
                "sentence pattern, level of vocabulary, completeness). NEVER compare "
                "the student's answer to it word-for-word: an open-ended speaking "
                "question has many correct answers, and a different answer is not a "
                "wrong answer.",
                "",
                # #1140：夥伴 staging 回報 `many food` 被放過關。上面那段「不要逐字比對」是
                # 為了防止「答得跟範例不同就被判低分」（#864 規格 3-3），但模型把它從
                # 「內容可以不同」推廣成「用詞錯了也算對」。這一句把兩件事切開。
                "That freedom is about WHAT the student chooses to say, not about "
                "HOW CORRECTLY they say it. Saying something different from the "
                "example is fine; saying it ungrammatically is not.",
            ]

        if keywords:
            lines += ["", f"Words the student was asked to use: {', '.join(keywords)}"]
        if tense_text:
            lines += ["", f"Target tense: {tense_text}"]
        if voice:
            lines += ["", f"Target voice: {voice}"]
        if rubric_note:
            lines += ["", f"Note for this question: {rubric_note}"]
        if global_rubric:
            lines += ["", f"What the teacher asked for overall: {global_rubric}"]
        if level:
            lines += ["", f"The student's level: {level}"]

        lines += [
            "",
            "Reply with JSON only, in this shape:",
            "{",
            '  "verdict": "great" | "improve",',
            '  "comment": "...",',
            '  "suggestion": "..."',
            "}",
            "",
            'Use "great" only when the answer does what the question asked '
            "AND has no language error a teacher would correct. If the meaning "
            'comes across but the English is wrong, that is still "improve" '
            "— a clear meaning does not excuse a wrong form.",
            "",
            "Check these, in this order of importance:",
            "- countable vs uncountable nouns (much / many / a lot of, and "
            "whether the noun takes -s)",
            "- verb tense and subject-verb agreement",
            "- word choice and collocation (does an English speaker say it "
            "that way?)",
            "- articles (a / an / the) and plurals",
            "- prepositions",
            "",
            # #1140：夥伴回報的案例直接寫成範例 —— 抽象規則模型容易打折，
            # 具體對照（much food / many foods / many food）效果穩定得多。
            'Worked example of the standard: for "I bought a lot of food", '
            '"much food" is correct, "many foods" is correct when the '
            'student means many KINDS of food, and "many food" is wrong — '
            'food is uncountable, so it cannot take "many" without the '
            'plural. An answer like that is "improve", with the correct form '
            "named in `comment`.",
            "",
            "Name the exact word or phrase that was wrong and the correct form. "
            "Put **one** main error in `comment` — this is spoken practice, not a "
            "proofreading exercise, and the student should leave knowing one thing "
            "to fix. The corrected sentence in `suggestion` can carry any further "
            "fixes, so `comment` does not have to list them all. Do not invent "
            "errors: if the sentence is correct English for the student's level, "
            'say so and use "great".',
            "",
            # PR #1152 review 第 2 點：輸入是**口說**的錄音，不是寫出來的句子。
            # 嚴格度拉高之後，缺標點、沒大寫這類逐字稿本來就有的特徵很容易被當成錯誤
            # 回報給學生 —— 那對口說練習毫無意義，而且會讓學生覺得被刁難。
            "The student is SPEAKING, not writing. Never treat missing punctuation, "
            "capitalisation, or filler words (um, uh, like) as errors. Judge only "
            "what would still be wrong if a fluent speaker said the same sentence "
            "out loud.",
            "",
            "",
            f"Write `comment` in {language}, in two short sentences at most, speaking "
            "to the student directly. Say what worked before what to change, and name "
            "one concrete thing to try. Never mention scores, grades or percentages.",
            "",
            # #1140 / PR #1152 review：原本寫「最多兩個錯」＋「評語最多兩句」＋「先講
            # 優點」，三者塞不進去，模型只能自己亂取捨 —— 而最可能被犧牲的正是錯誤
            # 細節，也就是這次要修的東西。改成「評語一個主錯、其餘交給建議說法」。
            # 這段原本放在前面、前向參照「下面的兩句限制」，移到這裡才讀得順。
            "When there is an error, the SECOND of those two sentences must be the "
            "correction — do not spend both sentences on praise. If praise plus "
            "correction will not fit, keep the correction and make the praise "
            "shorter.",
            "",
            "Put a full sentence the student could say in `suggestion`, in English, "
            'when verdict is "improve". It must answer this question, use the asked-for '
            "words and tense where they apply, and stay at the student's level. Leave "
            '`suggestion` out when verdict is "great".',
            "",
            "If the recording has no speech, or you cannot make out any words, use "
            'verdict "improve" and say so kindly in `comment`.',
            "",
            # #1140 2A：學生看不懂某個字時，會把它**逐字母拼出來**問 AI
            # （例如把 "spot" 唸成 S-P-O-T），而模型既聽不懂拼讀，也會把那當成一個很差
            # 的回答來評。這兩句處理這兩件事（#1140 2A）。
            "If the student spells a word out letter by letter (for example "
            '"S-P-O-T"), understand it as that word.',
            "",
            "Sometimes the student is not answering at all — they are asking what a "
            "word means, or asking for help. When that happens, do not judge their "
            'answer: use verdict "improve", tell them what the word means in one '
            "short sentence, and invite them to try answering. Leave `suggestion` "
            "out in that case.",
        ]
        return "\n".join(lines)

    @staticmethod
    def parse_json(content: str) -> Any:
        """與老師端共用同一個寬鬆解析（去掉 code fence、容忍尾巴被截斷）。"""
        from services.scenario_grading_ai import ScenarioGradingService

        return ScenarioGradingService.parse_json(content)

    @staticmethod
    def _text(value: Any) -> str:
        return value.strip() if isinstance(value, str) else ""

    @classmethod
    def normalize_result(cls, raw: Any) -> Dict[str, Any]:
        """只留下學生畫面真的會用到的三個欄位。

        刻意**白名單**而不是把模型回的東西原樣往外帶：模型有時會自己多塞分數或
        把參考答案抄回來，那兩樣都不該出現在學生那一側。
        """
        if not isinstance(raw, dict):
            raise ScenarioStudentFeedbackError("AI 回傳格式不正確")

        comment = cls._text(raw.get("comment"))
        if not comment:
            # 評語是對話裡唯一要顯示的東西 —— 空的就是一顆空泡泡，不如讓呼叫端重試
            raise ScenarioStudentFeedbackError("AI 沒有給評語")

        verdict = cls._text(raw.get("verdict")).lower()
        if verdict not in VERDICTS:
            verdict = DEFAULT_VERDICT

        suggestion = cls._text(raw.get("suggestion")) or None
        return {"verdict": verdict, "comment": comment, "suggestion": suggestion}

    async def generate(
        self,
        recording_url: str,
        criteria: Dict[str, Any],
        ui_language: str = "zh-TW",
    ) -> Dict[str, Any]:
        """聽一段錄音，回一則給學生的建議。呼叫端負責配額與所有權。

        音檔格式由網址推導（`mime_type_for_recording`），不開放呼叫端傳 —— #1036 的
        教訓：那是個會忘的參數，忘了就是靜靜把 mp4 標成 webm 送出去。
        """
        if not recording_url:
            raise ScenarioStudentFeedbackInputError("這一題沒有錄音，無法給建議")

        prompt = self.build_prompt(criteria, ui_language)

        from vertexai.generative_models import GenerationConfig, GenerativeModel
        from services.vertex_ai import VertexAIService, get_vertex_ai_service

        get_vertex_ai_service()._ensure_initialized()

        model = GenerativeModel(MODEL, system_instruction=self._system_instruction())
        config = GenerationConfig(
            max_output_tokens=MAX_OUTPUT_TOKENS,
            # 建議要穩定：同一段錄音重試不該忽然從「很棒」變成「要改進」
            temperature=0.3,
            response_mime_type="application/json",
        )
        # 關掉 thinking：這個任務是「聽完說一句鼓勵＋一句建議說法」，不需要推理，
        # 而 thinking token 會吃掉輸出預算（並以輸出價計費）。見 MAX_OUTPUT_TOKENS。
        VertexAIService._set_thinking_budget(config, 0)
        response = await model.generate_content_async(
            [
                await build_audio_part(
                    recording_url, mime_type_for_recording(recording_url)
                ),
                prompt,
            ],
            generation_config=config,
        )

        from services.scenario_grading_ai import ScenarioGradingService

        usage = ScenarioGradingService._usage_of(response)
        try:
            result = self.normalize_result(self.parse_json(response.text))
        except Exception:
            # 把 finish_reason 記下來 —— MAX_TOKENS 就是「又被截斷了」，不必再猜。
            # 第一次踩這個坑時 log 裡只有 JSONDecodeError，查了一輪才確認是截斷。
            finish = None
            try:
                finish = response.candidates[0].finish_reason
            except Exception:
                pass
            logger.warning(
                "scenario_student_feedback_ai: 解析失敗 | finish_reason=%s | out=%s",
                finish,
                usage.get("output_tokens"),
            )
            raise
        cost = ScenarioGradingService.estimate_cost(usage)
        logger.info(
            "scenario_student_feedback_ai | in=%s out=%s | cost≈$%.5f",
            usage.get("input_tokens"),
            usage.get("output_tokens"),
            cost,
        )
        return {**result, "usage": usage, "estimated_cost_usd": cost}


_service: Optional[ScenarioStudentFeedbackService] = None


def get_scenario_student_feedback_service() -> ScenarioStudentFeedbackService:
    global _service
    if _service is None:
        _service = ScenarioStudentFeedbackService()
    return _service
