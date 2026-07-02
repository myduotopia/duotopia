"""
Institution billing invoice models (issue #838).

Two tables backing the manual 請款 / 收款 workflow that follows the
read-only monthly billing query shipped in issue #768:

  - ``InstitutionInvoice``       — accounts-receivable ledger. One row per
    (organization, year, month); ``amount`` is snapshotted at 請款 time so a
    later change to ``per_student_price`` or enrolment does not mutate an
    already-issued invoice. The UNIQUE (organization_id, year, month) key is
    the idempotency anchor for the Phase D upsert endpoint.

    Cross-field invariant (enforced by the Phase D service layer, NOT yet at
    the DB): ``paid_at`` and ``paid_by_admin_id`` are set iff
    ``status == 'paid'``. The "mark paid" endpoint must stamp both together;
    marking any other status must leave them NULL. A hard DB CHECK is
    deliberately deferred until that endpoint exists so the constraint can be
    designed against real cancel/refund flows rather than guessed here.

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
from .base import UUID, JSONType


# Valid invoice lifecycle states. This is the single source of truth: the
# status CHECK constraint below is derived from it, and the Phase D PATCH
# endpoint will validate against this same set. Adding a state here
# propagates to the DB constraint automatically (a new migration is still
# required to alter the constraint on already-created tables).
INVOICE_STATUSES = ("pending", "paid", "overdue", "cancelled")

# Reasonable calendar-year guard for billing rows. Wide enough to never
# reject a real invoice, tight enough to catch a 0 / negative / 5-digit typo
# on the Phase D write path before that endpoint's own validation exists.
_MIN_INVOICE_YEAR = 2000
_MAX_INVOICE_YEAR = 2099


def _status_in_clause() -> str:
    """SQL ``status IN ('a', 'b', ...)`` body derived from INVOICE_STATUSES,
    so the CHECK constraint can never silently drift from the constant."""
    return "status IN (" + ", ".join(repr(s) for s in INVOICE_STATUSES) + ")"


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
    # paid_at / paid_by_admin_id: see the module-level invariant note — set
    # together with status='paid' by the Phase D endpoint.
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
    # server_default + a BEFORE UPDATE trigger (in the migration) keep this
    # fresh even for raw-SQL writers — notably the Phase D overdue cron that
    # bulk-UPDATEs status without going through the ORM's onupdate hook.
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "year",
            "month",
            name="uq_institution_invoices_org_year_month",
        ),
        CheckConstraint(
            _status_in_clause(),
            name="ck_institution_invoices_status_valid",
        ),
        CheckConstraint(
            "month BETWEEN 1 AND 12",
            name="ck_institution_invoices_month_valid",
        ),
        CheckConstraint(
            f"year BETWEEN {_MIN_INVOICE_YEAR} AND {_MAX_INVOICE_YEAR}",
            name="ck_institution_invoices_year_valid",
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
        # Guard the month formatter: SQLAlchemy exposes un-set NOT NULL
        # columns as None before flush, so `:02d` would TypeError on a
        # partially-built object — exactly when repr() is used for debugging.
        month = f"{self.month:02d}" if self.month is not None else "??"
        return (
            f"<InstitutionInvoice(id={self.id}, org={self.organization_id}, "
            f"{self.year}-{month}, {self.status}, amount={self.amount})>"
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
    # Optional CC list stored as a JSON array of email strings, matching the
    # project convention for list-type columns (JSONType → JSONB on Postgres,
    # JSON on SQLite). The send-email endpoint accepts cc?: string[] verbatim.
    cc = Column(JSONType, nullable=True)

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
        CheckConstraint(
            f"year BETWEEN {_MIN_INVOICE_YEAR} AND {_MAX_INVOICE_YEAR}",
            name="ck_institution_invoice_emails_year_valid",
        ),
        Index(
            "idx_institution_invoice_emails_lookup",
            "organization_id",
            "year",
            "month",
        ),
    )

    def __repr__(self):
        month = f"{self.month:02d}" if self.month is not None else "??"
        return (
            f"<InstitutionInvoiceEmail(id={self.id}, org={self.organization_id}, "
            f"{self.year}-{month}, to={self.recipient})>"
        )
