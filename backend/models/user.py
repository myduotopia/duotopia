"""
User models: Teacher, Student, and StudentIdentity
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
    is_demo = Column(Boolean, default=False, nullable=False)  # 標記 demo 帳號
    is_admin = Column(Boolean, default=False, nullable=False)  # Admin 權限

    # Email 驗證字段
    email_verified = Column(Boolean, default=False)  # email 是否已驗證
    email_verified_at = Column(DateTime(timezone=True))  # email 驗證時間
    email_verification_token = Column(String(100))  # email 驗證 token
    email_verification_sent_at = Column(DateTime(timezone=True))  # 最後發送驗證信時間

    # 密碼重設字段
    password_reset_token = Column(String(100))  # 密碼重設 token
    password_reset_sent_at = Column(DateTime(timezone=True))  # 最後發送密碼重設郵件時間
    password_reset_expires_at = Column(DateTime(timezone=True))  # token 過期時間

    # 訂閱系統 - 新系統使用 subscription_periods 表
    # 移除舊欄位：subscription_type, subscription_status, subscription_start_date,
    #            subscription_end_date, subscription_renewed_at, monthly_message_limit,
    #            messages_used_this_month
    subscription_auto_renew = Column(Boolean, default=False)  # 是否自動續訂（全域偏好）
    subscription_cancelled_at = Column(DateTime(timezone=True), nullable=True)  # 取消續訂時間
    trial_start_date = Column(DateTime(timezone=True), nullable=True)  # 試用開始日
    trial_end_date = Column(DateTime(timezone=True), nullable=True)  # 試用結束日

    # TapPay 信用卡 Token（用於自動續訂扣款）
    card_key = Column(String(255), nullable=True)  # TapPay Card Key（永久有效）
    card_token = Column(String(255), nullable=True)  # TapPay Card Token（90天有效，每次交易更新）
    card_last_four = Column(String(4), nullable=True)  # 信用卡末四碼（顯示用）
    card_bin_code = Column(String(6), nullable=True)  # 信用卡 BIN Code
    card_type = Column(
        Integer, nullable=True
    )  # 卡別（1: VISA, 2: MasterCard, 3: JCB, 4: Union Pay, 5: AMEX）
    card_funding = Column(Integer, nullable=True)  # 卡種（0: 信用卡, 1: 金融卡, 2: 預付卡）
    card_issuer = Column(String(100), nullable=True)  # 發卡銀行
    card_country = Column(String(2), nullable=True)  # 發卡國家代碼
    card_saved_at = Column(DateTime(timezone=True), nullable=True)  # 卡片儲存時間

    # SSO / OAuth
    has_password = Column(Boolean, default=True)  # False for OAuth-only accounts

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
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
    # Organization hierarchy relationships
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
    # Credit packages
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
        """取得當前有效的訂閱週期

        優化說明：
        - 使用 SQL query 而非 Python 循環（避免 N+1 query）
        - 利用 (teacher_id, status) 複合索引
        - 只查詢需要的欄位
        """
        # Import here to avoid circular dependency
        from .subscription import SubscriptionPeriod

        # 從 session 取得當前 session（如果物件已 attached）
        session = Session.object_session(self)
        if not session:
            # Fallback: 使用原始方法（物件未 attached 時）
            for period in self.subscription_periods:
                if period.status == "active":
                    return period
            return None

        # 使用 SQL query（利用索引）
        stmt = (
            select(SubscriptionPeriod)
            .where(
                SubscriptionPeriod.teacher_id == self.id,
                SubscriptionPeriod.status == "active",
            )
            .order_by(SubscriptionPeriod.start_date.desc())  # 最新的 period 優先
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

        # No active subscription, check credit packages
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

        # 確保 end_date 有 timezone
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

        # Also allow if teacher has active credit packages with remaining points
        return any(pkg.points_remaining > 0 for pkg in self._active_credit_packages())

    def __repr__(self):
        return f"<Teacher {self.name} ({self.email})>"


class StudentIdentity(Base):
    """學生統一身分表

    整合同一位學生在不同機構/教師下創建的多個 Student 帳號，
    透過 Email 驗證識別為同一人。
    """

    __tablename__ = "student_identities"

    id = Column(Integer, primary_key=True, index=True)

    # 主帳號（學生登入時使用的帳號）
    primary_student_id = Column(Integer, ForeignKey("students.id"), nullable=True)

    # 已驗證的統一 Email（唯一）
    verified_email = Column(String(255), unique=True, nullable=False, index=True)

    # 身分識別資訊（用於 1Campus SSO，Phase 6）
    national_id_hash = Column(String(64), unique=True, nullable=True)  # SHA-256
    one_campus_student_id = Column(String(100), nullable=True, index=True)

    # 密碼統一管理
    password_hash = Column(String(255), nullable=False)
    password_changed = Column(Boolean, default=False)
    last_password_change = Column(DateTime(timezone=True), nullable=True)

    # 整合資訊
    merged_at = Column(DateTime(timezone=True), server_default=func.now())
    merge_source = Column(String(50), default="email_verification")  # email_verification / one_campus_sso / manual_merge

    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    primary_student = relationship(
        "Student",
        foreign_keys=[primary_student_id],
        post_update=True,
    )
    linked_students = relationship(
        "Student",
        back_populates="identity",
        foreign_keys="Student.identity_id",
    )

    def __repr__(self):
        return f"<StudentIdentity {self.verified_email}>"


class Student(Base):
    """學生模型"""

    __tablename__ = "students"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    student_number = Column(String(50))  # 學號（選填）
    email = Column(String(255), nullable=True, index=True)  # Email（可為空，可重複）
    password_hash = Column(String(255), nullable=False)  # 密碼雜湊
    birthdate = Column(Date, nullable=False)  # 生日（預設密碼來源）
    password_changed = Column(Boolean, default=False)  # 是否已更改密碼
    email_verified = Column(Boolean, default=False)  # email 是否已驗證
    email_verified_at = Column(DateTime(timezone=True))  # email 驗證時間
    email_verification_token = Column(String(100))  # email 驗證 token
    email_verification_sent_at = Column(DateTime(timezone=True))  # 最後發送驗證信時間
    parent_phone = Column(String(20))  # Phase 2
    avatar_url = Column(String(500))
    is_active = Column(Boolean, default=True)
    last_login = Column(DateTime(timezone=True))  # 最後登入時間

    # 身分整合欄位
    identity_id = Column(Integer, ForeignKey("student_identities.id"), nullable=True)
    is_primary_account = Column(Boolean, nullable=True)  # null = 未整合
    password_migrated_to_identity = Column(Boolean, default=False)

    # 學習目標設定
    target_wpm = Column(Integer, default=80)  # 目標每分鐘字數
    target_accuracy = Column(Float, default=0.8)  # 目標準確率

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    identity = relationship(
        "StudentIdentity",
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
