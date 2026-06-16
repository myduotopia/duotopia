"""
Admin Plans API - manage subscription plan price / quota overrides.

Plan names are still code constants (see `backend/config/plans.py`); this
endpoint only edits per-plan numeric values stored in the `plans` table.
Create/Delete are intentionally not exposed because consumers reference
plan names by string identifier.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from datetime import datetime

from database import get_db
from models import Plan, Teacher
from routers.admin import get_current_admin


router = APIRouter(prefix="/api/admin/plans", tags=["admin-plans"])


# ============ Schemas ============
class PlanResponse(BaseModel):
    id: int
    name: str
    price: Optional[int] = None
    quota: Optional[int] = None
    display_order: int
    is_active: bool
    updated_at: Optional[datetime] = None
    updated_by_admin_id: Optional[int] = None
    # issue #768 follow-up: expose group-buy fields so the admin UI can
    # render plan-type-specific labels and totals. teacher_seats not-NULL
    # is the canonical "this is a group-buy plan" signal.
    teacher_seats: Optional[int] = None
    annual_fee: Optional[int] = None  # PER teacher; total = annual_fee * teacher_seats
    topup_discount: Optional[float] = None

    class Config:
        from_attributes = True


class PlanUpdateRequest(BaseModel):
    price: Optional[int] = Field(default=None, ge=0)
    quota: Optional[int] = Field(default=None, ge=0)
    is_active: Optional[bool] = None
    display_order: Optional[int] = Field(default=None, ge=0)
    # issue #768 follow-up: group-buy-only economic levers. Admin can
    # adjust per-teacher annual_fee + topup_discount without re-seeding;
    # teacher_seats stays fixed (changing the seat count after the team
    # is open would orphan existing TeacherSchool bindings).
    annual_fee: Optional[int] = Field(default=None, gt=0)
    topup_discount: Optional[float] = Field(default=None, gt=0, le=1)


# ============ Endpoints ============
@router.get("", response_model=List[PlanResponse])
async def list_plans(
    db: Session = Depends(get_db),
    _: Teacher = Depends(get_current_admin),
) -> List[PlanResponse]:
    """List all plans, ordered by display_order then name."""
    rows = db.query(Plan).order_by(Plan.display_order.asc(), Plan.name.asc()).all()
    return [PlanResponse.model_validate(r) for r in rows]


@router.put("/{plan_name}", response_model=PlanResponse)
async def update_plan(
    plan_name: str,
    request: PlanUpdateRequest,
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
) -> PlanResponse:
    """Update price / quota / is_active / display_order for a plan."""
    row = db.query(Plan).filter(Plan.name == plan_name).first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Plan '{plan_name}' not found")

    payload = request.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No fields provided to update")

    # Guard: annual_fee/topup_discount are meaningful only for group-buy
    # plans (teacher_seats IS NOT NULL). Setting them on an individual plan
    # would be silently wrong (they wouldn't be read).
    is_group_buy = row.teacher_seats is not None
    if not is_group_buy:
        for field in ("annual_fee", "topup_discount"):
            if field in payload:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"{field} can only be set on group-buy plans "
                        f"(plan {plan_name!r} has no teacher_seats)."
                    ),
                )

    for field, value in payload.items():
        setattr(row, field, value)
    row.updated_by_admin_id = admin.id

    db.commit()
    db.refresh(row)
    return PlanResponse.model_validate(row)
