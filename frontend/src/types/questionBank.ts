/**
 * 題庫型別（Issue #1061）。對應 backend/routers/question_bank.py 的回傳格式。
 */

export type QuestionType =
  | "multiple_choice"
  | "reading"
  | "cloze"
  | "fill_in"
  | "listening"
  | "listening_image";

export type QuestionVisibility =
  | "private"
  | "public"
  | "organization_only"
  | "individual_only";

export interface QuestionOption {
  id: number;
  order_index: number;
  text: string;
  is_correct: boolean;
  audio_url: string | null;
  image_url: string | null;
}

export interface QuestionExamPointRef {
  id: number;
  code: string;
  names: Record<string, string>;
  source: "manual" | "ai";
}

export interface QuestionProgramLink {
  program_id: number;
  lesson_id: number | null;
  /** 列表「教材」欄顯示用（後端回傳；寫入時不需要） */
  program_name?: string | null;
  lesson_name?: string | null;
}

/** 考題來源：歷屆考題（exam）／出版社版本（publisher）。organization_id / teacher_id 皆 null = 平台公用 */
export interface QuestionSource {
  id: number;
  source_type: "exam" | "publisher";
  name: string;
  year: number | null;
  organization_id: string | null;
  teacher_id: number | null;
}

export interface QuestionSourceCreateInput {
  source_type: "exam" | "publisher";
  name: string;
  year?: number | null;
  organization_id?: string | null;
}

// ---- 題組（#1079 閱讀題組）----

export type StimulusType = "passage" | "audio" | "dialogue" | "image" | "mixed";

/**
 * 題組主圖文排版（question_groups.layout）。格式定義與驗收樣本：
 * docs/design/question-bank-layout-samples/README.md
 * rows 由上到下；row 內 columns 依 span 比例分欄，手機寬度依序上下堆疊；
 * section 把一組 rows 框起來；paragraph 可含行內 markdown 與克漏字 `{{n}}`。
 */
export interface LayoutHeadingBlock {
  type: "heading";
  level: 2 | 3;
  text: string;
}
export interface LayoutParagraphBlock {
  type: "paragraph";
  text: string;
}
export interface LayoutImageBlock {
  type: "image";
  url: string;
  alt?: string;
  caption?: string;
  align?: "left" | "center" | "right";
  maxWidth?: number;
  frame?: boolean;
}
export interface LayoutDialogueLine {
  speaker: string;
  text: string;
}
export interface LayoutDialogueBlock {
  type: "dialogue";
  frame?: boolean;
  lines: LayoutDialogueLine[];
}
export type LayoutBlock =
  | LayoutHeadingBlock
  | LayoutParagraphBlock
  | LayoutImageBlock
  | LayoutDialogueBlock;

export interface LayoutColumn {
  span: number;
  blocks: LayoutBlock[];
}
export interface LayoutRow {
  type?: "row";
  columns: LayoutColumn[];
}
export interface LayoutSection {
  type: "section";
  frame?: boolean;
  rows: LayoutRow[];
}
export type LayoutNode = LayoutRow | LayoutSection;

export interface LayoutDoc {
  version: 1;
  /** 整篇主圖文（不含單字註解）外包一個框；會考題本的文章多半有框（#1082） */
  frame?: boolean;
  rows: LayoutNode[];
}

/** 會考題本底部的單字註解 */
export interface GlossaryEntry {
  word: string;
  zh: string;
}

/**
 * 題組對話文稿的一句（`question_group_segments`，#1083）：AI 從圖片整理、老師不可修改，
 * 之後的題組對話音檔由它產生。
 */
export interface GroupSegmentInput {
  speaker_label: string;
  transcript: string;
}

export interface GroupSegment extends GroupSegmentInput {
  order_index: number;
}

export interface QuestionGroup {
  id: number;
  question_type: QuestionType;
  stimulus_type: StimulusType;
  title: string | null;
  passage_text: string | null;
  image_url: string | null;
  audio_url: string | null;
  layout: LayoutDoc | null;
  glossary: GlossaryEntry[] | null;
  grade_min: number | null;
  grade_max: number | null;
  visibility: QuestionVisibility;
  is_platform: boolean;
  teacher_id: number;
  organization_id: string | null;
  school_id: string | null;
  is_owner: boolean;
  can_edit: boolean;
  questions: Question[];
  /** 對話文稿（圖片題組有人物對話時才有；後端一律回陣列，舊快取可能缺） */
  segments?: GroupSegment[];
  created_at: string | null;
  updated_at: string | null;
}

export interface Question {
  id: number;
  question_type: QuestionType;
  stem: string;
  explanation: string | null;
  image_url: string | null;
  stem_audio_url: string | null;
  grade_min: number | null;
  grade_max: number | null;
  allow_multiple_answers: boolean;
  show_stem_text: boolean;
  visibility: QuestionVisibility;
  is_platform: boolean;
  teacher_id: number;
  organization_id: string | null;
  school_id: string | null;
  group_id: number | null;
  /** 題組內小題順序；單題為 null */
  group_order?: number | null;
  /** 克漏字小題對應的空格編號（文章內 `{{n}}` 的 n）；其他題型為 null（#1085） */
  blank_index?: number | null;
  is_owner: boolean;
  /** 後端算出：建立者本人，或機構擁有人／教材管理者 → 可編輯／刪除 */
  can_edit: boolean;
  options: QuestionOption[];
  exam_points: QuestionExamPointRef[];
  program_links: QuestionProgramLink[];
  sources: QuestionSource[];
  created_at: string | null;
  updated_at: string | null;
}

