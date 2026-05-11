"""
Assignment CRUD operations
"""

import logging
import random
import uuid
from typing import Optional, List
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import and_, func

from database import get_db
from models import (
    Teacher,
    Student,
    Classroom,
    ClassroomStudent,
    ClassroomSchool,
    School,
    Content,
    ContentItem,
    ContentType,
    Lesson,
    Program,
    Assignment,
    AssignmentContent,
    StudentAssignment,
    StudentContentProgress,
    StudentItemProgress,
    AssignmentStatus,
)
from utils.permissions import has_read_org_materials_permission
from .validators import (
    CreateAssignmentRequest,
    UpdateAssignmentRequest,
    StudentResponse,
    ContentResponse,
)
from .dependencies import get_current_teacher
from services.preview_service import _VOCABULARY_CONTENT_TYPES

logger = logging.getLogger(__name__)

router = APIRouter()

# Practice modes that require each vocab item to carry a non-empty example
# sentence + translation. With vocab content, these modes read from the
# example fields; missing data degrades silently to playing the single-word
# audio (reading), skipping the item (rearrangement), or returning an empty
# question set (word_cloze) — see services.preview_service.get_sentence_fields
# and routers.students.assignments.extract_cloze_for_item. We block creation
# at the API boundary rather than letting the broken UX surface to students
# (issue #673).
_PRACTICE_MODES_REQUIRING_EXAMPLES = {"reading", "rearrangement", "word_cloze"}


def _collect_contents_missing_examples(
    contents: List[Content], practice_mode: Optional[str]
) -> List[str]:
    """Return titles of vocab contents whose items lack example sentences.

    Empty list ⇒ payload is valid for the given practice mode.

    Caller must ensure ``content.content_items`` are eager-loaded; this helper
    does not query the database.
    """
    if practice_mode not in _PRACTICE_MODES_REQUIRING_EXAMPLES:
        return []

    missing_titles: List[str] = []
    for content in contents:
        if content.type not in _VOCABULARY_CONTENT_TYPES:
            continue
        for item in content.content_items:
            sentence = (item.example_sentence or "").strip()
            translation = (item.example_sentence_translation or "").strip()
            if not sentence or not translation:
                missing_titles.append(content.title)
                break
    return missing_titles


def _raise_if_missing_examples(
    contents: List[Content], practice_mode: Optional[str]
) -> None:
    """Raise 422 with structured detail when vocab contents miss example data."""
    missing = _collect_contents_missing_examples(contents, practice_mode)
    if missing:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "EXAMPLE_SENTENCE_REQUIRED",
                "practice_mode": practice_mode,
                "content_titles": missing,
            },
        )


