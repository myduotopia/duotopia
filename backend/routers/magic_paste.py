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
from sqlalchemy.orm import Session

from database import get_db
from models import Teacher

# 共用同一份教師鑑權依賴，避免 auth 邏輯分叉（review PR #943 #2）
from routers.teachers import get_current_teacher
from services import magic_paste_quota as mpq
from services.magic_paste_service import (
    get_magic_paste_service,
    MagicPasteError,
    EXTRACT_MODES,
    EXTRACT_MODE_VOCABULARY,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/programs", tags=["magic-paste"])


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
    level: str = Form("A1"),
    extract_mode: str = Form(EXTRACT_MODE_VOCABULARY),
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """上傳單一圖片/PDF，AI 擷取教材內容並回傳供前端預覽（不寫入 DB）。

    擷取只抄圖上有的翻譯/例句；AI 翻譯/例句/語音改由前端「插入時」補洞。
    """
    if extract_mode not in EXTRACT_MODES:
        extract_mode = EXTRACT_MODE_VOCABULARY

    service = get_magic_paste_service()

    # 1) 大小把關優先：最多讀 上限+1 bytes，超過就中止，避免整包超大檔先讀進記憶體
    #    造成資源耗盡（review PR #943 #1）。
    max_bytes = service.MAX_FILE_BYTES
    file_bytes = await file.read(max_bytes + 1)
    if len(file_bytes) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"檔案過大（上限 {max_bytes // (1024 * 1024)}MB）",
        )

    # 2) 其餘檔案驗證（類型 / 非空；大小已於上一步把關）
    try:
        service.validate_file(file_bytes, file.content_type)
    except MagicPasteError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # 3) 配額預檢：明顯用完就不浪費 AI 呼叫
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

    # 4) AI 擷取
    try:
        result = await service.extract(
            file_bytes=file_bytes,
            mime_type=file.content_type,
            level=level,
            extract_mode=extract_mode,
        )
    except MagicPasteError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
        )
    except Exception as e:  # AI 供應商錯誤
        logger.error("[magic-paste] extraction failed: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI 擷取失敗，請稍後再試",
        )

    # 5) 有擷取到項目才扣配額（免費優先，超額扣點；點數不足丟 402）。
    #    擷取到 0 項（模糊圖 / 非教材圖）不扣額，避免老師白白損失一次額度
    #    （AI 成本雖已產生，但不轉嫁；產品決策見 review PR #943 round-3 #2）。
    charge = None
    if result["items"]:
        charge = mpq.consume(
            db,
            current_teacher,
            feature_detail={
                "provider": result["provider"],
                "model": result["model"],
                "extract_mode": extract_mode,
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
