"""
Organization hierarchy models
"""

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
from .base import UUID, JSONType
import uuid


# ============================================
# 機構層級系統 (Organization Hierarchy)
# ============================================


class Organization(Base):
    """
    機構 (Organization)
    - 機構可包含多個學校
    - 機構擁有者 (org_owner) 可管理所有學校
    """

    __tablename__ = "organizations"

    id = Column(UUID, primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    display_name = Column(String(200), nullable=True)
    description = Column(Text, nullable=True)

    # 統一編號 (Taiwan Business ID)
    # Note: Uniqueness enforced by partial index (uq_organizations_tax_id_active)
    #       in database for active organizations only, allowing reuse after soft delete
    tax_id = Column(String(20), nullable=True, index=True)

    # 聯絡資訊
    contact_email = Column(String(200), nullable=True)
    contact_phone = Column(String(50), nullable=True)
    address = Column(Text, nullable=True)

    # 狀態
    is_active = Column(Boolean, nullable=False, default=True, index=True)

    # 機構類型：'institution'（機構，依學生人數計費）/ 'group_buy'（團購）
    org_type = Column(String(20), nullable=False, server_default="institution")
    # 機構專用：單位學生月費（NT$）。團購機構為 NULL。
    per_student_price = Column(Integer, nullable=True)

    # 授權限制
    teacher_limit = Column(Integer, nullable=True)  # 教師授權數上限（NULL = 無限制）

    # 點數系統 (Points System)
    total_points = Column(Integer, nullable=False, default=0)  # 總點數
    used_points = Column(Integer, nullable=False, default=0)  # 已使用點數
    last_points_update = Column(DateTime(timezone=True), nullable=True)  # 最後更新時間

    # 訂閱日期 (Subscription Dates)
    subscription_start_date = Column(DateTime(timezone=True), nullable=True)  # 訂閱開始時間
    subscription_end_date = Column(DateTime(timezone=True), nullable=True)  # 訂閱結束時間

    # 設定
    settings = Column(JSONType, nullable=True)  # 機構層級設定

    # 時間戳記
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    schools = relationship(
        "School", back_populates="organization", cascade="all, delete-orphan"
    )
    teacher_organizations = relationship(
        "TeacherOrganization",
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    credit_packages = relationship(
        "CreditPackage",
        back_populates="organization",
        cascade="all, delete-orphan",
        order_by="CreditPackage.expires_at.asc()",
    )

    __table_args__ = (
        CheckConstraint(
            "org_type IN ('institution', 'group_buy')",
            name="ck_organizations_org_type_valid",
        ),
        CheckConstraint(
            "per_student_price IS NULL OR per_student_price > 0",
            name="ck_organizations_per_student_price_positive",
        ),
    )

    def __repr__(self):
        return f"<Organization(id={self.id}, name={self.name})>"


class School(Base):
    """
    學校 (School)
    - 屬於一個機構
    - 包含多個班級
    - 有自己的管理者 (school_admin)
    """

    __tablename__ = "schools"

    id = Column(UUID, primary_key=True, default=uuid.uuid4)
    organization_id = Column(
        UUID,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name = Column(String(100), nullable=False)
    display_name = Column(String(200), nullable=True)
    description = Column(Text, nullable=True)

    # 聯絡資訊
    contact_email = Column(String(200), nullable=True)
    contact_phone = Column(String(50), nullable=True)
    address = Column(Text, nullable=True)

    # 狀態
    is_active = Column(Boolean, nullable=False, default=True, index=True)

    # 團購方案專用：綁定的方案（10/30/50 席）。機構底下 schools 為 NULL。
    plan_id = Column(
        Integer, ForeignKey("plans.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # 團購方案專用：該團教師上限。機構底下 schools 為 NULL。
    teacher_seat_limit = Column(Integer, nullable=True)

    # 設定
    settings = Column(JSONType, nullable=True)  # 學校層級設定

    # 時間戳記
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    organization = relationship("Organization", back_populates="schools")
    plan = relationship("Plan", foreign_keys=[plan_id], back_populates="schools")
    teacher_schools = relationship(
        "TeacherSchool", back_populates="school", cascade="all, delete-orphan"
    )
    classroom_schools = relationship(
        "ClassroomSchool", back_populates="school", cascade="all, delete-orphan"
    )
    student_enrollments = relationship(
        "StudentSchool", back_populates="school", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(
            "teacher_seat_limit IS NULL OR teacher_seat_limit > 0",
            name="ck_schools_teacher_seat_limit_positive",
        ),
    )

    def __repr__(self):
        return f"<School(id={self.id}, name={self.name}, org={self.organization_id})>"


class TeacherOrganization(Base):
    """
    教師-機構關係表
    - 記錄教師在機構的角色
    - 主要用於 org_owner
    """

    __tablename__ = "teacher_organizations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    teacher_id = Column(
        Integer,
        ForeignKey("teachers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    organization_id = Column(
        UUID,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 角色（通常是 org_owner）
    role = Column(String(50), nullable=False, default="org_owner")

    # 狀態
    is_active = Column(Boolean, nullable=False, default=True, index=True)

    # 時間戳記
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    teacher = relationship("Teacher", back_populates="teacher_organizations")
    organization = relationship("Organization", back_populates="teacher_organizations")

    # 唯一約束：一個教師在一個機構只能有一個關係
    __table_args__ = (
        UniqueConstraint(
            "teacher_id", "organization_id", name="uq_teacher_organization"
        ),
        Index(
            "ix_teacher_organizations_active",
            "teacher_id",
            "organization_id",
            "is_active",
        ),
    )

    def __repr__(self):
        return f"<TeacherOrganization(teacher={self.teacher_id}, org={self.organization_id}, role={self.role})>"


class TeacherSchool(Base):
    """
    教師-學校關係表
    - 記錄教師在學校的角色
    - 支援多重角色 (school_admin, teacher)
    """

    __tablename__ = "teacher_schools"

    id = Column(Integer, primary_key=True, autoincrement=True)
    teacher_id = Column(
        Integer,
        ForeignKey("teachers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    school_id = Column(
        UUID, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # 角色列表（使用 JSON/JSONB 儲存）['school_admin', 'teacher']
    roles = Column(JSONType, nullable=False, default=list)

    # 自訂權限 (JSONB) - 覆蓋預設角色權限
    permissions = Column(JSONType, nullable=True, default=None)

    # 狀態
    is_active = Column(Boolean, nullable=False, default=True, index=True)

    # 時間戳記
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    teacher = relationship("Teacher", back_populates="teacher_schools")
    school = relationship("School", back_populates="teacher_schools")

    # 唯一約束：一個教師在一個學校只能有一個關係
    __table_args__ = (
        UniqueConstraint("teacher_id", "school_id", name="uq_teacher_school"),
        Index("ix_teacher_schools_active", "teacher_id", "school_id", "is_active"),
    )

    def __repr__(self):
        return f"<TeacherSchool(teacher={self.teacher_id}, school={self.school_id}, roles={self.roles})>"


class ClassroomSchool(Base):
    """
    班級-學校關係表
    - 記錄班級屬於哪個學校
    - 向下相容：保留 classroom.teacher_id（獨立教師）
    """

    __tablename__ = "classroom_schools"

    id = Column(Integer, primary_key=True, autoincrement=True)
    classroom_id = Column(
        Integer,
        ForeignKey("classrooms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    school_id = Column(
        UUID, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # 狀態
    is_active = Column(Boolean, nullable=False, default=True, index=True)

    # 時間戳記
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    classroom = relationship("Classroom", back_populates="classroom_schools")
    school = relationship("School", back_populates="classroom_schools")

    # 唯一約束：一個班級只能屬於一個學校
    __table_args__ = (
        UniqueConstraint("classroom_id", name="uq_classroom_school"),
        Index("ix_classroom_schools_active", "classroom_id", "school_id", "is_active"),
    )

    def __repr__(self):
        return (
            f"<ClassroomSchool(classroom={self.classroom_id}, school={self.school_id})>"
        )


class StudentSchool(Base):
    """
    學生-學校關係表（多對多）
    - 記錄學生屬於哪些學校
    - 支援學生同時屬於多個學校
    """

    __tablename__ = "student_schools"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(
        Integer,
        ForeignKey("students.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    school_id = Column(
        UUID, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # 狀態
    is_active = Column(Boolean, nullable=False, default=True, index=True)

    # 時間戳記
    enrolled_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    student = relationship("Student", back_populates="school_enrollments")
    school = relationship("School", back_populates="student_enrollments")

    # 唯一約束：一個學生在一個學校只能有一條記錄
    __table_args__ = (
        UniqueConstraint("student_id", "school_id", name="uq_student_school"),
        Index("ix_student_schools_active", "student_id", "school_id", "is_active"),
    )

    def __repr__(self):
        return f"<StudentSchool(student={self.student_id}, school={self.school_id})>"


class OrganizationPointsLog(Base):
    """
    機構點數使用記錄表
    - 記錄每次點數扣除的詳細資訊
    - 用於審計追蹤和使用分析
    """

    __tablename__ = "organization_points_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    organization_id = Column(
        UUID,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    teacher_id = Column(
        Integer,
        ForeignKey("teachers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # 點數使用資訊
    points_used = Column(Integer, nullable=False)  # 使用的點數
    feature_type = Column(
        String(50), nullable=True
    )  # 功能類型 (ai_generation, translation, etc.)
    description = Column(Text, nullable=True)  # 詳細描述

    # 時間戳記
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    # Relationships (optional, can be added if needed)
    # organization = relationship("Organization")
    # teacher = relationship("Teacher")

    def __repr__(self):
        return (
            f"<OrganizationPointsLog(org={self.organization_id}, "
            f"teacher={self.teacher_id}, points={self.points_used})>"
        )
