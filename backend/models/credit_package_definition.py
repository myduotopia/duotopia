"""
CreditPackageDefinition model - admin-editable price / points / bonus
overrides for the credit package catalog.

Package IDs are still defined as code constants in
`backend/config/plans.py::CREDIT_PACKAGES` (consumers reference them by
string `pkg-1000`, `pkg-5000`, ...). This table only overrides the numeric
attributes (price, points, bonus), the `is_active` flag, and the
`org_allowed` boolean (which replaces the legacy `ORG_ALLOWED_PACKAGES`
list).

The validity period stays a global constant
(`CREDIT_PACKAGE_VALIDITY_DAYS`); per-package validity is intentionally
out of scope for this iteration.

Do NOT confuse with `CreditPackage` (purchase history per teacher/org) in
`models/credit_package.py` — that table records actual purchases, this
table records the catalog definition.
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    Boolean,
    DateTime,
    ForeignKey,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class CreditPackageDefinition(Base):
    """點數包定義 - 由管理員可調整 points / bonus / price / is_active / org_allowed"""

    __tablename__ = "credit_package_definitions"

    id = Column(Integer, primary_key=True, index=True)

    # Matches the package_id strings used in code constants
    # (pkg-1000, pkg-2000, pkg-5000, pkg-10000, pkg-20000).
    package_id = Column(String(50), nullable=False, unique=True, index=True)

    # Base points granted. NULL means inherit config default.
    points = Column(Integer, nullable=True)

    # Bonus / free points on top of `points`.
    bonus = Column(Integer, nullable=True)

    # TWD price. NULL means inherit config default.
    price = Column(Integer, nullable=True)

    # Soft toggle. When false, package is hidden from the checkout flow
    # (existing purchases with this package_id continue to work).
    is_active = Column(Boolean, nullable=False, default=True)

    # Whether organizations can purchase this package. Replaces the legacy
    # `ORG_ALLOWED_PACKAGES` list constant.
    org_allowed = Column(Boolean, nullable=False, default=False)

    # Display order in admin UI / checkout list.
    display_order = Column(Integer, nullable=False, default=0)

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

    def __repr__(self):
        return (
            f"<CreditPackageDefinition package_id={self.package_id} "
            f"points={self.points} bonus={self.bonus} price={self.price} "
            f"active={self.is_active} org_allowed={self.org_allowed}>"
        )
