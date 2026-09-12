"""
Student group models (Issue #1046)

老師把一個班級拆成小組（第一組、第二組…）做競賽、加分、分工。

分組屬於「班級」而非個別老師 —— 沒有 teacher_id 欄位，所以同班的協同老師
（機構／學校模式下常見）看到的是同一份分組。

一個學生可以同時屬於多個組別（英文分組、打掃分組並存），所以刻意不對
(classroom, student) 設唯一約束；唯一約束只下在 (group_id, student_id)。
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


# 色票 key，不是 hex：前端把 key 映射成固定的 Tailwind class，因為 Tailwind
# 只認得完整字面的 class name，無法從樣板字串組出 bg-${color}-500。
GROUP_COLOR_VALUES = ("amber", "rose", "sky", "emerald", "violet", "slate")


class StudentGroup(Base):
    """班級內的一個組別"""

    __tablename__ = "student_groups"

    id = Column(Integer, primary_key=True, index=True)
    classroom_id = Column(
        Integer,
        ForeignKey("classrooms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(100), nullable=False)
    color = Column(String(20), nullable=True)
    # SET NULL 而非 CASCADE：組長轉學只該讓這組沒有組長，不該刪掉整組。
    leader_student_id = Column(
        Integer,
        ForeignKey("students.id", ondelete="SET NULL"),
        nullable=True,
    )
    sort_order = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    classroom = relationship("Classroom")
    leader = relationship("Student", foreign_keys=[leader_student_id])
    members = relationship(
        "StudentGroupMember",
        back_populates="group",
        cascade="all, delete-orphan",
        order_by="StudentGroupMember.sort_order",
    )

    __table_args__ = (
        UniqueConstraint(
            "classroom_id", "name", name="uq_student_group_classroom_name"
        ),
    )

    def __repr__(self):
        return f"<StudentGroup {self.name} (classroom={self.classroom_id})>"


class StudentGroupMember(Base):
    """組別成員。sort_order 即組內序號，拖曳排序後由後端整批重寫。"""

    __tablename__ = "student_group_members"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(
        Integer,
        ForeignKey("student_groups.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_id = Column(
        Integer,
        ForeignKey("students.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sort_order = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    group = relationship("StudentGroup", back_populates="members")
    student = relationship("Student")

    __table_args__ = (
        UniqueConstraint("group_id", "student_id", name="uq_student_group_member"),
    )

    def __repr__(self):
        return f"<StudentGroupMember group={self.group_id} student={self.student_id}>"
