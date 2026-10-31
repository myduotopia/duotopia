"""情境對話 AI 生圖服務 — Issue #1024 起，#1158 改用 Gemini 生圖模型。

#1021 把情境對話的文字類 AI 都接成真的了，只有逐題生圖沒做；#1024 補上時用的是
Imagen（``imagen-3.0-generate-002``），後來下架回 404。#1158 改用 Gemini 生圖模型
（模型 ID 與 location 都在 ``core.config``：``VERTEX_IMAGE_MODEL`` /
``VERTEX_IMAGE_LOCATION``，不寫死在這裡）。

為什麼直接打 REST，而不是用 google-genai SDK（#1158）
-----------------------------------------------------

要設定 4:3 比例與 ``person_generation`` 得用 ``imageConfig``，但舊的 ``vertexai`` SDK
沒有這個欄位；新 SDK ``google-genai`` 從有 ``ImageConfig`` 的版本起都要求
``httpx>=0.28.1``，而我們鎖在 ``httpx==0.25.2`` —— httpx 0.28 拿掉了 ``Client(app=...)``，
現在的 starlette 0.27 ``TestClient`` 就是這樣用的，升上去整套 API 測試都會壞。

所以這裡用 ``google-auth``（``google-cloud-aiplatform`` 本來就帶進來）取 ADC 憑證，
直接呼叫 Vertex 的 ``generateContent`` REST 端點。請求與回應都是官方 JSON 格式，
以後升級 httpx／改用 SDK 時只要換掉 :meth:`ScenarioDialogueImageService._post`。

資料出境（#959 的例外）
----------------------

亞洲 region 沒有 Gemini 生圖模型，所以**只有生圖**走 global（見 ``core/config.py``
「生圖例外」）。送出去的只有老師寫的描述／情境文字，**不送任何學生資料**。

生圖描述從哪來
--------------

* 題目圖：每一題的 ``item_metadata["scenario_dialogue"]["image_prompt"]``（#1013 起就有，
  #1021 產題會連生圖描述一起回傳），老師在生圖對話框裡可以改。
* 情境圖：``/suggest-image-description`` 依情境文章先擬一段，老師改完再生成。

人物與安全設定
--------------

人物年齡依描述決定（#1158 使用者定案）：有時要畫成人，有時要畫兒童（情境對話多半是
校園情境）。所以 ``personGeneration="ALLOW_ALL"``，描述**不做任何兒童字詞改寫**，
描述沒寫明年齡時交給模型依情境自然判斷。

2026-10-29 實測（global、``gemini-3.1-flash-lite-image``）：同一句「two young
children ... in a school classroom」，``ALLOW_ALL`` 正常生出兒童線稿；``ALLOW_ADULT``
回 ``finishReason=IMAGE_SAFETY``。#1024 那套「students → a classroom scene」改寫與
「人物都是成人」的畫風提示是為了繞過 ``ALLOW_ADULT``，已一併拿掉。

被擋下時模型回的是「沒有圖片的候選」或 ``promptFeedback.blockReason``，不是 HTTP 錯誤，
要自己判斷並轉成 :class:`ScenarioImageBlockedError` —— 那要對老師說「換個描述試試」，
與「呼叫失敗，請稍後再試」是兩件事。

計費
----

這裡只回報實際輸出 token（``output_tokens``），扣額度由
``services/scenario_image_billing`` 負責（#1158）。
"""

import asyncio
import base64
import logging
import re
from typing import Any, Dict, List, Optional

from core.config import settings

logger = logging.getLogger(__name__)

# 單一來源在 core.config（Issue #1119 起模型 ID 一律從 settings 取）
IMAGE_MODEL = settings.VERTEX_IMAGE_MODEL
IMAGE_LOCATION = settings.VERTEX_IMAGE_LOCATION

# 單張成本的粗估（美元，僅供觀測與日誌，非計費用途）。
# ⚠️ 未對照官方價目表查證（2026-10-29 價格頁抓不到生圖模型的單價），只是量級參考；
# 真正向老師收的是依 output token 換算的點數（scenario_image_billing）。
_PRICE_USD_PER_IMAGE = 0.04

# REST 呼叫逾時（秒）。實測一張約 10~20 秒，冷啟動時會更久
_REQUEST_TIMEOUT_SECONDS = 120

# 視為「被安全過濾擋下」的 finishReason
_BLOCKED_FINISH_REASONS = {
    "SAFETY",
    "IMAGE_SAFETY",
    "PROHIBITED_CONTENT",
    "IMAGE_PROHIBITED_CONTENT",
    "BLOCKLIST",
    "SPII",
    "RECITATION",
    "IMAGE_RECITATION",
}

IMAGE_KINDS = ("scenario", "question")


class ScenarioImageError(ValueError):
    """可預期的生圖錯誤（參數不合法、回應格式無法解析）。"""


