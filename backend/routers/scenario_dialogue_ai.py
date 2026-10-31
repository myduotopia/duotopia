"""情境對話 AI API — Issue #1021。

- POST /api/teachers/scenario-dialogue/generate-article   依訓練目標生成情境文章
- POST /api/teachers/scenario-dialogue/generate-questions 依情境文章與出題設定產題
- POST /api/teachers/scenario-dialogue/extract-article    從圖片/PDF 擷取情境文章
- POST /api/teachers/scenario-dialogue/compose            對話框打字：判斷意圖並加題／出題／修改題目／修改情境（#1158 C 段、修正 C6）

#1146：generate-article / generate-questions 多回 ``usable`` / ``reask`` /
``suggested_title``（答非所問不產內容、不扣額度）；generate-questions 接受無情境＋
``direction`` 與 ``scenario_images``；extract-article 多回 ``figures``（box_2d）。

三個端點都**不寫 DB**：產出來的東西先回前端給老師看、能改，按儲存才走
`/api/teachers/lessons/{id}/contents`（#1013）存起來。

配額（#1025）：三個端點都走每月硬上限（`services/scenario_text_quota`，50 次/月），
順序一律是「**先佔位 → 打 AI → 失敗就退款**」。回傳仍帶 token 用量與估算成本供觀測。

生圖（#1158）：依老師身分計費（admin 不限／機構點數／訂閱每月 60 張／點數制依 token／
未付費每天 3 張），見 `services/scenario_image_billing`；#1024 的每月 30 張規則已作廢。

- POST /api/teachers/scenario-dialogue/generate-image             生一張情境圖或題目圖
- GET  /api/teachers/scenario-dialogue/image-quota                目前的生圖計費方式與剩餘量
- POST /api/teachers/scenario-dialogue/suggest-image-description  AI 擬生圖描述（不計次數）
"""

import logging
from collections import Counter
from typing import (
    Annotated,
    Any,
    Awaitable,
    Callable,
    Dict,
    List,
    Literal,
    Optional,
    Union,
)

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, StringConstraints, model_validator

from database import get_db
from models import Teacher

# 共用同一份教師鑑權依賴，避免 auth 邏輯分叉（同 magic_paste）
from routers.teachers import get_current_teacher
from services import scenario_image_billing as sib
from services import scenario_text_quota as stq
from services.scenario_dialogue_image import (
    ScenarioDialogueImageService,
    ScenarioImageBlockedError,
    ScenarioImageError,
    ScenarioImageUpstreamError,
    get_scenario_dialogue_image_service,
)
from utils.scenario_dialogue import MAX_IMAGE_URL_CHARS, MAX_ITEMS, MAX_SCENARIO_IMAGES
from services.scenario_dialogue_ai import (
    MAX_TRANSLATE_LANGUAGE_CHARS,
    ScenarioDialogueAIError,
    ScenarioDialogueAIOutputError,
    get_scenario_dialogue_ai_service,
)
from services.scenario_dialogue_compose import get_scenario_dialogue_compose_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/teachers/scenario-dialogue", tags=["scenario-dialogue"])


# 各欄位的長度上限。這一版沒有配額（見 #1025），送進 prompt 的東西越大成本越高，
# 所以先用寬鬆但有界的上限擋住異常 payload —— 數字都遠大於面板正常能填出來的量，
# 老師不會撞到。
MAX_GOAL_CHARS = 1000
MAX_SCENARIO_CHARS = 8000
MAX_RUBRIC_CHARS = 2000
# 語言長度上限與服務層同一個來源 —— 兩邊各定義一次的話，改了一邊另一邊會靜靜地
# 不一致（服務層截斷、端點卻放行，或反過來）
MAX_LANGUAGE_CHARS = MAX_TRANSLATE_LANGUAGE_CHARS
MAX_LEVEL_CHARS = 10
MAX_EXISTING_QUESTIONS = 20
MAX_EXISTING_QUESTION_CHARS = 1000
# 與服務層同一個來源 —— 兩邊各寫一次 1000 的話，改了 Pydantic 上限卻忘了改截斷
# 上限（或反過來）不會有人發現（PR #1027 review）
MAX_IMAGE_PROMPT_CHARS = ScenarioDialogueImageService.MAX_DESCRIPTION_CHARS
# #1146 無情境出題時的「想問的方向」—— 與訓練目標同級的自由文字
MAX_DIRECTION_CHARS = MAX_GOAL_CHARS
# 介面語言代碼（zh-TW / en），決定重問句與標題建議用什麼語言
MAX_UI_LANGUAGE_CHARS = 10
# #1158 C 段 compose：老師在對話框一次打的內容（可能是好幾題）
MAX_COMPOSE_TEXT_CHARS = 8000
# 修正 C6：compose 收既有題目的完整欄位（與服務層收斂上限一致或更寬）
MAX_KEYWORD_CHARS = 60
MAX_KEYWORDS_PER_QUESTION = 10
MAX_REFERENCE_ANSWER_CHARS = 2000


