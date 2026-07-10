"""
魔術貼上 API（issue #891）。

- POST /api/programs/magic-paste      上傳 1 張圖片/PDF，AI 擷取教材內容（不寫入 DB，前端預覽後再存）
- GET  /api/programs/magic-paste/quota 查詢本月剩餘免費張數與付費點數

計費：每月前 5 張免費，超額扣點數（見 services/magic_paste_quota）。
"""

import logging
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from database import get_db
from models import Teacher
from auth import verify_token
from services import magic_paste_quota as mpq
from services.magic_paste_service import (
    get_magic_paste_service,
    MagicPasteError,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/programs", tags=["magic-paste"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/teacher/login")

_VALID_MODES = {"image_first", "ai"}


async def get_current_teacher(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> Teacher:
    payload = verify_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    if payload.get("type") != "teacher":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not a teacher"
        )
    teacher = db.query(Teacher).filter(Teacher.id == payload.get("sub")).first()
    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found"
        )
    return teacher


@router.get("/magic-paste/quota")
def magic_paste_quota(
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """查詢本月魔術貼上配額狀態。"""
    return mpq.get_quota_status(db, current_teacher)


@router.post("/magic-paste")
async def magic_paste_extract(
    file: UploadFile = File(...),
    translate_mode: str = Form("image_first"),
    example_mode: str = Form("image_first"),
    level: str = Form("A1"),
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """上傳單一圖片/PDF，AI 擷取教材內容並回傳供前端預覽（不寫入 DB）。"""
    if translate_mode not in _VALID_MODES:
        translate_mode = "image_first"
    if example_mode not in _VALID_MODES:
        example_mode = "image_first"

    file_bytes = await file.read()
    service = get_magic_paste_service()

    # 1) 檔案驗證（類型 / 大小 / 非空）
    try:
        service.validate_file(file_bytes, file.content_type)
    except MagicPasteError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # 2) 配額預檢：明顯用完就不浪費 AI 呼叫
    quota_before = mpq.get_quota_status(db, current_teacher)
    if not quota_before["can_use"]:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "MAGIC_PASTE_QUOTA_EXCEEDED",
                "message": "本月免費魔術貼上次數已用完，且點數不足，請訂閱方案或購買點數。",
                "quota": quota_before,
            },
        )

    # 3) AI 擷取
    try:
        result = await service.extract(
            file_bytes=file_bytes,
            mime_type=file.content_type,
            translate_mode=translate_mode,
            example_mode=example_mode,
            level=level,
        )
    except MagicPasteError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
        )
    except Exception as e:  # AI 供應商錯誤
        logger.error("[magic-paste] extraction failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI 擷取失敗，請稍後再試",
        )

    # 4) 擷取成功後才扣配額（免費優先，超額扣點；點數不足丟 402）
    charge = mpq.consume(
        db,
        current_teacher,
        feature_detail={
            "provider": result["provider"],
            "model": result["model"],
            "item_count": len(result["items"]),
            "estimated_cost_usd": result["estimated_cost_usd"],
        },
    )
    quota_after = mpq.get_quota_status(db, current_teacher)

    return {
        "items": result["items"],
        "charge": charge,
        "quota": quota_after,
        "estimated_cost_usd": result["estimated_cost_usd"],
        "provider": result["provider"],
    }