class ScenarioImageBlockedError(ScenarioImageError):
    """被安全過濾擋下（模型沒有產出圖片）。

    與一般失敗分開，因為對老師的意思不同：這個要說「換個描述試試」，一般失敗是
    「稍後再試」。繼承父類，所以只攔父類的呼叫端不會漏接。
    """


class ScenarioImageUpstreamError(RuntimeError):
    """Vertex 回 HTTP 錯誤（模型下架、權限、配額、5xx）。

    刻意**不**繼承 :class:`ScenarioImageError`：那個會被端點轉成 400「參數不合法」，
    但這是我們這邊的問題，要回 502「稍後再試」並進 error log。
    """


# 統一的畫風（#1158 使用者定案）：黑白線稿、不上色、不塗灰、白底、不放文字，
# 適合印成語言學習講義。同一份教材裡的圖不該一張彩色一張線稿。
#
# 「畫面要合理」：AI 常畫出三隻手、桌子比人大、說兩顆蘋果卻畫五顆 —— 學生會被誤導。
# 預設要求比例、數量、場景一致；**只有描述明確要求荒謬畫面時才例外**（老師可能就是
# 要出「這張圖哪裡怪？」的題目）。
#
# 結尾固定是 "no text or letters in the image." —— 測試用它確認風格提示沒被截斷。
_STYLE_HINT = (
    "Style: black-and-white line-art illustration for a printable "
    "language-learning worksheet. Clean black outlines on a plain white "
    "background only: no color, no gray shading, no filled areas. "
    "Keep the picture sensible and realistic: correct proportions between "
    "people and objects, the exact number of items described, and one "
    "consistent setting. People's ages follow the description; if it does "
    "not say, choose ages that fit the situation naturally. "
    "Only if the description above explicitly asks for "
    "something absurd, impossible or funny, draw exactly that instead. "
    "Keep it simple; no text or letters in the image."
)

# 依用途給模型一句開頭，讓它知道這張圖在教材裡扮演什麼角色
_KIND_LEAD = {
    "scenario": "A scene that sets up this situation for a speaking activity: ",
    "question": "A picture that supports this speaking question: ",
}


def build_image_prompt(raw_prompt: Optional[str], kind: str = "question") -> str:
    """把老師確認過的描述變成真的要送給生圖模型的 prompt。

    做兩件事：依用途加一句開頭、補上統一畫風。描述本身不改寫（人物年齡依描述，
    見模組說明），只把多餘空白收成一個。
    """
    text = (raw_prompt or "").strip()
    if not text:
        raise ScenarioImageError("生圖描述不可為空")
    if kind not in IMAGE_KINDS:
        raise ScenarioImageError(f"不支援的圖片用途：{kind!r}")

    text = re.sub(r"\s+", " ", text).strip()

    # 先把原文截到「扣掉開頭與風格提示之後」的長度，再接上去 —— 反過來做的話，原文
    # 接近上限時風格提示會被切掉半句（PR #1027 review round 2）
    lead = _KIND_LEAD[kind]
    suffix = f". {_STYLE_HINT}"
    room = ScenarioDialogueImageService.MAX_PROMPT_CHARS - len(lead) - len(suffix)
    return f"{lead}{text[:max(0, room)]}{suffix}"


