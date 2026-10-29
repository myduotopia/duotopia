/**
 * 上傳題本匯入（#1112）前端型別：對應後端 `/api/question-bank/exam-imports` 的回應
 * （`services/exam_import_serialize.serialize_import`／`serialize_page`）。
 *
 * 題目卡（`cards`）的形狀見後端 `services/exam_paper_service.py` 模組說明；C4 核對畫面用到的欄位
 * 都宣告在這裡（其餘保留 index signature）。核對畫面的 API（PATCH 設定、卡片增刪改、存入、
 * 略過核對）的輸入與回應型別也在這裡。
 *
 * `pageMergeInfo`（第五輪）：從各頁卡片的 `pages`、子題的 `page_no`／`source_question_no` 算出
 * 「被併入前面題組的頁」（目標頁＋題號範圍）與「跨頁題組所在的頁」（跨第幾到第幾頁），
 * 核對畫面「原卷第 N 頁」那一行用來說明 0 題的頁（後端不改）。同一頁既是跨頁題組的起點、
 * 又有小題被併進前一頁的題組時，以「跨頁」（span）為準（C4，第五輪遺留）。
 */
import type { GroupSegmentInput, LayoutDoc } from "@/types/questionBank";

export type ExamImportStatus = "processing" | "ready" | "saved" | "abandoned";
export type ExamImportPageStatus = "pending" | "processing" | "done" | "failed";
export type ExamImportAnswerSource = "answer_page" | "ai" | "teacher";

/** 題目卡裡的一題（單題的 `question`，或題組的 `group.questions[i]`） */
export interface ExamImportCardQuestion {
  /** 題本上印的題號（字串，可能是「31」或取不到時 null） */
  source_question_no?: string | null;
  /** 這一題在 PDF 的第幾頁（跨頁題組合併後，併進來的小題保留原頁碼） */
  page_no?: number | null;
  /** 這一題在頁上的位置 [ymin, xmin, ymax, xmax]（0–1000） */
  bbox?: number[] | null;
  stem?: string;
  /** 克漏字空格編號 */
  blank?: number | null;
  options?: string[];
  correct_indexes?: number[];
  /** 答案來源；老師改過（teacher）畫面不顯示 clip */
  answer_source?: ExamImportAnswerSource | null;
  explanation?: string | null;
  exam_point_codes?: string[];
  exam_point_ids?: number[];
  /** 後端從頁圖裁好的題幹圖；null＝沒有圖 */
  image_url?: string | null;
  option_image_urls?: (string | null)[] | null;
  status?: "ok" | "failed";
  teacher_edited?: string[];
  /** 已存進題庫（這張卡不再顯示） */
  saved_question_id?: number | null;
  [key: string]: unknown;
}

export interface ExamImportFigure {
  after_paragraph: number;
  caption: string;
  placement?: "beside" | "full";
  side?: "left" | "right";
  width?: number;
  /** 後端裁好的插圖 */
  url?: string | null;
}

export interface ExamImportStimulus {
  kind?: "text" | "image";
  paragraphs?: string[];
  text?: string;
  dialogue?: { speaker: string; text: string }[];
  framed?: boolean;
  figures?: ExamImportFigure[];
  /** kind=image 時後端裁好的整張圖 */
  image_url?: string | null;
  [key: string]: unknown;
}

export interface ExamImportCardGroup {
  group_type?: "reading" | "cloze";
  title?: string;
  stimulus?: ExamImportStimulus;
  glossary?: { word: string; zh: string }[];
  /** 老師在核對畫面改過排版時才有（存入時原樣採用） */
  layout?: LayoutDoc | null;
  passage_text?: string | null;
  segments?: GroupSegmentInput[] | null;
  questions?: ExamImportCardQuestion[];
  [key: string]: unknown;
}

/** 重複比對結果：題庫已有（bank；`reason: same_stem`＝題目文字相同）或同一份題本裡已有（import） */
export type ExamImportDuplicate =
  | {
      type: "bank";
      kind: "single" | "group";
      id: number;
      reason?: "same_stem";
    }
  | { type: "import"; card_id: string };