@router.post("/create")
async def create_assignment(
    request: CreateAssignmentRequest,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    建立作業（新架構）
    - 建立 Assignment 主表記錄
    - 關聯多個 Content
    - 指派給指定學生或全班
    """
    # 暫時停用訂閱檢查（保留邏輯以便日後恢復）
    if False:  # pragma: no cover
        # 驗證教師訂閱狀態
        if not current_teacher.can_assign_homework:
            raise HTTPException(
                status_code=403,
                detail="Your subscription has expired. Please recharge to create assignments.",
            )

    # 驗證班級存在且當前教師有權限
    # 支援兩種授權路徑：
    # 1. 班級導師（teacher_id == current_teacher.id）
    # 2. 機構管理員（透過 organization_id 驗證角色）
    classroom = (
        db.query(Classroom)
        .filter(
            and_(
                Classroom.id == request.classroom_id,
                Classroom.is_active.is_(True),
            )
        )
        .first()
    )

    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    # 授權檢查
    is_classroom_teacher = classroom.teacher_id == current_teacher.id
    is_org_admin = False

    if not is_classroom_teacher and request.organization_id:
        # 機構管理員路徑：驗證班級屬於該機構的學校，且教師有機構權限
        org_id = uuid.UUID(request.organization_id)

        # 檢查班級是否屬於該機構的學校
        classroom_school = (
            db.query(ClassroomSchool)
            .filter(
                ClassroomSchool.classroom_id == request.classroom_id,
                ClassroomSchool.is_active.is_(True),
            )
            .first()
        )

        if classroom_school:
            school = (
                db.query(School)
                .filter(
                    School.id == classroom_school.school_id,
                    School.organization_id == org_id,
                )
                .first()
            )

            if school and has_read_org_materials_permission(
                current_teacher.id, org_id, db
            ):
                is_org_admin = True

    if not is_classroom_teacher and not is_org_admin:
        raise HTTPException(
            status_code=404, detail="Classroom not found or you don't have permission"
        )

    # 驗證所有 Content 存在並 eager load content_items
    contents = (
        db.query(Content)
        .options(selectinload(Content.content_items))
        .filter(Content.id.in_(request.content_ids))
        .all()
    )
    if len(contents) != len(request.content_ids):
        raise HTTPException(status_code=404, detail="Some contents not found")

    # Issue #673: block reading / rearrangement / word_cloze on vocab contents
    # whose items don't carry example_sentence + example_sentence_translation.
    _raise_if_missing_examples(contents, request.practice_mode)

    # Sanitize answer_mode - deprecated field with database constraint
    # Only 'listening' and 'writing' are allowed by database CHECK constraint
    # If value is invalid (e.g., 'speaking'), use default 'writing'
    sanitized_answer_mode = request.answer_mode
    if request.answer_mode not in ["listening", "writing", None]:
        sanitized_answer_mode = "writing"  # Default fallback

    # 建立 Assignment 主表記錄
    assignment = Assignment(
        title=request.title,
        description=request.description,
        classroom_id=request.classroom_id,
        teacher_id=current_teacher.id,
        due_date=request.due_date,
        start_date=request.start_date,
        is_active=True,
        # 作答模式設定
        practice_mode=request.practice_mode,
        answer_mode=sanitized_answer_mode,
        time_limit_per_question=request.time_limit_per_question,
        shuffle_questions=request.shuffle_questions or False,
        show_answer=request.show_answer or False,
        play_audio=request.play_audio or False,
        # 單字選擇模式設定
        target_proficiency=request.target_proficiency,
        show_word=request.show_word,
        show_image=request.show_image,
        show_translation=request.show_translation,
        show_option_images=bool(request.show_option_images),  # Issue #631
        score_category=request.score_category,
    )
    db.add(assignment)
    db.flush()  # 取得 assignment.id

    # 🔥 複製 Content 和 ContentItem 作為作業副本
    content_copy_map = {}  # 原始 content_id -> 副本 content_id
    content_items_copy_map = {}  # 原始 content_item_id -> 副本 content_item_id

    for original_content in contents:
        # 複製 Content
        content_copy = Content(
            lesson_id=original_content.lesson_id,
            type=original_content.type,
            title=original_content.title,
            order_index=original_content.order_index,
            is_active=True,
            target_wpm=original_content.target_wpm,
            target_accuracy=original_content.target_accuracy,
            time_limit_seconds=original_content.time_limit_seconds,
            level=original_content.level,
            tags=original_content.tags.copy() if original_content.tags else [],
            is_public=False,  # 副本不公開
            # 作業副本欄位
            is_assignment_copy=True,
            source_content_id=original_content.id,
        )
        db.add(content_copy)
        db.flush()
        content_copy_map[original_content.id] = content_copy.id

        # 複製所有 ContentItem
        original_items = sorted(
            original_content.content_items, key=lambda x: x.order_index
        )

        for original_item in original_items:
            item_copy = ContentItem(
                content_id=content_copy.id,
                order_index=original_item.order_index,
                text=original_item.text,
                translation=original_item.translation,
                audio_url=original_item.audio_url,
                item_metadata=original_item.item_metadata.copy()
                if original_item.item_metadata
                else {},
                # 例句欄位
                example_sentence=original_item.example_sentence,
                example_sentence_translation=original_item.example_sentence_translation,
                example_sentence_definition=original_item.example_sentence_definition,
                example_sentence_audio_url=original_item.example_sentence_audio_url,
                # Phase 2 欄位
                image_url=original_item.image_url,
                part_of_speech=original_item.part_of_speech,
                distractors=original_item.distractors.copy()
                if isinstance(original_item.distractors, list)
                and len(original_item.distractors) > 0
                else None,
                word_count=original_item.word_count,
                max_errors=original_item.max_errors,
            )
            db.add(item_copy)
            db.flush()
            content_items_copy_map[original_item.id] = item_copy.id

    # word_selection 模式：為缺少干擾項的 items 從作業內所有 content 的單字翻譯生成
    # Issue #631: 干擾項升級為 list[{text, image_url}]，方便 show_option_images 模式
    # 用 snapshot 的 image_url 渲染選項圖。reader 端會做雙形狀相容。
    if request.practice_mode == "word_selection":
        from utils.distractors import make_distractor

        # 收集作業內所有 content copies 的翻譯（跨 content）
        all_copy_content_ids = list(content_copy_map.values())
        all_items_in_assignment = (
            db.query(ContentItem)
            .filter(ContentItem.content_id.in_(all_copy_content_ids))
            .filter(ContentItem.translation.isnot(None))
            .filter(ContentItem.translation != "")
            .order_by(ContentItem.order_index)
            .all()
        )
        # 候選池：每個 item 同時帶 translation + image_url
        all_candidates = [
            (item.translation, item.image_url) for item in all_items_in_assignment
        ]

        generated_count = 0
        for item in all_items_in_assignment:
            if not isinstance(item.distractors, list) or len(item.distractors) == 0:
                target = item.translation.lower().strip()
                pool = [
                    (t, img)
                    for (t, img) in all_candidates
                    if t.lower().strip() != target
                ]
                random.shuffle(pool)
                item.distractors = [
                    make_distractor(text=t, image_url=img) for (t, img) in pool[:3]
                ]
                generated_count += 1
        if generated_count > 0:
            logger.info(
                f"Auto-generated cross-content distractors for "
                f"{generated_count} items in assignment {assignment.id}"
            )

    # 例句模式 + 單字集：為缺少例句音檔的 items 自動 TTS 生成
    if request.practice_mode in ("reading", "rearrangement"):
        from services.tts import TTSService
        from utils.ttsVoiceResolver import get_voice_and_rate

        tts_service = TTSService()
        all_copy_content_ids = list(content_copy_map.values())
        db.flush()  # ensure copied items are queryable
        vocab_items = (
            db.query(ContentItem)
            .join(Content)
            .filter(
                ContentItem.content_id.in_(all_copy_content_ids),
                Content.type.in_(_VOCABULARY_CONTENT_TYPES),
                ContentItem.example_sentence.isnot(None),
                ContentItem.example_sentence != "",
                ContentItem.example_sentence_audio_url.is_(None),
            )
            .all()
        )
        tts_generated = 0
        for item in vocab_items:
            try:
                # 從 item_metadata 讀取 audio_settings，用相同 voice 生成例句音檔
                audio_settings = (
                    item.item_metadata.get("audio_settings", {})
                    if item.item_metadata
                    else {}
                )
                voice, rate = get_voice_and_rate(
                    audio_settings.get("accent", "American English"),
                    audio_settings.get("gender", "Male"),
                    audio_settings.get("speed", "Normal x1"),
                )
                audio_url = await tts_service.generate_tts(
                    item.example_sentence, voice, rate
                )
                item.example_sentence_audio_url = audio_url
                tts_generated += 1
            except Exception as e:
                logger.warning(f"TTS generation failed for item {item.id}: {e}")
        if tts_generated > 0:
            logger.info(
                f"Auto-generated example sentence TTS for "
                f"{tts_generated} vocab items in assignment {assignment.id}"
            )

    # 建立 AssignmentContent 關聯（指向副本）
    for idx, original_content_id in enumerate(request.content_ids, 1):
        copy_content_id = content_copy_map[original_content_id]
        assignment_content = AssignmentContent(
            assignment_id=assignment.id, content_id=copy_content_id, order_index=idx
        )
        db.add(assignment_content)

    # 取得要指派的學生列表
    if request.student_ids and len(request.student_ids) > 0:
        # 指派給指定學生
        students = (
            db.query(Student)
            .join(ClassroomStudent)
            .filter(
                and_(
                    ClassroomStudent.classroom_id == request.classroom_id,
                    Student.id.in_(request.student_ids),
                    Student.is_active.is_(True),
                    ClassroomStudent.is_active.is_(True),
                )
            )
            .all()
        )
        if len(students) != len(request.student_ids):
            raise HTTPException(
                status_code=400, detail="Some students not found in this classroom"
            )
    else:
        # 指派給全班
        students = (
            db.query(Student)
            .join(ClassroomStudent)
            .filter(
                and_(
                    ClassroomStudent.classroom_id == request.classroom_id,
                    Student.is_active.is_(True),
                    ClassroomStudent.is_active.is_(True),
                )
            )
            .all()
        )

    if not students:
        raise HTTPException(
            status_code=400, detail="No active students in this classroom"
        )

    # Preload all ContentItems for all COPY content_ids (avoid N+1)
    copy_content_ids = list(content_copy_map.values())
    all_content_items = (
        db.query(ContentItem)
        .filter(ContentItem.content_id.in_(copy_content_ids))
        .order_by(ContentItem.content_id, ContentItem.order_index)
        .all()
    )
    # Build map: copy_content_id -> [copy_items]
    content_items_map = {}
    for item in all_content_items:
        if item.content_id not in content_items_map:
            content_items_map[item.content_id] = []
        content_items_map[item.content_id].append(item)

    # 為每個學生建立 StudentAssignment
    for student in students:
        student_assignment = StudentAssignment(
            assignment_id=assignment.id,
            student_id=student.id,
            classroom_id=request.classroom_id,
            # 暫時保留舊欄位以兼容
            title=request.title,
            instructions=request.description,
            due_date=request.due_date,
            status=AssignmentStatus.NOT_STARTED,
            is_active=True,
        )
        db.add(student_assignment)
        db.flush()

        # 為每個內容建立進度記錄（使用副本 ID）
        for idx, original_content_id in enumerate(request.content_ids, 1):
            copy_content_id = content_copy_map[original_content_id]
            progress = StudentContentProgress(
                student_assignment_id=student_assignment.id,
                content_id=copy_content_id,  # 指向副本
                status=AssignmentStatus.NOT_STARTED,
                order_index=idx,
                is_locked=False if idx == 1 else True,  # 只解鎖第一個
            )
            db.add(progress)
            db.flush()  # 取得 progress.id

            # Get copy content items from preloaded map (no query)
            content_items = content_items_map.get(copy_content_id, [])

            for item in content_items:
                item_progress = StudentItemProgress(
                    student_assignment_id=student_assignment.id,
                    content_item_id=item.id,  # 指向副本的 ContentItem
                    status="NOT_STARTED",
                )
                db.add(item_progress)

    db.commit()

    return {
        "success": True,
        "assignment_id": assignment.id,
        "student_count": len(students),
        "content_count": len(request.content_ids),
        "message": f"Successfully created assignment for {len(students)} students",
    }


@router.get("/")
async def get_assignments(
    classroom_id: Optional[int] = Query(None, description="Filter by classroom"),
    status: Optional[str] = Query(None, description="Filter by status"),
    is_archived: Optional[bool] = Query(False, description="Filter by archive status"),
    is_instant_practice: Optional[bool] = Query(
        None,
        description="Filter by instant practice (None=all, True=only, False=exclude)",
    ),
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    取得作業列表（新架構）
    - 教師看到自己建立的作業
    - 可依班級、狀態、即刻練習篩選
    - 預設只顯示未封存作業，is_archived=true 顯示封存作業
    - is_instant_practice=None 顯示所有，True 只顯示即刻練習，False 排除即刻練習
    - 不帶 classroom_id 時回傳所有班級的作業（跨班級查詢）
    """
    # 建立查詢
    query = db.query(Assignment).filter(
        Assignment.teacher_id == current_teacher.id,
        Assignment.is_active.is_(True),
    )

    # 即刻練習篩選（預設 None = 顯示所有）
    if is_instant_practice is True:
        query = query.filter(Assignment.is_instant_practice.is_(True))
    elif is_instant_practice is False:
        query = query.filter(Assignment.is_instant_practice.is_(False))
    # is_instant_practice=None → 不篩選，回傳全部

    # 封存篩選
    if is_archived:
        query = query.filter(Assignment.is_archived.is_(True))
    else:
        query = query.filter(Assignment.is_archived.is_(False))

    # 套用篩選
    if classroom_id:
        query = query.filter(Assignment.classroom_id == classroom_id)

    assignments = query.order_by(Assignment.created_at.desc()).all()

    # Batch-load classroom names (avoid N+1)
    classroom_ids = list({a.classroom_id for a in assignments if a.classroom_id})
    classrooms = (
        db.query(Classroom.id, Classroom.name)
        .filter(Classroom.id.in_(classroom_ids))
        .all()
        if classroom_ids
        else []
    )
    classroom_name_map = {c.id: c.name for c in classrooms}

    # Batch-load assignment content counts (avoid N+1)
    assignment_ids = [a.id for a in assignments]
    content_counts = (
        db.query(
            AssignmentContent.assignment_id,
            func.count(AssignmentContent.id).label("count"),
        )
        .filter(AssignmentContent.assignment_id.in_(assignment_ids))
        .group_by(AssignmentContent.assignment_id)
        .all()
    )
    content_count_map = {row.assignment_id: row.count for row in content_counts}

    # Batch-load first content type for each assignment (avoid N+1)
    first_contents = (
        db.query(AssignmentContent.assignment_id, Content.type)
        .join(Content, AssignmentContent.content_id == Content.id)
        .filter(
            AssignmentContent.assignment_id.in_(assignment_ids),
            AssignmentContent.order_index == 1,
        )
        .all()
    )
    content_type_map = {
        row.assignment_id: row.type.value if row.type else None
        for row in first_contents
    }

    # Batch-load all student assignments (avoid N+1)
    all_student_assignments = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.assignment_id.in_(assignment_ids),
            StudentAssignment.is_active.is_(True),
        )
        .all()
    )
    # Build map: assignment_id -> [student_assignments]
    student_assignments_map = {}
    for sa in all_student_assignments:
        if sa.assignment_id not in student_assignments_map:
            student_assignments_map[sa.assignment_id] = []
        student_assignments_map[sa.assignment_id].append(sa)

    # 組合回應
    result = []
    for assignment in assignments:
        # Get from preloaded maps (no queries)
        content_count = content_count_map.get(assignment.id, 0)
        student_assignments = student_assignments_map.get(assignment.id, [])

        status_counts = {
            "not_started": 0,
            "in_progress": 0,
            "submitted": 0,
            "graded": 0,
            "returned": 0,
            "resubmitted": 0,
        }

        for sa in student_assignments:
            status_key = sa.status.value.lower()
            if status_key in status_counts:
                status_counts[status_key] += 1

        # 計算完成率
        total_students = len(student_assignments)
        completed = status_counts["graded"]
        completion_rate = (
            int((completed / total_students * 100)) if total_students > 0 else 0
        )

        # Get content_type from preloaded map
        content_type = content_type_map.get(assignment.id)

        result.append(
            {
                "id": assignment.id,
                "title": assignment.title,
                "description": assignment.description,
                "classroom_id": assignment.classroom_id,
                "classroom_name": classroom_name_map.get(assignment.classroom_id),
                "is_instant_practice": assignment.is_instant_practice or False,
                "content_count": content_count,
                "student_count": total_students,
                "due_date": (
                    assignment.due_date.isoformat() if assignment.due_date else None
                ),
                "start_date": (
                    assignment.start_date.isoformat() if assignment.start_date else None
                ),
                "created_at": (
                    assignment.created_at.isoformat() if assignment.created_at else None
                ),
                "completion_rate": completion_rate,
                "status_distribution": status_counts,
                # 內容類型與作答模式
                "content_type": content_type,
                "practice_mode": assignment.practice_mode,
                "answer_mode": assignment.answer_mode,
                # 封存狀態
                "is_archived": assignment.is_archived or False,
                "archived_at": (
                    assignment.archived_at.isoformat()
                    if assignment.archived_at
                    else None
                ),
            }
        )

    return result


