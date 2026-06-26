"""
Institution billing invoice models (issue #838).

Two tables backing the manual 請款 / 收款 workflow that follows the
read-only monthly billing query shipped in issue #768:

  - ``InstitutionInvoice``       — accounts-receivable ledger. One row per
    (organization, year, month); ``amount`` is snapshotted at 請款 time so a
    later change to ``per_student_price`` or enrolment does not mutate an
    already-issued invoice. The UNIQUE (organization_id, year, month) key is
    the idempotency anchor for the Phase D upsert endpoint.

  - ``InstitutionInvoiceEmail``  — append-only audit trail of 請款 emails
    sent. Deliberately has NO unique key: resending the same month must be
    recorded as a new row, never overwrite history.

This module is the data layer only — the PDF (Phase B), email send
(Phase C) and AR-management endpoints + overdue cron (Phase D) land in
follow-up PRs once this migration is merged to staging.
"""

from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.sql import func

from database import Base
from .base import UUID


# Valid invoice lifecycle states. Kept in sync with the CHECK constraint
# below and the migration; the Phase D PATCH endpoint will validate against
# this same set.
INVOICE_STATUSES = ("pending", "paid", "overdue", "cancelled")


class InstitutionInvoice(Base):
    """機構應收帳款 (accounts-receivable ledger)."""

    __tablename__ = "institution_invoices"

    id = Column(Integer, primary_key=True)

    organization_id = Column(
        UUID,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)

    # Amount (NT$) snapshotted at 請款 time — intentionally NOT recomputed
    # from per_student_price on read.
    amount = Column(Integer, nullable=False)

    status = Column(
        String(20), nullable=False, default="pending", server_default="pending"
    )

    due_date = Column(Date, nullable=True)
    paid_at = Column(DateTime(timezone=True), nullable=True)
    paid_by_admin_id = Column(
        Integer,
        ForeignKey("teachers.id", ondelete="SET NULL"),
        nullable=True,
    )
    payment_note = Column(Text, nullable=True)

    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "year",
            "month",
            name="uq_institution_invoices_org_year_month",
        ),
        CheckConstraint(
            "status IN ('pending', 'paid', 'overdue', 'cancelled')",
            name="ck_institution_invoices_status_valid",
        ),
        CheckConstraint(
            "month BETWEEN 1 AND 12",
            name="ck_institution_invoices_month_valid",
        ),
        CheckConstraint(
            "amount >= 0",
            name="ck_institution_invoices_amount_nonneg",
        ),
        Index("idx_institution_invoices_status", "status"),
        Index("idx_institution_invoices_org", "organization_id"),
        Index("idx_institution_invoices_due_date", "due_date"),
    )

    def __repr__(self):
        return (
            f"<InstitutionInvoice(id={self.id}, org={self.organization_id}, "
            f"{self.year}-{self.month:02d}, {self.status}, amount={self.amount})>"
        )


class InstitutionInvoiceEmail(Base):
    """請款 email 寄送稽核紀錄 (append-only)."""

    __tablename__ = "institution_invoice_emails"

    id = Column(Integer, primary_key=True)

    organization_id = Column(
        UUID,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)

    recipient = Column(String(200), nullable=False)
    # Optional CC list, stored as a comma-separated string (the send-email
    # endpoint accepts cc?: string[] and joins it).
    cc = Column(Text, nullable=True)

    sent_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sent_by_admin_id = Column(
        Integer,
        ForeignKey("teachers.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            "month BETWEEN 1 AND 12",
            name="ck_institution_invoice_emails_month_valid",
        ),
        Index(
            "idx_institution_invoice_emails_lookup",
            "organization_id",
            "year",
            "month",
        ),
    )

    def __repr__(self):
        return (
            f"<InstitutionInvoiceEmail(id={self.id}, org={self.organization_id}, "
            f"{self.year}-{self.month:02d}, to={self.recipient})>"
        )
