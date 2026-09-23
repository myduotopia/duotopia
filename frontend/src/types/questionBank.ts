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

export interface QuestionListResponse {
  items: Question[];
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
  question_type: "multiple_choice";
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

// ---- AI 工具（#1065）----
export interface AiQuestionInput {
  key: string;
  stem: string;
  options: string[];
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