@router.put("/{assignment_id}")
async def update_assignment(
    assignment_id: int,
    request: CreateAssignmentRequest,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    編輯作業（新架構）
    """
    # 取得並驗證作業
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
            Assignment.is_active.is_(True),
        )
        .first()
    )

    if not assignment:
        raise HTTPException(
            status_code=404, detail="Assignment not found or you don't have permission"
        )

    # Issue #673: validate example-sentence requirements on the new content set
    # before mutating anything (so a failed validation leaves the existing
    # assignment intact).
    new_contents = (
        db.query(Content)
        .options(selectinload(Content.content_items))
        .filter(Content.id.in_(request.content_ids))
        .all()
    )
    if len(new_contents) != len(request.content_ids):
        raise HTTPException(status_code=404, detail="Some contents not found")
    # Use the request's practice_mode if provided, otherwise the existing one
    # on the assignment (PUT replaces the resource so practice_mode may be
    # unchanged from the request side).
    effective_mode = request.practice_mode or assignment.practice_mode
    _raise_if_missing_examples(new_contents, effective_mode)

    # 更新基本資訊
    assignment.title = request.title
    assignment.description = request.description
    assignment.due_date = request.due_date

    # 更新內容關聯（先刪除舊的，再建立新的）
    db.query(AssignmentContent).filter(
        AssignmentContent.assignment_id == assignment_id
    ).delete()

    for idx, content_id in enumerate(request.content_ids, 1):
        assignment_content = AssignmentContent(
            assignment_id=assignment_id, content_id=content_id, order_index=idx
        )
        db.add(assignment_content)

    # 更新所有相關的 StudentAssignment（暫時保留舊欄位）
    db.query(StudentAssignment).filter(
        StudentAssignment.assignment_id == assignment_id
    ).update(
        {
            "title": request.title,
            "instructions": request.description,
            "due_date": request.due_date,
        }
    )

    db.commit()

    return {
        "success": True,
        "assignment_id": assignment_id,
        "message": "Assignment updated successfully",
    }


@router.patch("/{assignment_id}")
async def patch_assignment(
    assignment_id: int,
    request: UpdateAssignmentRequest,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    部分更新作業（只更新提供的欄位）
    """
    # 取得並驗證作業
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
            Assignment.is_active.is_(True),
        )
        .first()
    )

    if not assignment:
        raise HTTPException(
            status_code=404, detail="Assignment not found or you don't have permission"
        )

    # Issue #673: no example-sentence validation needed here. PATCH cannot
    # change practice_mode or content_ids (UpdateAssignmentRequest does not
    # expose them); both were validated at create / PUT time. If those fields
    # are added to UpdateAssignmentRequest in the future, port the
    # _raise_if_missing_examples call from create_assignment / update_assignment.

    # 只更新提供的欄位（使用 model_fields_set 區分「未提供」和「明確傳 null」）
    provided = request.model_fields_set

    if "title" in provided:
        assignment.title = request.title

    if "description" in provided:
        assignment.description = request.description
    elif "instructions" in provided:
        assignment.description = request.instructions

    if "due_date" in provided:
        assignment.due_date = request.due_date

    if "start_date" in provided:
        assignment.start_date = request.start_date

    # 進階設定更新
    advanced_fields = [
        "time_limit_per_question",
        "shuffle_questions",
        "show_answer",
        "play_audio",
        "target_proficiency",
        "show_word",
        "show_image",
        "show_translation",
        "show_option_images",  # Issue #631
    ]
    for field in advanced_fields:
        if field in provided:
            setattr(assignment, field, getattr(request, field))

    # Issue #631: 互斥校驗 — 部分更新後若兩者皆 True 則拒絕
    if assignment.show_image and assignment.show_option_images:
        raise HTTPException(
            status_code=422,
            detail="show_image and show_option_images are mutually exclusive",
        )

    # 更新 StudentAssignment 記錄
    update_fields = {}
    if "title" in provided:
        update_fields["title"] = request.title
    if "description" in provided or "instructions" in provided:
        update_fields["instructions"] = request.description or request.instructions
    if "due_date" in provided:
        update_fields["due_date"] = request.due_date

    if update_fields:
        db.query(StudentAssignment).filter(
            StudentAssignment.assignment_id == assignment_id
        ).update(update_fields)

    # 如果要更新 student_ids
    if request.student_ids is not None:
        # 先找出要刪除的 StudentAssignment IDs
        assignments_to_delete = (
            db.query(StudentAssignment.id)
            .filter(
                StudentAssignment.assignment_id == assignment_id,
                StudentAssignment.status == AssignmentStatus.NOT_STARTED,
            )
            .all()
        )

        assignment_ids_to_delete = [a.id for a in assignments_to_delete]

        if assignment_ids_to_delete:
            # 先刪除相關的 StudentContentProgress 記錄
            db.query(StudentContentProgress).filter(
                StudentContentProgress.student_assignment_id.in_(
                    assignment_ids_to_delete
                )
            ).delete(synchronize_session=False)

            # 再刪除 StudentAssignment 記錄
            db.query(StudentAssignment).filter(
                StudentAssignment.id.in_(assignment_ids_to_delete)
            ).delete(synchronize_session=False)

        # Preload existing student assignments (avoid N+1)
        existing_student_assignments = (
            db.query(StudentAssignment)
            .filter(StudentAssignment.assignment_id == assignment_id)
            .all()
        )
        existing_student_ids = {sa.student_id for sa in existing_student_assignments}

        # Preload assignment contents (avoid N+1)
        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .order_by(AssignmentContent.order_index)
            .all()
        )

        # Preload all content items (avoid N+1)
        content_ids = [ac.content_id for ac in assignment_contents]
        all_content_items = (
            db.query(ContentItem)
            .filter(ContentItem.content_id.in_(content_ids))
            .order_by(ContentItem.content_id, ContentItem.order_index)
            .all()
        )
        content_items_map = {}
        for item in all_content_items:
            if item.content_id not in content_items_map:
                content_items_map[item.content_id] = []
            content_items_map[item.content_id].append(item)

        # 為新的學生列表創建 StudentAssignment
        for student_id in request.student_ids:
            # Check from preloaded set (no query)
            if student_id in existing_student_ids:
                continue  # Already exists

            student_assignment = StudentAssignment(
                assignment_id=assignment_id,
                student_id=student_id,
                classroom_id=assignment.classroom_id,
                title=assignment.title,
                instructions=assignment.description,
                due_date=assignment.due_date,
                status=AssignmentStatus.NOT_STARTED,
                assigned_at=datetime.now(timezone.utc),
                is_active=True,
            )
            db.add(student_assignment)
            db.flush()  # 取得 student_assignment.id

            # Use preloaded assignment_contents (no query)
            for ac in assignment_contents:
                progress = StudentContentProgress(
                    student_assignment_id=student_assignment.id,
                    content_id=ac.content_id,
                    status=AssignmentStatus.NOT_STARTED,
                    order_index=ac.order_index,
                    is_locked=False if ac.order_index == 1 else True,  # 只解鎖第一個
                )
                db.add(progress)
                db.flush()  # 取得 progress.id

                # Use preloaded content_items (no query)
                content_items = content_items_map.get(ac.content_id, [])

                for item in content_items:
                    item_progress = StudentItemProgress(
                        student_assignment_id=student_assignment.id,
                        content_item_id=item.id,
                        status="NOT_STARTED",
                    )
                    db.add(item_progress)

    db.commit()

    return {
        "success": True,
        "assignment_id": assignment_id,
        "message": "Assignment updated successfully",
    }


