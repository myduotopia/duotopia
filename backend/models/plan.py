"""
Plan model - subscription plan price/quota overrides editable by admin.

Plan names are still defined as code constants in `backend/config/plans.py`
(consumers import PLAN_TUTOR, PLAN_SCHOOL, etc. by name). This table only
overrides the numeric attributes (price, monthly quota, display order, active
flag) so admins can adjust them without a deploy.

Use `config.plans.get_plan_price(name)` and `get_plan_quota(name)` to read —
those helpers prefer the DB row and fall back to the config constants.
"""

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class Plan(Base):
    """訂閱方案 - 由管理員可調整價格／配額的設定"""

    __tablename__ = "plans"

    id = Column(Integer, primary_key=True, index=True)

    # Matches `plan_name` strings used in code constants (PLAN_TUTOR etc.)
    name = Column(String(100), nullable=False, unique=True, index=True)

    # Monetary price (TWD per month). NULL means inherit config default.
    price = Column(Integer, nullable=True)

    # Monthly quota of points granted on subscription start.
    quota = Column(Integer, nullable=True)

    # --- Group-buy plan fields (NULL for individual plans) ---
    # Number of teacher seats in the group (10 / 30 / 50).
    teacher_seats = Column(Integer, nullable=True)
    # Annual fee PER TEACHER (NT$), not the team total.
    # Team total = annual_fee * teacher_seats, computed at checkout.
    annual_fee = Column(Integer, nullable=True)
    # Top-up discount applied when buying point packages (e.g. 0.95 / 0.90 / 0.85).
    topup_discount = Column(Numeric(3, 2), nullable=True)

    # Display order in admin UI / checkout list.
    display_order = Column(Integer, nullable=False, default=0)

    # Soft toggle. When false, plan is hidden from checkout (but existing
    # subscriptions with this plan_name continue to work).
    is_active = Column(Boolean, nullable=False, default=True)

    # Audit
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by_admin_id = Column(
        Integer, ForeignKey("teachers.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    updated_by = relationship("Teacher", foreign_keys=[updated_by_admin_id])
    # Group-buy: schools bound to this plan (empty for individual plans).
    schools = relationship(
        "School", foreign_keys="School.plan_id", back_populates="plan"
    )

    __table_args__ = (
        CheckConstraint(
            "teacher_seats IS NULL OR teacher_seats > 0",
            name="ck_plans_teacher_seats_positive",
        ),
        CheckConstraint(
            "annual_fee IS NULL OR annual_fee > 0",
            name="ck_plans_annual_fee_positive",
        ),
        # Reject 0 (= 100% off → NT$0 charge → TapPay rejects). Real
        # group-buy discounts are 0.85–0.95; if a "free" plan is ever
        # needed, that's a separate comped-subscription flow, not a
        # discounted purchase.
        CheckConstraint(
            "topup_discount IS NULL OR (topup_discount > 0 AND topup_discount <= 1)",
            name="ck_plans_topup_discount_range",
        ),
    )

    def __repr__(self):
        return (
            f"<Plan name={self.name} price={self.price} "
            f"quota={self.quota} active={self.is_active}>"
        )
