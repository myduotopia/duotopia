"""
Translation Ops operations for teachers.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload, joinedload
from sqlalchemy import func
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta

from database import get_db
from models import Teacher, Classroom, Student, Program, Lesson, Content, ContentItem
from models import ClassroomStudent, Assignment, AssignmentContent
from models import (
    ProgramLevel,
    TeacherOrganization,
    TeacherSchool,
    Organization,
    School,
)
from .dependencies import get_current_teacher
from .validators import *
from .utils import TEST_SUBSCRIPTION_WHITELIST, parse_birthdate
from services.translation import translation_service

logger = logging.getLogger(__name__)

router = APIRouter()

# 已知語言代碼與名稱（用於驗證 target_lang）
VALID_LANGUAGE_CODES = {
    "zh-TW", "zh-CN", "en", "ja", "ko", "vi", "th", "id", "ms",
    "fr", "de", "es", "pt", "it", "ru", "ar", "hi", "bn", "tr",
    "pl", "nl", "sv", "da", "no", "fi", "cs", "el", "he", "uk",
    "ro", "hu", "tl", "my", "km", "lo",
}
VALID_LANGUAGE_NAMES = {
    "chinese", "english", "japanese", "korean", "vietnamese", "thai",
    "indonesian", "malay", "french", "german", "spanish", "portuguese",
    "italian", "russian", "arabic", "hindi", "bengali", "turkish",
    "polish", "dutch", "swedish", "danish", "norwegian", "finnish",
    "czech", "greek", "hebrew", "ukrainian", "romanian", "hungarian",
    "filipino", "tagalog", "burmese", "khmer", "lao",
    "繁體中文", "簡體中文", "英文", "日文", "韓文", "越南文", "泰文",
    "印尼文", "馬來文", "法文", "德文", "西班牙文", "葡萄牙文",
    "義大利文", "俄文", "阿拉伯文", "印地文", "孟加拉文", "土耳其文",
    "波蘭文", "荷蘭文", "瑞典文", "丹麥文", "挪威文", "芬蘭文",
    "捷克文", "希臘文", "希伯來文", "烏克蘭文", "羅馬尼亞文", "匈牙利文",
    "菲律賓文", "緬甸文", "高棉文", "寮文",
}


def is_valid_language(lang: str) -> bool:
    """檢查 target_lang 是否為可辨識的語言代碼或名稱"""
    return lang.lower().strip() in {v.lower() for v in VALID_LANGUAGE_CODES | VALID_LANGUAGE_NAMES}


@router.post("/translate")
async def translate_text(
    request: TranslateRequest, current_teacher: Teacher = Depends(get_current_teacher)
):
    """翻譯單一文本"""
    if not is_valid_language(request.target_lang):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"message": f"無法辨識的語言：{request.target_lang}"},
        )
    try:
        translation = await translation_service.translate_text(
            request.text, request.target_lang
        )
        return {"original": request.text, "translation": translation}
    except Exception as e:
        logger.error("Translation error: %s", e)
        raise HTTPException(status_code=500, detail="Translation service error")


@router.post("/translate-with-pos")
async def translate_with_pos(
    request: TranslateRequest, current_teacher: Teacher = Depends(get_current_teacher)
):
    """翻譯單字並辨識詞性"""
    if not is_valid_language(request.target_lang):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"message": f"無法辨識的語言：{request.target_lang}"},
        )
    try:
        result = await translation_service.translate_with_pos(
            request.text, request.target_lang
        )
        return {
            "original": request.text,
            "translation": result["translation"],
            "parts_of_speech": result["parts_of_speech"],
        }
    except Exception as e:
        logger.error("Translate with POS error: %s", e)
        raise HTTPException(status_code=500, detail="Translation service error")


@router.post("/translate-with-pos/batch")
async def batch_translate_with_pos(
    request: BatchTranslateRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """批次翻譯多個單字並辨識詞性"""
    if not is_valid_language(request.target_lang):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"message": f"無法辨識的語言：{request.target_lang}"},
        )
    try:
        results = await translation_service.batch_translate_with_pos(
            request.texts, request.target_lang
        )
        return {"originals": request.texts, "results": results}
    except Exception as e:
        logger.error("Batch translate with POS error: %s", e)
        raise HTTPException(status_code=500, detail="Translation service error")


@router.post("/translate/batch")
async def batch_translate(
    request: BatchTranslateRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """批次翻譯多個文本"""
    if not is_valid_language(request.target_lang):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"message": f"無法辨識的語言：{request.target_lang}"},
        )
    try:
        translations = await translation_service.batch_translate(
            request.texts, request.target_lang
        )
        return {"originals": request.texts, "translations": translations}
    except Exception as e:
        logger.error("Batch translation error: %s", e)
        raise HTTPException(status_code=500, detail="Translation service error")


@router.post("/generate-sentences")
async def generate_sentences(
    request: GenerateSentencesRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """AI 生成例句"""
    try:
        # 如果有 lesson_id，查詢 Lesson 與 Program 取得完整教學情境
        unit_context = None
        lesson_name = None
        program_name = None
        program_description = None
        program_tags = None
        if request.lesson_id:
            lesson = (
                db.query(Lesson)
                .options(joinedload(Lesson.program))
                .filter(Lesson.id == request.lesson_id)
                .first()
            )
            if lesson:
                lesson_name = lesson.name
                if lesson.description:
                    unit_context = lesson.description
                if lesson.program:
                    if lesson.program.name:
                        program_name = lesson.program.name
                    if lesson.program.description:
                        program_description = lesson.program.description
                    if lesson.program.tags:
                        program_tags = lesson.program.tags

        sentences = await translation_service.generate_sentences(
            words=request.words,
            definitions=request.definitions,
            unit_context=unit_context,
            lesson_name=lesson_name,
            program_name=program_name,
            program_description=program_description,
            program_tags=program_tags,
            level=request.level,
            prompt=request.prompt,
            translate_to=request.translate_to,
            parts_of_speech=request.parts_of_speech,
        )
        return {"sentences": sentences}
    except Exception as e:
        logger.error("Generate sentences error: %s", e)
        raise HTTPException(status_code=500, detail="Generate sentences failed")