class GenerateArticleRequest(BaseModel):
    """訓練目標是必填 —— 沒有它就是舊 stub 那種與老師無關的產出。"""

    goal: str = Field(max_length=MAX_GOAL_CHARS)
    # 文章難度，空字串 = 不指定（CEFR 代碼，服務層驗證）
    level: str = Field(default="", max_length=MAX_LEVEL_CHARS)
    # #1146 老師介面語言：答非所問時的重問句與標題建議用這個語言
    ui_language: str = Field(default="zh-TW", max_length=MAX_UI_LANGUAGE_CHARS)


# 空白描述要在進到額度之前就被擋掉 —— 佔一次名額再退雖然結果正確，但白跑兩趟 DB。
#
# 一定要搭配 strip_whitespace：只寫 min_length=1 擋得掉 "" 卻擋不掉 " "
# （長度是 1，照樣通過），空白描述還是會走完「佔額度 → 服務層失敗 → 退款」
# ——那正是這條想省掉的事（PR #1027 review round 4）。
_ImageDescription = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=MAX_IMAGE_PROMPT_CHARS,
    ),
]


class GenerateImageRequest(BaseModel):
    """生一張情境圖或題目圖（#1158 起）。

    ``description`` 是老師在生圖對話框裡確認過的描述。``image_prompt`` 是 #1024 的
    舊欄位名（前端改版前還在送），兩者擇一，都給時以 ``description`` 為準。
    """

    kind: Literal["scenario", "question"] = "question"
    description: Optional[_ImageDescription] = None
    image_prompt: Optional[_ImageDescription] = None

    @model_validator(mode="after")
    def _require_description(self) -> "GenerateImageRequest":
        if not (self.description or self.image_prompt):
            raise ValueError("description 不可為空")
        return self

    @property
    def text(self) -> str:
        return self.description or self.image_prompt or ""


class SuggestImageDescriptionRequest(BaseModel):
    """AI 擬生圖描述。情境圖帶情境文章；題目圖要擬時可以只帶題目。"""

    scenario_content: str = Field(default="", max_length=MAX_SCENARIO_CHARS)
    question: str = Field(default="", max_length=MAX_EXISTING_QUESTION_CHARS)


class GenerateQuestionsRequest(BaseModel):
    # #1146：情境不再必填 —— 「不需要情境，問日常生活」改用 direction 當出題依據。
    # 兩者（加上情境圖）至少要有一個，由服務層把關。
    scenario_content: str = Field(default="", max_length=MAX_SCENARIO_CHARS)
    direction: str = Field(default="", max_length=MAX_DIRECTION_CHARS)
    # 情境圖網址（最多 5 張）。服務層只讀本站 bucket / 本機 static 的圖（防 SSRF）
    scenario_images: List[
        Annotated[str, StringConstraints(max_length=MAX_IMAGE_URL_CHARS)]
    ] = Field(default_factory=list, max_length=MAX_SCENARIO_IMAGES)
    ui_language: str = Field(default="zh-TW", max_length=MAX_UI_LANGUAGE_CHARS)
    count: int
    question_level: str = Field(default="", max_length=MAX_LEVEL_CHARS)
    # 穩定代碼，例如 {"time": "past", "aspect": "simple"}；服務層會翻成英文描述
    global_tense: Optional[Dict[str, str]] = None
    global_voice: str = Field(default="", max_length=MAX_LEVEL_CHARS)
    global_rubric: str = Field(default="", max_length=MAX_RUBRIC_CHARS)
    # 「其他」語言存的是老師自己打的名字（#1016），不能用白名單；服務層會再壓成單行
    translate_language: str = Field(default="", max_length=MAX_LANGUAGE_CHARS)
    # 已經在清單上的題目，避免「再產一批」給出重複的。
    # 上限比 MAX_ITEMS（10）寬一點，避免老師剛好卡在邊界時整個請求被擋掉。
    existing_questions: List[
        Annotated[str, StringConstraints(max_length=MAX_EXISTING_QUESTION_CHARS)]
    ] = Field(default_factory=list, max_length=MAX_EXISTING_QUESTIONS)


