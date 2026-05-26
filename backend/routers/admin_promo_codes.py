"""
Admin Promo Code API (issue #637, PR 3).

Lets admins manage referral promo codes, tune the per-event reward point
values, and read a referral report. Frontend UI is a separate PR.

All endpoints require admin (`get_current_admin`).
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, cast, Integer
from sqlalchemy.orm import Session

from database import get_db
from models import (
    Teacher,
    PromoCode,
    PromoReferral,
    PromoRewardConfig,
    PromoRewardEvent,
)
from routers.admin import get_current_admin
from services.promo_code_service import generate_unique_code

router = APIRouter(prefix="/api/admin/promo-codes", tags=["admin-promo-codes"])


# ============ Schemas ============
class PromoCodeResponse(BaseModel):
    id: int
    code: str
    teacher_id: int
    kind: str
    expires_at: Optional[datetime] = None
    is_active: bool
    note: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class AffiliateCodeCreateRequest(BaseModel):
    teacher_id: int
    expires_at: Optional[datetime] = None  # None = permanent
    note: Optional[str] = Field(default=None, max_length=500)


class PromoCodeUpdateRequest(BaseModel):
    is_active: Optional[bool] = None
    expires_at: Optional[datetime] = None
    note: Optional[str] = Field(default=None, max_length=500)


class RewardConfigResponse(BaseModel):
    id: int
    reward_key: str
    points: int
    recipient: str
    is_active: bool

    class Config:
        from_attributes = True


class RewardConfigUpdateRequest(BaseModel):
    points: Optional[int] = Field(default=None, ge=0)
    is_active: Optional[bool] = None


class ReferralReportRow(BaseModel):
    referrer_teacher_id: int
    referral_count: int
    verified_count: int
    paid_count: int
    total_points_awarded: int


# ============ Promo code endpoints ============
@router.get("", response_model=List[PromoCodeResponse])
async def list_promo_codes(
    teacher_id: Optional[int] = None,
    kind: Optional[str] = None,
    db: Session = Depends(get_db),
    _: Teacher = Depends(get_current_admin),
) -> List[PromoCodeResponse]:
    """List promo codes, newest first. Optional filters by teacher / kind."""
    query = db.query(PromoCode)
    if teacher_id is not None:
        query = query.filter(PromoCode.teacher_id == teacher_id)
    if kind is not None:
        query = query.filter(PromoCode.kind == kind)
    rows = query.order_by(PromoCode.created_at.desc()).all()
    return [PromoCodeResponse.model_validate(r) for r in rows]


@router.post("", response_model=PromoCodeResponse, status_code=201)
async def create_affiliate_code(
    request: AffiliateCodeCreateRequest,
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
) -> PromoCodeResponse:
    """Create an affiliate promo code for a teacher (optional expiry)."""
    teacher = db.query(Teacher).filter(Teacher.id == request.teacher_id).first()
    if teacher is None:
        raise HTTPException(
            status_code=404, detail=f"Teacher {request.teacher_id} not found"
        )

    code = PromoCode(
        code=generate_unique_code(db),
        teacher_id=request.teacher_id,
        kind="affiliate",
        expires_at=request.expires_at,
        is_active=True,
        note=request.note,
        admin_id=admin.id,
        admin_reason="affiliate code created",
    )
    db.add(code)
    db.commit()
    db.refresh(code)
    return PromoCodeResponse.model_validate(code)


@router.patch("/{code_id}", response_model=PromoCodeResponse)
async def update_promo_code(
    code_id: int,
    request: PromoCodeUpdateRequest,
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
) -> PromoCodeResponse:
    """Activate / deactivate a code or change its expiry / note."""
    code = db.query(PromoCode).filter(PromoCode.id == code_id).first()
    if code is None:
        raise HTTPException(status_code=404, detail=f"Promo code {code_id} not found")

    payload = request.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No fields provided to update")

    for field, value in payload.items():
        setattr(code, field, value)
    code.admin_id = admin.id
    code.admin_reason = "admin update via /admin/promo-codes"
    db.commit()
    db.refresh(code)
    return PromoCodeResponse.model_validate(code)


# ============ Reward config endpoints ============
@router.get("/reward-configs", response_model=List[RewardConfigResponse])
async def list_reward_configs(
    db: Session = Depends(get_db),
    _: Teacher = Depends(get_current_admin),
) -> List[RewardConfigResponse]:
    """List the per-event reward point configs."""
    rows = db.query(PromoRewardConfig).order_by(PromoRewardConfig.id.asc()).all()
    return [RewardConfigResponse.model_validate(r) for r in rows]


@router.patch("/reward-configs/{reward_key}", response_model=RewardConfigResponse)
async def update_reward_config(
    reward_key: str,
    request: RewardConfigUpdateRequest,
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
) -> RewardConfigResponse:
    """Update the points / active flag for a reward key."""
    row = (
        db.query(PromoRewardConfig)
        .filter(PromoRewardConfig.reward_key == reward_key)
        .first()
    )
    if row is None:
        raise HTTPException(
            status_code=404, detail=f"Reward config '{reward_key}' not found"
        )

    payload = request.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No fields provided to update")

    for field, value in payload.items():
        setattr(row, field, value)
    row.updated_by_admin_id = admin.id
    db.commit()
    db.refresh(row)
    return RewardConfigResponse.model_validate(row)


# ============ Referral report ============
def build_referral_report(db: Session) -> List[ReferralReportRow]:
    """Per-referrer summary. Extracted from the endpoint so it can be unit
    tested without the admin TestClient (permission-system bootstrap)."""
    referral_rows = (
        db.query(
            PromoReferral.referrer_teacher_id.label("referrer"),
            func.count(PromoReferral.id).label("referral_count"),
            func.count(PromoReferral.verified_at).label("verified_count"),
            func.coalesce(
                func.sum(cast(PromoReferral.first_paid_event_consumed, Integer)),
                0,
            ).label("paid_count"),
        )
        .group_by(PromoReferral.referrer_teacher_id)
        .all()
    )

    # Points awarded per referrer (referrer is granted_to in referrer-recipient events).
    points_by_referrer = dict(
        db.query(
            PromoReferral.referrer_teacher_id,
            func.coalesce(func.sum(PromoRewardEvent.points), 0),
        )
        .join(PromoRewardEvent, PromoRewardEvent.referral_id == PromoReferral.id)
        .filter(
            PromoRewardEvent.granted_to_teacher_id == PromoReferral.referrer_teacher_id
        )
        .group_by(PromoReferral.referrer_teacher_id)
        .all()
    )

    return [
        ReferralReportRow(
            referrer_teacher_id=r.referrer,
            referral_count=r.referral_count,
            verified_count=r.verified_count,
            paid_count=int(r.paid_count or 0),
            total_points_awarded=int(points_by_referrer.get(r.referrer, 0)),
        )
        for r in referral_rows
    ]


@router.get("/report", response_model=List[ReferralReportRow])
async def referral_report(
    db: Session = Depends(get_db),
    _: Teacher = Depends(get_current_admin),
) -> List[ReferralReportRow]:
    """Per-referrer summary: referrals, verified, paid-converted, points awarded."""
    return build_referral_report(db)
