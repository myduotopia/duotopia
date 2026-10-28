/**
 * 上傳題本匯入（#1112）前端型別：對應後端 `/api/question-bank/exam-imports` 的回應
 * （`services/exam_import_service.serialize_import`／`serialize_page`）。
 *
 * C3 只用到頁狀態與題數；題目卡內容（`cards`）的完整形狀由 C4 確認畫面接上，這裡只宣告
 * 計算題數與跨頁題組說明需要的欄位。
 *
 * `pageMergeInfo`（第五輪）：從各頁卡片的 `pages`、子題的 `page_no`／`source_question_no` 算出
 * 「被併入前面題組的頁」（目標頁＋題號範圍）與「跨頁題組所在的頁」（跨第幾到第幾頁），
 * 處理進度畫面用來說明 0 題的頁（後端不改）。
 */

export type ExamImportStatus = "processing" | "ready" | "saved" | "abandoned";
export type ExamImportPageStatus = "pending" | "processing" | "done" | "failed";

/** 題目卡裡的一題（只宣告 C3／第五輪用到的欄位） */
export interface ExamImportCardQuestion {
  /** 題本上印的題號（字串，可能是「31」或取不到時 null） */
  source_question_no?: string | null;
  /** 這一題在 PDF 的第幾頁（跨頁題組合併後，併進來的小題保留原頁碼） */
  page_no?: number | null;
  [key: string]: unknown;
}

/** 題目卡（只宣告 C3 用到的欄位；其餘欄位 C4 再補型別） */
export interface ExamImportCard {
  card_id: string;
  kind: "single" | "group";
  /** 卡片所在頁（題組合併後是起始頁） */
  page_no?: number;
  /** 題組橫跨的頁（跨頁合併後如 [8, 9]；單頁時只有自己） */
  pages?: number[];
  question?: ExamImportCardQuestion | null;
  group?: { questions?: ExamImportCardQuestion[] } | null;
  [key: string]: unknown;
}

export interface ExamImportPage {
  page_no: number;
  status: ExamImportPageStatus;
  image_url: string | null;
  is_answer_page: boolean;
  cards: ExamImportCard[];
  /** 失敗原因（白話）；空白頁略過時是 `BLANK_SKIPPED`（看 `blank_skipped` 就好） */
  error: string | null;
  /** 瀏覽器判斷是空白頁、沒送 AI（算已完成） */
  blank_skipped: boolean;
  resend_count: number;
  processed_at: string | null;
}

export interface ExamImportSettingsPayload {
  grade_min: number | null;
  grade_max: number | null;
  source_id: number | null;
  program_links: { program_id: number; lesson_id: number | null }[];
  visibility: "private" | "public" | null;
}

export interface ExamImportSummary {
  id: number;
  file_name: string;
  file_hash: string;
  page_count: number;
  status: ExamImportStatus;
  settings: Partial<ExamImportSettingsPayload>;
  tts_accents: string[];
  question_count: number;
  /** 已處理完的頁（含空白頁略過） */
  pages_done: number;
  pages_failed: number;
  pages_blank: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface ExamImportDetail extends ExamImportSummary {
  known_answers: Record<string, number[]>;
  retry_limits: { page_resends: number; question_retries: number };
  pages: ExamImportPage[];
}

export interface ExamImportCreateInput {
  file_name: string;
  file_hash: string;
  page_count: number;
  tts_accents: string[];
  settings: ExamImportSettingsPayload;
}

export interface ExamImportPageResult {
  page: ExamImportPage;
  import: ExamImportSummary;
}

/** 一張題目卡有幾題（單題 1、題組＝小題數） */
export function cardQuestionCount(card: ExamImportCard): number {
  if (card.kind === "group") return card.group?.questions?.length ?? 0;
  return 1;
}

export function pageQuestionCount(page: ExamImportPage): number {
  return page.cards.reduce((sum, c) => sum + cardQuestionCount(c), 0);
}

/** 一頁的跨頁題組說明（`pageMergeInfo` 的結果） */
export type PageMergeInfo =
  | {
      /** 這一頁的小題被併進前面某頁的題組（這一頁自己沒卡片） */
      kind: "merged";
      /** 題組所在頁 */
      target: number;
      /** 併進去的小題題號範圍；題號取不到（或不是數字）時沒有 */
      from?: number;
      to?: number;
    }
  | {
      /** 這一頁的題組跨到後面的頁 */
      kind: "span";
      from: number;
      to: number;
    };

function cardQuestions(card: ExamImportCard): ExamImportCardQuestion[] {
  if (card.kind === "group") return card.group?.questions ?? [];
  return card.question ? [card.question] : [];
}

/**
 * 掃描所有頁的卡片，找出跨頁題組：題組卡的 `pages` 超過一頁時，
 * - 卡片所在頁 → `span`（跨第 min–max 頁）
 * - `pages` 裡其他頁 → `merged`（併入卡片所在頁；題號範圍取該頁小題的 `source_question_no`）
 *
 * 只看卡片，不看頁狀態；畫面再依「完成、幾題」決定要不要顯示。回傳頁碼 → 說明。
 */
export function pageMergeInfo(
  pages: ExamImportPage[],
): Map<number, PageMergeInfo> {
  const out = new Map<number, PageMergeInfo>();
  for (const page of pages) {
    for (const card of page.cards ?? []) {
      if (card.kind !== "group") continue;
      const spanPages = (card.pages ?? []).filter((n) => typeof n === "number");
      if (spanPages.length < 2) continue;
      const home = card.page_no ?? page.page_no;
      const from = Math.min(...spanPages);
      const to = Math.max(...spanPages);
      const prev = out.get(home);
      if (prev?.kind === "span") {
        out.set(home, {
          kind: "span",
          from: Math.min(prev.from, from),
          to: Math.max(prev.to, to),
        });
      } else if (!prev) {
        out.set(home, { kind: "span", from, to });
      }
      const questions = cardQuestions(card);
      for (const n of spanPages) {
        if (n === home || out.has(n)) continue;
        const nos = questions
          .filter((q) => q.page_no === n)
          .map((q) => Number.parseInt(String(q.source_question_no ?? ""), 10))
          .filter((v) => Number.isFinite(v));
        out.set(
          n,
          nos.length > 0
            ? {
                kind: "merged",
                target: home,
                from: Math.min(...nos),
                to: Math.max(...nos),
              }
            : { kind: "merged", target: home },
        );
      }
    }
  }
  return out;
}
