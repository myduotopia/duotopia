/**
 * 上傳題本匯入（#1112）前端型別：對應後端 `/api/question-bank/exam-imports` 的回應
 * （`services/exam_import_service.serialize_import`／`serialize_page`）。
 *
 * C3 只用到頁狀態與題數；題目卡內容（`cards`）的完整形狀由 C4 確認畫面接上，這裡只宣告
 * 計算題數需要的欄位。
 */

export type ExamImportStatus = "processing" | "ready" | "saved" | "abandoned";
export type ExamImportPageStatus = "pending" | "processing" | "done" | "failed";

/** 題目卡（只宣告 C3 用到的欄位；其餘欄位 C4 再補型別） */
export interface ExamImportCard {
  card_id: string;
  kind: "single" | "group";
  group?: { questions?: unknown[] } | null;
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
