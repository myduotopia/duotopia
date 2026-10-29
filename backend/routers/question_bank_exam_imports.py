"""
題庫 API：上傳題本匯入（Issue #1112 C2，後台擷取能力；畫面在 C3／C4）。

- POST   /api/question-bank/exam-imports                                 建立匯入（每天 1 本、擋重複題本）
- GET    /api/question-bank/exam-imports                                 未完成的匯入（30 天內）
- GET    /api/question-bank/exam-imports/{id}                            匯入（含所有頁與題目卡）
- POST   /api/question-bank/exam-imports/{id}/pages/{page_no}            送一頁頁圖擷取
- POST   /api/question-bank/exam-imports/{id}/pages/{page_no}/retry      重讀單一題（card_id 或題號，bbox 只輔助）
- POST   /api/question-bank/exam-imports/{id}/pages/{page_no}/blank      標為空白頁（附頁圖；不呼叫 AI、不記用量）
- POST   /api/question-bank/exam-imports/{id}/pages/{page_no}/send-blank 空白頁「仍要送出這一頁」（用存好的頁圖、不算重送）
- DELETE /api/question-bank/exam-imports/{id}                            放棄匯入（刪草稿與頁圖；已存入的題目保留）
- 核對畫面端點（PATCH 設定、題目卡增刪改、存入、略過核對）在 ``question_bank_exam_import_review.py``

本檔的 ``router`` 不帶 prefix／tags，由 ``routers/question_bank.py`` ``include_router`` 掛上
（同 question_bank_groups／question_bank_ai_routes 的拆檔慣例），``main.py`` 不需改。

用量只記不扣：不佔 magic paste 每月額度、不扣點數。schemas 在 ``question_bank_exam_import_schemas.py``。
業務規則在 ``services/exam_import_service.py``（空白頁在 ``exam_import_blank.py``、重試在
``exam_import_retry.py``）。
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from database import get_db
from models import Teacher
from routers import question_bank_exam_import_review
from routers.question_bank_common import _parse_uuid, _require_bank_membership
from routers.question_bank_exam_import_schemas import (  # noqa: F401  (舊匯入相容)
    ExamImportCreate,
    ExamImportSettings,
)
from routers.teachers import get_current_teacher
from services import exam_import_service as eis
from services.exam_import_settings import validate_program_links
from services.exam_import_blank import mark_blank_page, send_blank_page
from services.exam_import_retry import retry_question
from services import question_bank_service as qbs
from services.exam_paper_service import (
    ExamPaperError,
    ExamPaperOutputError,
    ExamPaperTimeoutError,
)
from services.magic_paste_service import MagicPasteError, MagicPasteService

logger = logging.getLogger(__name__)

router = APIRouter()


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

# 核對畫面（編輯／刪除／手動補題目卡、整份設定、存入、略過核對；C4a）在另一檔
router.include_router(question_bank_exam_import_review.router)


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
        validate_program_links(
            db, teacher, [pl.model_dump() for pl in s.program_links], s.model_dump()
        )
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
    organization_id: Optional[str] = Query(None),
    school_id: Optional[str] = Query(None),
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """未完成的匯入（30 天內、沒放棄、還沒全部存入、自己建立的），新的在前。

    依題庫範圍（C4a）：不帶參數＝我的題庫；``organization_id``＝該機構題庫（``school_id`` 同理）。
    """
    _parse_uuid(organization_id, "organization_id")
    _parse_uuid(school_id, "school_id")
    rows = eis.list_unfinished(
        db, teacher, organization_id=organization_id, school_id=school_id
    )
    return {"items": [eis.serialize_import(i) for i in rows]}


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
        # 存頁圖（GCS）與略過核對的自動存入（補裁圖）都是同步 I/O：丟 threadpool，不擋事件迴圈
        page = await run_in_threadpool(
            mark_blank_page, db, imp, page_no, data, file.content_type
        )
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
    file: Optional[UploadFile] = File(None),
    card_id: Optional[str] = Form(None),
    question_no: Optional[str] = Form(None),
    bbox: Optional[str] = Form(
        None, description="JSON：[ymin, xmin, ymax, xmax]（0–1000）"
    ),
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """只重讀那一頁的那一題，取代該卡；回傳新卡。

    ``file``（頁圖）可省略：沒附就用擷取時存好的頁圖（前端不必再抓 GCS 頁圖）；找不到存好的頁圖
    → 409 ``EXAM_IMPORT_PAGE_IMAGE_MISSING``。仍接受附檔（舊前端相容）。

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
    data = await _read_page_file(file) if file is not None else None
    try:
        card = await retry_question(
            db,
            imp,
            page_no,
            data,
            file.content_type if file is not None else None,
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
