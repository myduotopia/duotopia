"""
班級批次編輯 AI 助手 API（#1139 第二階段）。

- POST /api/classrooms/batch-edit/ai-suggest   依指示提議批次編輯視窗裡那幾班的新名稱／年級

只有平台管理員（``Teacher.is_admin``）能用，其他人一律 403（D3）；只限管理員，不另做配額。
端點**不寫 DB**：回傳 ``{reply, changes:[{id, name?, grade?}]}`` 給前端填進表格，
人按「儲存」才走第一階段的批次端點寫入（D4）。輸入只有那幾班的 ``{id, name, grade}``
（1–200 班）、對話紀錄（最多 10 輪＝20 則）與本次指示（1–1000 字），AI 只能改名稱與年級（D5）。

AI 服務在呼叫時經 ``get_classroom_batch_edit_ai_service()`` 取得；測試 monkeypatch 的是
``services.classroom_batch_edit_ai.ClassroomBatchEditAIService.generate``。
模型輸出無法解析、逾時或供應端錯誤 → 502（前端顯示「AI 暫時無法回應，請重試」）。
"""

from __future__ import annotations

import logging
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from models import Teacher
from routers.schemas.classroom import BATCH_GRADE_MAX_ITEMS
from routers.teachers import get_current_teacher
from services.classroom_batch_edit_ai import (
    CLASSROOM_NAME_MAX_LENGTH,
    GRADE_MAX,
    GRADE_MIN,
    ClassroomInput,
    HistoryTurn,
    get_classroom_batch_edit_ai_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/classrooms/batch-edit", tags=["classrooms"])

MAX_INSTRUCTION_CHARS = 1000
MAX_HISTORY_MESSAGES = 20  # 10 輪（使用者＋助手各一則）
MAX_HISTORY_CONTENT_CHARS = 2000


class AiSuggestClassroom(BaseModel):
    id: int
    # 表格當下的名稱（使用者可能剛清空，所以允許空字串）
    name: str = Field(default="", max_length=CLASSROOM_NAME_MAX_LENGTH)
    grade: Optional[int] = Field(default=None, ge=GRADE_MIN, le=GRADE_MAX)


class AiSuggestHistoryTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=MAX_HISTORY_CONTENT_CHARS)


class AiSuggestRequest(BaseModel):
    classrooms: List[AiSuggestClassroom] = Field(
        min_length=1, max_length=BATCH_GRADE_MAX_ITEMS
    )
    history: List[AiSuggestHistoryTurn] = Field(
        default_factory=list, max_length=MAX_HISTORY_MESSAGES
    )
    instruction: str = Field(max_length=MAX_INSTRUCTION_CHARS)

    @field_validator("instruction")
    @classmethod
    def instruction_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("instruction must not be blank")
        return v

    @field_validator("classrooms")
    @classmethod
    def no_duplicate_ids(cls, v: List[AiSuggestClassroom]) -> List[AiSuggestClassroom]:
        ids = [c.id for c in v]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate classroom id")
        return v


class AiSuggestChange(BaseModel):
    id: int
    name: Optional[str] = None
    grade: Optional[int] = None


class AiSuggestResponse(BaseModel):
    reply: str
    changes: List[AiSuggestChange]


@router.post(
    "/ai-suggest", response_model=AiSuggestResponse, response_model_exclude_none=True
)
async def ai_suggest(
    payload: AiSuggestRequest,
    teacher: Teacher = Depends(get_current_teacher),
):
    """AI 提議批次編輯視窗裡那幾班的新名稱／年級（只限平台管理員，不寫 DB）。"""
    if not teacher.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    classrooms = [
        ClassroomInput(id=c.id, name=c.name, grade=c.grade) for c in payload.classrooms
    ]
    history = [HistoryTurn(role=h.role, content=h.content) for h in payload.history]
    try:
        suggestion = await get_classroom_batch_edit_ai_service().suggest(
            classrooms, history, payload.instruction
        )
    except Exception as e:  # 解析失敗 / TimeoutError / provider errors
        logger.exception("[classroom-batch-edit-ai] suggest failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI 暫時無法回應，請重試",
        )

    return {
        "reply": suggestion.reply,
        "changes": [c.as_dict() for c in suggestion.changes],
    }
