"""Institution monthly invoice email (issue #838 Phase C).

Sends the monthly 請款單 to an institution's contact email with the Phase B
PDF attached, and records an append-only audit row in
``institution_invoice_emails``. Reuses the read-only billing figures and the
PDF builder; the only DB write is the audit row.
"""

import html as _html
from datetime import date

from sqlalchemy.orm import Session

from models import InstitutionInvoiceEmail
from services.institution_invoice_pdf import build_invoice_pdf, invoice_number


def build_subject(org, year: int, month: int) -> str:
    name = org.display_name or org.name or "機構"
    return f"[Duotopia] {name} {year} 年 {month:02d} 月請款單"


def build_email_html(org, year: int, month: int, billing: dict) -> str:
    """Plain, self-contained HTML body: 機構名 / 期間 / 金額 / 付款方式 /
    客服窗口. Org name is HTML-escaped (user-sourced free text)."""
    name = _html.escape(org.display_name or org.name or "機構")
    currency = billing.get("currency", "TWD")
    total = billing.get("total_amount", 0)
    count = billing.get("billable_student_count", 0)
    inv_no = invoice_number(org.id, year, month)
    support = "support@duotopia.com"
    return f"""\
<div style="font-family: sans-serif; font-size: 14px; color: #222; line-height: 1.6;">
  <p>{name} 您好，</p>
  <p>附件為貴機構 <b>{year} 年 {month:02d} 月</b>的請款單（請款單編號
     <b>{inv_no}</b>），敬請查收。</p>
  <table style="border-collapse: collapse; margin: 12px 0;">
    <tr><td style="padding: 4px 12px; color:#666;">請款期間</td>
        <td style="padding: 4px 12px;"><b>{year} 年 {month:02d} 月</b></td></tr>
    <tr><td style="padding: 4px 12px; color:#666;">計費人數</td>
        <td style="padding: 4px 12px;">{count} 位</td></tr>
    <tr><td style="padding: 4px 12px; color:#666;">應收總額</td>
        <td style="padding: 4px 12px; font-size:16px; color:#1a56db;">
          <b>{currency} {total:,}</b></td></tr>
  </table>
  <p>付款方式：請參閱附件請款單所載匯款資訊，並於備註填寫請款單編號以利對帳。</p>
  <p>如有任何問題，歡迎聯繫客服窗口：<a href="mailto:{support}">{support}</a>。</p>
  <p style="color:#888; font-size:12px;">
    本請款單為 Duotopia 內部請款憑證，非統一發票。</p>
</div>"""


def send_monthly_invoice_email(
    db: Session,
    org,
    year: int,
    month: int,
    billing: dict,
    recipient: str,
    *,
    cc: list | None,
    sent_by_id: int | None,
    email_service,
    issued_date: date | None = None,
) -> InstitutionInvoiceEmail:
    """Render the PDF, email it to ``recipient`` (with optional cc), and
    append an audit row. Raises RuntimeError if the email send fails so the
    caller does not record a phantom "sent" row.

    ``email_service`` is injected so the endpoint passes the shared singleton
    and tests pass a mock.
    """
    pdf_bytes = build_invoice_pdf(org, year, month, billing, issued_date=issued_date)
    inv_no = invoice_number(org.id, year, month)
    subject = build_subject(org, year, month)
    html_body = build_email_html(org, year, month, billing)
    filename = f"{inv_no}.pdf"

    ok = email_service.send_email(
        recipient,
        subject,
        html_body,
        cc=cc or None,
        attachments=[(filename, pdf_bytes, "pdf")],
    )
    if not ok:
        raise RuntimeError("email_send_failed")

    # Append-only audit row (no unique key — repeat sends accumulate history).
    record = InstitutionInvoiceEmail(
        organization_id=org.id,
        year=year,
        month=month,
        recipient=recipient,
        cc=cc or None,
        sent_by_admin_id=sent_by_id,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record
