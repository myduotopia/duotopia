"""
題庫 API：上傳題本匯入（Issue #1112 C2，後台擷取能力；畫面在 C3／C4）。

- POST   /api/question-bank/exam-imports                                 建立匯入（每天 1 本、擋重複題本）
- GET    /api/question-bank/exam-imports                                 未完成的匯入（30 天內）
- GET    /api/question-bank/exam-imports/{id}                            匯入（含所有頁與題目卡）
- POST   /api/question-bank/exam-imports/{id}/pages/{page_no}            送一頁頁圖擷取
- POST   /api/question-bank/exam-imports/{id}/pages/{page_no}/retry      重讀單一題（card_id 或題號，bbox 只輔助）
- POST   /api/question-bank/exam-imports/{id}/pages/{page_no}/blank      標為空白頁（附頁圖；不呼叫 AI、不記用量）
- POST   /api/question-bank/exam-imports/{id}/pages/{page_no}/send-blank 空白頁「仍要送出這一頁」（用存好的頁圖、不算重送）
- DELETE /api/question-bank/exam-imports/{id}                            放棄匯入（刪草稿與頁圖）

本檔的 ``router`` 不帶 prefix／tags，由 ``routers/question_bank.py`` ``include_router`` 掛上
（同 question_bank_groups／question_bank_ai_routes 的拆檔慣例），``main.py`` 不需改。

用量只記不扣：不佔 magic paste 每月額度、不扣點數。存入題庫（全部儲存／略過核對）在 C4。
業務規則在 ``services/exam_import_service.py``（空白頁在 ``exam_import_blank.py``、重試在
``exam_import_retry.py``）。
"""

from __future__ import annotations

import json
import logging
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from database import get_db
from models import Teacher
from models.exam_import import EXAM_IMPORT_MAX_PAGES
from models.question_bank import GRADE_MAX, GRADE_MIN
from routers.question_bank_common import _parse_uuid, _require_bank_membership
from routers.question_bank_schemas import ProgramLinkIn
from routers.teachers import get_current_teacher
from services import exam_import_service as eis
from services.exam_import_blank import mark_blank_page, send_blank_page
from services.exam_import_retry import retry_question
from services import question_bank_service as qbs
from services.exam_paper_service import (
    ExamPaperError,
    ExamPaperOutputError,
    ExamPaperTimeoutError,
)
from services.magic_paste_service import MagicPasteError, MagicPasteService
from utils.ttsVoiceResolver import ACCENT_CHOICES

logger = logging.getLogger(__name__)

router = APIRouter()


# ============ Schemas ============


class ExamImportSettings(BaseModel):
    """整份設定（每份只填一次，C4 存入時套用到全部題目）。都可先不填，存入前由畫面要求必填。"""

    grade_min: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    grade_max: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    source_id: Optional[int] = None
    # TODO(C4)：教材／單元的擁有權（老師看得到、能掛題目）目前沒驗證，只存在草稿；存入題庫時
    # 沿用題目建立 API 的 program_links 驗證，驗不過的題目卡留在畫面上標出原因
    program_links: List[ProgramLinkIn] = Field(default_factory=list)
    visibility: Optional[
        Literal["private", "public", "organization_only", "individual_only"]
    ] = None
    organization_id: Optional[str] = None
    school_id: Optional[str] = None

    @model_validator(mode="after")
    def _check(self):
        if (
            self.grade_min is not None
            and self.grade_max is not None
            and self.grade_min > self.grade_max
        ):
            raise ValueError("grade_min 不可大於 grade_max")
        if self.organization_id and self.school_id:
            raise ValueError("organization_id 與 school_id 只能擇一")
        return self


class ExamImportCreate(BaseModel):
    file_name: str = Field(..., min_length=1, max_length=255)
    # 檔案內容 SHA-256（前端計算；PDF 在前端拆頁，後端拿不到整份檔）
    file_hash: str = Field(..., pattern=r"^[0-9a-fA-F]{64}$")
    page_count: int = Field(..., ge=1, le=EXAM_IMPORT_MAX_PAGES)
    # 朗讀口音：多選、至少一種（值同平台 TTS 設定：American English…）
    tts_accents: List[str] = Field(..., min_length=1)
    settings: ExamImportSettings = Field(default_factory=ExamImportSettings)

    @field_validator("file_name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("檔名不可空白")
        return v

    @field_validator("tts_accents")
    @classmethod
    def _accents(cls, v: List[str]) -> List[str]:
        bad = [a for a in v if a not in ACCENT_CHOICES]
        if bad:
            raise ValueError(f"不支援的口音：{bad}（可選 {ACCENT_CHOICES}）")
        return list(dict.fromkeys(v))


# ============ Helpers ============


def _raise(e: eis.ExamImportError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail=e.detail)


def _load(db: Session, teacher: Teacher, import_id: int):
    try:
        return eis.get_import(db, teacher, import_id)
    except eis.ExamImportError as e:
        raise _raise(e)


async def _read_page_file(file: UploadFile) -> bytes:
    max_bytes = MagicPasteService.MAX_FILE_BYTES
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"頁面圖片過大（上限 {max_bytes // (1024 * 1024)}MB）",
        )
    return data