@router.delete("/{assignment_id}")
async def delete_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    軟刪除作業（新架構）
    """
    # 取得並驗證作業
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
            Assignment.is_active.is_(True),
        )
        .first()
    )

    if not assignment:
        raise HTTPException(
            status_code=404, detail="Assignment not found or you don't have permission"
        )

    # 軟刪除 Assignment
    assignment.is_active = False

    # 軟刪除所有相關的 StudentAssignment
    db.query(StudentAssignment).filter(
        StudentAssignment.assignment_id == assignment_id
    ).update({"is_active": False})

    db.commit()

    return {"success": True, "message": "Assignment deleted successfully"}


@router.patch("/{assignment_id}/archive")
async def archive_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    封存作業
    - 將作業標記為已封存
    - 所有學生成績結算為當下成績（狀態不變）
    - 封存後不會顯示在作業管理列表中
    """
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
            Assignment.is_active.is_(True),
            Assignment.is_archived.is_(False),
        )
        .first()
    )

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found, already archived, or you don't have permission",
        )

    assignment.is_archived = True
    assignment.archived_at = datetime.now(timezone.utc)

    db.commit()

    return {
        "success": True,
        "assignment_id": assignment_id,
        "archived_at": assignment.archived_at.isoformat(),
        "message": "Assignment archived successfully",
    }


