"""
Credit Package model - one-time purchased point bundles with expiry
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    ForeignKey,
    Index,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
from .base import UUID, JSONType
import uuid


class CreditPackage(Base):
    """
    點數包 - 一次性購買的點數，有效期 1 年

    teacher_id 和 organization_id 二選一：
    - 個人包填 teacher_id（organization_id = null）
    - 機構包填 organization_id（teacher_id = null）
    """

    __tablename__ = "credit_packages"
    __table_args__ = (
        Index("ix_credit_packages_teacher_status", "teacher_id", "status"),
        Index("ix_credit_packages_teacher_expires", "teacher_id", "expires_at"),
        Index("ix_credit_packages_org_status", "organization_id", "status"),
        Index("ix_credit_packages_expires_at", "expires_at"),
    )

    id = Column(Integer, primary_key=True, index=True)

    # Owner: teacher OR organization (mutually exclusive)
    teacher_id = Column(
        Integer, ForeignKey("teachers.id", ondelete="CASCADE"), nullable=True
    )
    organization_id = Column(
        UUID, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True
    )

    # Package info
    package_id = Column(String, nullable=False)  # "pkg-1000", "pkg-5000", "trial-bonus"
    points_total = Column(Integer, nullable=False)  # includes bonus (5000+200=5200)
    points_used = Column(Integer, nullable=False, default=0)
    price_paid = Column(Integer, nullable=False)  # TWD, 0 for trial

    # Dates
    purchased_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(
        DateTime(timezone=True), nullable=False
    )  # purchased_at + 1 year

    # Status
    status = Column(
        String, nullable=False, default="active"
    )  # active / expired / refunded / migrated

    # Payment
    payment_id = Column(String, nullable=True)  # TapPay transaction ID

    # Source
    source = Column(
        String, nullable=False
    )  # "purchase" / "trial_bonus" / "admin_grant" / "org_purchase"

    # Admin audit (mirrors SubscriptionPeriod pattern). `admin_id` and
    # `admin_reason` record the most recent admin write (edit or refund);
    # `admin_metadata` JSONB accumulates the full change history.
    admin_id = Column(
        Integer, ForeignKey("teachers.id", ondelete="SET NULL"), nullable=True
    )
    admin_reason = Column(Text, nullable=True)
    admin_metadata = Column(JSONType, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    teacher = relationship(
        "Teacher", foreign_keys=[teacher_id], back_populates="credit_packages"
    )
    organization = relationship("Organization", back_populates="credit_packages")
    admin = relationship("Teacher", foreign_keys=[admin_id])

    @property
    def points_remaining(self) -> int:
        return max(0, self.points_total - self.points_used)

    def __repr__(self):
        owner = (
            f"teacher={self.teacher_id}"
            if self.teacher_id
            else f"org={self.organization_id}"
        )
        return (
            f"<CreditPackage {owner} "
            f"pkg={self.package_id} remaining={self.points_remaining}/{self.points_total}>"
        )
