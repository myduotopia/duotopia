// Shared print HTML generation for sticky note views
// Used by both single-print (AssignmentStickyNote modal) and batch-print (ClassroomDetail)
import type { TFunction } from "i18next";

function escapeHtml(s: string | number | undefined | null): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Traffic light status config for print (matches TrafficLightDot in StudentStatusPanel)
export const STATUS_HEX: Record<
  string,
  { color: string; symbol?: string; dashed?: boolean; quarter?: boolean }
> = {
  NOT_STARTED: { color: "#F59E0B", dashed: true },
  IN_PROGRESS: { color: "#F59E0B", quarter: true },
  SUBMITTED: { color: "#EF4444" },
  RETURNED: { color: "#F59E0B", symbol: "✗" },
  RESUBMITTED: { color: "#22C55E" },
  GRADED: { color: "#22C55E", symbol: "✓" },
};

// Status labels for legend
const STATUS_LEGEND: { status: string; labelKey: string }[] = [
  {
    status: "NOT_STARTED",
    labelKey: "assignmentDetail.sheet.statusNotStarted",
  },
  {
    status: "IN_PROGRESS",
    labelKey: "assignmentDetail.sheet.statusInProgress",
  },
  { status: "SUBMITTED", labelKey: "assignmentDetail.sheet.statusSubmitted" },
  { status: "RETURNED", labelKey: "assignmentDetail.sheet.statusReturned" },
  {
    status: "RESUBMITTED",
    labelKey: "assignmentDetail.sheet.statusResubmitted",
  },
  { status: "GRADED", labelKey: "assignmentDetail.sheet.statusGraded" },
];

export interface PrintStudent {
  student_number: number;
  student_name: string;
  score?: number;
  is_interim_score?: boolean;
  status: string;
}

export interface PrintOptions {
  showNumber: boolean;
  showName: boolean;
  showScore: boolean;
}

/**
 * Generate an SVG string for the traffic light dot (for print HTML).
 */
function trafficLightSvg(status: string, size = 12): string {
  const r = size / 2;
  const cfg = STATUS_HEX[status] || STATUS_HEX.NOT_STARTED;

  if (cfg.dashed) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${r}" cy="${r}" r="${r - 1.5}" fill="none" stroke="${cfg.color}" stroke-width="1.5" stroke-dasharray="3 2"/></svg>`;
  }
  if (cfg.quarter) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${r}" cy="${r}" r="${r - 0.75}" fill="none" stroke="${cfg.color}" stroke-width="1.5"/>
      <path d="M${r},${r} L${r},0 A${r},${r} 0 0,1 ${size},${r} Z" fill="${cfg.color}"/>
    </svg>`;
  }
  if (cfg.symbol) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${r}" cy="${r}" r="${r}" fill="${cfg.color}"/>
      <text x="${r}" y="${r}" text-anchor="middle" dominant-baseline="central" fill="white" font-size="${size * 0.55}" font-weight="bold">${cfg.symbol}</text>
    </svg>`;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${r}" cy="${r}" r="${r}" fill="${cfg.color}"/></svg>`;
}

/**
 * Build the HTML for a single sticky note page.
 * Uses new traffic light style with white cards and square aspect ratio.
 */
export function buildStickyNotePageHtml(
  title: string,
  students: PrintStudent[],
  _statusCounts: Record<string, number>,
  options: PrintOptions,
  t: TFunction,
): string {
  const { showNumber, showName, showScore } = options;

  // Legend — 2-column grid
  const legendHtml = STATUS_LEGEND.map(({ status, labelKey }) => {
    return `<div style="display:flex;align-items:center;gap:6px">
      ${trafficLightSvg(status, 10)}
      <span>${t(labelKey, labelKey)}</span>
    </div>`;
  }).join("");

  // Student cards — white bg, square, traffic light dot
  const cardsHtml = students
    .map((student) => {
      const hasNumber = student.student_number > 0;
      // 已派發的學生一律顯示分數（同 StudentStatusPanel 規則）：
      //   null / 未完成 → 0；is_interim_score 加 "~"；unassigned 顯示 "-"。
      const hasScore = student.status !== "unassigned";
      const scoreValue = student.score ?? 0;
      const scoreText = `${student.is_interim_score ? "~" : ""}${Number(scoreValue).toFixed(0)}`;

      const parts: string[] = [];
      if (showNumber && hasNumber) {
        parts.push(
          `<div style="font-size:11px;color:#374151">${escapeHtml(student.student_number)}</div>`,
        );
      }
      if (showName) {
        parts.push(
          `<div style="font-size:11px;color:#6B7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">${escapeHtml(student.student_name)}</div>`,
        );
      }
      if (showScore) {
        parts.push(
          `<div style="font-size:16px;font-weight:bold;color:${hasScore ? "#1F2937" : "#D1D5DB"}">${hasScore ? escapeHtml(scoreText) : "-"}</div>`,
        );
      }

      return `<div style="position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6px;border-radius:8px;border:1px solid #e5e7eb;background:#ffffff;aspect-ratio:1/1;text-align:center;overflow:hidden">
        <span style="position:absolute;top:3px;right:3px">${trafficLightSvg(student.status, 10)}</span>
        ${parts.join("")}
      </div>`;
    })
    .join("");

  return `<div class="sticky-note">
  <h3>${escapeHtml(title)}</h3>
  <div class="card-grid">${cardsHtml}</div>
  <div class="legend">${legendHtml}</div>
</div>`;
}

/**
 * Open a print window with one or more sticky note pages.
 * Layout: 2 sticky notes per row on A4, like real sticky notes.
 */
export function openPrintWindow(pagesHtml: string[]): void {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  const allPages = pagesHtml.join("");
  // eslint-disable-next-line no-useless-escape
  const printScript = `<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();}}<\/script>`;

  printWindow.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Print</title>
<style>
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
  body {
    font-family: -apple-system, "Microsoft JhengHei", sans-serif;
    padding: 10mm;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 10mm;
    align-content: flex-start;
  }
  .sticky-note {
    width: calc(50% - 5mm);
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 12px;
    page-break-inside: avoid;
    box-sizing: border-box;
  }
  .sticky-note h3 {
    text-align: center;
    margin: 0 0 8px;
    font-size: 14px;
  }
  .card-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
    margin-bottom: 8px;
  }
  .legend {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 16px;
    font-size: 9px;
    color: #6b7280;
    padding-top: 6px;
    border-top: 1px solid #f3f4f6;
  }
  @media print {
    body { padding: 8mm; }
    .sticky-note { border-color: #d1d5db; }
  }
</style>
</head><body>
  ${allPages}
  ${printScript}
</body></html>`);
  printWindow.document.close();
}