class ComposeExistingQuestion(BaseModel):
    """compose 的既有題目（修正 C6）：帶完整欄位，AI 才改得了「把第 2 題改成…」。

    ``number`` 是右欄畫面上的題號（1 起算；清單中間有空白題時可能不連續），
    修改題目時 AI 回的 ``revisions[].index`` 就是這個數字。沒給時依序編號。
    """

    number: Optional[int] = Field(default=None, ge=1, le=MAX_EXISTING_QUESTIONS)
    question: str = Field(default="", max_length=MAX_EXISTING_QUESTION_CHARS)
    translation: str = Field(default="", max_length=MAX_EXISTING_QUESTION_CHARS)
    keywords: List[
        Annotated[str, StringConstraints(max_length=MAX_KEYWORD_CHARS)]
    ] = Field(default_factory=list, max_length=MAX_KEYWORDS_PER_QUESTION)
    reference_answer: str = Field(default="", max_length=MAX_REFERENCE_ANSWER_CHARS)
    image_prompt: str = Field(default="", max_length=MAX_IMAGE_PROMPT_CHARS)


class ComposeRequest(BaseModel):
    """對話框打字（#1158 C 段）：前端 ``questionRequestBase()`` 的欄位＋``text``。

    與 GenerateQuestionsRequest 的差別：沒有 ``count`` —— 題數由後端依
    ``existing_questions``（只算非空白題）算出剩餘名額，再由 AI 依老師的話決定。

    ``existing_questions`` 修正 C6 起可以是物件（``ComposeExistingQuestion``，帶題號與
    完整欄位，修改題目要用）；純字串（舊格式）照收，題號依序編。
    """

    # 空白輸入在進到額度之前就擋掉（同 _ImageDescription 的理由）
    text: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True, min_length=1, max_length=MAX_COMPOSE_TEXT_CHARS
        ),
    ]
    scenario_content: str = Field(default="", max_length=MAX_SCENARIO_CHARS)
    direction: str = Field(default="", max_length=MAX_DIRECTION_CHARS)
    scenario_images: List[
        Annotated[str, StringConstraints(max_length=MAX_IMAGE_URL_CHARS)]
    ] = Field(default_factory=list, max_length=MAX_SCENARIO_IMAGES)
    ui_language: str = Field(default="zh-TW", max_length=MAX_UI_LANGUAGE_CHARS)
    question_level: str = Field(default="", max_length=MAX_LEVEL_CHARS)
    global_tense: Optional[Dict[str, str]] = None
    global_voice: str = Field(default="", max_length=MAX_LEVEL_CHARS)
    global_rubric: str = Field(default="", max_length=MAX_RUBRIC_CHARS)
    translate_language: str = Field(default="", max_length=MAX_LANGUAGE_CHARS)
    existing_questions: List[
        Union[
            Annotated[str, StringConstraints(max_length=MAX_EXISTING_QUESTION_CHARS)],
            ComposeExistingQuestion,
        ]
    ] = Field(default_factory=list, max_length=MAX_EXISTING_QUESTIONS)


def _bad_request(exc: ScenarioDialogueAIError) -> HTTPException:
    """參數不合法 → 400。這些都是前端該擋而沒擋的情況，訊息直接給前端顯示。"""
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


def _ai_failed(what: str, exc: Exception) -> HTTPException:
    logger.error("[scenario-dialogue] %s failed: %s", what, exc, exc_info=True)
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="AI 產生失敗，請稍後再試",
    )


# #1146 review 9：答非所問（usable=False）會退額度，等於不限次數免費呼叫 AI。
# 先只記錄、不設上限 —— 用 log 觀察有沒有人反覆送無效輸入，再決定要不要擋。
# 計數存在記憶體：每個 Cloud Run instance 各自計、重啟歸零，只供觀察趨勢用。
_reask_refund_counts: Counter = Counter()


def _log_reask_refund(teacher: Teacher, endpoint: str) -> None:
    key = (getattr(teacher, "id", None), endpoint)
    _reask_refund_counts[key] += 1
    logger.warning(
        "scenario_text_quota | reask_refund | teacher_id=%s | endpoint=%s | count=%s",
        key[0],
        endpoint,
        _reask_refund_counts[key],
    )


