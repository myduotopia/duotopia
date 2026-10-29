/**
 * 上傳題本核對畫面（#1112 C4b）的畫面模型：純函式，把整份匯入（`ExamImportDetail`）整理成
 * 「依原卷頁碼排列的頁＋還沒存的題目卡」與題號導覽的每一格。
 *
 * - 已存進題庫的卡（`cardIsSaved`）不顯示。
 * - 每題的狀態（`ReviewIssue`，設計文件第五節「題號導覽」、cold-read B4）：
 *   - `failed` 處理失敗（整張卡失敗＝題組每一格都紅；單一小題失敗只標那一格）
 *   - `missing` 缺答案（只標那一題）
 *   - `duplicate` 你的題庫（個人或機構）已有這題／`sameStem` 題目文字與題庫某題相同（整組同色）
 *   - `importDuplicate` 這份題本裡已有相同的題目（老師自己刪）
 *   - `saveFailed` 上次「全部儲存」被退回的其他原因（克漏字空格對不上、驗證錯誤）
 *   - 還沒處理完的頁：每頁一格 `processing`（灰虛線）
 * - 「需注意」＝缺答案、失敗、這份題本內重複、儲存被退回（題庫已有的會自動略過，不算需注意，A2）。
 * - 格子標籤＝原卷題號；沒有就用流水號（B4）。
 */
import {
  cardIsSaved,
  cardQuestions,
  type ExamImportCard,
  type ExamImportCardQuestion,
  type ExamImportDetail,
  type ExamImportPage,
  type ExamImportSaveFailure,
} from "./types";

export type ReviewIssue =
  | "failed"
  | "missing"
  | "duplicate"
  | "sameStem"
  | "importDuplicate"
  | "saveFailed"
  | "processing";

export interface ReviewPage {
  page: ExamImportPage;
  /** 這一頁還沒存的卡（原卷順序） */
  cards: ExamImportCard[];
  /** 還沒處理完（等待中／處理中）＝顯示灰色佔位條 */
  processing: boolean;
}

export interface ReviewEntry {
  /** 導覽格 key（卡 id＋小題位置；處理中的頁是 page-N） */
  key: string;
  cardId: string | null;
  pageNo: number;
  questionIndex: number;
  label: string;
  issue: ReviewIssue | null;
}

export function reviewPages(detail: ExamImportDetail | null): ReviewPage[] {
  if (!detail) return [];
  return [...detail.pages]
    .sort((a, b) => a.page_no - b.page_no)
    .map((page) => ({
      page,
      cards: (page.cards ?? []).filter((c) => !cardIsSaved(c)),
      processing: page.status === "pending" || page.status === "processing",
    }));
}

export function entryKey(cardId: string, questionIndex: number): string {
  return `${cardId}:${questionIndex}`;
}

/** 捲動定位用的 DOM id */
export function entryDomId(key: string): string {
  return `exam-review-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

const FAILURE_ISSUE: Record<string, ReviewIssue> = {
  failed: "failed",
  missing_answer: "missing",
  duplicate: "duplicate",
  same_stem: "sameStem",
  duplicate_in_import: "importDuplicate",
};

/** 整張卡的狀態（題組每一格都套用）；null＝看各題 */
export function cardIssue(
  card: ExamImportCard,
  failure?: ExamImportSaveFailure,
): ReviewIssue | null {
  if (card.status === "failed") return "failed";
  const dup = card.duplicate_of;
  if (dup?.type === "bank")
    return dup.reason === "same_stem" ? "sameStem" : "duplicate";
  if (dup?.type === "import") return "importDuplicate";
  if (failure && failure.reason !== "missing_answer")
    return FAILURE_ISSUE[failure.reason] ?? "saveFailed";
  return null;
}

export function questionIssue(
  card: ExamImportCard,
  q: ExamImportCardQuestion,
  failure?: ExamImportSaveFailure,
): ReviewIssue | null {
  const whole = cardIssue(card, failure);
  if (whole) return whole;
  if (q.status === "failed") return "failed";
  if ((q.correct_indexes ?? []).length === 0) return "missing";
  return null;
}

export function needsAttention(issue: ReviewIssue | null): boolean {
  return (
    issue === "failed" ||
    issue === "missing" ||
    issue === "importDuplicate" ||
    issue === "saveFailed"
  );
}

export function reviewEntries(
  pages: ReviewPage[],
  failures: Record<string, ExamImportSaveFailure>,
): ReviewEntry[] {
  const out: ReviewEntry[] = [];
  let running = 0;
  for (const { page, cards, processing } of pages) {
    if (processing) {
      out.push({
        key: `page-${page.page_no}`,
        cardId: null,
        pageNo: page.page_no,
        questionIndex: 0,
        label: "…",
        issue: "processing",
      });
      continue;
    }
    for (const card of cards) {
      const qs = cardQuestions(card);
      const list = qs.length > 0 ? qs : [{} as ExamImportCardQuestion];
      list.forEach((q, i) => {
        running += 1;
        out.push({
          key: entryKey(card.card_id, i),
          cardId: card.card_id,
          pageNo: page.page_no,
          questionIndex: i,
          label: (q.source_question_no ?? "").trim() || String(running),
          issue: questionIssue(card, q, failures[card.card_id]),
        });
      });
    }
  }
  return out;
}

/** 處理中的頁數（全部儲存停用時說明「還有 N 頁處理中」） */
export function pagesInProgress(detail: ExamImportDetail | null): number {
  if (!detail) return 0;
  return detail.pages.filter(
    (p) => p.status === "pending" || p.status === "processing",
  ).length;
}
