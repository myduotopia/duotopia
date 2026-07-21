"""
檔案服務 API 路由
用於提供學生錄音檔案和其他靜態資源
"""

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/files", tags=["files"])


@router.get("/recordings/{filename}")
async def get_recording(filename: str):
    """獲取錄音檔案 - 從 GCS 重定向"""
    # 錄音檔案應該已經儲存在 GCS，這個 endpoint 只是為了相容性
    # 實際的錄音 URL 應該直接指向 GCS
    raise HTTPException(
        status_code=404,
        detail=f"Recording file not found: {filename}. Files should be accessed directly from GCS.",
    )
