"""
Tts Ops operations for teachers.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException

from models import Teacher
from .dependencies import get_current_teacher
from .validators import TTSRequest, BatchTTSRequest

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/tts")
async def generate_tts(
    request: TTSRequest, current_teacher: Teacher = Depends(get_current_teacher)
):
    """生成單一 TTS 音檔"""
    try:
        from services.tts import get_tts_service

        tts_service = get_tts_service()

        # 直接使用 await，因為 FastAPI 已經在異步環境中
        audio_url = await tts_service.generate_tts(
            text=request.text,
            voice=request.voice,
            rate=request.rate,
            volume=request.volume,
        )

        return {"audio_url": audio_url}
    except Exception as e:
        logger.error(f"TTS error: {e}")
        raise HTTPException(status_code=500, detail="TTS generation failed")


@router.post("/tts/batch")
async def batch_generate_tts(
    request: BatchTTSRequest, current_teacher: Teacher = Depends(get_current_teacher)
):
    """批次生成 TTS 音檔"""
    try:
        from services.tts import get_tts_service

        tts_service = get_tts_service()

        # 直接使用 await，因為 FastAPI 已經在異步環境中
        audio_urls = await tts_service.batch_generate_tts(
            texts=request.texts,
            voice=request.voice,
            rate=request.rate,
            volume=request.volume,
        )

        return {"audio_urls": audio_urls}
    except Exception as e:
        logger.error(f"Batch TTS error: {e}")
        raise HTTPException(status_code=500, detail="Batch TTS generation failed")


@router.get("/tts/voices")
async def get_tts_voices(
    language: str = "en", current_teacher: Teacher = Depends(get_current_teacher)
):
    """取得可用的 TTS 語音列表"""
    try:
        from services.tts import get_tts_service

        tts_service = get_tts_service()

        # 直接使用 await，因為 FastAPI 已經在異步環境中
        voices = await tts_service.get_available_voices(language)

        return {"voices": voices}
    except Exception as e:
        logger.error(f"Get voices error: {e}")
        raise HTTPException(status_code=500, detail="Failed to get voices")
