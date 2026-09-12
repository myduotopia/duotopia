"""班級學生分組 API — Issue #1046。

老師把一個班級拆成小組（第一組、第二組…）做競賽、加分、分工。

- GET    /api/teachers/classrooms/{classroom_id}/groups        取得班級的所有組別
- POST   /api/teachers/classrooms/{classroom_id}/groups        建立組別
- PUT    /api/teachers/groups/{group_id}                       整包更新組別
- DELETE /api/teachers/groups/{group_id}                       刪除組別
- PUT    /api/teachers/classrooms/{classroom_id}/groups/order  重排組別順序

分組屬於班級而非個別老師（見 models/student_group.py），但存取權仍沿用全專案
既有的 `Classroom.teacher_id == current_teacher.id` 慣例：查不到班級一律回 404，
不回 403，避免洩漏「這個班級存在但不是你的」。

更新組別的成員採「全刪重插」而非逐筆 diff：一組只有數十人，整批取代的語意
（送什麼順序就是什麼順序）比 diff 好推理，也讓拖曳排序只要送整串 id 就好。
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models import (
    Classroom,
    ClassroomStudent,
    GROUP_COLOR_VALUES,
    Student,
    StudentGroup,
    StudentGroupMember,
    Teacher,
)

# 共用同一份教師鑑權依賴，避免 auth 邏輯分叉
from routers.teachers import get_current_teacher

router = APIRouter(prefix="/api/teachers", tags=["student-groups"])


# ============ Schemas ============


class GroupMemberOut(BaseModel):
    student_id: int
    name: str
    student_number: Optional[str] = None
    # 組內序號（從 0 起算，前端顯示時 +1）
    sort_order: int


class GroupOut(BaseModel):
    id: int
    classroom_id: int
    name: str
    color: Optional[str] = None
    leader_student_id: Optional[int] = None
    sort_order: int
    members: List[GroupMemberOut]


class GroupWrite(BaseModel):
    """建立與更新共用同一個 body 形狀。

    `member_student_ids` 是**有序**的：陣列索引直接成為每位成員的 sort_order。
    """

    name: str = Field(min_length=1, max_length=100)
    color: Optional[str] = Field(default=None, max_length=20)
    member_student_ids: List[int] = Field(default_factory=list)
    leader_student_id: Optional[int] = None


class GroupOrderUpdate(BaseModel):
    group_ids: List[int]


# ============ Helpers ============


def _classroom_not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Classroom not found")


def _group_not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Group not found")


def _invalid(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail
    )


def _get_owned_classroom(db: Session, teacher_id: int, classroom_id: int) -> Classroom:
    classroom = (
        db.query(Classroom)
        .filter(
            Classroom.id == classroom_id,
            Classroom.teacher_id == teacher_id,
            Classroom.is_active.is_(True),
        )
        .first()
    )
    if not classroom:
        raise _classroom_not_found()
    return classroom


def _get_owned_group(db: Session, teacher_id: int, group_id: int) -> StudentGroup:
    """查組別時一併確認它所屬的班級是這位老師的。"""
    group = (
        db.query(StudentGroup)
        .join(Classroom, StudentGroup.classroom_id == Classroom.id)
        .filter(
            StudentGroup.id == group_id,
            Classroom.teacher_id == teacher_id,
            Classroom.is_active.is_(True),
        )
        .options(selectinload(StudentGroup.members))
        .first()
    )
    if not group:
        raise _group_not_found()
    return group


def _classroom_student_map(db: Session, classroom_id: int) -> dict:
    """班上在籍且啟用的學生：student_id -> Student。"""
    rows = (
        db.query(Student)
        .join(ClassroomStudent, ClassroomStudent.student_id == Student.id)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.is_active.is_(True),
            Student.is_active.is_(True),
        )
        .all()
    )
    return {s.id: s for s in rows}


def _validate_body(db: Session, classroom_id: int, body: GroupWrite) -> None:
    """擋掉 DB 約束攔不下來的東西。"""
    if not body.name.strip():
        raise _invalid("Group name is required")

    if body.color is not None and body.color not in GROUP_COLOR_VALUES:
        raise _invalid("Unknown group color")

    ids = body.member_student_ids
    if len(set(ids)) != len(ids):
        raise _invalid("A student was listed twice")

    if ids:
        # 每位成員都必須是「這個班級」的在籍學生。
        in_class = set(_classroom_student_map(db, classroom_id).keys())
        if not set(ids).issubset(in_class):
            raise _invalid("One or more students do not belong to this classroom")

    if body.leader_student_id is not None and body.leader_student_id not in ids:
        raise _invalid("The leader must be one of the members of the group")


def _name_taken(
    db: Session, classroom_id: int, name: str, exclude_group_id: Optional[int] = None
) -> bool:
    q = db.query(StudentGroup.id).filter(
        StudentGroup.classroom_id == classroom_id,
        StudentGroup.name == name,
    )
    if exclude_group_id is not None:
        q = q.filter(StudentGroup.id != exclude_group_id)
    return db.query(q.exists()).scalar()


def _replace_members(db: Session, group: StudentGroup, student_ids: List[int]) -> None:
    """整批取代成員：一組只有數十人，全刪重插比 diff 好推理。"""
    db.query(StudentGroupMember).filter(StudentGroupMember.group_id == group.id).delete(
        synchronize_session=False
    )
    for index, student_id in enumerate(student_ids):
        db.add(
            StudentGroupMember(
                group_id=group.id,
                student_id=student_id,
                sort_order=index,
            )
        )


def _to_out(group: StudentGroup, students: dict) -> GroupOut:
    members = [
        GroupMemberOut(
            student_id=m.student_id,
            name=students[m.student_id].name,
            student_number=students[m.student_id].student_number,
            sort_order=m.sort_order,
        )
        # 已離班的學生即使還留著 member 列也不回傳，避免前端拿到殘影。
        for m in sorted(group.members, key=lambda m: m.sort_order)
        if m.student_id in students
    ]
    return GroupOut(
        id=group.id,
        classroom_id=group.classroom_id,
        name=group.name,
        color=group.color,
        leader_student_id=group.leader_student_id,
        sort_order=group.sort_order,
        members=members,
    )


# ============ Endpoints ============


@router.get("/classrooms/{classroom_id}/groups", response_model=List[GroupOut])
async def list_groups(
    classroom_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """取得班級的所有組別，依 sort_order 排序。"""
    _get_owned_classroom(db, current_teacher.id, classroom_id)

    groups = (
        db.query(StudentGroup)
        .filter(StudentGroup.classroom_id == classroom_id)
        .options(selectinload(StudentGroup.members))
        .order_by(StudentGroup.sort_order, StudentGroup.id)
        .all()
    )
    students = _classroom_student_map(db, classroom_id)
    return [_to_out(g, students) for g in groups]


@router.post(
    "/classrooms/{classroom_id}/groups",
    response_model=GroupOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_group(
    classroom_id: int,
    body: GroupWrite,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """建立組別，sort_order 自動接在現有組別最後。"""
    _get_owned_classroom(db, current_teacher.id, classroom_id)
    _validate_body(db, classroom_id, body)

    name = body.name.strip()
    if _name_taken(db, classroom_id, name):
        raise HTTPException(status_code=409, detail="Group name already exists")

    last = (
        db.query(StudentGroup.sort_order)
        .filter(StudentGroup.classroom_id == classroom_id)
        .order_by(StudentGroup.sort_order.desc())
        .first()
    )
    next_order = (last[0] + 1) if last else 0

    group = StudentGroup(
        classroom_id=classroom_id,
        name=name,
        color=body.color,
        leader_student_id=body.leader_student_id,
        sort_order=next_order,
    )
    db.add(group)
    db.flush()  # 取得 group.id 才能插成員

    _replace_members(db, group, body.member_student_ids)
    db.commit()
    db.refresh(group)

    return _to_out(group, _classroom_student_map(db, classroom_id))


@router.put("/groups/{group_id}", response_model=GroupOut)
async def update_group(
    group_id: int,
    body: GroupWrite,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """整包更新：name / color / 成員（有序）/ 組長一次寫完。"""
    group = _get_owned_group(db, current_teacher.id, group_id)
    _validate_body(db, group.classroom_id, body)

    name = body.name.strip()
    if _name_taken(db, group.classroom_id, name, exclude_group_id=group.id):
        raise HTTPException(status_code=409, detail="Group name already exists")

    group.name = name
    group.color = body.color
    group.leader_student_id = body.leader_student_id
    _replace_members(db, group, body.member_student_ids)

    db.commit()
    db.refresh(group)

    return _to_out(group, _classroom_student_map(db, group.classroom_id))


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(
    group_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """刪除組別，成員列由 FK ON DELETE CASCADE 一併清掉。"""
    group = _get_owned_group(db, current_teacher.id, group_id)
    db.delete(group)
    db.commit()


@router.put("/classrooms/{classroom_id}/groups/order", response_model=List[GroupOut])
async def reorder_groups(
    classroom_id: int,
    body: GroupOrderUpdate,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """依送來的 id 順序重寫 sort_order。"""
    _get_owned_classroom(db, current_teacher.id, classroom_id)

    groups = (
        db.query(StudentGroup)
        .filter(StudentGroup.classroom_id == classroom_id)
        .options(selectinload(StudentGroup.members))
        .all()
    )
    by_id = {g.id: g for g in groups}

    # 必須剛好是這個班級現有組別的完整排列，否則拒絕 —— 半套的順序會讓沒被
    # 提到的組別留著舊的 sort_order，排出來的結果沒有定義。
    if set(body.group_ids) != set(by_id.keys()) or len(body.group_ids) != len(by_id):
        raise _invalid("group_ids must list every group of this classroom exactly once")

    for index, group_id in enumerate(body.group_ids):
        by_id[group_id].sort_order = index

    db.commit()

    students = _classroom_student_map(db, classroom_id)
    ordered = sorted(groups, key=lambda g: g.sort_order)
    return [_to_out(g, students) for g in ordered]