async def _with_text_quota(
    db: Session,
    teacher: Teacher,
    endpoint: str,
    run: Callable[[], Awaitable[Dict[str, Any]]],
) -> Dict[str, Any]:
    """文字 AI 的配額包裝（#1025）：先佔位 → 執行 → 沒交出東西就退款。

    順序很重要，不是風格問題：先查 `get_quota_status` 再打 AI 是擋不住並發的 ——
    同一位老師在 49/50 時同時送兩個請求，兩個都會通過那次檢查（PR #1027 review）。
    先 consume 佔位，額度用完在**打 AI 之前**就回 402，一次呼叫都不浪費。

    退款走 ``finally`` 而不是在每個 except 分支各退一次：老師在 AI 跑到一半關掉分頁
    時，Starlette 丟的是 ``asyncio.CancelledError``，它是 BaseException 而不是
    Exception，``except Exception`` 接不到，那個名額就永遠回不來（PR #1027 review R2）。

    ``year_month`` 一定要傳 consume 回傳的那個值，不能讓 refund 自己重算：AI 慢起來
    可能跨過 UTC 午夜，扣在 A 月、退到 B 月的話 A 月永遠少一格（PR #1027 review R3）。

    三個端點共用這一份，而不是各自複製 —— 上面這幾個坑每一個都是踩過才長成這樣的。
    """
    charge = stq.consume(db, teacher)
    if charge["charged"] is None:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "SCENARIO_TEXT_QUOTA_EXCEEDED",
                "message": "本月情境對話 AI 次數已用完（下個月 1 日自動重置），可以改用手動輸入。",
                "quota": charge,
            },
        )

    delivered = False
    try:
        result = await run()
        # #1146 答非所問（usable=False）時沒有產出任何內容，只回一句重問 ——
        # 同樣算「沒把東西交到老師手上」，退款。
        delivered = result.get("usable") is not False
        if not delivered:
            _log_reask_refund(teacher, endpoint)
        return {**result, "quota": charge}
    finally:
        # 沒把東西交到老師手上就退款（參數錯、模型沒產出、中途取消都算）——
        # 扣他一次只會讓他不敢再試（比照 magic_paste 擷取到 0 項不扣額的決策）
        final = charge
        if not delivered:
            try:
                final = stq.refund(db, teacher, year_month=charge["year_month"])
            except Exception:
                # finally 裡再丟例外會**取代**原本要回給老師的那個錯誤（含 HTTP 狀態
                # 碼），老師會看到一個莫名的 500。退款失敗頂多是少退一次額度，
                # 不該把真正的原因吃掉（PR #1123 review 4）。
                logger.exception("scenario_text_quota | 退款失敗，額度少退一次 | %s", endpoint)
        # 印**退款後**的值。印 charge["used"] 的話，退掉的失敗會被記成已消耗，
        # 而這些 log 正是日後用來校準 FREE_MONTHLY_LIMIT 的依據（本機 review 指出）。
        logger.info(
            "scenario_text_quota | %s | delivered=%s | used=%s/%s",
            endpoint,
            delivered,
            final["used"],
            final["limit"],
        )


