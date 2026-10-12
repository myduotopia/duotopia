"""
題庫 API：AI 工具端點（#1065 / #1084；自 routers/question_bank.py 拆出，#1082）。

- POST   /api/question-bank/ai/answer                 AI 作答：正確選項 + 解析（不扣點）
- POST   /api/question-bank/ai/group-title            AI 題組標題：依文章／小題下短標題（不扣點）
- POST   /api/question-bank/ai/analyze                AI 考點分析：考點 code + 年段（不扣點）

本檔的 ``router`` 不帶 prefix／tags，由 ``routers/question_bank.py`` 在原本
AI 段落的位置 ``router.include_router(...)`` 掛上（prefix ``/api/question-bank`` 與 tags 由
外層 router 套用），網址、權限、回應與 OpenAPI 路徑都與拆檔前相同。``main.py`` 不需改。

AI 服務一律在呼叫時經 ``get_question_bank_ai_service()`` 取得；測試 monkeypatch 的是
``services.question_bank_ai.QuestionBankAIService`` 的方法，不依賴本模組路徑。
``ai_analyze`` 失敗時 rollback 已 flush 的 pending 考點（#1077）。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models import ExamPoint, Teacher
from routers.teachers import get_current_teacher
from services.question_bank_ai import (
    MAX_PASSAGE_CHARS,
    QuestionBankAIError,
    QuestionBankAIOutputError,
    get_question_bank_ai_service,
    normalize_inputs,
)
from routers.question_bank_schemas import AiGroupTitleIn, AiQuestionsIn
from routers.question_bank_common import _exam_point_out

router = APIRouter()


# ============ AI 工具（#1065）— 先不扣點、不記用量 ============


def _ai_inputs(payload: AiQuestionsIn):
    try:
        return normalize_inputs([q.model_dump() for q in payload.questions])
    except QuestionBankAIError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


def _ai_failed(what: str, exc: Exception) -> HTTPException:
    logging.getLogger(__name__).warning("[qb-ai] %s failed: %s", what, exc)
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY, detail="AI 產生失敗，請稍後再試"
    )


@router.post("/ai/answer")
async def ai_answer(
    payload: AiQuestionsIn,
    teacher: Teacher = Depends(get_current_teacher),
):
    """AI 作答：每題回正確選項 index（可複選）與繁中解析；判斷不了的列在 skipped。"""
    items = _ai_inputs(payload)
    try:
        results, skipped = await get_question_bank_ai_service().answer(items)
    except QuestionBankAIOutputError as e:
        raise _ai_failed("answer", e)
    except Exception as e:  # TimeoutError / provider errors
        raise _ai_failed("answer", e)
    return {
        "results": [
            {
                "key": r.key,
                "correct_indexes": r.correct_indexes,
                "explanation": r.explanation,
            }
            for r in results
        ],
        "skipped": skipped,
    }


@router.post("/ai/group-title")
async def ai_group_title(
    payload: AiGroupTitleIn,
    teacher: Teacher = Depends(get_current_teacher),
):
    """AI 題組標題：依主圖文純文字與小題題幹產一個英文短標題（#1084）。"""
    passage = (payload.passage or "").strip()[:MAX_PASSAGE_CHARS]
    try:
        title = await get_question_bank_ai_service().suggest_title(
            passage, payload.stems
        )
    except QuestionBankAIOutputError as e:
        raise _ai_failed("group-title", e)
    except Exception as e:  # TimeoutError / provider errors
        raise _ai_failed("group-title", e)
    return {"title": title}


@router.post("/ai/analyze")
async def ai_analyze(
    payload: AiQuestionsIn,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """AI 考點分析：只能從平台正式考點挑；提議的新考點存 pending、不回前端。"""
    items = _ai_inputs(payload)
    try:
        results, skipped = await get_question_bank_ai_service().analyze(db, items)
    except QuestionBankAIError as e:
        # _store_proposed 可能已 flush pending 考點；get_db 只 close 不 rollback
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except QuestionBankAIOutputError as e:
        db.rollback()
        raise _ai_failed("analyze", e)
    except Exception as e:
        db.rollback()
        raise _ai_failed("analyze", e)

    wanted = {i for r in results for i in r.exam_point_ids}
    points = (
        {
            ep.id: ep
            for ep in db.query(ExamPoint)
            .options(selectinload(ExamPoint.aliases))
            .filter(ExamPoint.id.in_(wanted))
            .all()
        }
        if wanted
        else {}
    )
    return {
        "results": [
            {
                "key": r.key,
                "exam_points": [
                    _exam_point_out(points[i]) for i in r.exam_point_ids if i in points
                ],
                "grade_min": r.grade_min,
                "grade_max": r.grade_max,
            }
            for r in results
        ],
        "skipped": skipped,
    }