/** 列表的題組列（小題不單獨出現在列表） */
export interface QuestionGroupListRow {
  kind: "group";
  id: number;
  /** 題組內小題的題型（整組同一種） */
  question_type: QuestionType;
  stimulus_type: StimulusType;
  title: string | null;
  /** 列表顯示用：passage_text 或 title 的前段 */
  preview: string;
  question_count: number;
  grade_min: number | null;
  grade_max: number | null;
  visibility: QuestionVisibility;
  is_platform: boolean;
  teacher_id: number;
  organization_id: string | null;
  school_id: string | null;
  is_owner: boolean;
  can_edit: boolean;
  /** 題組內小題的來源聯集 */
  sources: QuestionSource[];
  /** 題組內小題的考點聯集（列表顯示用；舊回應可能沒有） */
  exam_points?: QuestionExamPointRef[];
  /** 題組內小題的教材關聯聯集（列表顯示用；舊回應可能沒有） */
  program_links?: QuestionProgramLink[];
  created_at: string | null;
  updated_at: string | null;
}

/** 列表列：單題（kind 可省略 = 舊資料相容）或題組 */
export type QuestionListItem =
  | (Question & { kind?: "single" })
  | QuestionGroupListRow;

export function isGroupRow(
  item: QuestionListItem,
): item is QuestionGroupListRow {
  return item.kind === "group";
}

export interface QuestionListResponse {
  items: QuestionListItem[];
  total: number;
  page: number;
  page_size: number;
}

export type QuestionListScope =
  | "all"
  | "mine"
  | "organization"
  | "school"
  | "platform";

export interface QuestionListParams {
  scope?: QuestionListScope;
  organization_id?: string;
  school_id?: string;
  question_type?: QuestionType;
  exam_point_ids?: number[];
  grade_min?: number;
  grade_max?: number;
  q?: string;
  /** mine/organization 時只列自己的／機構的，不含公開題 */
  only_own?: boolean;
  page?: number;
  page_size?: number;
}

export interface ExamPoint {
  id: number;
  code: string;
  parent_id: number | null;
  names: Record<string, string>;
  status: "active" | "pending" | "merged";
  order_index: number;
  aliases: string[];
}

export interface SimilarQuestion {
  id: number;
  stem: string;
  visibility: QuestionVisibility;
  is_platform: boolean;
  is_owner: boolean;
}

export interface SimilarQuestionsResponse {
  exact_duplicate: SimilarQuestion | null;
  similar: SimilarQuestion[];
}

export interface QuestionOptionInput {
  text: string;
  is_correct?: boolean;
  audio_url?: string | null;
  image_url?: string | null;
}

export interface QuestionCreateInput {
  question_type: QuestionType;
  stem: string;
  options: QuestionOptionInput[];
  explanation?: string | null;
  image_url?: string | null;
  stem_audio_url?: string | null;
  grade_min?: number | null;
  grade_max?: number | null;
  allow_multiple_answers?: boolean;
  show_stem_text?: boolean;
  visibility?: QuestionVisibility;
  exam_point_ids?: number[];
  program_links?: QuestionProgramLink[];
  source_ids?: number[];
  organization_id?: string | null;
  school_id?: string | null;
}

export type QuestionUpdateInput = Partial<
  Omit<QuestionCreateInput, "question_type" | "organization_id" | "school_id">
>;

/** 題組小題：與單題相同，但歸屬／公開由題組決定 */
export type QuestionGroupQuestionInput = Omit<
  QuestionCreateInput,
  "question_type" | "organization_id" | "school_id" | "visibility"
> & { group_order?: number; blank_index?: number | null };

export interface QuestionGroupCreateInput {
  question_type: QuestionType;
  stimulus_type: StimulusType;
  title?: string | null;
  passage_text?: string | null;
  image_url?: string | null;
  layout?: LayoutDoc | null;
  glossary?: GlossaryEntry[] | null;
  grade_min?: number | null;
  grade_max?: number | null;
  visibility?: QuestionVisibility;
  questions: QuestionGroupQuestionInput[];
  /** 對話文稿；有給時後端以它重組 passage_text（PATCH：給了就整組替換，[] = 清掉） */
  segments?: GroupSegmentInput[] | null;
  organization_id?: string | null;
  school_id?: string | null;
}

/** PATCH 題組：group 欄位只送有改的；questions 給了就整份對齊（帶 id 更新、無 id 新增、缺席刪除） */
export type QuestionGroupUpdateInput = Partial<
  Omit<
    QuestionGroupCreateInput,
    "question_type" | "organization_id" | "school_id" | "questions"
  >
> & {
  questions?: (QuestionGroupQuestionInput & { id?: number })[];
};

// ---- AI 工具（#1065）----
export interface AiQuestionInput {
  key: string;
  stem: string;
  options: string[];
  /** 題組小題：主圖文的純文字（後端會附在題目前給模型） */
  passage?: string;
}

export interface AiAnswerResult {
  key: string;
  correct_indexes: number[];
  explanation: string;
}

export interface AiAnalyzeResult {
  key: string;
  exam_points: ExamPoint[];
  grade_min: number | null;
  grade_max: number | null;
}

export interface AiResponse<T> {
  results: T[];
  /** 模型判斷不了或回傳不合法而被丟掉的 key */
  skipped: string[];
}

/** 顯示考點名稱：優先目前語言，退回 zh-TW → en → code */
export function examPointLabel(
  ep: { code: string; names: Record<string, string> },
  lang: string,
): string {
  return ep.names[lang] ?? ep.names["zh-TW"] ?? ep.names["en"] ?? ep.code;
}
