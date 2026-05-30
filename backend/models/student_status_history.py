"""Student status-change history (issue #768).

Records every active/inactive transition for a student so institution
per-student monthly billing can compute headcount over a billing period
(active days per student x organizations.per_student_price).

Append-only audit trail — never mutated in place.
"""

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.sql import func
from database import Base
from .base import UUID


class StudentStatusHistory(Base):
    __tablename__ = "student_status_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(
        Integer,
        ForeignKey("students.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # SET NULL (not CASCADE): a school delete must not wipe billing-audit rows.
    school_id = Column(
        UUID,
        ForeignKey("schools.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # 'active' / 'inactive'
    status = Column(String(20), nullable=False)

    changed_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    changed_by = Column(
        Integer, ForeignKey("teachers.id", ondelete="SET NULL"), nullable=True
    )
    note = Column(Text, nullable=True)

    __table_args__ = (
        Index(
            "ix_student_status_history_student_changed",
            "student_id",
            "changed_at",
        ),
        CheckConstraint(
            "status IN ('active', 'inactive')",
            name="ck_student_status_history_status_valid",
        ),
    )

    def __repr__(self):
        return (
            f"<StudentStatusHistory(student={self.student_id}, "
            f"status={self.status}, at={self.changed_at})>"
        )
