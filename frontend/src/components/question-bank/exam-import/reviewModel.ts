/**
 * 上傳題本核對畫面（#1112 C4b）的畫面模型：純函式，把整份匯入（`ExamImportDetail`）整理成
 * 「依原卷頁碼排列的頁＋還沒存的題目卡」與題號下拉的每一列（C4c：左側方格導覽改成上方下拉）。
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
 * - 標籤＝原卷題號；沒有就用流水號（B4）。
 * - 題號下拉（C4c）：`pickerGroups` 依原卷頁分組、`pickerStatus` 每題狀態文字（E3）；
 *   `missingSettings` 整份設定缺哪些必填（按存入時自動展開設定、焦點到第一個缺的欄位，E5）。
 * - 存入退回 `pending_continuation`（題組可能還有下一頁的內容）不算問題：等下一頁處理完就好，不標色。
 * - `unsettledCardIds`：**還不能編輯的題組卡**（C4b 審查 1）——頁上最後一張是題組，後面（往下找到下一個
 *   有卡片的已處理頁之前）還有頁在等待／處理中，下一頁可能還會併進小題或文章。規則與後端
 *   `exam_import_save.unsettled_card_ids` 相同；畫面停用編輯並說明「下一頁處理完才能編輯」。
 * - `continuationNotMerged`：卡片仍標 `continues_previous`、前面的頁都處理完了（照理該併進上一個題組
 *   卻沒併：上一個題組老師已編輯過排版或已存入，C4a 修正 4），卡上說明「接續上一頁的題組…未自動合併」。
 */
import {
  cardIsSaved,
  cardQuestions,
  type ExamImportCard,
  type ExamImportCardQuestion,
  type ExamImportDetail,
  type ExamImportPage,
  type ExamImportSaveFailure,
  type ExamImportSettingsPayload,
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

/** 存入退回但不算問題的原因（等下一頁處理完再存） */
const NOT_AN_ISSUE = new Set(["missing_answer", "pending_continuation"]);

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
  if (failure && !NOT_AN_ISSUE.has(failure.reason))
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

/**
 * 題號下拉每題的狀態（C4c cold-read E3）：問題（`ReviewIssue`）優先；沒有問題但還在等下一頁
 * （`pending_continuation` 被退回、或題組卡還不能編輯）→ `pending`（灰字「等下一頁」）。
 */
export type PickerStatus = Exclude<ReviewIssue, "processing"> | "pending";

export function pickerStatus(
  entry: ReviewEntry,
  failure: ExamImportSaveFailure | undefined,
  locked: boolean,
): PickerStatus | null {
  if (entry.issue && entry.issue !== "processing") return entry.issue;
  if (failure?.reason === "pending_continuation" || locked) return "pending";
  return null;
}

/** 下拉依「原卷第 P 頁」分組（跨頁題組歸起始頁，E2）；處理中的頁只有一列灰字 */
export interface PickerGroup {
  pageNo: number;
  processing: boolean;
  entries: ReviewEntry[];
}

export function pickerGroups(entries: ReviewEntry[]): PickerGroup[] {
  const out: PickerGroup[] = [];
  for (const e of entries) {
    let g = out[out.length - 1];
    if (!g || g.pageNo !== e.pageNo) {
      g = { pageNo: e.pageNo, processing: false, entries: [] };
      out.push(g);
    }
    if (e.issue === "processing") g.processing = true;
    else g.entries.push(e);
  }
  return out;
}

/** 整份設定還缺的必填欄位（同後端 `missing_required`：年段上下限、來源、公開） */
export type SettingKey = "grade" | "source" | "visibility";

export function missingSettings(
  settings: Partial<ExamImportSettingsPayload> | undefined,
  grade: [number | null, number | null],
): SettingKey[] {
  const out: SettingKey[] = [];
  if (grade[0] === null || grade[1] === null) out.push("grade");
  if (settings?.source_id == null) out.push("source");
  if (!settings?.visibility) out.push("visibility");
  return out;
}

/** 處理中的頁數（全部儲存停用時說明「還有 N 頁處理中」） */
export function pagesInProgress(detail: ExamImportDetail | null): number {
  if (!detail) return 0;
  return detail.pages.filter(
    (p) => p.status === "pending" || p.status === "processing",
  ).length;
}

const isUnprocessed = (status: ExamImportPage["status"] | undefined) =>
  status === "pending" || status === "processing";

/**
 * 還不能編輯的題組卡 id（下一頁可能還會併進內容）。同後端 `unsettled_card_ids`：只看已處理完的頁，
 * 頁上最後一張是題組時往後找，遇到等待／處理中的頁 → 不能編輯；遇到失敗頁或有卡片的頁就停。
 */
export function unsettledCardIds(detail: ExamImportDetail | null): Set<string> {
  const out = new Set<string>();
  if (!detail) return out;
  const byNo = new Map(detail.pages.map((p) => [p.page_no, p]));
  for (const page of detail.pages) {
    if (page.status !== "done") continue;
    const cards = page.cards ?? [];
    const last = cards[cards.length - 1];
    if (!last || last.kind !== "group") continue;
    for (let n = page.page_no + 1; n <= detail.page_count; n += 1) {
      const later = byNo.get(n);
      if (isUnprocessed(later?.status)) {
        out.add(last.card_id);
        break;
      }
      if (later?.status !== "done" || (later.cards ?? []).length > 0) break;
    }
  }
  return out;
}

/**
 * 延續上一頁卻沒併進去的題組卡：卡片還標 `continues_previous`、而且前面的頁都處理完了
 * （前面還有頁在處理時，等那一頁處理完會自動併，不必說明）。
 */
export function continuationNotMerged(
  detail: ExamImportDetail | null,
  card: ExamImportCard,
): boolean {
  if (!detail || card.kind !== "group" || !card.continues_previous)
    return false;
  const home = card.page_no ?? 0;
  return !detail.pages.some((p) => p.page_no < home && isUnprocessed(p.status));
}
