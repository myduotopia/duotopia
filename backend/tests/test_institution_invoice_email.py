"""Tests for services.institution_invoice_email + email attachment wiring
(issue #838 Phase C).

Service-layer only (no endpoint / permission system): subject/HTML shape,
the MIME attachment assembly, and that a send writes an append-only audit
row (and that a transport failure writes none). Endpoint auth/400 paths are
covered by test_institution_billing_endpoint.py (CI).
"""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from models import InstitutionInvoiceEmail, Organization
from services.email_service import EmailService
from services.institution_invoice_email import (
    build_email_html,
    build_subject,
    send_monthly_invoice_email,
)


def _billing(total=200, count=2, per=100, currency="TWD"):
    return {
        "per_student_price": per,
        "billable_student_count": count,
        "total_amount": total,
        "currency": currency,
        "students": [{"student_id": 1, "name": "王小明", "billable": True}],
    }


def _make_org(db, **over):
    base = dict(
        name="Acme",
        org_type="institution",
        per_student_price=100,
        contact_email="finance@acme.example",
        is_active=True,
    )
    base.update(over)
    org = Organization(**base)
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


# ---------- subject / html ----------


def test_build_subject_format():
    org = SimpleNamespace(id="a6101f83-0000", name="Acme", display_name="Acme 機構")
    assert build_subject(org, 2026, 6) == "[Duotopia] Acme 機構 2026 年 06 月請款單"


def test_build_email_html_contains_key_fields_and_escapes_name():
    org = SimpleNamespace(
        id="a6101f83-0000", name="Acme", display_name="Acme <機構> & Co"
    )
    html = build_email_html(org, 2026, 6, _billing(total=300, count=3))
    assert "2026 年 06 月" in html
    assert "TWD 300" in html
    assert "support@duotopia.com" in html
    # user-sourced name is HTML-escaped
    assert "&lt;機構&gt;" in html
    assert "&amp; Co" in html


# ---------- MIME attachment wiring ----------


def test_email_service_build_message_carries_attachment_and_cc():
    svc = EmailService()
    msg = svc._build_message(
        "to@x.com",
        "subj",
        "<p>hi</p>",
        cc=["c1@x.com", "c2@x.com"],
        attachments=[("invoice.pdf", b"%PDF-1.4 fake", "pdf")],
    )
    assert msg["Cc"] == "c1@x.com, c2@x.com"
    assert msg.get_content_subtype() == "mixed"
    filenames = [p.get_filename() for p in msg.walk() if p.get_filename()]
    assert "invoice.pdf" in filenames


def test_email_service_build_message_no_attachment_is_alternative():
    svc = EmailService()
    msg = svc._build_message("to@x.com", "s", "<p>hi</p>")
    assert msg.get_content_subtype() == "alternative"


# ---------- send_monthly_invoice_email (audit trail) ----------


def test_send_writes_audit_row_and_attaches_pdf(shared_test_session):
    org = _make_org(shared_test_session)
    mock_svc = Mock()
    mock_svc.send_email.return_value = True

    rec = send_monthly_invoice_email(
        shared_test_session,
        org,
        2026,
        6,
        _billing(),
        org.contact_email,
        cc=["cc@x.com"],
        sent_by_id=None,
        email_service=mock_svc,
    )

    assert rec.id is not None
    assert rec.recipient == "finance@acme.example"
    assert rec.cc == ["cc@x.com"]
    assert rec.sent_at is not None

    # A real PDF was attached (application/pdf) with a .pdf filename.
    kwargs = mock_svc.send_email.call_args.kwargs
    fname, content, subtype = kwargs["attachments"][0]
    assert fname.endswith(".pdf")
    assert subtype == "pdf"
    assert content[:4] == b"%PDF"


def test_repeat_send_appends_history(shared_test_session):
    org = _make_org(shared_test_session, contact_email="repeat@acme.example")
    mock_svc = Mock()
    mock_svc.send_email.return_value = True
    for _ in range(3):
        send_monthly_invoice_email(
            shared_test_session,
            org,
            2026,
            6,
            _billing(),
            org.contact_email,
            cc=None,
            sent_by_id=None,
            email_service=mock_svc,
        )
    count = (
        shared_test_session.query(InstitutionInvoiceEmail)
        .filter(
            InstitutionInvoiceEmail.organization_id == org.id,
            InstitutionInvoiceEmail.year == 2026,
            InstitutionInvoiceEmail.month == 6,
        )
        .count()
    )
    assert count == 3


def test_send_failure_writes_no_audit_row(shared_test_session):
    org = _make_org(shared_test_session, contact_email="fail@acme.example")
    mock_svc = Mock()
    mock_svc.send_email.return_value = False  # transport failure

    with pytest.raises(RuntimeError):
        send_monthly_invoice_email(
            shared_test_session,
            org,
            2026,
            6,
            _billing(),
            org.contact_email,
            cc=None,
            sent_by_id=None,
            email_service=mock_svc,
        )

    count = (
        shared_test_session.query(InstitutionInvoiceEmail)
        .filter(InstitutionInvoiceEmail.organization_id == org.id)
        .count()
    )
    assert count == 0
