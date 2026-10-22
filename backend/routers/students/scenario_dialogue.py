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

計數的時機照既有學生端端點（`routers/speech_assessment.py`）的做法：**先 gate、成功
後才加**。這代表極短時間內的連點可能打出兩次 AI（上限仍守得住），換來的是「AI 失敗
不吃學生次數」—— 對學生而言後者重要得多。前端在等建議時本來就會停用輸入區。
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
    increment_analysis_count,
)
from services.scenario_student_feedback_ai import (
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

    # 先 gate 再打 AI：第 4 次不會花掉任何 token（403 已通過 > 429 次數用完）
    check_can_analyze(progress)

    # 評分依據一律由 utils.scenario_dialogue 組出 —— 題目、參考答案、必用字詞、
    # 生效時態語態、整份作答指引的形狀只能有一處（與老師端同源）。
    criteria = sd.grading_criteria(
        item.text or "",
        sd.read_item_block(item.item_metadata),
        content.scenario_settings,
    )

    service = get_scenario_student_feedback_service()
    try:
        result = await service.generate(
            recording_url=progress.recording_url,
            criteria=criteria,
            ui_language=payload.ui_language or "zh-TW",
        )
    except ScenarioStudentFeedbackInputError as exc:
        # 題目資料不完整（例如題目被清空）—— 不是學生的錯，也不算用掉一次
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception:
        # AI 爆掉（模型回了垃圾、Vertex 超時、音檔抓不到…）是我們的問題。
        # 不能讓它吃掉學生的 3 次機會，也不該把 traceback 丟到學生畫面上，
        # 所以這裡收成 503 讓前端顯示「請再試一次」。計數在下面，走不到。
        logger.exception("scenario student feedback failed | progress=%s", progress.id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI 暫時無法給建議，請再試一次",
        )

    # 走到這裡才算用掉一次。AI 失敗（上面 raise）不吃學生的 3 次機會。
    count = increment_analysis_count(progress, db)
    db.commit()

    # **白名單輸出**：service 回的東西還帶著 usage／成本，模型有時也會自己多塞分數或
    # 把參考答案抄回來。學生那一側只拿這三個欄位加配額資訊。
    return {
        "verdict": result["verdict"],
        "comment": result["comment"],
        "suggestion": result.get("suggestion"),
        "ai_analysis_count": count,
        "ai_analysis_remaining": max(0, MAX_AI_ANALYSIS_ATTEMPTS - count),
        "max_attempts": MAX_AI_ANALYSIS_ATTEMPTS,
    }
