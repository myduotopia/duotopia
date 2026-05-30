"""Group-buy top-up discount lookup for credit-package purchases (issue #768).

Resolves a teacher to the best (lowest) `plans.topup_discount` across every
active group-buy school binding the teacher has. Returns None when the teacher
is not in any group-buy school, in which case the purchase pays full price.
"""

from decimal import Decimal
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import Plan, School, Teacher, TeacherSchool


def get_teacher_topup_discount(teacher: Teacher, db: Session) -> Optional[Decimal]:
    """Return MIN(topup_discount) across the teacher's active group-buy schools,
    or None if the teacher has no group-buy binding."""
    return (
        db.query(func.min(Plan.topup_discount))
        .join(School, School.plan_id == Plan.id)
        .join(TeacherSchool, TeacherSchool.school_id == School.id)
        .filter(
            TeacherSchool.teacher_id == teacher.id,
            TeacherSchool.is_active.is_(True),
            School.is_active.is_(True),
            Plan.is_active.is_(True),
            Plan.topup_discount.isnot(None),
        )
        .scalar()
    )
