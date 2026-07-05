"""Admin accounts-receivable endpoints for institution invoices
(issue #838 Phase D).

All routes are admin-only (`get_current_admin`). The amount is computed
server-side from `compute_monthly_billing` at lock time — the client never
supplies it.
"""

import uuid
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from models import InstitutionInvoice, Organization, Teacher
from models.institution_invoice import INVOICE_STATUSES
from routers.admin import get_current_admin
from services.institution_billing import compute_monthly_billing
from services.institution_invoice_ledger import apply_status_change, upsert_invoice


router = APIRouter(prefix="/api/admin", tags=["admin-institution-invoices"])


class CreateInvoiceRequest(BaseModel):
    organization_id: uuid.UUID
    year: int = Field(..., ge=1, le=9998)
    month: int = Field(..., ge=1, le=12)


class UpdateInvoiceRequest(BaseModel):
    status: str = Field(..., description="'paid' or 'cancelled'")
    payment_note: Optional[str] = Field(default=None, max_length=1000)


class InvoiceResponse(BaseModel):
    id: int
    organization_id: str
    organization_name: Optional[str]
    year: int
    month: int
    amount: int
    status: str
    due_date: Optional[date]
    paid_at: Optional[str]
    paid_by_admin_id: Optional[int]
    payment_note: Optional[str]
    created_at: Optional[str]


def _serialize(inv: InstitutionInvoice, org_name: Optional[str]) -> InvoiceResponse:
    return InvoiceResponse(
        id=inv.id,
        organization_id=str(inv.organization_id),
        organization_name=org_name,
        year=inv.year,
        month=inv.month,
        amount=inv.amount,
        status=inv.status,
        due_date=inv.due_date,
        paid_at=inv.paid_at.isoformat() if inv.paid_at else None,
        paid_by_admin_id=inv.paid_by_admin_id,
        payment_note=inv.payment_note,
        created_at=inv.created_at.isoformat() if inv.created_at else None,
    )


@router.post("/institution-invoices", response_model=InvoiceResponse)
async def create_institution_invoice(
    body: CreateInvoiceRequest,
    db: Session = Depends(get_db),
    _: Teacher = Depends(get_current_admin),
):
    """Lock the (org, year, month) accounts-receivable invoice. Amount is
    computed server-side and snapshotted. Idempotent: a repeat lock for the
    same period UPDATEs the pending row rather than creating a duplicate.
    """
    org = (
        db.query(Organization)
        .filter(
            Organization.id == body.organization_id,
            Organization.is_active.is_(True),
        )
        .first()
    )
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found"
        )

    try:
        billing = compute_monthly_billing(org, body.year, body.month, db)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    invoice, _created = upsert_invoice(
        db,
        org.id,
        body.year,
        body.month,
        billing["total_amount"],
    )
    return _serialize(invoice, org.display_name or org.name)


@router.get("/institution-invoices", response_model=List[InvoiceResponse])
async def list_institution_invoices(
    status_filter: Optional[str] = Query(
        default=None, alias="status", description="pending/paid/overdue/cancelled"
    ),
    overdue: Optional[bool] = Query(default=None),
    year: Optional[int] = Query(default=None, ge=1, le=9998),
    month: Optional[int] = Query(default=None, ge=1, le=12),
    organization_id: Optional[uuid.UUID] = Query(default=None),
    db: Session = Depends(get_db),
    _: Teacher = Depends(get_current_admin),
):
    """List invoices with optional filters, newest period first. `overdue=true`
    is shorthand for status='overdue'."""
    if status_filter and status_filter not in INVOICE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"status must be one of {INVOICE_STATUSES}",
        )
    q = db.query(InstitutionInvoice, Organization).join(
        Organization, Organization.id == InstitutionInvoice.organization_id
    )
    # `overdue=true` is a shorthand for status='overdue' and takes precedence
    # over `status` so passing both never AND-collapses to an empty result.
    if overdue:
        q = q.filter(InstitutionInvoice.status == "overdue")
    elif status_filter:
        q = q.filter(InstitutionInvoice.status == status_filter)
    if year is not None:
        q = q.filter(InstitutionInvoice.year == year)
    if month is not None:
        q = q.filter(InstitutionInvoice.month == month)
    if organization_id is not None:
        q = q.filter(InstitutionInvoice.organization_id == organization_id)

    rows = q.order_by(
        InstitutionInvoice.year.desc(),
        InstitutionInvoice.month.desc(),
        InstitutionInvoice.id.desc(),
    ).all()
    return [_serialize(inv, org.display_name or org.name) for inv, org in rows]


@router.patch("/institution-invoices/{invoice_id}", response_model=InvoiceResponse)
async def update_institution_invoice(
    invoice_id: int,
    body: UpdateInvoiceRequest,
    db: Session = Depends(get_db),
    current_admin: Teacher = Depends(get_current_admin),
):
    """Mark an invoice paid / cancelled (records admin id + timestamp for
    'paid'). 'pending'/'overdue' are system-managed and rejected with 400."""
    invoice = (
        db.query(InstitutionInvoice).filter(InstitutionInvoice.id == invoice_id).first()
    )
    if invoice is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found"
        )

    try:
        invoice = apply_status_change(
            db, invoice, body.status, current_admin.id, body.payment_note
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    org = (
        db.query(Organization)
        .filter(Organization.id == invoice.organization_id)
        .first()
    )
    return _serialize(invoice, (org.display_name or org.name) if org else None)
