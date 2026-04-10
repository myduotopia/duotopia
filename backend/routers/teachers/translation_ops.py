"""
Translation Ops operations for teachers.
"""
import logging
import time

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


@router.post("/translate")
async def translate_text(
    request: TranslateRequest, current_teacher: Teacher = Depends(get_current_teacher)
):
    """翻譯單一文本"""
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
    t0 = time.monotonic()
    word_count = len(request.texts)
    logger.info(
        "[PERF] API translate-with-pos/batch START | words=%d | lang=%s",
        word_count,
        request.target_lang,
    )
    try:
        results = await translation_service.batch_translate_with_pos(
            request.texts, request.target_lang
        )
        elapsed = time.monotonic() - t0
        logger.info(
            "[PERF] API translate-with-pos/batch DONE | words=%d | %.2fs | avg=%.2fs/word",
            word_count,
            elapsed,
            elapsed / word_count if word_count else 0,
        )
        return {"originals": request.texts, "results": results}
    except Exception as e:
        elapsed = time.monotonic() - t0
        logger.error(
            "[PERF] API translate-with-pos/batch ERROR | words=%d | %.2fs | %s",
            word_count,
            elapsed,
            e,
        )
        raise HTTPException(status_code=500, detail="Translation service error")


@router.post("/translate/batch")
async def batch_translate(
    request: BatchTranslateRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """批次翻譯多個文本"""
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
    t0 = time.monotonic()
    word_count = len(request.words)
    logger.info(
        "[PERF] API generate-sentences START | words=%d | level=%s",
        word_count,
        request.level,
    )
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
        elapsed = time.monotonic() - t0
        logger.info(
            "[PERF] API generate-sentences DONE | words=%d | %.2fs | avg=%.2fs/word",
            word_count,
            elapsed,
            elapsed / word_count if word_count else 0,
        )
        return {"sentences": sentences}
    except Exception as e:
        elapsed = time.monotonic() - t0
        logger.error(
            "[PERF] API generate-sentences ERROR | words=%d | %.2fs | %s",
            word_count,
            elapsed,
            e,
        )
        raise HTTPException(status_code=500, detail="Generate sentences failed")
