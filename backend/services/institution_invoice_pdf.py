"""Institution monthly invoice PDF generation (issue #838 Phase B).

Renders a 請款單 (internal billing statement — NOT a 統一發票) for an
institution org's monthly per-head billing. Reuses the read-only figures
from ``services.institution_billing.compute_monthly_billing``; this module
is presentation only and performs no DB writes.

Chinese text is embedded via ReportLab's built-in ``STSong-Light`` CID font,
so no TTF file needs to be shipped and both Chinese and English render
correctly.
"""

import os
from datetime import date, datetime
from io import BytesIO
from zoneinfo import ZoneInfo

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


TAIPEI = ZoneInfo("Asia/Taipei")

# ReportLab's built-in Adobe CID font for Simplified/Traditional Chinese.
# Registering it (idempotently) lets us embed CJK glyphs without bundling a
# TTF. The same font name is used for every style below.
_CJK_FONT = "STSong-Light"
_font_registered = False


def _ensure_font() -> None:
    global _font_registered
    if not _font_registered:
        pdfmetrics.registerFont(UnicodeCIDFont(_CJK_FONT))
        _font_registered = True


def invoice_number(org_id, year: int, month: int) -> str:
    """Deterministic 請款單編號: ``INV-{org_id 前 8 碼}-{YYYYMM}``.

    Same (org, year, month) → identical number on every download, so the
    statement can be referenced consistently. Uses the first 8 chars of the
    org UUID string (its first hex block).
    """
    short = str(org_id)[:8]
    return f"INV-{short}-{year:04d}{month:02d}"


def get_bank_info() -> dict:
    """Remittance account shown on the statement, overridable per environment
    via env vars so staging/prod use different accounts and tests never show
    a real one. Defaults are obvious placeholders (never a real account).
    """
    return {
        "bank_name": os.getenv("INVOICE_BANK_NAME", "（範例）測試銀行 001"),
        "account": os.getenv("INVOICE_BANK_ACCOUNT", "0000-0000-0000-0000（範例）"),
        "holder": os.getenv("INVOICE_BANK_HOLDER", "Duotopia（範例收款戶名）"),
    }


def _fmt_amount(amount: int, currency: str) -> str:
    return f"{currency} {amount:,}"


def build_invoice_pdf(
    org,
    year: int,
    month: int,
    billing: dict,
    *,
    issued_date: date | None = None,
) -> bytes:
    """Render the monthly 請款單 PDF and return its bytes.

    ``org`` is duck-typed: it must expose ``id``, ``name``, ``display_name``,
    ``tax_id``, ``contact_email`` and ``address``. ``billing`` is the dict
    returned by ``compute_monthly_billing`` (keys: per_student_price,
    billable_student_count, total_amount, currency, students[]).

    ``issued_date`` defaults to today in Taipei; passing it fixed makes the
    output reproducible for tests.
    """
    _ensure_font()
    if issued_date is None:
        issued_date = datetime.now(TAIPEI).date()

    currency = billing.get("currency", "TWD")
    per_price = billing.get("per_student_price", 0)
    students = billing.get("students", [])
    total_amount = billing.get("total_amount", 0)
    inv_no = invoice_number(org.id, year, month)
    bank = get_bank_info()

    # ---- styles ----
    base = getSampleStyleSheet()
    normal = ParagraphStyle(
        "cjk", parent=base["Normal"], fontName=_CJK_FONT, fontSize=10, leading=15
    )
    title = ParagraphStyle(
        "cjkTitle",
        parent=base["Title"],
        fontName=_CJK_FONT,
        fontSize=20,
        leading=26,
    )
    right = ParagraphStyle("cjkRight", parent=normal, alignment=TA_RIGHT)
    total_style = ParagraphStyle(
        "cjkTotal", parent=normal, fontSize=16, leading=22, alignment=TA_RIGHT
    )
    cell = ParagraphStyle("cjkCell", parent=normal, fontSize=9, leading=12)
    cell_c = ParagraphStyle("cjkCellC", parent=cell, alignment=TA_CENTER)

    org_display = org.display_name or org.name or ""

    story = []
    story.append(Paragraph("Duotopia 請款單", title))
    story.append(Paragraph("Institution Monthly Billing Statement", right))
    story.append(Spacer(1, 6 * mm))

    # ---- header: invoice meta + org info (two columns) ----
    meta_lines = [
        f"請款單編號 Invoice No.：{inv_no}",
        f"開立日期 Issued：{issued_date.isoformat()}",
        f"請款期間 Period：{year} 年 {month:02d} 月",
    ]
    org_lines = [
        f"機構名稱：{org_display}",
        f"統一編號：{org.tax_id or '—'}",
        f"聯絡 Email：{org.contact_email or '—'}",
        f"地址：{org.address or '—'}",
    ]
    header_tbl = Table(
        [
            [
                Paragraph("<br/>".join(meta_lines), normal),
                Paragraph("<br/>".join(org_lines), normal),
            ]
        ],
        colWidths=[85 * mm, 85 * mm],
    )
    header_tbl.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.grey),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(header_tbl)
    story.append(Spacer(1, 6 * mm))

    # ---- line-item table ----
    header_row = [
        Paragraph("學生 ID", cell_c),
        Paragraph("姓名", cell_c),
        Paragraph("是否計費", cell_c),
        Paragraph("單價", cell_c),
    ]
    rows = [header_row]
    if students:
        for s in students:
            billable = bool(s.get("billable"))
            unit = _fmt_amount(per_price, currency) if billable else "—"
            rows.append(
                [
                    Paragraph(str(s.get("student_id", "")), cell_c),
                    Paragraph(str(s.get("name", "")), cell),
                    Paragraph("是" if billable else "否", cell_c),
                    Paragraph(unit, cell_c),
                ]
            )
    else:
        rows.append([Paragraph("（本月無學生資料）", cell_c), "", "", ""])

    item_tbl = Table(
        rows,
        colWidths=[30 * mm, 70 * mm, 30 * mm, 40 * mm],
        repeatRows=1,
    )
    item_style = [
        ("FONTNAME", (0, 0), (-1, -1), _CJK_FONT),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f0f0")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if not students:
        item_style.append(("SPAN", (0, 1), (-1, 1)))
    item_tbl.setStyle(TableStyle(item_style))
    story.append(item_tbl)
    story.append(Spacer(1, 4 * mm))

    # ---- totals ----
    story.append(
        Paragraph(
            f"計費人數 Billable：{billing.get('billable_student_count', 0)} 位"
            f"　×　單價 {_fmt_amount(per_price, currency)}",
            right,
        )
    )
    story.append(
        Paragraph(
            f"<b>應收總額 Total Due：{_fmt_amount(total_amount, currency)}</b>",
            total_style,
        )
    )
    story.append(Spacer(1, 8 * mm))

    # ---- remittance + notes ----
    bank_lines = [
        "匯款資訊 Remittance",
        f"銀行 Bank：{bank['bank_name']}",
        f"帳號 Account：{bank['account']}",
        f"戶名 Account Holder：{bank['holder']}",
    ]
    story.append(Paragraph("<br/>".join(bank_lines), normal))
    story.append(Spacer(1, 4 * mm))
    story.append(
        Paragraph(
            "注意事項：本請款單為 Duotopia 內部請款憑證，非統一發票。"
            "如需統一發票請另行聯繫。請於收到後 30 日內完成匯款，"
            "並於備註填寫請款單編號以利對帳。",
            normal,
        )
    )

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=f"{inv_no} {org_display}",
    )
    doc.build(story)
    return buf.getvalue()
