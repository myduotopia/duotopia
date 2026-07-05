"""Institution accounts-receivable ledger (issue #838 Phase D).

CRUD-side helpers for the ``institution_invoices`` table: idempotent
create/lock, mark paid/cancelled, and the daily overdue sweep. The amount is
snapshotted from ``compute_monthly_billing`` at lock time so a later change
to enrolment or per_student_price does not mutate an already-issued invoice.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from models import InstitutionInvoice
from models.institution_invoice import INVOICE_STATUSES


TAIPEI = ZoneInfo("Asia/Taipei")

# Default payment window: an invoice locked today is due this many days out.
DEFAULT_DUE_DAYS = 30


def default_due_date(now: Optional[datetime] = None) -> date:
    """Due date for a freshly locked invoice: Taipei-today + 30 days."""
    base = (now or datetime.now(timezone.utc)).astimezone(TAIPEI).date()
    return base + timedelta(days=DEFAULT_DUE_DAYS)


def upsert_invoice(
    db: Session,
    organization_id,
    year: int,
    month: int,
    amount: int,
    *,
    due_date: Optional[date] = None,
    now: Optional[datetime] = None,
) -> Tuple[InstitutionInvoice, bool]:
    """Idempotently create-or-refresh the (org, year, month) invoice.

    Returns (invoice, created). The UNIQUE(org, year, month) key guarantees a
    single row per period, so a repeat "lock" UPDATEs rather than INSERTs.

    Re-locking only refreshes the snapshot (amount + due_date) while the
    invoice is still ``pending`` — once it is paid / cancelled / overdue it is
    left untouched so a settled invoice is never silently reverted.
    """
    if due_date is None:
        due_date = default_due_date(now)

    existing = (
        db.query(InstitutionInvoice)
        .filter(
            InstitutionInvoice.organization_id == organization_id,
            InstitutionInvoice.year == year,
            InstitutionInvoice.month == month,
        )
        .first()
    )
    if existing is not None:
        if existing.status == "pending":
            existing.amount = amount
            existing.due_date = due_date
            db.commit()
            db.refresh(existing)
        return existing, False

    invoice = InstitutionInvoice(
        organization_id=organization_id,
        year=year,
        month=month,
        amount=amount,
        status="pending",
        due_date=due_date,
    )
    db.add(invoice)
    db.commit()
    db.refresh(invoice)
    return invoice, True


def mark_invoice_paid(
    db: Session,
    invoice: InstitutionInvoice,
    admin_id: int,
    payment_note: Optional[str] = None,
    *,
    now: Optional[datetime] = None,
) -> InstitutionInvoice:
    """Mark an invoice paid, stamping who/when (invariant: paid ⇒ paid_at set)."""
    invoice.status = "paid"
    invoice.paid_at = now or datetime.now(timezone.utc)
    invoice.paid_by_admin_id = admin_id
    if payment_note is not None:
        invoice.payment_note = payment_note
    db.commit()
    db.refresh(invoice)
    return invoice


def mark_invoice_cancelled(
    db: Session,
    invoice: InstitutionInvoice,
    payment_note: Optional[str] = None,
) -> InstitutionInvoice:
    """Cancel an invoice. paid_* stay NULL (never paid)."""
    invoice.status = "cancelled"
    if payment_note is not None:
        invoice.payment_note = payment_note
    db.commit()
    db.refresh(invoice)
    return invoice


def apply_status_change(
    db: Session,
    invoice: InstitutionInvoice,
    new_status: str,
    admin_id: int,
    payment_note: Optional[str] = None,
) -> InstitutionInvoice:
    """Route a PATCH status change to the right helper. Only 'paid' and
    'cancelled' are admin-settable; 'pending'/'overdue' are system-managed.
    Raises ValueError on an unsupported target status.
    """
    if new_status == "paid":
        return mark_invoice_paid(db, invoice, admin_id, payment_note)
    if new_status == "cancelled":
        return mark_invoice_cancelled(db, invoice, payment_note)
    raise ValueError(
        f"status must be one of ('paid', 'cancelled'); got {new_status!r}. "
        f"(valid lifecycle states: {INVOICE_STATUSES})"
    )


def mark_overdue_invoices(db: Session, today: Optional[date] = None) -> int:
    """Daily sweep: flip every still-``pending`` invoice whose due_date has
    passed to ``overdue``. Returns the number updated. Idempotent — a second
    run the same day finds nothing left pending-and-past-due.
    """
    if today is None:
        today = datetime.now(TAIPEI).date()
    updated = (
        db.query(InstitutionInvoice)
        .filter(
            InstitutionInvoice.status == "pending",
            InstitutionInvoice.due_date.isnot(None),
            InstitutionInvoice.due_date < today,
        )
        .update({InstitutionInvoice.status: "overdue"}, synchronize_session=False)
    )
    db.commit()
    return updated