class ScenarioDialogueImageService:
    # 老師描述的長度上限（端點的 Pydantic 上限用這個）
    MAX_DESCRIPTION_CHARS = 1000
    # 送給模型的整段 prompt 上限：描述 + 開頭 + 畫風（畫風約 600 字元，所以比描述寬）
    MAX_PROMPT_CHARS = 2000

    def __init__(self) -> None:
        self._session: Any = None

    # ---------------------------------------------------------------- 回應解析

    @staticmethod
    def output_tokens_of(response: Dict[str, Any]) -> int:
        """實際輸出 token（圖片 token + thinking token，兩者都以輸出價計費）。"""
        meta = response.get("usageMetadata") or {}
        return int(meta.get("candidatesTokenCount") or 0) + int(
            meta.get("thoughtsTokenCount") or 0
        )

    @staticmethod
    def extract_image(response: Any) -> Dict[str, Any]:
        """從 ``generateContent`` 回應取出第一張圖：``{"image_bytes", "mime_type"}``。

        **被擋** 與 **格式變了** 要分開（PR #1027 review 的同一個理由）：

        * 被擋：``promptFeedback.blockReason``、``finishReason`` 是安全類、或候選裡沒有
          圖片（模型改回一段拒絕的文字）→ :class:`ScenarioImageBlockedError`。
        * 回應根本不是預期的形狀（不是 dict）→ :class:`ScenarioImageError`
          「稍後再試」，不能被講成「你的描述有問題」。
        """
        if not isinstance(response, dict):
            raise ScenarioImageError("圖片回應格式無法解析（Vertex API 可能已變更），請稍後再試")

        blocked_msg = "AI 沒有產出圖片，可能是描述被安全過濾擋下，請換個描述再試"
        feedback = response.get("promptFeedback") or {}
        if feedback.get("blockReason"):
            raise ScenarioImageBlockedError(blocked_msg)

        candidates = response.get("candidates") or []
        if not candidates:
            raise ScenarioImageBlockedError(blocked_msg)

        first = candidates[0] or {}
        if first.get("finishReason") in _BLOCKED_FINISH_REASONS:
            raise ScenarioImageBlockedError(blocked_msg)

        parts = (first.get("content") or {}).get("parts") or []
        for part in parts:
            inline = part.get("inlineData") if isinstance(part, dict) else None
            if not inline or not inline.get("data"):
                continue
            try:
                data = base64.b64decode(inline["data"])
            except Exception:
                raise ScenarioImageError("圖片回應格式無法解析，請稍後再試")
            if data:
                return {
                    "image_bytes": data,
                    "mime_type": inline.get("mimeType") or "image/png",
                }

        # 有候選但沒有圖片（只有文字）= 模型拒絕畫，對老師而言就是「換個描述」
        raise ScenarioImageBlockedError(blocked_msg)

    @staticmethod
    def estimate_cost(image_count: int = 1) -> float:
        return round(max(0, image_count) * _PRICE_USD_PER_IMAGE, 6)

    # ---------------------------------------------------------------- Vertex

    @staticmethod
    def endpoint_url(
        model: str = IMAGE_MODEL,
        location: str = IMAGE_LOCATION,
        project: Optional[str] = None,
    ) -> str:
        project_id = project or settings.VERTEX_AI_PROJECT_ID
        host = (
            "aiplatform.googleapis.com"
            if location == "global"
            else f"{location}-aiplatform.googleapis.com"
        )
        return (
            f"https://{host}/v1/projects/{project_id}/locations/{location}"
            f"/publishers/google/models/{model}:generateContent"
        )

    @staticmethod
    def build_request_body(prompt: str) -> Dict[str, Any]:
        return {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseModalities": ["IMAGE"],
                "imageConfig": {
                    "aspectRatio": "4:3",
                    # 人物年齡依描述，成人與兒童都可以（見模組說明）
                    "personGeneration": "ALLOW_ALL",
                },
            },
        }

    def _get_session(self) -> Any:
        if self._session is None:
            import google.auth
            from google.auth.transport.requests import AuthorizedSession

            credentials, _ = google.auth.default(
                scopes=["https://www.googleapis.com/auth/cloud-platform"]
            )
            self._session = AuthorizedSession(credentials)
        return self._session

    def _post(self, prompt: str) -> Dict[str, Any]:
        """同步打一次 ``generateContent``（在 thread 裡跑，見 :meth:`generate`）。"""
        resp = self._get_session().post(
            self.endpoint_url(),
            json=self.build_request_body(prompt),
            timeout=_REQUEST_TIMEOUT_SECONDS,
        )
        if resp.status_code >= 400:
            # 不把回應全文丟給老師；進 log 讓我們查（模型下架會是 404）
            raise ScenarioImageUpstreamError(
                f"Vertex image {resp.status_code}: {resp.text[:500]}"
            )
        try:
            return resp.json()
        except ValueError:
            raise ScenarioImageError("圖片回應格式無法解析，請稍後再試")

    async def generate(self, raw_prompt: Optional[str], kind: str = "question") -> dict:
        """產生一張圖。

        回傳 ``{"image_bytes", "mime_type", "prompt", "output_tokens",
        "estimated_cost_usd"}``。呼叫端負責存檔與扣額度 —— 這裡只管「跟模型要一張圖」。
        """
        prompt = build_image_prompt(raw_prompt, kind)

        # requests 是同步的，丟到 thread 裡跑，不卡住 event loop
        response = await asyncio.to_thread(self._post, prompt)

        image = self.extract_image(response)
        output_tokens = self.output_tokens_of(response)
        cost = self.estimate_cost(1)
        logger.info(
            "scenario_dialogue_image generate | model=%s | location=%s | kind=%s | "
            "bytes=%s | output_tokens=%s | cost≈$%.4f",
            IMAGE_MODEL,
            IMAGE_LOCATION,
            kind,
            len(image["image_bytes"]),
            output_tokens,
            cost,
        )
        return {
            "image_bytes": image["image_bytes"],
            "mime_type": image["mime_type"],
            "prompt": prompt,
            "output_tokens": output_tokens,
            "estimated_cost_usd": cost,
        }


_service: Optional[ScenarioDialogueImageService] = None


def get_scenario_dialogue_image_service() -> ScenarioDialogueImageService:
    global _service
    if _service is None:
        _service = ScenarioDialogueImageService()
    return _service