def _ai_timeout(next_step: str) -> HTTPException:
    """AI 超過 2 分鐘沒回應（已中斷、用量已記）。前端照 ``error`` 顯示失敗與下一步。"""
    return HTTPException(
        status_code=status.HTTP_504_GATEWAY_TIMEOUT,
        detail={
            "error": "EXAM_IMPORT_AI_TIMEOUT",
            "message": f"AI 處理超過 2 分鐘，{next_step}",
        },
    )


def _ai_failed(what: str, exc: Exception) -> HTTPException:
    logger.warning("[exam-import] %s failed: %s", what, exc, exc_info=True)
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY, detail="AI 擷取失敗，請稍後再試"
    )


# ============ Endpoints ============


@router.post("/exam-imports", status_code=status.HTTP_201_CREATED)
def create_exam_import(
    payload: ExamImportCreate,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """建立匯入草稿（每頁一列 pending）。重複題本 409、超過每天 1 本 429。"""
    s = payload.settings
    _require_bank_membership(
        db,
        teacher,
        _parse_uuid(s.organization_id, "organization_id"),
        _parse_uuid(s.school_id, "school_id"),
    )
    if s.source_id is not None:
        visible = (
            qbs.visible_sources_query(db, teacher).filter_by(id=s.source_id).first()
        )
        if visible is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="找不到這個考題來源"
            )
    try:
        imp = eis.create_import(
            db,
            teacher,
            file_name=payload.file_name,
            file_hash=payload.file_hash,
            page_count=payload.page_count,
            tts_accents=payload.tts_accents,
            settings=s.model_dump(),
        )
    except eis.ExamImportError as e:
        db.rollback()
        raise _raise(e)
    return eis.serialize_import(imp, include_pages=True)


