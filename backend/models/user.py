"""
User models: Teacher, Student, and Identity (unified identity)
"""

from sqlalchemy import (
    Column,
    ForeignKey,
    Integer,
    String,
    DateTime,
    Boolean,
    Date,
    Float,
    select,
)
from sqlalchemy.orm import relationship, Session
from sqlalchemy.sql import func
from database import Base


class Identity(Base):
    """統一身分表

    統一管理老師和學生的登入身分，
    以 email 為唯一識別，支援密碼統一管理和 OAuth 擴展。
    """

    __tablename__ = "identities"

    id = Column(Integer, primary_key=True, index=True)

    # 統一 Email（唯一）
    email = Column(String(255), unique=True, nullable=False, index=True)

    # 密碼管理
    password_hash = Column(String(255), nullable=True)
    password_changed = Column(Boolean, default=False)
    last_password_change = Column(DateTime(timezone=True), nullable=True)

    # Email 驗證
    email_verified = Column(Boolean, default=False, nullable=False)
    email_verified_at = Column(DateTime(timezone=True), nullable=True)

    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    linked_students = relationship(
        "Student",
        back_populates="identity",
        foreign_keys="Student.identity_id",
    )
    linked_teachers = relationship(
        "Teacher",
        back_populates="identity",
        foreign_keys="Teacher.identity_id",
    )

    def __repr__(self):
        return f"<Identity {self.email}>"


class Teacher(Base):
    """教師模型（個體戶）"""

    __tablename__ = "teachers"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(100), nullable=False)
    phone = Column(String(20))
    avatar_url = Column(String(500))
    is_active = Column(Boolean, default=True, nullable=False)
    is_demo = Column(Boolean, default=False, nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)

    # Identity 關聯
    identity_id = Column(Integer, ForeignKey("identities.id"), nullable=True)

    # Email 驗證字段
    email_verified = Column(Boolean, default=False)
    email_verified_at = Column(DateTime(timezone=True))
    email_verification_token = Column(String(100))
    email_verification_sent_at = Column(DateTime(timezone=True))

    # 密碼重設字段
    password_reset_token = Column(String(100))
    password_reset_sent_at = Column(DateTime(timezone=True))
    password_reset_expires_at = Column(DateTime(timezone=True))

    # 訂閱系統
    subscription_auto_renew = Column(Boolean, default=False)
    subscription_cancelled_at = Column(DateTime(timezone=True), nullable=True)
    trial_start_date = Column(DateTime(timezone=True), nullable=True)
    trial_end_date = Column(DateTime(timezone=True), nullable=True)

    # TapPay 信用卡 Token
    card_key = Column(String(255), nullable=True)
    card_token = Column(String(255), nullable=True)
    card_last_four = Column(String(4), nullable=True)
    card_bin_code = Column(String(6), nullable=True)
    card_type = Column(Integer, nullable=True)
    card_funding = Column(Integer, nullable=True)
    card_issuer = Column(String(100), nullable=True)
    card_country = Column(String(2), nullable=True)
    card_saved_at = Column(DateTime(timezone=True), nullable=True)

    # SSO / OAuth
    has_password = Column(Boolean, default=True)  # False for OAuth-only accounts

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    identity = relationship(
        "Identity",
        back_populates="linked_teachers",
        foreign_keys=[identity_id],
    )
    classrooms = relationship(
        "Classroom", back_populates="teacher", cascade="all, delete-orphan"
    )
    programs = relationship(
        "Program", back_populates="teacher", cascade="all, delete-orphan"
    )
    assignments = relationship("Assignment", back_populates="teacher")
    subscription_transactions = relationship(
        "TeacherSubscriptionTransaction",
        foreign_keys="TeacherSubscriptionTransaction.teacher_id",
        back_populates="teacher",
        cascade="all, delete-orphan",
    )
    subscription_periods = relationship(
        "SubscriptionPeriod",
        foreign_keys="SubscriptionPeriod.teacher_id",
        back_populates="teacher",
        cascade="all, delete-orphan",
        order_by="SubscriptionPeriod.start_date.desc()",
    )
    point_usage_logs = relationship(
        "PointUsageLog",
        back_populates="teacher",
        cascade="all, delete-orphan",
        order_by="PointUsageLog.created_at.desc()",
    )
    teacher_organizations = relationship(
        "TeacherOrganization",
        back_populates="teacher",
        cascade="all, delete-orphan",
    )
    teacher_schools = relationship(
        "TeacherSchool",
        back_populates="teacher",
        cascade="all, delete-orphan",
    )
    credit_packages = relationship(
        "CreditPackage",
        back_populates="teacher",
        cascade="all, delete-orphan",
        order_by="CreditPackage.expires_at.asc()",
    )
    # OAuth identities
    oauth_identities = relationship(
        "OAuthIdentity",
        back_populates="teacher",
        cascade="all, delete-orphan",
    )

    @property
    def current_period(self):
        """取得當前有效的訂閱週期"""
        from .subscription import SubscriptionPeriod

        session = Session.object_session(self)
        if not session:
            for period in self.subscription_periods:
                if period.status == "active":
                    return period
            return None

        stmt = (
            select(SubscriptionPeriod)
            .where(
                SubscriptionPeriod.teacher_id == self.id,
                SubscriptionPeriod.status == "active",
            )
            .order_by(SubscriptionPeriod.start_date.desc())
            .limit(1)
        )
        return session.execute(stmt).scalar_one_or_none()

    def _active_credit_packages(self):
        """取得所有 active 且未過期的點數包"""
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        return [
            pkg
            for pkg in (self.credit_packages or [])
            if pkg.status == "active" and pkg.expires_at and pkg.expires_at > now
        ]

    @property
    def quota_total(self) -> int:
        """訂閱配額 + 所有 active 點數包的加總"""
        total = 0
        period = self.current_period
        if period:
            total += period.quota_total
        total += sum(pkg.points_total for pkg in self._active_credit_packages())
        return total

    @property
    def quota_remaining(self) -> int:
        """所有來源的剩餘加總"""
        remaining = 0
        period = self.current_period
        if period:
            remaining += max(0, period.quota_total - period.quota_used)
        remaining += sum(pkg.points_remaining for pkg in self._active_credit_packages())
        return remaining

    @property
    def subscription_status(self):
        """獲取訂閱狀態 - 從 subscription_periods + credit packages 計算"""
        period = self.current_period
        if period:
            from datetime import datetime, timezone

            now = datetime.now(timezone.utc)
            end_date = period.end_date
            if end_date.tzinfo is None:
                end_date = end_date.replace(tzinfo=timezone.utc)

            if end_date > now:
                return "subscribed"

        if self._active_credit_packages():
            return "free"

        return "expired"

    @property
    def days_remaining(self):
        """獲取剩餘天數 - 從 subscription_periods 計算"""
        period = self.current_period
        if not period:
            return 0

        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)

        end_date = period.end_date
        if end_date.tzinfo is None:
            end_date = end_date.replace(tzinfo=timezone.utc)

        if end_date > now:
            return (end_date - now).days
        else:
            return 0

    @property
    def subscription_end_date(self):
        """獲取訂閱結束日期 - 從 subscription_periods 計算"""
        period = self.current_period
        if not period:
            return None
        return period.end_date

    @property
    def can_assign_homework(self):
        """是否可以分派作業 - 有效訂閱或有 active 點數包"""
        period = self.current_period
        if period:
            from datetime import datetime, timezone

            now = datetime.now(timezone.utc)
            end_date = period.end_date
            if end_date.tzinfo is None:
                end_date = end_date.replace(tzinfo=timezone.utc)

            if end_date > now:
                return True

        return any(pkg.points_remaining > 0 for pkg in self._active_credit_packages())

    def __repr__(self):
        return f"<Teacher {self.name} ({self.email})>"


