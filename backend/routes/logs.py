"""日誌記錄 API"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from services.bigquery_logger import get_bigquery_logger

router = APIRouter(prefix="/api/logs", tags=["logs"])


class AudioErrorLog(BaseModel):
    """音檔錯誤日誌資料模型"""

    # 錯誤資訊
    error_type: str
    error_code: Optional[int] = None
    error_message: Optional[str] = None

    # 音檔資訊
    audio_url: str
    audio_size: Optional[int] = None
    audio_duration: Optional[float] = None
    content_type: Optional[str] = None

    # 裝置資訊
    user_agent: str
    platform: Optional[str] = None
    browser: Optional[str] = None
    browser_version: Optional[str] = None
    device_model: Optional[str] = None
    is_mobile: Optional[bool] = None
    screen_resolution: Optional[str] = None
    connection_type: Optional[str] = None

    # 使用者資訊
    student_id: Optional[int] = None
    assignment_id: Optional[int] = None
    page_url: Optional[str] = None

    # 診斷資訊
    can_play_webm: Optional[str] = None
    can_play_mp4: Optional[str] = None
    load_time_ms: Optional[int] = None

    # BigQuery 表 schema 已新增對應 NULLABLE 欄位，insert_rows_json 可安全持久化
    chunk_count: Optional[int] = None
    recorder_state_at_stop: Optional[str] = None
    request_data_called: Optional[bool] = None
    recording_time_ms: Optional[int] = None


@router.post("/audio-error")
async def log_audio_error(error_log: AudioErrorLog):
    """
    記錄音檔播放錯誤

    此端點不需要認證，因為可能是學生裝置上發生錯誤
    """
    try:
        logger = get_bigquery_logger()
        success = await logger.log_audio_error(error_log.dict())

        if success:
            return {"status": "ok", "message": "Error logged"}
        else:
            # 即使記錄失敗也返回 200，不影響前端
            return {"status": "warning", "message": "Failed to log error"}

    except Exception as e:
        print(f"❌ Log error failed: {e}")
        # 靜默失敗，不影響前端
        return {"status": "error", "message": str(e)}