@router.get("/exam-imports")
def list_exam_imports(
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """未完成的匯入（30 天內、沒放棄、還沒全部存入），新的在前。"""
    return {
        "items": [eis.serialize_import(i) for i in eis.list_unfinished(db, teacher)]
    }


@router.get("/exam-imports/{import_id}")
def get_exam_import(
    import_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    return eis.serialize_import(_load(db, teacher, import_id), include_pages=True)


@router.post("/exam-imports/{import_id}/pages/{page_no}")
async def extract_exam_import_page(
    import_id: int,
    page_no: int,
    file: UploadFile = File(...),
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """送一頁頁圖（PNG／JPEG／WebP）：存 GCS、AI 擷取、寫入頁狀態與題目卡。

    回傳這一頁與整份匯入摘要；答案頁會回填其他頁，所以前端收到答案頁後要重抓整份（GET）。
    409 ``EXAM_IMPORT_PAGE_BUSY``（處理中／已由另一次送出接手）、``EXAM_IMPORT_RETRY_LIMIT``
    （整頁重送已 2 次）、504 ``EXAM_IMPORT_AI_TIMEOUT``（AI 超過 2 分鐘，該頁已標失敗）。
    """
    imp = _load(db, teacher, import_id)
    data = await _read_page_file(file)
    try:
        page = await eis.process_page(db, imp, page_no, data, file.content_type)
    except eis.ExamImportError as e:
        raise _raise(e)
    except (ExamPaperError, MagicPasteError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except ExamPaperTimeoutError:
        raise _ai_timeout("這一頁已標為失敗，可以重送整頁")
    except ExamPaperOutputError as e:
        raise _ai_failed("page", e)
    except Exception as e:  # AI 供應商錯誤
        raise _ai_failed("page", e)
    return {"page": eis.serialize_page(page), "import": eis.serialize_import(imp)}


@router.post("/exam-imports/{import_id}/pages/{page_no}/blank")
async def mark_exam_import_blank_page(
    import_id: int,
    page_no: int,
    file: UploadFile = File(...),
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """瀏覽器判斷是空白的頁：存頁圖、標成已處理（0 張卡，``blank_skipped``），不呼叫 AI、不記用量。
    只接受還沒處理的頁（否則 409 ``EXAM_IMPORT_PAGE_BUSY``）；已標過的再標一次直接回傳。"""
    imp = _load(db, teacher, import_id)
    data = await _read_page_file(file)
    try:
        page = mark_blank_page(db, imp, page_no, data, file.content_type)
    except eis.ExamImportError as e:
        raise _raise(e)
    except (ExamPaperError, MagicPasteError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return {"page": eis.serialize_page(page), "import": eis.serialize_import(imp)}


@router.post("/exam-imports/{import_id}/pages/{page_no}/send-blank")
async def send_exam_import_blank_page(
    import_id: int,
    page_no: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """空白頁「仍要送出這一頁」：用存好的頁圖送 AI 擷取（不必重選檔案），**不算整頁重送次數**。
    不是略過的空白頁回 409 ``EXAM_IMPORT_NOT_BLANK``；其餘錯誤同送一頁。"""
    imp = _load(db, teacher, import_id)
    try:
        page = await send_blank_page(db, imp, page_no)
    except eis.ExamImportError as e:
        raise _raise(e)
    except (ExamPaperError, MagicPasteError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except ExamPaperTimeoutError:
        raise _ai_timeout("這一頁已標為失敗，可以重送整頁")
    except ExamPaperOutputError as e:
        raise _ai_failed("send-blank", e)
    except Exception as e:  # AI 供應商錯誤
        raise _ai_failed("send-blank", e)
    return {"page": eis.serialize_page(page), "import": eis.serialize_import(imp)}


@router.post("/exam-imports/{import_id}/pages/{page_no}/retry")
async def retry_exam_import_question(
    import_id: int,
    page_no: int,
    file: UploadFile = File(...),
    card_id: Optional[str] = Form(None),
    question_no: Optional[str] = Form(None),
    bbox: Optional[str] = Form(
        None, description="JSON：[ymin, xmin, ymax, xmax]（0–1000）"
    ),
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """只重讀那一頁的那一題，取代該卡；回傳新卡。

    必須指定既有的題目卡：``card_id`` 或題號（``bbox`` 只是輔助定位，不能單獨使用）。都沒給 →
    422 ``EXAM_IMPORT_RETRY_TARGET``；題號比不到任何卡 → 404 ``EXAM_IMPORT_CARD_NOT_FOUND``。
    擷取時漏掉、沒有卡的題請老師「手動補這一題」。每張卡最多重試 2 次，超過回 409
    ``EXAM_IMPORT_RETRY_LIMIT``。
    """
    card_id = (card_id or "").strip() or None
    question_no = (question_no or "").strip() or None
    if not card_id and not question_no:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": "EXAM_IMPORT_RETRY_TARGET",
                "message": "請指定要重試的題目卡或題號；漏掉的題請手動補這一題",
            },
        )
    imp = _load(db, teacher, import_id)
    box = None
    if bbox:
        try:
            box = MagicPasteService._normalize_box_2d(json.loads(bbox))
        except (ValueError, TypeError):
            box = None
        if box is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="bbox 格式錯誤"
            )
    data = await _read_page_file(file)
    try:
        card = await retry_question(
            db,
            imp,
            page_no,
            data,
            file.content_type,
            card_id=card_id,
            question_no=question_no,
            bbox=box,
        )
    except eis.ExamImportError as e:
        raise _raise(e)
    except (ExamPaperError, MagicPasteError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except ExamPaperTimeoutError:
        raise _ai_timeout("可以再重試或手動補這一題")
    except ExamPaperOutputError as e:
        raise _ai_failed("retry", e)
    except Exception as e:
        raise _ai_failed("retry", e)
    return {"card": card, "import": eis.serialize_import(imp)}


@router.delete("/exam-imports/{import_id}")
def abandon_exam_import(
    import_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """放棄這次匯入：刪草稿（各頁題目卡）與該匯入的頁圖；不算進每天 1 本。已存入（saved）回 409。"""
    imp = _load(db, teacher, import_id)
    try:
        eis.abandon_import(db, imp)
    except eis.ExamImportError as e:
        raise _raise(e)
    return {"id": imp.id, "status": imp.status}
