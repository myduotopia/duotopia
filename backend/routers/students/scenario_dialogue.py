"""情境對話：學生答完一題拿 AI 建議（Issue #1140 Stage 1）。

#1133 的對話式作答 UI 裡，AI 建議是流程的一環（送出 → 建議 → 再試一次／下一題），
`useScenarioChat` 的狀態機沒有建議就停住。這支端點就是那一步。

## 與老師端那支的分界

老師端 `POST /api/teachers/assignments/{id}/scenario-ai-grade/{item_progress_id}`
（#1035）產出逐字稿＋四面向分數給老師**參考**。這一支產出的是給學生看的鼓勵式評語與
建議說法，**不產生也不回傳任何分數**。兩支共用的只有「Gemini 直讀 GCS 音檔」的管線。

## 為什麼配額用既有的 ai_analysis_count

每題 3 次的語意、race-safe 的加總、以及「作業退回重做時歸零」都已經在
`services/analysis_quota.py`（#676 Phase 2），而且批改頁的 Azure 分析用的是同一欄。
另寫一套計數會讓同一題有兩個互不相識的上限。

## 先領額度再打 AI（PR #1141 review）

這支原本照既有學生端端點（`routers/speech_assessment.py`）的做法「先 gate、成功後才
加」，並在註解裡說「連點最多多打一通，上限仍守得住」。**那句話是錯的**：並行時每個
請求都在 count < 3 時通過 gate，各自打一通付費的 Gemini，一個腳本可以在任何
increment 落地之前連發幾十通 —— 存下來的數字仍停在 3，所以從資料完全看不出來。
（#1025 在老師端踩過同一個坑。）

改成 `reserve_analysis_slot()`：那一次 `UPDATE ... WHERE count < MAX` 是原子的，同時
進來 N 個請求最多只有 3 個領到號碼牌，**AI 呼叫數因此真的有上限**；領不到的直接 429，
一個 token 都不花。AI 失敗再用 `refund_analysis_slot()` 把那一次還回去，學生不會因為
我們的錯誤被扣機會。
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from models import Content, ContentItem, ContentType, StudentAssignment
from models.progress import StudentItemProgress
from services.analysis_quota import (
    MAX_AI_ANALYSIS_ATTEMPTS,
    check_can_analyze,
    refund_analysis_slot,
    reserve_analysis_slot,
)
from services.scenario_student_feedback_ai import (
    DEFAULT_KIND,
    HELP_KINDS,
    ScenarioStudentFeedbackInputError,
    get_scenario_student_feedback_service,
)
from utils import scenario_dialogue as sd

from .dependencies import ensure_assignment_classroom_visible, get_student_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/scenario-dialogue", tags=["students-scenario-dialogue"])


class FeedbackRequest(BaseModel):
    item_progress_id: int
    #: 學生介面語言；只影響評語用什麼語言寫（建議說法永遠是英文）。
    ui_language: Optional[str] = Field(default="zh-TW", max_length=32)


@router.post("/feedback")
async def scenario_dialogue_feedback(
    payload: FeedbackRequest,
    student_id: int = Depends(get_student_id),
    db: Session = Depends(get_db),
):
    """聽學生這一題的錄音，回一則建議。"""

    # 所有權與資料一次查齊。**一定要用 student_id 過濾** —— 少了這個條件，任何學生
    # 都能拿別人的 progress_id 去燒對方的配額，順便看到對方那題的內容。
    # 查不到一律 404（不是 403）：不要讓呼叫者從狀態碼分辨「這個 id 存在但不是你的」。
    row = (
        db.query(StudentItemProgress, ContentItem, Content, StudentAssignment)
        .join(
            ContentItem,
            StudentItemProgress.content_item_id == ContentItem.id,
        )
        .join(Content, ContentItem.content_id == Content.id)
        .join(
            StudentAssignment,
            StudentItemProgress.student_assignment_id == StudentAssignment.id,
        )
        .filter(
            StudentItemProgress.id == payload.item_progress_id,
            StudentAssignment.student_id == student_id,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    progress, item, content, student_assignment = row

    # 班級被停用／刪除就不給（#1097）
    ensure_assignment_classroom_visible(db, student_assignment.id, student_id)

    if content.type != ContentType.SCENARIO_DIALOGUE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This endpoint only serves scenario dialogue items",
        )

    if not progress.recording_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="這一題還沒有錄音",
        )

    # 403「老師已判定通過」優先於 429「次數用完」—— 前者是更清楚的理由
    check_can_analyze(progress)

    # **這幾行一定要留在 db.commit() 之前。**
    #
    # commit 會讓這個 session 的 ORM 物件 expire，之後讀 `item.text` /
    # `progress.recording_url` 都會觸發 refresh → 開一條新交易，而那條交易會一路開著
    # 等 Gemini 回來（可能數十秒）。每個進行中的請求因此佔住一條連線處於
    # *idle in transaction*，一個班同時作答就能把連線池吃光 —— 影響的是整個服務，
    # 不只這個功能（PR #1141 review R4）。
    #
    # 評分依據一律由 utils.scenario_dialogue 組出 —— 題目、參考答案、必用字詞、
    # 生效時態語態、整份作答指引的形狀只能有一處（與老師端同源）。
    criteria = sd.grading_criteria(
        item.text or "",
        sd.read_item_block(item.item_metadata),
        content.scenario_settings,
    )

    recording_url = progress.recording_url
    progress_id = progress.id

    # 原子地領一次額度。領不到＝這一題已經用到上限（並行時也只有 3 個領得到），
    # 直接 429，一個 token 都不花。見檔頭「先領額度再打 AI」。
    count = reserve_analysis_slot(progress, db)
    if count is None:
        # 領不到就什麼都不要留下 —— rollback 而不是 commit（review R3）
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "AI_ANALYSIS_QUOTA_EXCEEDED",
                "message": "AI analysis quota exhausted for this item.",
                "ai_analysis_count": MAX_AI_ANALYSIS_ATTEMPTS,
                "ai_analysis_remaining": 0,
                "max_attempts": MAX_AI_ANALYSIS_ATTEMPTS,
            },
        )
    db.commit()

    service = get_scenario_student_feedback_service()
    # 沒有成功拿到建議就要把剛領的額度還回去。用 try/finally 而不是在每個 except 裡
    # 退款，是因為 **asyncio.CancelledError 是 BaseException**：學生等 Gemini 的時候
    # 關掉頁面，handler 會被取消，`except Exception` 抓不到 —— 額度扣了卻沒退，
    # 學生白白少一次機會（PR #1141 review R2）。finally 連取消都蓋得到。
    used = False
    try:
        result = await service.generate(
            recording_url=recording_url,
            criteria=criteria,
            ui_language=payload.ui_language or "zh-TW",
        )
        used = True
    except ScenarioStudentFeedbackInputError as exc:
        # 題目資料不完整（例如題目被清空）—— 不是學生的錯
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception:
        # AI 爆掉（模型回了垃圾、Vertex 超時、音檔抓不到…）是我們的問題：
        # 收成 503 讓前端顯示「請再試一次」，不要把 traceback 丟到學生畫面上。
        logger.exception("scenario student feedback failed | progress=%s", progress_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI 暫時無法給建議，請再試一次",
        )
    finally:
        if not used:
            # rollback 先做：失敗路徑可能留下一個爛掉的交易，退款自己得活得下來
            # （#1025 的教訓）。
            #
            # 競態：AI 跑的期間若老師把作業退回重做（計數歸零），這一退可能多退新一輪
            # 的一次。機率極低、方向對學生有利，不另外處理。
            # 退款失敗不能蓋掉原本的 503/400，只留 log 供人工補償。
            try:
                db.rollback()
                refund_analysis_slot(progress, db)
                db.commit()
            except Exception:
                logger.exception("refund failed | progress=%s", progress_id)

    # 求助（問某個字怎麼說、說不會答，#1158）不算作答次數：把剛領的額度退回。
    # 前端 useScenarioChat 也同樣只把 kind=feedback 算進 maxAttempts，兩邊一致。
    # 額度仍先領再打 AI（並行上限照舊）；已用滿 3 次時求助一樣會 429。
    kind = result.get("kind") or DEFAULT_KIND
    if kind in HELP_KINDS:
        try:
            count = refund_analysis_slot(progress, db)
            db.commit()
        except Exception:
            # 退不回去只是學生少一次機會，不該讓已經拿到的幫助變成 503
            logger.exception("help refund failed | progress=%s", progress_id)

    # **白名單輸出**：service 回的東西還帶著 usage／成本，模型有時也會自己多塞分數或
    # 把參考答案抄回來。學生那一側只拿這幾個欄位加配額資訊。
    return {
        "kind": kind,
        "verdict": result["verdict"],
        "comment": result["comment"],
        "suggestion": result.get("suggestion"),
        "ai_analysis_count": count,
        "ai_analysis_remaining": max(0, MAX_AI_ANALYSIS_ATTEMPTS - count),
        "max_attempts": MAX_AI_ANALYSIS_ATTEMPTS,
    }