@router.patch("/{assignment_id}/unarchive")
async def unarchive_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    解除封存作業
    - 將作業從封存區恢復到作業管理列表
    """
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
            Assignment.is_active.is_(True),
            Assignment.is_archived.is_(True),
        )
        .first()
    )

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found, not archived, or you don't have permission",
        )

    assignment.is_archived = False
    assignment.archived_at = None

    db.commit()

    return {
        "success": True,
        "assignment_id": assignment_id,
        "message": "Assignment unarchived successfully",
    }


@router.get("/classrooms/{classroom_id}/students", response_model=List[StudentResponse])
async def get_classroom_students(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """取得班級的學生列表"""
    # 驗證班級存在且屬於當前教師
    classroom = (
        db.query(Classroom)
        .filter(
            and_(
                Classroom.id == classroom_id,
                Classroom.teacher_id == current_teacher.id,
                Classroom.is_active.is_(True),
            )
        )
        .first()
    )

    if not classroom:
        raise HTTPException(
            status_code=404, detail="Classroom not found or you don't have permission"
        )

    # 取得班級學生
    students = (
        db.query(Student)
        .join(ClassroomStudent)
        .filter(
            and_(
                ClassroomStudent.classroom_id == classroom_id,
                Student.is_active.is_(True),
                ClassroomStudent.is_active.is_(True),
            )
        )
        .all()
    )

    return students


@router.get("/contents", response_model=List[ContentResponse])
async def get_available_contents(
    classroom_id: Optional[int] = Query(None, description="Filter by classroom"),
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    取得可用的 Content 列表
    如果提供 classroom_id，只回傳該班級的 Content
    """
    query = db.query(Content).join(Lesson).join(Program)

    if classroom_id:
        # 驗證班級權限
        classroom = (
            db.query(Classroom)
            .filter(
                and_(
                    Classroom.id == classroom_id,
                    Classroom.teacher_id == current_teacher.id,
                    Classroom.is_active.is_(True),
                )
            )
            .first()
        )

        if not classroom:
            raise HTTPException(
                status_code=404,
                detail="Classroom not found or you don't have permission",
            )

        # 篩選該班級的 Content
        query = query.filter(Program.classroom_id == classroom_id)
    else:
        # 回傳該教師所有的 Content (透過 classroom)
        query = query.join(Classroom).filter(Classroom.teacher_id == current_teacher.id)

    contents = query.all()

    # 轉換為回應格式
    response = []
    for content in contents:
        items_count = (
            len(content.content_items) if hasattr(content, "content_items") else 0
        )
        response.append(
            ContentResponse(
                id=content.id,
                lesson_id=content.lesson_id,
                title=content.title,
                type=(
                    content.type.value
                    if hasattr(content.type, "value")
                    else str(content.type)
                ),
                level=content.level,
                items_count=items_count,
            )
        )

    return response
