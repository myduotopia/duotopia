"""
Issue #838 — data-layer tests for the institution billing invoice tables.

Covers the two new tables shipped in the migration-only PR:
  - institution_invoices        (應收帳款 / accounts-receivable ledger)
  - institution_invoice_emails  (請款 email 寄送稽核紀錄)

No endpoint / PDF / email behaviour here (Phases B/C/D land after this
migration merges); this only proves schema, constraints, defaults, and the
unique (org, year, month) idempotency key the upsert flow will rely on.
"""

import pytest
from sqlalchemy.exc import IntegrityError

from models import (
    Teacher,
    Organization,
    InstitutionInvoice,
    InstitutionInvoiceEmail,
)


def _make_org(db):
    o = Organization(
        name="Acme",
        org_type="institution",
        per_student_price=100,
        is_active=True,
    )
    db.add(o)
    db.commit()
    db.refresh(o)
    return o


def _make_admin(db, email="invoice-admin@test.com"):
    t = Teacher(name="Admin", email=email, password_hash="x", is_admin=True)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


# ---------------------------------------------------- institution_invoices


def test_invoice_defaults_status_pending(test_db_session):
    org = _make_org(test_db_session)
    inv = InstitutionInvoice(organization_id=org.id, year=2026, month=6, amount=500)
    test_db_session.add(inv)
    test_db_session.commit()
    test_db_session.refresh(inv)
    assert inv.status == "pending"
    assert inv.id is not None
    assert inv.created_at is not None
    assert inv.paid_at is None
    assert inv.paid_by_admin_id is None


def test_invoice_unique_org_year_month(test_db_session):
    """The (org, year, month) key is the idempotency anchor for the
    Phase D upsert — a second row for the same period must be rejected."""
    org = _make_org(test_db_session)
    test_db_session.add(
        InstitutionInvoice(organization_id=org.id, year=2026, month=6, amount=500)
    )
    test_db_session.commit()
    test_db_session.add(
        InstitutionInvoice(organization_id=org.id, year=2026, month=6, amount=999)
    )
    with pytest.raises(IntegrityError):
        test_db_session.commit()
    test_db_session.rollback()


def test_invoice_rejects_invalid_status(test_db_session):
    org = _make_org(test_db_session)
    test_db_session.add(
        InstitutionInvoice(
            organization_id=org.id, year=2026, month=7, amount=1, status="banana"
        )
    )
    with pytest.raises(IntegrityError):
        test_db_session.commit()
    test_db_session.rollback()


def test_invoice_rejects_bad_month(test_db_session):
    org = _make_org(test_db_session)
    test_db_session.add(
        InstitutionInvoice(organization_id=org.id, year=2026, month=13, amount=1)
    )
    with pytest.raises(IntegrityError):
        test_db_session.commit()
    test_db_session.rollback()


def test_invoice_rejects_negative_amount(test_db_session):
    org = _make_org(test_db_session)
    test_db_session.add(
        InstitutionInvoice(organization_id=org.id, year=2026, month=8, amount=-1)
    )
    with pytest.raises(IntegrityError):
        test_db_session.commit()
    test_db_session.rollback()


def test_invoice_records_paid_fields(test_db_session):
    org = _make_org(test_db_session)
    admin = _make_admin(test_db_session)
    inv = InstitutionInvoice(
        organization_id=org.id,
        year=2026,
        month=9,
        amount=300,
        status="paid",
        paid_by_admin_id=admin.id,
        payment_note="ATM 匯款 末五碼 12345",
    )
    test_db_session.add(inv)
    test_db_session.commit()
    test_db_session.refresh(inv)
    assert inv.status == "paid"
    assert inv.paid_by_admin_id == admin.id
    assert inv.payment_note == "ATM 匯款 末五碼 12345"


# ----------------------------------------------- institution_invoice_emails


def test_email_audit_row_inserts(test_db_session):
    org = _make_org(test_db_session)
    admin = _make_admin(test_db_session, "audit-admin@test.com")
    rec = InstitutionInvoiceEmail(
        organization_id=org.id,
        year=2026,
        month=6,
        recipient="finance@org.com",
        sent_by_admin_id=admin.id,
    )
    test_db_session.add(rec)
    test_db_session.commit()
    test_db_session.refresh(rec)
    assert rec.id is not None
    assert rec.sent_at is not None
    assert rec.recipient == "finance@org.com"


def test_email_audit_allows_repeat_sends(test_db_session):
    """Resending the same month must append history, not collide on a
    unique key — there is intentionally NO unique constraint here."""
    org = _make_org(test_db_session)
    for _ in range(3):
        test_db_session.add(
            InstitutionInvoiceEmail(
                organization_id=org.id, year=2026, month=6, recipient="f@org.com"
            )
        )
        test_db_session.commit()
    count = (
        test_db_session.query(InstitutionInvoiceEmail)
        .filter_by(organization_id=org.id, year=2026, month=6)
        .count()
    )
    assert count == 3


def test_email_audit_rejects_bad_month(test_db_session):
    org = _make_org(test_db_session)
    test_db_session.add(
        InstitutionInvoiceEmail(
            organization_id=org.id, year=2026, month=0, recipient="f@org.com"
        )
    )
    with pytest.raises(IntegrityError):
        test_db_session.commit()
    test_db_session.rollback()