class Student(Base):
    """學生模型"""

    __tablename__ = "students"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    student_number = Column(String(50))
    email = Column(String(255), nullable=True, index=True)
    password_hash = Column(String(255), nullable=False)
    birthdate = Column(Date, nullable=False)
    password_changed = Column(Boolean, default=False)
    email_verified = Column(Boolean, default=False)
    email_verified_at = Column(DateTime(timezone=True))
    email_verification_token = Column(String(100))
    email_verification_sent_at = Column(DateTime(timezone=True))
    parent_phone = Column(String(20))
    avatar_url = Column(String(500))
    is_active = Column(Boolean, default=True)
    last_login = Column(DateTime(timezone=True))

    # 身分整合欄位
    identity_id = Column(Integer, ForeignKey("identities.id"), nullable=True)
    is_primary_account = Column(Boolean, nullable=True)
    password_migrated_to_identity = Column(Boolean, default=False)

    # 學習目標設定
    target_wpm = Column(Integer, default=80)
    target_accuracy = Column(Float, default=0.8)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    identity = relationship(
        "Identity",
        back_populates="linked_students",
        foreign_keys=[identity_id],
    )
    classroom_enrollments = relationship("ClassroomStudent", back_populates="student")
    school_enrollments = relationship("StudentSchool", back_populates="student")
    assignments = relationship("StudentAssignment", back_populates="student")

    def get_default_password(self):
        """取得預設密碼（生日格式：YYYYMMDD）"""
        if self.birthdate:
            return self.birthdate.strftime("%Y%m%d")
        return None

    def __repr__(self):
        return f"<Student {self.name}>"