/** 題目卡 */
export interface ExamImportCard {
  card_id: string;
  kind: "single" | "group";
  /** 卡片所在頁（題組合併後是起始頁） */
  page_no?: number;
  /** 題組橫跨的頁（跨頁合併後如 [8, 9]；單頁時只有自己） */
  pages?: number[];
  bbox?: number[] | null;
  status?: "ok" | "failed";
  duplicate_of?: ExamImportDuplicate | null;
  tts_accent?: string | null;
  teacher_edited?: string[];
  retry_count?: number;
  /** 老師「手動補一題」新增的卡（不能重試、沒有原卷位置） */
  manual?: boolean;
  /** 題組已存進題庫 */
  saved_group_id?: number | null;
  question?: ExamImportCardQuestion | null;
  group?: ExamImportCardGroup | null;
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

export type ExamImportVisibility =
  | "private"
  | "public"
  | "organization_only"
  | "individual_only";

export interface ExamImportSettingsPayload {
  grade_min: number | null;
  grade_max: number | null;
  source_id: number | null;
  program_links: { program_id: number; lesson_id: number | null }[];
  visibility: ExamImportVisibility | null;
  /** 存進機構題庫（建立後不能改） */
  organization_id?: string | null;
  school_id?: string | null;
}

/** PATCH 整份設定：只送有改的欄位（存進哪個題庫不能改） */
export type ExamImportSettingsPatch = Partial<
  Pick<
    ExamImportSettingsPayload,
    "grade_min" | "grade_max" | "source_id" | "program_links" | "visibility"
  >
>;

export interface ExamImportSummary {
  id: number;
  file_name: string;
  file_hash: string;
  page_count: number;
  status: ExamImportStatus;
  settings: Partial<ExamImportSettingsPayload> & { auto_save?: boolean };
  tts_accents: string[];
  question_count: number;
  /** 已處理完的頁（含空白頁略過） */
  pages_done: number;
  pages_failed: number;
  pages_blank: number;
  /** 已存進題庫的題數（含題組小題）；舊回應沒有 */
  saved_question_count?: number;
  /** 略過核對（處理完自動存入）是否開著 */
  auto_save?: boolean;
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

/** 卡片格式的一題（PATCH／POST 卡片送的內容欄位；後端只收這些） */
export interface CardQuestionInput {
  stem?: string;
  options?: string[];
  correct_indexes?: number[];
  explanation?: string;
  exam_point_codes?: string[];
  exam_point_ids?: number[];
  image_url?: string | null;
  option_image_urls?: (string | null)[];
  source_question_no?: string | null;
  blank?: number | null;
}

export interface CardGroupInput {
  group_type?: "reading" | "cloze";
  title?: string;
  glossary?: { word: string; zh: string }[];
  layout?: LayoutDoc | null;
  passage_text?: string | null;
  segments?: GroupSegmentInput[];
  questions?: CardQuestionInput[];
}

export interface CardPatchInput {
  tts_accent?: string;
  question?: CardQuestionInput;
  group?: CardGroupInput;
}

export interface CardCreateInput extends CardPatchInput {
  kind: "single" | "group";
  page_no: number;
  after_card_id?: string | null;
  source_question_no?: string | null;
}

export interface ExamImportCardResult {
  card: ExamImportCard;
  import: ExamImportSummary;
}

export type ExamImportSaveFailReason =
  | "failed"
  | "missing_answer"
  | "duplicate"
  | "same_stem"
  | "duplicate_in_import"
  | "cloze_blanks"
  | "invalid";

export interface ExamImportSaveFailure {
  card_id: string;
  reason: string;
  message: string;
}

/** POST /save、/skip-review 的回應 */
export interface ExamImportSaveResult {
  saved: { card_id: string; question_ids?: number[]; group_id?: number }[];
  failed: ExamImportSaveFailure[];
  skipped_duplicate_cards?: number;
  skipped_duplicate_questions?: number;
  completed: boolean;
  status: ExamImportStatus;
  import: ExamImportSummary;
}

/** 卡片已存進題庫（畫面不再顯示）：單題看 question、題組看 saved_group_id */
export function cardIsSaved(card: ExamImportCard): boolean {
  if (card.kind === "group") return !!card.saved_group_id;
  return !!card.question?.saved_question_id;
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

/** 卡片裡的每一題（單題 1 題、題組＝小題） */
export function cardQuestions(card: ExamImportCard): ExamImportCardQuestion[] {
  if (card.kind === "group") return card.group?.questions ?? [];
  return card.question ? [card.question] : [];
}

/**
 * 掃描所有頁的卡片，找出跨頁題組：題組卡的 `pages` 超過一頁時，
 * - 卡片所在頁 → `span`（跨第 min–max 頁）；這一頁先前被標成 `merged` 也改成 `span`（跨頁優先）
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
      } else {
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
