"""
Program Ops operations for teachers.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload, joinedload
from sqlalchemy import func
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta

from database import get_db
from models import Teacher, Classroom, Student, Program, Lesson, Content, ContentItem
from models import (
    ClassroomStudent,
    Assignment,
    AssignmentContent,
    StudentContentProgress,
)
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
from schemas import ProgramUpdate

router = APIRouter()


@router.get("/programs")
async def get_teacher_programs(
    is_template: Optional[bool] = None,
    classroom_id: Optional[int] = None,
    school_id: Optional[str] = None,
    organization_id: Optional[str] = None,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """取得教師的所有課程（支援過濾公版/班級課程/學校教材/組織教材）"""

    # 如果提供 school_id，返回該學校的共用教材（不限制 teacher_id）
    if school_id:
        query = (
            db.query(Program)
            .filter(
                Program.school_id == school_id,
                Program.is_template.is_(True),
                Program.is_active.is_(True),
            )
            .options(
                selectinload(Program.classroom),
                selectinload(Program.lessons)
                .selectinload(Lesson.contents)
                .selectinload(Content.content_items),
            )
        )
    # 如果提供 organization_id，返回該組織的共用教材（不限制 teacher_id）
    elif organization_id:
        query = (
            db.query(Program)
            .filter(
                Program.organization_id == organization_id,
                Program.is_template.is_(True),
                Program.is_active.is_(True),
            )
            .options(
                selectinload(Program.classroom),
                selectinload(Program.lessons)
                .selectinload(Lesson.contents)
                .selectinload(Content.content_items),
            )
        )
    # 否則返回教師的個人課程（原有邏輯）
    else:
        query = (
            db.query(Program)
            .filter(
                Program.teacher_id == current_teacher.id,
                Program.is_active.is_(True),
                # 🔥 FIX: 個人教材必須排除有 school_id 或 organization_id 的課程
                Program.school_id.is_(None),
                Program.organization_id.is_(None),
            )
            .options(
                selectinload(Program.classroom),
                selectinload(Program.lessons)
                .selectinload(Lesson.contents)
                .selectinload(Content.content_items),
            )
        )

    # 過濾公版/班級課程
    if is_template is not None:
        query = query.filter(Program.is_template == is_template)

    # 過濾特定班級
    if classroom_id is not None:
        query = query.filter(Program.classroom_id == classroom_id)

    programs = query.order_by(Program.order_index).all()

    # 🔥 Batch-load student counts for all classrooms (avoid N+1)
    classroom_ids = [p.classroom_id for p in programs if p.classroom_id]

    student_counts = (
        db.query(
            ClassroomStudent.classroom_id,
            func.count(ClassroomStudent.id).label("count"),
        )
        .filter(ClassroomStudent.classroom_id.in_(classroom_ids))
        .group_by(ClassroomStudent.classroom_id)
        .all()
    )
    student_count_map = {row.classroom_id: row.count for row in student_counts}

    result = []
    for program in programs:
        # 🔥 Get student count from preloaded map (no query)
        student_count = student_count_map.get(program.classroom_id, 0)

        # 處理 lessons 和 contents
        lessons_data = []
        for lesson in sorted(program.lessons, key=lambda x: x.order_index):
            if lesson.is_active:
                contents_data = []
                if lesson.contents:
                    for content in sorted(lesson.contents, key=lambda x: x.order_index):
                        if content.is_active and not content.is_assignment_copy:
                            # 將 content_items 轉換成舊格式 items
                            items_data = []
                            if content.content_items:
                                for item in sorted(
                                    content.content_items, key=lambda x: x.order_index
                                ):
                                    items_data.append(
                                        {
                                            "id": item.id,
                                            "text": item.text,
                                            "translation": item.translation,
                                            "audio_url": item.audio_url,
                                            "order_index": item.order_index,
                                            "image_url": item.image_url,
                                        }
                                    )

                            contents_data.append(
                                {
                                    "id": content.id,
                                    "title": content.title,
                                    "type": content.type,
                                    "items": items_data,
                                    "items_count": len(items_data),
                                    "order_index": content.order_index,
                                    "level": content.level,
                                    "tags": content.tags or [],
                                }
                            )

                lessons_data.append(
                    {
                        "id": lesson.id,
                        "name": lesson.name,
                        "description": lesson.description,
                        "estimated_minutes": lesson.estimated_minutes,
                        "order_index": lesson.order_index,
                        "contents": contents_data,
                    }
                )

        result.append(
            {
                "id": program.id,
                "name": program.name,
                "description": program.description,
                "level": program.level.value if program.level else None,
                "classroom_id": program.classroom_id,
                "classroom_name": program.classroom.name if program.classroom else None,
                "estimated_hours": program.estimated_hours,
                "is_active": program.is_active,
                "is_template": program.is_template,
                "created_at": (
                    program.created_at.isoformat() if program.created_at else None
                ),
                "lesson_count": len(lessons_data),
                "student_count": student_count,
                "status": ("active" if program.is_active else "archived"),
                "order_index": (
                    program.order_index if hasattr(program, "order_index") else 1
                ),
                "tags": program.tags or [],
                "visibility": program.visibility,
                "lessons": lessons_data,
            }
        )

    return result


@router.post("/programs")
async def create_program(
    program_data: ProgramCreate,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """創建新課程"""
    # For template programs, classroom_id is optional
    if not program_data.is_template:
        # Verify classroom belongs to teacher (only for non-template programs)
        if not program_data.classroom_id:
            raise HTTPException(
                status_code=400,
                detail="classroom_id is required for non-template programs",
            )

        classroom = (
            db.query(Classroom)
            .filter(
                Classroom.id == program_data.classroom_id,
                Classroom.teacher_id == current_teacher.id,
            )
            .first()
        )

        if not classroom:
            raise HTTPException(status_code=404, detail="Classroom not found")

    # Get the max order_index
    if program_data.is_template:
        # For template programs, get max order across all template programs
        max_order = (
            db.query(func.max(Program.order_index))
            .filter(
                Program.is_template.is_(True), Program.teacher_id == current_teacher.id
            )
            .scalar()
            or 0
        )
    else:
        # For classroom programs, get max order within the classroom
        max_order = (
            db.query(func.max(Program.order_index))
            .filter(Program.classroom_id == program_data.classroom_id)
            .scalar()
            or 0
        )

    program = Program(
        name=program_data.name,
        description=program_data.description,
        level=getattr(
            ProgramLevel, program_data.level.upper().replace("-", "_"), ProgramLevel.A1
        ),
        classroom_id=program_data.classroom_id,
        teacher_id=current_teacher.id,
        estimated_hours=program_data.estimated_hours,
        is_template=program_data.is_template or False,
        is_active=True,
        order_index=max_order + 1,
        tags=program_data.tags or [],
    )
    db.add(program)
    db.commit()
    db.refresh(program)

    return {
        "id": program.id,
        "name": program.name,
        "description": program.description,
        "level": program.level.value,
        "classroom_id": program.classroom_id,
        "estimated_hours": program.estimated_hours,
        "is_template": program.is_template,
        "order_index": program.order_index,
        "tags": program.tags or [],
        "lessons": [],  # New programs have no lessons yet
    }


@router.put("/programs/reorder")
async def reorder_programs(
    order_data: List[Dict[str, int]],  # [{"id": 1, "order_index": 1}, ...]
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """重新排序課程"""
    # 優化：批次查詢課程，避免 N+1 問題
    program_ids = [item["id"] for item in order_data]
    programs_list = (
        db.query(Program)
        .filter(Program.id.in_(program_ids), Program.teacher_id == current_teacher.id)
        .all()
    )
    programs_dict = {p.id: p for p in programs_list}

    for item in order_data:
        program = programs_dict.get(item["id"])
        if program:
            program.order_index = item["order_index"]

    db.commit()
    return {"message": "Programs reordered successfully"}


@router.put("/programs/{program_id}/lessons/reorder")
async def reorder_lessons(
    program_id: int,
    order_data: List[Dict[str, int]],  # [{"id": 1, "order_index": 1}, ...]
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """重新排序單元"""
    # 驗證 program 屬於當前教師
    program = (
        db.query(Program)
        .filter(Program.id == program_id, Program.teacher_id == current_teacher.id)
        .first()
    )

    if not program:
        raise HTTPException(status_code=404, detail="Program not found")

    # 優化：批次查詢課程單元，避免 N+1 問題
    lesson_ids = [item["id"] for item in order_data]
    lessons_list = (
        db.query(Lesson)
        .filter(Lesson.id.in_(lesson_ids), Lesson.program_id == program_id)
        .all()
    )
    lessons_dict = {lesson.id: lesson for lesson in lessons_list}

    for item in order_data:
        lesson = lessons_dict.get(item["id"])
        if lesson:
            lesson.order_index = item["order_index"]

    db.commit()
    return {"message": "Lessons reordered successfully"}


@router.put("/lessons/{lesson_id}/contents/reorder")
async def reorder_contents(
    lesson_id: int,
    order_data: List[Dict[str, int]],  # [{"id": 1, "order_index": 1}, ...]
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """重新排序內容"""
    # 驗證 lesson 屬於當前教師的 program
    lesson = (
        db.query(Lesson)
        .join(Program)
        .filter(Lesson.id == lesson_id, Program.teacher_id == current_teacher.id)
        .first()
    )

    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")

    # 優化：批次查詢內容，避免 N+1 問題
    content_ids = [item["id"] for item in order_data]
    contents_list = (
        db.query(Content)
        .filter(Content.id.in_(content_ids), Content.lesson_id == lesson_id)
        .all()
    )
    contents_dict = {content.id: content for content in contents_list}

    for item in order_data:
        content = contents_dict.get(item["id"])
        if content:
            content.order_index = item["order_index"]

    db.commit()
    return {"message": "Contents reordered successfully"}


@router.get("/programs/{program_id}")
async def get_program(
    program_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """取得單一課程資料"""
    program = (
        db.query(Program)
        .filter(
            Program.id == program_id,
            Program.teacher_id == current_teacher.id,
            Program.is_active.is_(True),
        )
        .options(
            selectinload(Program.lessons)
            .selectinload(Lesson.contents)
            .selectinload(Content.content_items)
        )
        .first()
    )

    if not program:
        raise HTTPException(status_code=404, detail="Program not found")

    return {
        "id": program.id,
        "name": program.name,
        "description": program.description,
        "level": program.level.value if program.level else "A1",
        "classroom_id": program.classroom_id,
        "estimated_hours": program.estimated_hours,
        "order_index": program.order_index if hasattr(program, "order_index") else 1,
        "lessons": [
            {
                "id": lesson.id,
                "name": lesson.name,
                "description": lesson.description,
                "order_index": lesson.order_index,
                "estimated_minutes": lesson.estimated_minutes,
                "contents": [
                    {
                        "id": content.id,
                        "type": (
                            content.type.value if content.type else "reading_assessment"
                        ),
                        "title": content.title,
                        "items": [item for item in content.content_items]
                        if hasattr(content, "content_items")
                        else [],  # Use content_items relationship
                        "items_count": len(content.content_items)
                        if hasattr(content, "content_items")
                        else 0,
                        "estimated_time": "10 分鐘",  # Can be calculated based on items
                    }
                    for content in sorted(
                        lesson.contents or [], key=lambda x: x.order_index
                    )
                    if content.is_active
                    and not content.is_assignment_copy  # Filter out assignment copies
                ],
            }
            for lesson in sorted(program.lessons or [], key=lambda x: x.order_index)
            if lesson.is_active  # Filter by is_active
        ],
    }


@router.put("/programs/{program_id}")
async def update_program(
    program_id: int,
    update_data: ProgramUpdate,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """更新課程資料"""
    program = (
        db.query(Program)
        .filter(
            Program.id == program_id,
            Program.teacher_id == current_teacher.id,
            Program.is_active.is_(True),
        )
        .first()
    )

    if not program:
        raise HTTPException(status_code=404, detail="Program not found")

    # 使用 model_dump 來獲取所有提交的欄位（包含 None 值的）
    update_dict = update_data.model_dump(exclude_unset=True)

    if "name" in update_dict:
        program.name = update_dict["name"]
    if "description" in update_dict:
        program.description = update_dict["description"]
    if "estimated_hours" in update_dict:
        program.estimated_hours = update_dict["estimated_hours"]
    if "level" in update_dict:
        # 將字串轉換為 ProgramLevel enum
        program.level = ProgramLevel(update_dict["level"])
    if "tags" in update_dict:
        program.tags = update_dict["tags"]

    db.commit()
    db.refresh(program)

    return {
        "id": program.id,
        "name": program.name,
        "description": program.description,
        "estimated_hours": program.estimated_hours,
        "level": program.level.value if program.level else "A1",
        "tags": program.tags or [],
    }


@router.delete("/programs/{program_id}")
async def delete_program(
    program_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """刪除課程 - 使用軟刪除保護資料完整性"""

    program = (
        db.query(Program)
        .filter(
            Program.id == program_id,
            Program.teacher_id == current_teacher.id,
            Program.is_active.is_(True),
        )
        .first()
    )

    if not program:
        raise HTTPException(status_code=404, detail="Program not found")

    # 檢查相關資料
    lesson_count = db.query(Lesson).filter(Lesson.program_id == program_id).count()

    # 先取得所有相關 lesson 的 ID
    lesson_ids = [
        lesson.id
        for lesson in db.query(Lesson.id).filter(Lesson.program_id == program_id).all()
    ]

    content_count = 0
    assignment_count = 0

    if lesson_ids:
        # 計算 content 數量
        content_count = (
            db.query(Content).filter(Content.lesson_id.in_(lesson_ids)).count()
        )

        # 取得所有相關 content 的 ID
        content_ids = [
            c.id
            for c in db.query(Content.id)
            .filter(Content.lesson_id.in_(lesson_ids))
            .all()
        ]

        if content_ids:
            # 計算 assignment 數量（透過 StudentContentProgress）
            assignment_count = (
                db.query(
                    func.count(
                        func.distinct(StudentContentProgress.student_assignment_id)
                    )
                )
                .filter(StudentContentProgress.content_id.in_(content_ids))
                .scalar()
            ) or 0

    # 軟刪除 - 保留資料以供日後參考
    program.is_active = False
    db.commit()

    return {
        "message": "Program successfully deactivated (soft delete)",
        "details": {
            "program_id": program_id,
            "program_name": program.name,
            "deactivated": True,
            "related_data": {
                "lessons": lesson_count,
                "contents": content_count,
                "assignments": assignment_count,
            },
            "note": "課程已停用但資料保留，可聯繫管理員恢復",
        },
    }


@router.post("/programs/{program_id}/lessons")
async def add_lesson(
    program_id: int,
    lesson_data: LessonCreate,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """新增課程單元"""
    program = (
        db.query(Program)
        .filter(
            Program.id == program_id,
            Program.teacher_id == current_teacher.id,
            Program.is_active.is_(True),
        )
        .first()
    )

    if not program:
        raise HTTPException(status_code=404, detail="Program not found")

    lesson = Lesson(
        program_id=program_id,
        name=lesson_data.name,
        description=lesson_data.description,
        order_index=lesson_data.order_index,
        estimated_minutes=lesson_data.estimated_minutes,
    )
    db.add(lesson)
    db.commit()
    db.refresh(lesson)

    return {
        "id": lesson.id,
        "name": lesson.name,
        "description": lesson.description,
        "order_index": lesson.order_index,
        "estimated_minutes": lesson.estimated_minutes,
    }


@router.put("/lessons/{lesson_id}")
async def update_lesson(
    lesson_id: int,
    lesson_data: LessonCreate,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """更新課程單元"""
    # 驗證 lesson 屬於當前教師
    lesson = (
        db.query(Lesson)
        .join(Program)
        .filter(
            Lesson.id == lesson_id,
            Program.teacher_id == current_teacher.id,
            Lesson.is_active.is_(True),
            Program.is_active.is_(True),
        )
        .first()
    )

    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")

    # 更新資料
    lesson.name = lesson_data.name
    lesson.description = lesson_data.description
    lesson.order_index = lesson_data.order_index
    lesson.estimated_minutes = lesson_data.estimated_minutes

    db.commit()
    db.refresh(lesson)

    return {
        "id": lesson.id,
        "name": lesson.name,
        "description": lesson.description,
        "order_index": lesson.order_index,
        "estimated_minutes": lesson.estimated_minutes,
    }


@router.delete("/lessons/{lesson_id}")
async def delete_lesson(
    lesson_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """刪除課程單元 - 使用軟刪除保護資料完整性"""

    # 驗證 lesson 屬於當前教師
    lesson = (
        db.query(Lesson)
        .join(Program)
        .filter(
            Lesson.id == lesson_id,
            Program.teacher_id == current_teacher.id,
            Lesson.is_active.is_(True),
            Program.is_active.is_(True),
        )
        .first()
    )

    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")

    # 檢查相關資料
    content_count = (
        db.query(Content)
        .filter(Content.lesson_id == lesson_id, Content.is_active.is_(True))
        .count()
    )

    # 先查詢這個 lesson 相關的所有 content IDs
    content_ids = [
        c.id for c in db.query(Content.id).filter(Content.lesson_id == lesson_id).all()
    ]

    # 使用 content IDs 來計算作業數量（透過 StudentContentProgress）
    assignment_count = 0
    if content_ids:
        assignment_count = (
            db.query(
                func.count(func.distinct(StudentContentProgress.student_assignment_id))
            )
            .filter(StudentContentProgress.content_id.in_(content_ids))
            .scalar()
        ) or 0

    # 軟刪除 lesson
    lesson.is_active = False

    # 同時軟刪除相關的 contents
    db.query(Content).filter(Content.lesson_id == lesson_id).update(
        {"is_active": False}
    )

    db.commit()

    return {
        "message": "Lesson successfully deactivated (soft delete)",
        "details": {
            "lesson_id": lesson_id,
            "lesson_name": lesson.name,
            "deactivated": True,
            "related_data": {
                "contents": content_count,
                "assignments": assignment_count,
            },
            "note": "單元已停用但資料保留，可聯繫管理員恢復",
        },
    }
