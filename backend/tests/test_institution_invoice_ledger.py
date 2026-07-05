"""Tests for services.institution_invoice_ledger (issue #838 Phase D).

Service-layer: idempotent upsert (lock), mark paid/cancelled, status-change
routing, and the daily overdue sweep. Admin endpoint auth/filters are covered
by test_institution_invoices_endpoint.py (CI).
"""

from datetime import date, datetime, timedelta, timezone

import pytest

from auth import get_password_hash
from models import InstitutionInvoice, Organization, Teacher
from services.institution_invoice_ledger import (
    apply_status_change,
    default_due_date,
    mark_invoice_cancelled,
    mark_invoice_paid,
    mark_overdue_invoices,
    upsert_invoice,
)


def _org(db):
    o = Organization(
        name="Acme", org_type="institution", per_student_price=100, is_active=True
    )
    db.add(o)
    db.commit()
    db.refresh(o)
    return o


def _admin(db, email="ledger-admin@test.com"):
    t = Teacher(
        name="Admin", email=email, password_hash=get_password_hash("x"), is_admin=True
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


# ---------- upsert / lock ----------


def test_upsert_creates_then_is_idempotent(shared_test_session):
    org = _org(shared_test_session)
    inv1, created1 = upsert_invoice(shared_test_session, org.id, 2026, 6, 500)
    assert created1 is True
    assert inv1.status == "pending"
    assert inv1.amount == 500
    assert inv1.due_date is not None

    # Re-lock same period with a new amount → UPDATE, not a second row.
    inv2, created2 = upsert_invoice(shared_test_session, org.id, 2026, 6, 900)
    assert created2 is False
    assert inv2.id == inv1.id
    assert inv2.amount == 900
    count = (
        shared_test_session.query(InstitutionInvoice)
        .filter(
            InstitutionInvoice.organization_id == org.id,
            InstitutionInvoice.year == 2026,
            InstitutionInvoice.month == 6,
        )
        .count()
    )
    assert count == 1


def test_upsert_does_not_disturb_a_paid_invoice(shared_test_session):
    org = _org(shared_test_session)
    admin = _admin(shared_test_session)
    inv, _ = upsert_invoice(shared_test_session, org.id, 2026, 7, 500)
    mark_invoice_paid(shared_test_session, inv, admin.id, "paid via ATM")

    # A later re-lock must NOT revert a settled invoice or change its amount.
    inv2, created = upsert_invoice(shared_test_session, org.id, 2026, 7, 9999)
    assert created is False
    assert inv2.status == "paid"
    assert inv2.amount == 500


def test_upsert_survives_unique_race(shared_test_session):
    """If a concurrent insert wins the (org, year, month) UNIQUE key between
    our SELECT and INSERT, upsert must recover (re-lock the winner) instead
    of surfacing the IntegrityError as a 500."""
    org = _org(shared_test_session)
    # Simulate the race: a row already committed for this period, but our
    # in-flight call still "sees None" — emulate by pre-inserting then forcing
    # the insert path via a patched _find that returns None on the first look.
    from services import institution_invoice_ledger as mod

    pre = InstitutionInvoice(
        organization_id=org.id, year=2026, month=6, amount=100, status="pending"
    )
    shared_test_session.add(pre)
    shared_test_session.commit()

    calls = {"n": 0}
    real_query = shared_test_session.query

    def _fake_query(*a, **k):
        # First .first() in upsert returns None (pretend we didn't see the
        # winner); subsequent lookups behave normally so the recovery path
        # re-fetches the real row.
        q = real_query(*a, **k)
        if a and a[0] is InstitutionInvoice and calls["n"] == 0:
            calls["n"] += 1

            class _Wrap:
                def filter(self, *fa, **fk):
                    return self

                def first(self):
                    return None

            return _Wrap()
        return q

    import unittest.mock as mock

    with mock.patch.object(shared_test_session, "query", _fake_query):
        inv, created = upsert_invoice(shared_test_session, org.id, 2026, 6, 777)

    assert created is False
    assert inv.id == pre.id
    # recovered row re-locked to the new amount (was pending)
    assert inv.amount == 777


def test_default_due_date_is_30_days_out():
    now = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
    assert default_due_date(now) == date(2026, 7, 1)


# ---------- mark paid / cancelled ----------


def test_mark_paid_records_admin_and_time(shared_test_session):
    org = _org(shared_test_session)
    admin = _admin(shared_test_session, "paid-admin@test.com")
    inv, _ = upsert_invoice(shared_test_session, org.id, 2026, 8, 300)
    out = mark_invoice_paid(shared_test_session, inv, admin.id, "收訖")
    assert out.status == "paid"
    assert out.paid_at is not None
    assert out.paid_by_admin_id == admin.id
    assert out.payment_note == "收訖"


def test_mark_cancelled_leaves_paid_fields_null(shared_test_session):
    org = _org(shared_test_session)
    inv, _ = upsert_invoice(shared_test_session, org.id, 2026, 9, 300)
    out = mark_invoice_cancelled(shared_test_session, inv, "作廢")
    assert out.status == "cancelled"
    assert out.paid_at is None
    assert out.paid_by_admin_id is None
    assert out.payment_note == "作廢"


def test_apply_status_change_rejects_settled_invoice(shared_test_session):
    """Settled invoices are terminal: a paid/cancelled invoice cannot be
    transitioned again via the endpoint (would overwrite the payment audit
    stamp with no history)."""
    org = _org(shared_test_session)
    admin = _admin(shared_test_session, "settled-admin@test.com")

    paid, _ = upsert_invoice(shared_test_session, org.id, 2026, 11, 300)
    mark_invoice_paid(shared_test_session, paid, admin.id)
    with pytest.raises(ValueError, match="settled"):
        apply_status_change(shared_test_session, paid, "cancelled", admin.id)

    cancelled, _ = upsert_invoice(shared_test_session, org.id, 2026, 12, 300)
    mark_invoice_cancelled(shared_test_session, cancelled)
    with pytest.raises(ValueError, match="settled"):
        apply_status_change(shared_test_session, cancelled, "paid", admin.id)


def test_mark_cancelled_direct_clears_paid_fields(shared_test_session):
    """Defensive: the low-level mark_invoice_cancelled clears paid_* so the
    'paid_* set iff status=paid' invariant holds even if a paid invoice is
    cancelled through a direct service call (the endpoint blocks this, but
    the helper stays self-consistent)."""
    org = _org(shared_test_session)
    admin = _admin(shared_test_session, "direct-cancel-admin@test.com")
    inv, _ = upsert_invoice(shared_test_session, org.id, 2026, 11, 300)
    mark_invoice_paid(shared_test_session, inv, admin.id)
    out = mark_invoice_cancelled(shared_test_session, inv, "退團")
    assert out.status == "cancelled"
    assert out.paid_at is None
    assert out.paid_by_admin_id is None


def test_apply_status_change_rejects_unsupported(shared_test_session):
    org = _org(shared_test_session)
    admin = _admin(shared_test_session, "reject-admin@test.com")
    inv, _ = upsert_invoice(shared_test_session, org.id, 2026, 10, 300)
    with pytest.raises(ValueError):
        apply_status_change(shared_test_session, inv, "pending", admin.id)
    with pytest.raises(ValueError):
        apply_status_change(shared_test_session, inv, "banana", admin.id)


# ---------- overdue sweep ----------


def test_mark_overdue_flips_only_past_due_pending(shared_test_session):
    org = _org(shared_test_session)
    today = date(2026, 7, 15)
    # past-due pending → should flip
    past, _ = upsert_invoice(
        shared_test_session, org.id, 2026, 5, 100, due_date=date(2026, 7, 1)
    )
    # future-due pending → stays pending
    future, _ = upsert_invoice(
        shared_test_session, org.id, 2026, 6, 100, due_date=date(2026, 8, 1)
    )
    # past-due but already paid → untouched
    paid, _ = upsert_invoice(
        shared_test_session, org.id, 2026, 4, 100, due_date=date(2026, 6, 1)
    )
    admin = _admin(shared_test_session, "sweep-admin@test.com")
    mark_invoice_paid(shared_test_session, paid, admin.id)

    updated = mark_overdue_invoices(shared_test_session, today=today)
    assert updated == 1

    shared_test_session.refresh(past)
    shared_test_session.refresh(future)
    shared_test_session.refresh(paid)
    assert past.status == "overdue"
    assert future.status == "pending"
    assert paid.status == "paid"

    # Idempotent: a second run finds nothing new.
    assert mark_overdue_invoices(shared_test_session, today=today) == 0


def test_mark_overdue_ignores_null_due_date(shared_test_session):
    org = _org(shared_test_session)
    inv = InstitutionInvoice(
        organization_id=org.id, year=2026, month=3, amount=100, status="pending"
    )
    shared_test_session.add(inv)
    shared_test_session.commit()
    updated = mark_overdue_invoices(shared_test_session, today=date(2026, 12, 31))
    assert updated == 0
    shared_test_session.refresh(inv)
    assert inv.status == "pending"
