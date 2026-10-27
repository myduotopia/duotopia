"""
題庫 API：上傳題本匯入（Issue #1112 C2，後台擷取能力；畫面在 C3／C4）。

- POST   /api/question-bank/exam-imports                                 建立匯入（每天 1 本、擋重複題本）
- GET    /api/question-bank/exam-imports                                 未完成的匯入（30 天內）
- GET    /api/question-bank/exam-imports/{id}                            匯入（含所有頁與題目卡）
- POST   /api/question-bank/exam-imports/{id}/pages/{page_no}            送一頁頁圖擷取
- POST   /api/question-bank/exam-imports/{id}/pages/{page_no}/retry      重讀單一題（題號／bbox／card_id）
- DELETE /api/question-bank/exam-imports/{id}                            放棄匯入（刪草稿與頁圖）

本檔的 ``router`` 不帶 prefix／tags，由 ``routers/question_bank.py`` ``include_router`` 掛上
（同 question_bank_groups／question_bank_ai_routes 的拆檔慣例），``main.py`` 不需改。

用量只記不扣：不佔 magic paste 每月額度、不扣點數。存入題庫（全部儲存／略過核對）在 C4。
業務規則在 ``services/exam_import_service.py``。
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
from services import question_bank_service as qbs
from services.exam_paper_service import ExamPaperError, ExamPaperOutputError
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
    """
    imp = _load(db, teacher, import_id)
    data = await _read_page_file(file)
    try:
        page = await eis.process_page(db, imp, page_no, data, file.content_type)
    except eis.ExamImportError as e:
        raise _raise(e)
    except (ExamPaperError, MagicPasteError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except ExamPaperOutputError as e:
        raise _ai_failed("page", e)
    except Exception as e:  # AI 供應商錯誤
        raise _ai_failed("page", e)
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
    """只重讀那一頁的那一題（送頁圖＋題號／bbox，或 card_id），取代該卡；回傳新卡。"""
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
        card = await eis.retry_question(
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
