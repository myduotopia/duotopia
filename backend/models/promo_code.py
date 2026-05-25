"""
Promo Code models (issue #637) — referral tracking for the 特約合作方案.

Four tables form the data layer:

- ``PromoCode``        每位老師的推銷碼（個人預設碼 + admin 特約碼）
- ``PromoReferral``    被推薦人 ↔ 推薦人的綁定關係（一個被推薦人僅一筆）
- ``PromoRewardConfig`` admin 可調整的各事件獎勵點數
- ``PromoRewardEvent`` 已發放紀錄，靠 idempotency_key 防重複發放

PR 1 只建立 schema + 自動產生個人碼；獎勵發放與 API 在後續 PR。
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    CheckConstraint,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base
from .base import JSONType


class PromoCode(Base):
    """推銷碼本體。

    ``kind``：
    - ``personal``  每位老師註冊時自動產生一組，``expires_at`` 為 NULL（永久），
      一師只會有一筆（partial unique index 保證）。
    - ``affiliate`` admin 為特約老師額外建立，可設定到期日。
    """

    __tablename__ = "promo_codes"
    __table_args__ = (
        # 一師一個人碼；特約碼不受限。
        Index(
            "uq_promo_codes_teacher_personal",
            "teacher_id",
            unique=True,
            sqlite_where=text("kind = 'personal'"),
            postgresql_where=text("kind = 'personal'"),
        ),
        Index("ix_promo_codes_teacher_id", "teacher_id"),
        Index("ix_promo_codes_active_expires", "is_active", "expires_at"),
    )

    id = Column(Integer, primary_key=True, index=True)

    code = Column(String(16), nullable=False, unique=True, index=True)
    teacher_id = Column(
        Integer, ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False
    )

    kind = Column(String(16), nullable=False, default="personal")
    # NULL = 永久有效；有值 = 到期日
    expires_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    note = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Admin audit (mirrors CreditPackage pattern)
    admin_id = Column(
        Integer, ForeignKey("teachers.id", ondelete="SET NULL"), nullable=True
    )
    admin_reason = Column(Text, nullable=True)
    admin_metadata = Column(JSONType, nullable=True)

    teacher = relationship(
        "Teacher", foreign_keys=[teacher_id], back_populates="promo_codes"
    )
    admin = relationship("Teacher", foreign_keys=[admin_id])

    def __repr__(self):
        return (
            f"<PromoCode code={self.code} teacher={self.teacher_id} "
            f"kind={self.kind} active={self.is_active}>"
        )


class PromoReferral(Base):
    """被推薦人與推薦人的綁定關係。一個被推薦人最多綁定一次。"""

    __tablename__ = "promo_referrals"
    __table_args__ = (
        UniqueConstraint(
            "referred_teacher_id", name="uq_promo_referrals_referred_teacher"
        ),
        CheckConstraint(
            "referrer_teacher_id != referred_teacher_id",
            name="ck_promo_referrals_no_self_referral",
        ),
        Index("ix_promo_referrals_referrer", "referrer_teacher_id"),
        Index("ix_promo_referrals_promo_code", "promo_code"),
    )

    id = Column(Integer, primary_key=True, index=True)

    referrer_teacher_id = Column(
        Integer, ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False
    )
    referred_teacher_id = Column(
        Integer, ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False
    )

    # 註冊當下填入的 code（快照，避免日後 code 改動），加上軟參照。
    promo_code = Column(String(16), nullable=False)
    promo_code_id = Column(
        Integer, ForeignKey("promo_codes.id", ondelete="SET NULL"), nullable=True
    )

    signup_at = Column(DateTime(timezone=True), server_default=func.now())
    verified_at = Column(DateTime(timezone=True), nullable=True)

    # 「首次付費」獎勵（訂閱 or 點數包二擇一）是否已發。
    first_paid_event_consumed = Column(Boolean, nullable=False, default=False)
    # 被推薦人一次性 bonus 是否已發。
    referred_bonus_granted = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    referrer = relationship("Teacher", foreign_keys=[referrer_teacher_id])
    referred = relationship("Teacher", foreign_keys=[referred_teacher_id])
    promo_code_ref = relationship("PromoCode", foreign_keys=[promo_code_id])

    def __repr__(self):
        return (
            f"<PromoReferral referrer={self.referrer_teacher_id} "
            f"referred={self.referred_teacher_id} code={self.promo_code}>"
        )


class PromoRewardConfig(Base):
    """admin 可編輯的各事件獎勵點數設定（每個 trigger 一列）。"""

    __tablename__ = "promo_reward_configs"

    id = Column(Integer, primary_key=True, index=True)

    reward_key = Column(String(64), nullable=False, unique=True, index=True)
    points = Column(Integer, nullable=False)
    recipient = Column(String(16), nullable=False, default="referrer")
    is_active = Column(Boolean, nullable=False, default=True)

    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by_admin_id = Column(
        Integer, ForeignKey("teachers.id", ondelete="SET NULL"), nullable=True
    )

    updated_by = relationship("Teacher", foreign_keys=[updated_by_admin_id])

    def __repr__(self):
        return (
            f"<PromoRewardConfig key={self.reward_key} points={self.points} "
            f"recipient={self.recipient}>"
        )


class PromoRewardEvent(Base):
    """已發放點數紀錄。``idempotency_key`` unique 防止重複發放，也是報表來源。"""

    __tablename__ = "promo_reward_events"
    __table_args__ = (
        Index("ix_promo_reward_events_granted_to", "granted_to_teacher_id"),
        Index("ix_promo_reward_events_referral", "referral_id"),
    )

    id = Column(Integer, primary_key=True, index=True)

    referral_id = Column(
        Integer, ForeignKey("promo_referrals.id", ondelete="CASCADE"), nullable=False
    )
    reward_key = Column(String(64), nullable=False)
    # signup / subscription / credit_package
    trigger_type = Column(String(32), nullable=False)
    points = Column(Integer, nullable=False)
    granted_to_teacher_id = Column(
        Integer, ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False
    )
    # 發點所建立的 CreditPackage（PR 3 填）
    credit_package_id = Column(
        Integer, ForeignKey("credit_packages.id", ondelete="SET NULL"), nullable=True
    )

    idempotency_key = Column(String(128), nullable=False, unique=True, index=True)
    event_payload = Column(JSONType, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    referral = relationship("PromoReferral")

    def __repr__(self):
        return (
            f"<PromoRewardEvent key={self.reward_key} points={self.points} "
            f"to={self.granted_to_teacher_id}>"
        )
