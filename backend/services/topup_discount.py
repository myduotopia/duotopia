"""Group-buy top-up discount lookup for credit-package purchases (issue #768).

Resolves a teacher to the best (lowest) `plans.topup_discount` across every
active group-buy school binding the teacher has. Returns None when the teacher
is not in any group-buy school, in which case the purchase pays full price.
"""

from decimal import Decimal
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import GroupBuyMember, GroupBuyTeam, Plan, Teacher


def get_teacher_topup_discount(teacher: Teacher, db: Session) -> Optional[Decimal]:
    """Return MIN(topup_discount) across the teacher's active group-buy teams,
    or None if the teacher has no group-buy binding.

    issue #862 read-switch：改讀新表 group_buy_members → group_buy_teams → Plan
    （取代舊 TeacherSchool → School → Plan join），與其餘團購讀取路徑一致，讓折扣
    在最後停舊寫後仍正確。語意對齊舊版：只看 active 綁定（member + team is_active），
    不看 subscription_end（行為保持）。

    Detection of "group-buy plan" is by `Plan.teacher_seats IS NOT NULL` —
    matches `_guard_group_buy` in config/plans.py. Filtering only on
    `Plan.topup_discount IS NOT NULL` would silently apply discounts to
    individual plans if an admin sets a topup_discount value on a Tutor
    plan (the CHECK constraint doesn't forbid that combination).
    """
    raw = (
        db.query(func.min(Plan.topup_discount))
        .join(GroupBuyTeam, GroupBuyTeam.plan_id == Plan.id)
        .join(GroupBuyMember, GroupBuyMember.team_id == GroupBuyTeam.id)
        .filter(
            GroupBuyMember.teacher_id == teacher.id,
            GroupBuyMember.is_active.is_(True),
            GroupBuyTeam.is_active.is_(True),
            Plan.is_active.is_(True),
            Plan.teacher_seats.isnot(None),  # canonical group-buy signal
            Plan.topup_discount.isnot(None),
        )
        .scalar()
    )
    # Defensive cast: Postgres returns Decimal, but SQLite test path may
    # return float. Stay in Decimal so downstream financial math (in
    # credit_packages.py) keeps its precision guarantees.
    return None if raw is None else Decimal(str(raw))