@router.get("/text-quota")
def text_quota(
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """本月情境對話文字 AI 的剩餘次數（Issue #1025）。

    **目前前端沒有呼叫它** —— 每次產題都是直接送出，額度用完由後端回 402，面板跳
    「本月次數已用完，填好的內容都還在，可以改用手動輸入」。這支是給「面板上顯示
    本月還剩 N 次」預留的查詢面，先做好並有測試涵蓋（同 `/image-quota` 的狀態）。

    之所以沒一起做顯示：那會動到面板的版面，而 #1044 正在改同一個檔案的字級與圖片
    欄位，兩張單互相衝突。等 #1044 合併後再補。
    """
    return stq.get_quota_status(db, current_teacher)


@router.post("/generate-article")
async def generate_article(
    payload: GenerateArticleRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    service = get_scenario_dialogue_ai_service()

    async def run():
        try:
            return await service.generate_article(
                goal=payload.goal,
                level=payload.level,
                ui_language=payload.ui_language,
            )
        except ScenarioDialogueAIOutputError as e:
            # 呼叫成功但模型沒給出可用的東西 —— 不是老師填錯，回 502「請稍後再試」。
            # 這個 except 必須排在父類 ScenarioDialogueAIError 前面（PR #1023 review）
            raise _ai_failed("generate-article", e)
        except ScenarioDialogueAIError as e:
            # 參數問題（空的訓練目標、不合法的難度）→ 400，訊息直接給老師看
            raise _bad_request(e)
        except Exception as e:
            raise _ai_failed("generate-article", e)

    return await _with_text_quota(db, current_teacher, "generate-article", run)


@router.post("/generate-questions")
async def generate_questions(
    payload: GenerateQuestionsRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """產一批題目。

    一次產 10 題與重新產 1 題都算**一次**額度 —— 不按題數加權是刻意的，見
    `services/scenario_text_quota` 的說明（鼓勵批次產題，要擋的是連按重產單題）。
    """
    service = get_scenario_dialogue_ai_service()

    async def run():
        try:
            return await service.generate_questions(
                scenario_content=payload.scenario_content,
                count=payload.count,
                question_level=payload.question_level,
                global_tense=payload.global_tense,
                global_voice=payload.global_voice,
                global_rubric=payload.global_rubric,
                translate_language=payload.translate_language,
                existing_questions=payload.existing_questions,
                direction=payload.direction,
                scenario_images=payload.scenario_images,
                ui_language=payload.ui_language,
            )
        except ScenarioDialogueAIOutputError as e:
            raise _ai_failed("generate-questions", e)
        except ScenarioDialogueAIError as e:
            raise _bad_request(e)
        except Exception as e:
            raise _ai_failed("generate-questions", e)

    return await _with_text_quota(db, current_teacher, "generate-questions", run)


@router.post("/compose")
async def compose(
    payload: ComposeRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """老師在對話框打字（#1158 C 段）：一次 AI 呼叫判斷意圖並產出。

    回傳 ``{usable, reask, intent, questions, skipped_count, truncated_count,
    requested_count, suggested_title, output_truncated}``：

    * ``intent="add_questions"``：老師自己打的題目拆成一題一格，translation 為空字串，
      不去重。**不截斷**到剩餘名額（安全上限 30 題），``truncated_count`` 告訴前端超出
      幾題，由前端提示後截斷。
    * ``intent="generate"``：依目前設定出 min(老師要的題數, 剩餘名額) 題
      （沒說題數時 min(5, 剩餘)；模型多給時以剩餘名額為上限）。``requested_count``
      是模型讀出的老師要求題數（沒說為 0），大於剩餘名額時前端說明只出得了幾題。
    * ``suggested_title``：標題建議（何時套用由前端依 #1146 規則決定）。
    * ``output_truncated``：輸出被截斷、只救回部分題目，前端提示老師分次輸入。
    * ``intent="revise_questions"``（修正 C6）：``revisions: [{index, question,
      translation, keywords, reference_answer, image_prompt}]``，``index`` 是題號（1 起算，
      ＝送來的 ``existing_questions[].number``），只含要改的題目。題數不變。
    * ``intent="revise_scenario"``（修正 C6）：``scenario_content`` 是改寫後的整篇情境文章。
    * ``suggested_title``：標題建議（何時套用由前端依 #1146 規則決定）。
    * ``output_truncated``：輸出被截斷、只救回部分題目，前端提示老師分次輸入。
    * ``usable=False``：整段都與題目無關，只回重問句，不計次。``refusal`` 有值時是
      「沒辦法照做」的原因代碼（``full``／``no_questions``／``no_scenario``／
      ``revise_out_of_range``），同樣不計次，前端依代碼顯示說明。

    計入文字 AI 次數池（一次呼叫算一次）。修正 C6 起清單已滿 10 題**也照樣呼叫**
    （老師可能是要修改既有題目或情境；前端事先分不出來）；判斷出是加題／出題時回
    ``refusal="full"``、不計次。
    """
    existing: List[Union[str, Dict[str, Any]]] = []
    for item in payload.existing_questions:
        if isinstance(item, str):
            if item.strip():
                existing.append(item.strip())
        elif item.question.strip():
            existing.append(item.model_dump())
    remaining = max(0, MAX_ITEMS - len(existing))

    service = get_scenario_dialogue_compose_service()

    async def run():
        try:
            return await service.compose(
                text=payload.text,
                remaining=remaining,
                scenario_content=payload.scenario_content,
                direction=payload.direction,
                scenario_images=payload.scenario_images,
                question_level=payload.question_level,
                global_tense=payload.global_tense,
                global_voice=payload.global_voice,
                global_rubric=payload.global_rubric,
                translate_language=payload.translate_language,
                existing_questions=existing,
                ui_language=payload.ui_language,
            )
        except ScenarioDialogueAIOutputError as e:
            raise _ai_failed("compose", e)
        except ScenarioDialogueAIError as e:
            raise _bad_request(e)
        except Exception as e:
            raise _ai_failed("compose", e)

    return await _with_text_quota(db, current_teacher, "compose", run)


@router.post("/extract-article")
async def extract_article(
    file: UploadFile = File(...),
    ui_language: str = Form("zh-TW", max_length=MAX_UI_LANGUAGE_CHARS),
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """從老師上傳的圖片 / PDF 擷取情境文章（#1146 起一併回 ``suggested_title``）。

    ``ui_language`` 決定標題建議的語言（同 generate-article）。
    """
    service = get_scenario_dialogue_ai_service()

    # 大小把關優先：最多讀「上限 + 1」bytes，超過就中止，避免超大檔整包先進記憶體
    # （magic_paste review PR #943 #1 的同一個理由）
    max_bytes = service.MAX_FILE_BYTES
    file_bytes = await file.read(max_bytes + 1)
    if len(file_bytes) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"檔案過大（上限 {max_bytes // (1024 * 1024)}MB）",
        )

    # 注意：上面的大小把關在**佔位之前** —— 檔案過大是老師根本還沒用到 AI 就被擋，
    # 不該扣他一次額度。
    async def run():
        try:
            return await service.extract_article(
                file_bytes=file_bytes,
                mime_type=file.content_type,
                ui_language=ui_language,
            )
        except ScenarioDialogueAIOutputError as e:
            raise _ai_failed("extract-article", e)
        except ScenarioDialogueAIError as e:
            raise _bad_request(e)
        except Exception as e:
            raise _ai_failed("extract-article", e)

    return await _with_text_quota(db, current_teacher, "extract-article", run)


@router.get("/image-quota")
def image_quota(
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """目前的生圖計費方式與剩餘量（#1158）。

    回傳 ``{billing, remaining, limit, period, points_per_image_estimate, can_generate}``，
    格式見 ``services/scenario_image_billing.get_status``。
    """
    return sib.get_status(db, current_teacher)


# #1158 決定：預填描述不計任何次數，只記 log 觀察用量（每個 Cloud Run instance 各自
# 計、重啟歸零，只供觀察趨勢 —— 同 _reask_refund_counts）。
_suggest_description_counts: Counter = Counter()


@router.post("/suggest-image-description")
async def suggest_image_description(
    payload: SuggestImageDescriptionRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """依情境文章（或題目）擬一段英文生圖描述，給老師在生圖對話框裡改（#1158）。

    **不計任何次數**（使用者定案）：不佔文字 AI 次數池、也不佔生圖額度，只寫 log。
    這是文字模型的小請求，成本遠低於生圖本身；擋它只會讓老師不敢按「AI 生圖」。
    """
    service = get_scenario_dialogue_ai_service()
    teacher_id = getattr(current_teacher, "id", None)
    _suggest_description_counts[teacher_id] += 1
    logger.info(
        "scenario_image_description | teacher_id=%s | count=%s",
        teacher_id,
        _suggest_description_counts[teacher_id],
    )
    try:
        return await service.suggest_image_description(
            scenario_content=payload.scenario_content,
            question=payload.question,
        )
    except ScenarioDialogueAIOutputError as e:
        raise _ai_failed("suggest-image-description", e)
    except ScenarioDialogueAIError as e:
        raise _bad_request(e)
    except Exception as e:
        raise _ai_failed("suggest-image-description", e)


@router.post("/generate-image")
async def generate_image(
    payload: GenerateImageRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """依老師確認過的描述生一張圖（情境圖或題目圖），存好之後回傳網址。

    順序是「**先佔位額度** → 生圖 → 存檔 → 成功才扣點／失敗就退名額」
    （PR #1027 review；#1158 改成依身分計費，見 ``services/scenario_image_billing``）。

    先查一次額度再打 AI、最後才扣，是擋不住並發的：同一位老師在上限邊界同時送兩個
    請求，兩個都會通過那次檢查。改成先 reserve 佔位，額度用完在**打 AI 之前**就回
    402，一次呼叫都不會浪費。

    點數制的實際 token 生完才知道，所以 reserve 只確認「餘額至少夠一張的預估點數」，
    生完再依實際 token 一次扣掉；生圖失敗根本不會扣點，不需要退點。

    老師沒拿到圖的情況一律退回張數名額（被安全過濾擋下、存檔失敗）—— 扣他一次只會
    讓他不敢再試，比照 magic_paste 擷取到 0 項不扣額的決策。

    每位老師同時只能有一張在生成中（``sib.acquire_generation_slot``），上一張還沒
    結束時回 409 ``SCENARIO_IMAGE_IN_PROGRESS``「上一張圖還在生成」。
    """
    # 稽核紀錄：誰、生哪種圖、用什麼描述（生圖資料出境到 global 的合規例外要求
    # 保留，見 docs/design/issue-1073-vertex-sdk-migration.md「生圖例外」）。
    # 放在取用生成名額（409）與預留額度（402）之前，被擋下或失敗的請求也有紀錄
    # （#1158 修正 B1）。
    logger.info(
        "scenario_image_generate | teacher_id=%s | kind=%s | description=%r",
        current_teacher.id,
        payload.kind,
        payload.text,
    )

    # 每位老師同時只能有一張在生成中，第二個請求回 409（#1158 A 段 review）。
    # 放在 reserve 之前，而且下面整段（含 reserve 的 402、settle）都包在 try/finally
    # 裡，不論成功、失敗、中途取消都會放掉。
    slot_token = sib.acquire_generation_slot(db, current_teacher)
    try:
        charge = sib.reserve(db, current_teacher)

        # 佔位之後一律用 try/finally 退回，不是在每個 except 分支各退一次
        # （PR #1027 review round 2）：老師在生圖跑到一半關掉分頁時，Starlette 丟的是
        # asyncio.CancelledError —— 它是 BaseException 而不是 Exception，`except Exception`
        # 接不到，那個名額就永遠回不來了。finally 則連 BaseException 都涵蓋得到。
        delivered = False
        service = get_scenario_dialogue_image_service()
        try:
            try:
                result = await service.generate(payload.text, kind=payload.kind)
            except ScenarioImageBlockedError as e:
                # 被安全過濾擋下：這是「換個描述」而不是「稍後再試」，訊息直接給老師看
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
                )
            except ScenarioImageUpstreamError as e:
                # Vertex 回 HTTP 錯誤（模型下架、權限、5xx）—— 我們這邊的問題，稍後再試
                raise _ai_failed("generate-image", e)
            except ScenarioImageError as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)
                )
            except Exception as e:
                raise _ai_failed("generate-image", e)

            try:
                from services.image_upload import get_image_upload_service

                image_url = get_image_upload_service().store_image_bytes(
                    result["image_bytes"], result.get("mime_type") or "image/png"
                )
            except Exception as e:
                # 圖生出來了卻存不進去 —— 老師一樣沒拿到圖
                raise _ai_failed("generate-image-store", e)

            delivered = True
        finally:
            # 沒把圖交到老師手上就退回名額（被擋、失敗、中途取消都算）。
            # release 用佔位時的期間鍵，不重算 —— 生圖跨過午夜／月底時扣在哪期就退哪期
            # （PR #1027 review round 3）
            if not delivered:
                try:
                    sib.release(db, current_teacher, charge)
                except Exception:
                    # finally 裡再丟例外會**取代**原本要回給老師的錯誤（PR #1123 review 4）
                    logger.exception("scenario_image_billing | 退回名額失敗")

        # 圖已經存好才扣點（依實際 token）。扣點失敗不影響回應，見 settle 的說明
        billed = sib.settle(
            db,
            current_teacher,
            charge,
            result.get("output_tokens", 0),
            feature_detail={"kind": payload.kind},
        )
        return {
            "image_url": image_url,
            "prompt": result["prompt"],
            "kind": payload.kind,
            "estimated_cost_usd": result["estimated_cost_usd"],
            "billing": billed,
            "quota": sib.get_status(db, current_teacher),
        }
    finally:
        try:
            sib.release_generation_slot(db, current_teacher, slot_token)
        except Exception:
            # 放不掉也不能取代原本的回應／錯誤；那列最多 IN_FLIGHT_STALE_SECONDS 後過期
            logger.exception("scenario_image_billing | 放掉生成中標記失敗")
