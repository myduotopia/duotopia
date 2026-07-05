"""Tests for services.institution_invoice_pdf (issue #838 Phase B).

Covers the deterministic invoice number, env-driven bank info, and that the
PDF renders (valid %PDF bytes) across the populated / zero-student / mixed
billable cases. No DB or endpoint here — pure presentation layer.
"""

from datetime import date
from types import SimpleNamespace

from services.institution_invoice_pdf import (
    build_invoice_pdf,
    get_bank_info,
    invoice_number,
)


def _org(**over):
    base = dict(
        id="a6101f83-5f13-4a2b-9c7d-000000000000",
        name="Acme Institution",
        display_name="Acme 機構",
        tax_id="12345678",
        contact_email="finance@acme.example",
        address="台北市中正區測試路 1 號",
    )
    base.update(over)
    return SimpleNamespace(**base)


def _billing(students, per_price=100, currency="TWD"):
    billable = sum(1 for s in students if s["billable"])
    return {
        "org_id": "a6101f83-5f13-4a2b-9c7d-000000000000",
        "year": 2026,
        "month": 6,
        "per_student_price": per_price,
        "billable_student_count": billable,
        "total_amount": billable * per_price,
        "currency": currency,
        "students": students,
    }


# ---------- invoice_number ----------


def test_invoice_number_format_and_determinism():
    oid = "a6101f83-5f13-4a2b-9c7d-000000000000"
    n1 = invoice_number(oid, 2026, 6)
    n2 = invoice_number(oid, 2026, 6)
    assert n1 == "INV-a6101f83-202606"
    assert n1 == n2  # deterministic


def test_invoice_number_zero_pads_month():
    assert invoice_number("abcdef12-0000", 2026, 1).endswith("-202601")


# ---------- bank info ----------


def test_bank_info_defaults_are_placeholders(monkeypatch):
    monkeypatch.delenv("INVOICE_BANK_ACCOUNT", raising=False)
    info = get_bank_info()
    # Default must be an obvious placeholder, never a real account.
    assert "範例" in info["account"] or "0000" in info["account"]


def test_bank_info_reads_env(monkeypatch):
    monkeypatch.setenv("INVOICE_BANK_NAME", "玉山銀行 808")
    monkeypatch.setenv("INVOICE_BANK_ACCOUNT", "1234-5678")
    monkeypatch.setenv("INVOICE_BANK_HOLDER", "杜拓比亞股份有限公司")
    info = get_bank_info()
    assert info["bank_name"] == "玉山銀行 808"
    assert info["account"] == "1234-5678"
    assert info["holder"] == "杜拓比亞股份有限公司"


# ---------- build_invoice_pdf ----------


def test_pdf_renders_valid_bytes_with_students():
    students = [
        {"student_id": 1, "name": "王小明", "billable": True},
        {"student_id": 2, "name": "Jane Doe", "billable": False},
        {"student_id": 3, "name": "李四", "billable": True},
    ]
    data = build_invoice_pdf(
        _org(), 2026, 6, _billing(students), issued_date=date(2026, 7, 1)
    )
    assert isinstance(data, bytes)
    assert data[:4] == b"%PDF"
    assert len(data) > 1000


def test_pdf_renders_with_zero_students():
    data = build_invoice_pdf(
        _org(), 2026, 6, _billing([]), issued_date=date(2026, 7, 1)
    )
    assert data[:4] == b"%PDF"


def test_pdf_handles_xml_special_chars_in_free_text():
    """Regression: ReportLab Paragraph parses XML-like markup, so a literal
    &/</> in an org name, address, or student name must be escaped or PDF
    generation raises a parse error (500)."""
    org = _org(
        name="Fun & Learn <Institute>",
        display_name="Fun & Learn <機構>",
        address="3F, No. 5 <Building B> & Co.",
    )
    students = [
        {"student_id": 1, "name": "A & B <script>", "billable": True},
        {"student_id": 2, "name": "李 <四> & 王", "billable": False},
    ]
    data = build_invoice_pdf(
        org, 2026, 6, _billing(students), issued_date=date(2026, 7, 1)
    )
    assert data[:4] == b"%PDF"


def test_pdf_handles_missing_org_optional_fields():
    org = _org(display_name=None, tax_id=None, contact_email=None, address=None)
    data = build_invoice_pdf(
        org,
        2026,
        6,
        _billing([{"student_id": 1, "name": "王小明", "billable": True}]),
        issued_date=date(2026, 7, 1),
    )
    assert data[:4] == b"%PDF"


def test_pdf_uses_env_bank_account(monkeypatch):
    """The remittance account on the statement comes from env config so
    staging/prod can differ and tests never surface a real account."""
    monkeypatch.setenv("INVOICE_BANK_ACCOUNT", "SENTINEL-ACCT")
    # Sanity: the value the PDF will render is the env one, not a default.
    assert get_bank_info()["account"] == "SENTINEL-ACCT"
    data = build_invoice_pdf(
        _org(),
        2026,
        6,
        _billing([{"student_id": 1, "name": "王小明", "billable": True}]),
        issued_date=date(2026, 7, 1),
    )
    assert data[:4] == b"%PDF"
