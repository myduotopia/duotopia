"""
Content Ops operations for teachers.
"""
from fastapi import APIRouter, Depends, HTTPException, status, File, Form, UploadFile
from sqlalchemy.orm import Session, selectinload, joinedload
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func, text
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
from .validators import ContentCreate, ContentUpdate, ContentCopy
from .utils import TEST_SUBSCRIPTION_WHITELIST, parse_birthdate
from models import ContentType

import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/lessons/{lesson_id}/contents")
async def get_lesson_contents(
    lesson_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """取得單元的內容列表"""
    from utils.permissions import check_lesson_access

    # check_lesson_access handles personal, org, and template lesson access
    _program, lesson = check_lesson_access(
        db, lesson_id, current_teacher, require_owner=False
    )

    contents = (
        db.query(Content)
        .filter(
            Content.lesson_id == lesson_id,
            Content.is_active.is_(True),
            Content.is_assignment_copy.is_(False),  # 只返回模板內容
        )
        .options(selectinload(Content.content_items))  # 🔥 Eager load items
        .order_by(Content.order_index)
        .all()
    )

    result = []
    for content in contents:
        # 🔥 Use preloaded content_items (no query)
        content_items = sorted(content.content_items, key=lambda x: x.order_index)

        items_data = [
            {
                "id": item.id,
                "text": item.text,
                "translation": item.translation,
                "audio_url": item.audio_url,
                # 例句相關欄位
                "example_sentence": item.example_sentence,
                "example_sentence_translation": item.example_sentence_translation,
                "example_sentence_definition": item.example_sentence_definition,
                # 例句重組欄位
                "word_count": item.word_count,
                "max_errors": item.max_errors,
                # 單字集相關欄位
                "image_url": item.image_url,
                "part_of_speech": item.part_of_speech,
                "distractors": item.distractors,
            }
            for item in content_items
        ]

        result.append(
            {
                "id": content.id,
                "type": content.type.value if content.type else "EXAMPLE_SENTENCES",
                "title": content.title,
                "items": items_data,
                "target_wpm": content.target_wpm,
                "target_accuracy": content.target_accuracy,
                "order_index": content.order_index,
                "level": content.level,
                "tags": content.tags,
                "is_public": content.is_public,
            }
        )

    return result


@router.post("/lessons/{lesson_id}/contents")
async def create_content(
    lesson_id: int,
    content_data: ContentCreate,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """建立新內容"""
    from utils.permissions import check_lesson_access

    # check_lesson_access handles personal, org, and template lesson access
    _program, lesson = check_lesson_access(
        db, lesson_id, current_teacher, require_owner=True
    )

    # 如果沒有提供 order_index，自動設為最後一個位置
    if content_data.order_index is None:
        max_order = (
            db.query(func.max(Content.order_index))
            .filter(Content.lesson_id == lesson_id, Content.is_active.is_(True))
            .scalar()
        )
        order_index = (max_order or 0) + 1
    else:
        order_index = content_data.order_index

    # 解析 content type
    content_type_str = (
        content_data.type.upper() if content_data.type else "EXAMPLE_SENTENCES"
    )
    # 處理 legacy values
    type_mapping = {
        "READING_ASSESSMENT": ContentType.EXAMPLE_SENTENCES,
        "SENTENCE_MAKING": ContentType.VOCABULARY_SET,
    }
    try:
        content_type = type_mapping.get(content_type_str) or ContentType(
            content_type_str
        )
    except ValueError:
        content_type = ContentType.EXAMPLE_SENTENCES

    # 決定 Content 的難度等級
    # 優先順序：前端指定 > 繼承 Program > 預設 A1
    content_level = content_data.level
    if not content_level:
        # 如果前端沒有指定，繼承 Program 的難度等級
        content_level = (
            lesson.program.level
            if hasattr(lesson, "program") and lesson.program
            else "A1"
        )

    # 建立 Content（不再使用 items 欄位）
    content = Content(
        lesson_id=lesson_id,
        type=content_type,
        title=content_data.title,
        target_wpm=content_data.target_wpm,
        target_accuracy=content_data.target_accuracy,
        order_index=order_index,
        level=content_level,
        tags=content_data.tags or [],
    )
    db.add(content)
    db.commit()
    db.refresh(content)

    # 建立 ContentItem 記錄
    items_created = []
    if content_data.items:
        for idx, item_data in enumerate(content_data.items):
            # 計算 word_count（如果有 example_sentence）
            example_sentence = item_data.get("example_sentence", "")
            word_count = len(example_sentence.split()) if example_sentence else None
            # 根據 word_count 計算 max_errors
            max_errors = None
            if word_count:
                if word_count <= 10:
                    max_errors = 3
                elif word_count <= 25:
                    max_errors = 5
                else:
                    max_errors = 7

            # 處理 metadata（用於儲存額外欄位）(#366 清理)
            metadata = {}
            if "definition" in item_data:
                metadata["chinese_translation"] = item_data["definition"]

            # 統一翻譯欄位（canonical）
            if "vocabulary_translation" in item_data:
                metadata["vocabulary_translation"] = item_data["vocabulary_translation"]
            if "vocabulary_translation_lang" in item_data:
                metadata["vocabulary_translation_lang"] = item_data[
                    "vocabulary_translation_lang"
                ]

            # 向後相容：ReadingAssessmentPanel 仍送舊欄位
            if "english_definition" in item_data:
                metadata["english_definition"] = item_data["english_definition"]
                if (
                    "vocabulary_translation" not in item_data
                    and item_data["english_definition"]
                ):
                    metadata["vocabulary_translation"] = item_data["english_definition"]
            if "selectedLanguage" in item_data:
                metadata["selected_language"] = item_data["selectedLanguage"]
                if "vocabulary_translation_lang" not in item_data:
                    metadata["vocabulary_translation_lang"] = item_data[
                        "selectedLanguage"
                    ]
            # 儲存完整的 parts_of_speech 陣列到 metadata
            if "parts_of_speech" in item_data:
                metadata["parts_of_speech"] = item_data["parts_of_speech"]

            # 儲存 TTS audio settings（accent/gender/speed）供例句 TTS 生成使用
            if "audio_settings" in item_data:
                metadata["audio_settings"] = item_data["audio_settings"]

            # 根據前端傳來的資料決定存儲到 translation 欄位的內容
            # 優先使用語言感知的 vocabulary_translation（前端目前選擇語言的翻譯，
            # 中/英/日/韓），舊欄位作為相容性 fallback。
            translation_value = (
                item_data.get("vocabulary_translation")
                or item_data.get("definition")
                or item_data.get("translation", "")
                or ""  # guard against explicit None value
            )

            # 處理 part_of_speech：前端可能傳送 parts_of_speech (plural, array)
            # 後端欄位是 part_of_speech (singular, string)，只存第一個
            # 完整陣列已存到 metadata["parts_of_speech"]
            part_of_speech = item_data.get("part_of_speech")
            if not part_of_speech and "parts_of_speech" in item_data:
                # 如果是陣列，取第一個元素存到 DB 欄位
                parts = item_data.get("parts_of_speech", [])
                if parts and isinstance(parts, list) and len(parts) > 0:
                    part_of_speech = parts[0]

            content_item = ContentItem(
                content_id=content.id,
                order_index=idx,
                text=item_data.get("text", ""),
                translation=translation_value,
                audio_url=item_data.get("audio_url"),
                # 例句相關欄位
                example_sentence=example_sentence or None,
                example_sentence_translation=item_data.get(
                    "example_sentence_translation"
                ),
                example_sentence_definition=item_data.get(
                    "example_sentence_definition"
                ),
                example_sentence_audio_url=item_data.get("example_sentence_audio_url"),
                word_count=word_count,
                max_errors=max_errors,
                # 單字集相關欄位
                image_url=item_data.get("image_url"),
                part_of_speech=part_of_speech,
                distractors=item_data.get("distractors"),
                item_metadata=metadata if metadata else None,
            )
            db.add(content_item)
            items_created.append(
                {
                    "text": content_item.text,
                    "translation": content_item.translation,
                    "image_url": content_item.image_url,
                    "part_of_speech": content_item.part_of_speech,
                }
            )

    # 干擾項不在 content 建立時生成，而是在建立作業時跨 content 生成
    # 見 crud.py create_assignment 中的 word_selection 區塊

    db.commit()

    return {
        "id": content.id,
        "type": content.type.value,
        "title": content.title,
        "items": items_created,  # 返回建立的 items
        "items_count": len(items_created),  # 前端顯示用
        "target_wpm": content.target_wpm,
        "target_accuracy": content.target_accuracy,
        "order_index": content.order_index,
        "level": content.level if hasattr(content, "level") else "A1",
        "tags": content.tags if hasattr(content, "tags") else [],
    }


@router.get("/contents/{content_id}")
async def get_content_detail(
    content_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """獲取內容詳情"""
    from utils.permissions import check_content_access

    # check_content_access handles personal, org, template, and assignment copy access
    _program, _lesson, content = check_content_access(
        db, content_id, current_teacher, require_owner=False
    )

    # Eager load content_items to avoid N+1
    db.refresh(content, ["content_items"])

    return {
        "id": content.id,
        "type": content.type.value if content.type else "reading_assessment",
        "title": content.title,
        "items": [
            {
                "id": item.id,
                "text": item.text,
                "translation": item.translation,  # 主要翻譯欄位（通常是中文）
                "definition": item.item_metadata.get("chinese_translation")
                or item.translation
                if item.item_metadata
                else item.translation,  # 中文翻譯
                "english_definition": item.item_metadata.get("english_definition", "")
                if item.item_metadata
                else "",  # 英文釋義
                "selectedLanguage": item.item_metadata.get(
                    "selected_language", "chinese"
                )
                if item.item_metadata
                else "chinese",  # 選擇的語言
                # 統一翻譯欄位：vocabulary_translation + vocabulary_translation_lang
                # 優先讀取新欄位，fallback 到舊欄位以相容既有資料 (#366)
                "vocabulary_translation": (
                    item.item_metadata.get("vocabulary_translation")
                    or (
                        item.item_metadata.get("english_definition")
                        if item.item_metadata.get("selected_language") == "english"
                        else (
                            item.item_metadata.get("chinese_translation")
                            or item.translation
                        )
                    )
                )
                if item.item_metadata
                else (item.translation or ""),
                "vocabulary_translation_lang": (
                    item.item_metadata.get("vocabulary_translation_lang")
                    or item.item_metadata.get("selected_language")
                    or "chinese"
                )
                if item.item_metadata
                else "chinese",
                "audio_url": item.audio_url,
                # 單字集相關欄位
                "example_sentence": item.example_sentence,
                "example_sentence_translation": item.example_sentence_translation,
                "example_sentence_audio_url": item.example_sentence_audio_url,
                "image_url": item.image_url,
                "part_of_speech": item.part_of_speech,
                # 前端使用 parts_of_speech (plural, array)
                # 優先從 metadata 讀取完整陣列，否則用 DB 欄位的單一值
                "parts_of_speech": item.item_metadata.get("parts_of_speech", [])
                if item.item_metadata and item.item_metadata.get("parts_of_speech")
                else ([item.part_of_speech] if item.part_of_speech else []),
                "distractors": item.distractors,
                # 時間戳記
                "created_at": item.created_at.isoformat() if item.created_at else None,
                "updated_at": item.updated_at.isoformat() if item.updated_at else None,
                "content_id": item.content_id,
                "order_index": item.order_index,
                "item_metadata": item.item_metadata or {},
            }
            for item in content.content_items
        ]
        if hasattr(content, "content_items")
        else [],
        "target_wpm": content.target_wpm,
        "target_accuracy": content.target_accuracy,
        "time_limit_seconds": content.time_limit_seconds,
        "order_index": content.order_index,
        "level": content.level if hasattr(content, "level") else "A1",
        "tags": content.tags if hasattr(content, "tags") else ["public"],
    }


@router.put("/contents/{content_id}")
async def update_content(
    content_id: int,
    update_data: ContentUpdate,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """更新內容"""
    from utils.permissions import check_content_access

    # check_content_access handles personal, org, template, and assignment copy access
    _program, _lesson, content = check_content_access(
        db, content_id, current_teacher, require_owner=True
    )

    # 引入音檔管理器
    from services.audio_manager import get_audio_manager

    audio_manager = get_audio_manager()

    if update_data.title is not None:
        content.title = update_data.title
    if update_data.items is not None:
        # 處理 ContentItem 更新
        # 先取得現有的 ContentItem

        existing_items = (
            db.query(ContentItem).filter(ContentItem.content_id == content.id).all()
        )

        # 建立新音檔 URL 的集合
        new_audio_urls = set()
        for item in update_data.items:
            if isinstance(item, dict) and "audio_url" in item and item["audio_url"]:
                new_audio_urls.add(item["audio_url"])

        # 刪除不再使用的舊音檔
        for existing_item in existing_items:
            if hasattr(existing_item, "audio_url") and existing_item.audio_url:
                if existing_item.audio_url not in new_audio_urls:
                    audio_manager.delete_old_audio(existing_item.audio_url)

        # 先刪除參照 content_items 的 practice_answers（老師修改內容後舊答題紀錄失效）
        # 顯式刪除：防止 ON DELETE CASCADE migration (20260415_1000) 尚未執行的環境
        existing_item_ids = [item.id for item in existing_items]
        if existing_item_ids:
            # Lazy import to avoid circular dependency (progress → program → content)
            from models.progress import PracticeAnswer

            db.query(PracticeAnswer).filter(
                PracticeAnswer.content_item_id.in_(existing_item_ids)
            ).delete(synchronize_session=False)

        # 使用參數化查詢刪除所有現有的 ContentItem，確保唯一約束不衝突
        try:
            db.execute(
                text("DELETE FROM content_items WHERE content_id = :content_id"),
                {"content_id": content.id},
            )
            db.flush()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail="無法刪除內容項目，因為存在相關引用")

        # 創建新的 ContentItem
        for idx, item_data in enumerate(update_data.items):
            if isinstance(item_data, dict):
                # Store additional fields in item_metadata
                metadata = {}
                if "options" in item_data:
                    metadata["options"] = item_data["options"]
                if "correct_answer" in item_data:
                    metadata["correct_answer"] = item_data["correct_answer"]
                if "question_type" in item_data:
                    metadata["question_type"] = item_data["question_type"]

                # 處理翻譯支援 (#366 清理)
                # chinese_translation 永遠從 definition 取得
                if "definition" in item_data:
                    metadata["chinese_translation"] = item_data["definition"]

                # 統一翻譯欄位（canonical）
                if "vocabulary_translation" in item_data:
                    metadata["vocabulary_translation"] = item_data[
                        "vocabulary_translation"
                    ]
                if "vocabulary_translation_lang" in item_data:
                    metadata["vocabulary_translation_lang"] = item_data[
                        "vocabulary_translation_lang"
                    ]

                # 向後相容：ReadingAssessmentPanel 仍送 english_definition
                # + selectedLanguage，接受並映射到新欄位
                if "english_definition" in item_data:
                    metadata["english_definition"] = item_data["english_definition"]
                    # 若無 vocabulary_translation，映射到新欄位
                    if (
                        "vocabulary_translation" not in item_data
                        and item_data["english_definition"]
                    ):
                        metadata["vocabulary_translation"] = item_data[
                            "english_definition"
                        ]
                if "selectedLanguage" in item_data:
                    metadata["selected_language"] = item_data["selectedLanguage"]
                    if "vocabulary_translation_lang" not in item_data:
                        metadata["vocabulary_translation_lang"] = item_data[
                            "selectedLanguage"
                        ]
                # 舊的 translation + selectedLanguage=english 組合
                if (
                    "translation" in item_data
                    and item_data["translation"]
                    and item_data.get("selectedLanguage") == "english"
                ):
                    metadata["english_definition"] = item_data["translation"]
                    if "vocabulary_translation" not in item_data:
                        metadata["vocabulary_translation"] = item_data["translation"]
                # 儲存完整的 parts_of_speech 陣列到 metadata
                if "parts_of_speech" in item_data:
                    metadata["parts_of_speech"] = item_data["parts_of_speech"]

                # 儲存 TTS audio settings（accent/gender/speed）供例句 TTS 生成使用
                if "audio_settings" in item_data:
                    metadata["audio_settings"] = item_data["audio_settings"]

                # 根據前端傳來的資料決定存儲到 translation 欄位的內容
                # 優先使用語言感知的 vocabulary_translation（前端目前選擇語言的翻譯，
                # 中/英/日/韓），舊欄位作為相容性 fallback。
                translation_value = (
                    item_data.get("vocabulary_translation")
                    or item_data.get("definition")
                    or item_data.get("translation", "")
                    or ""  # guard against explicit None value
                )

                # 計算 word_count（如果有 example_sentence）
                example_sentence = item_data.get("example_sentence", "")
                word_count = len(example_sentence.split()) if example_sentence else None
                # 根據 word_count 計算 max_errors
                max_errors = None
                if word_count:
                    if word_count <= 10:
                        max_errors = 3
                    elif word_count <= 25:
                        max_errors = 5
                    else:
                        max_errors = 7

                # 處理 part_of_speech：前端可能傳送 parts_of_speech (plural, array)
                # 後端欄位是 part_of_speech (singular, string)，只存第一個
                # 完整陣列已存到 metadata["parts_of_speech"]
                part_of_speech = item_data.get("part_of_speech")
                if not part_of_speech and "parts_of_speech" in item_data:
                    # 如果是陣列，取第一個元素存到 DB 欄位
                    parts = item_data.get("parts_of_speech", [])
                    if parts and isinstance(parts, list) and len(parts) > 0:
                        part_of_speech = parts[0]

                content_item = ContentItem(
                    content_id=content.id,
                    order_index=idx,
                    text=item_data.get("text", ""),
                    translation=translation_value,
                    audio_url=item_data.get("audio_url"),
                    # 例句相關欄位
                    example_sentence=example_sentence or None,
                    example_sentence_translation=item_data.get(
                        "example_sentence_translation"
                    ),
                    example_sentence_definition=item_data.get(
                        "example_sentence_definition"
                    ),
                    example_sentence_audio_url=item_data.get(
                        "example_sentence_audio_url"
                    ),
                    word_count=word_count,
                    max_errors=max_errors,
                    # 單字集相關欄位
                    image_url=item_data.get("image_url"),
                    part_of_speech=part_of_speech,
                    distractors=item_data.get("distractors"),
                    item_metadata=metadata,
                )
                db.add(content_item)
    if update_data.target_wpm is not None:
        content.target_wpm = update_data.target_wpm
    if update_data.target_accuracy is not None:
        content.target_accuracy = update_data.target_accuracy
    if update_data.time_limit_seconds is not None:
        content.time_limit_seconds = update_data.time_limit_seconds
    if update_data.order_index is not None:
        content.order_index = update_data.order_index
    if update_data.level is not None:
        content.level = update_data.level
    if update_data.tags is not None:
        content.tags = update_data.tags

    # 干擾項不在 content 編輯時生成，而是在建立作業時跨 content 生成
    # 見 crud.py create_assignment 中的 word_selection 區塊

    db.commit()
    db.refresh(content)

    return {
        "id": content.id,
        "type": content.type.value,
        "title": content.title,
        "items": [
            {
                "id": item.id,
                "text": item.text,
                "translation": item.translation,  # 主要翻譯欄位（通常是中文）
                "definition": item.item_metadata.get("chinese_translation")
                or item.translation
                if item.item_metadata
                else item.translation,  # 中文翻譯
                "english_definition": item.item_metadata.get("english_definition", "")
                if item.item_metadata
                else "",  # 英文釋義
                "selectedLanguage": item.item_metadata.get(
                    "selected_language", "chinese"
                )
                if item.item_metadata
                else "chinese",  # 選擇的語言
                # 統一翻譯欄位：vocabulary_translation + vocabulary_translation_lang
                # 優先讀取新欄位，fallback 到舊欄位以相容既有資料 (#366)
                "vocabulary_translation": (
                    item.item_metadata.get("vocabulary_translation")
                    or (
                        item.item_metadata.get("english_definition")
                        if item.item_metadata.get("selected_language") == "english"
                        else (
                            item.item_metadata.get("chinese_translation")
                            or item.translation
                        )
                    )
                )
                if item.item_metadata
                else (item.translation or ""),
                "vocabulary_translation_lang": (
                    item.item_metadata.get("vocabulary_translation_lang")
                    or item.item_metadata.get("selected_language")
                    or "chinese"
                )
                if item.item_metadata
                else "chinese",
                "audio_url": item.audio_url,
                # 例句相關欄位
                "example_sentence": item.example_sentence,
                "example_sentence_translation": item.example_sentence_translation,
                "example_sentence_definition": item.example_sentence_definition,
                "word_count": item.word_count,
                "max_errors": item.max_errors,
                # 單字集相關欄位
                "image_url": item.image_url,
                "part_of_speech": item.part_of_speech,
                # 前端使用 parts_of_speech (plural, array)
                # 優先從 metadata 讀取完整陣列，否則用 DB 欄位的單一值
                "parts_of_speech": item.item_metadata.get("parts_of_speech", [])
                if item.item_metadata and item.item_metadata.get("parts_of_speech")
                else ([item.part_of_speech] if item.part_of_speech else []),
                "distractors": item.distractors,
                # 其他欄位
                "options": item.item_metadata.get("options", [])
                if item.item_metadata
                else [],
                "correct_answer": item.item_metadata.get("correct_answer")
                if item.item_metadata
                else None,
                "question_type": item.item_metadata.get("question_type", "text")
                if item.item_metadata
                else "text",
            }
            for item in content.content_items
        ]
        if hasattr(content, "content_items")
        else [],
        "target_wpm": content.target_wpm,
        "target_accuracy": content.target_accuracy,
        "order_index": content.order_index,
        "level": content.level if hasattr(content, "level") else "A1",
        "tags": content.tags if hasattr(content, "tags") else [],
    }


@router.delete("/contents/{content_id}")
async def delete_content(
    content_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """刪除內容（軟刪除）"""
    from utils.permissions import check_content_access

    # check_content_access handles personal, org, template, and assignment copy access
    _program, _lesson, content = check_content_access(
        db, content_id, current_teacher, require_owner=True, allow_assignment_copy=False
    )

    # 檢查是否有相關的作業

    assignment_count = (
        db.query(AssignmentContent)
        .filter(AssignmentContent.content_id == content_id)
        .count()
    )

    # 軟刪除
    content.is_active = False
    db.commit()

    return {
        "message": "Content deactivated successfully",
        "details": {
            "content_title": content.title,
            "deactivated": True,
            "related_data": {"assignments": assignment_count},
            "reason": "soft_delete",
            "note": "內容已停用但資料保留，相關作業仍可查看",
        },
    }


@router.post("/contents/{content_id}/copy")
async def copy_content(
    content_id: int,
    copy_data: ContentCopy,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """複製內容到指定的單元"""
    from utils.permissions import check_content_access, check_lesson_access
    from services.program_service import _copy_content_with_items

    # 驗證來源 content 存取權限
    _program, _lesson, content = check_content_access(
        db, content_id, current_teacher, require_owner=False
    )

    # 驗證目標 lesson 存取權限
    _target_program, target_lesson = check_lesson_access(
        db, copy_data.target_lesson_id, current_teacher, require_owner=True
    )

    # 計算目標 lesson 中的最大 order_index
    max_order = (
        db.query(func.max(Content.order_index))
        .filter(
            Content.lesson_id == copy_data.target_lesson_id,
            Content.is_active.is_(True),
        )
        .scalar()
    )

    # Eager load content_items
    db.refresh(content, ["content_items"])

    # 複製 content 及所有 items
    new_content = _copy_content_with_items(content, copy_data.target_lesson_id, db)

    # 設定複製後的標題和 order_index
    new_content.title = f"{content.title}(copy)"
    new_content.order_index = (max_order or 0) + 1
    # Teacher-initiated copy: track source but keep is_assignment_copy=False (default)
    new_content.source_content_id = content.id

    try:
        db.commit()
        db.refresh(new_content)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="複製內容衝突，請重試")

    return {
        "id": new_content.id,
        "type": new_content.type.value if new_content.type else "EXAMPLE_SENTENCES",
        "title": new_content.title,
        "items_count": len(new_content.content_items),
        "target_wpm": new_content.target_wpm,
        "target_accuracy": new_content.target_accuracy,
        "order_index": new_content.order_index,
        "level": getattr(new_content, "level", "A1"),
        "tags": getattr(new_content, "tags", []),
        "source_content_id": content.id,
        "target_lesson_id": copy_data.target_lesson_id,
    }


# ============ Image Upload Endpoints ============
@router.post("/upload/image")
async def upload_image(
    file: UploadFile = File(...),
    content_id: Optional[int] = Form(None),
    item_index: Optional[int] = Form(None),
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Upload image file for vocabulary set items

    Args:
        file: Image file (jpg, png, gif, webp)
        content_id: Content ID (for tracking which vocabulary set)
        item_index: Item index (for tracking which word)
    """
    try:
        from services.image_upload import get_image_upload_service

        image_service = get_image_upload_service()

        # If content_id is provided, verify teacher owns this content
        if content_id:
            content = (
                db.query(Content)
                .filter(
                    Content.id == content_id,
                    Content.lesson.has(
                        Lesson.program.has(Program.teacher_id == current_teacher.id)
                    ),
                )
                .first()
            )

            if not content:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Content not found or access denied",
                )

            # If updating existing item, delete old image
            if item_index is not None:
                content_items = (
                    db.query(ContentItem)
                    .filter(ContentItem.content_id == content_id)
                    .order_by(ContentItem.order_index)
                    .all()
                )

                if content_items and item_index < len(content_items):
                    old_image_url = content_items[item_index].image_url
                    if old_image_url:
                        image_service.delete_image(old_image_url)

        # Upload new image
        image_url = await image_service.upload_image(
            file, content_id=content_id, item_index=item_index
        )

        return {"image_url": image_url}
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error("Image upload error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Image upload failed")
