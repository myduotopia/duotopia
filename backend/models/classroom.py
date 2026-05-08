"""
Classroom models
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    ForeignKey,
    Boolean,
    Text,
    Enum,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
from .base import ProgramLevel


# ============ 班級管理 ============
class Classroom(Base):
    """班級模型（注意：使用 Classroom 避免與 Python 保留字衝突）"""

    __tablename__ = "classrooms"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    level = Column(Enum(ProgramLevel), default=ProgramLevel.A1)
    teacher_id = Column(Integer, ForeignKey("teachers.id"), nullable=True)
    school = Column(String(255), nullable=True)  # 學校名稱（與 DB 一致，但不使用）
    grade = Column(String(50), nullable=True)  # 年級（與 DB 一致，但不使用）
    academic_year = Column(String(20), nullable=True)  # 學年度（與 DB 一致，但不使用）
    is_active = Column(Boolean, default=True)

    # 1Campus sync metadata. Populated only for classrooms imported from
    # 1Campus jasmine API. Manual Duotopia classrooms have these as NULL,
    # which the sync service treats as "do not touch".
    one_campus_class_id = Column(String(100), nullable=True, index=True)
    one_campus_school_dsns = Column(String(100), nullable=True)
    last_synced_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    teacher = relationship("Teacher", back_populates="classrooms")
    students = relationship(
        "ClassroomStudent", back_populates="classroom", cascade="all, delete-orphan"
    )
    programs = relationship(
        "Program", back_populates="classroom", cascade="all, delete-orphan"
    )  # 直接關聯課程
    assignments = relationship(
        "Assignment", back_populates="classroom", cascade="all, delete-orphan"
    )
    # Organization hierarchy relationship
    classroom_schools = relationship(
        "ClassroomSchool",
        back_populates="classroom",
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        return f"<Classroom {self.name}>"


class ClassroomStudent(Base):
    """班級學生關聯表"""

    __tablename__ = "classroom_students"

    id = Column(Integer, primary_key=True, index=True)
    classroom_id = Column(Integer, ForeignKey("classrooms.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    joined_at = Column(DateTime(timezone=True), server_default=func.now())
    is_active = Column(Boolean, default=True)

    # Relationships
    classroom = relationship("Classroom", back_populates="students")
    student = relationship("Student", back_populates="classroom_enrollments")

    # Unique constraint
    __table_args__ = ({"mysql_engine": "InnoDB"},)
