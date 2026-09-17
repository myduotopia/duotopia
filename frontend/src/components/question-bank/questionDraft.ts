/**
 * 選擇題編輯面板的草稿型別與純驗證函式（Issue #1064）。
 *
 * 放在獨立檔案讓 QuestionCard / MultipleChoiceQuestionSheet 共用，也方便單測：
 * 驗證函式只回傳 i18n key（不呼叫 t），由呼叫端翻譯。
 */

import type {
  ExamPoint,
  Question,
  QuestionCreateInput,
  QuestionProgramLink,
  QuestionVisibility,
  SimilarQuestionsResponse,
} from "@/types/questionBank";

/** 預設顯示 A–D 四格；按「新增選項」才展開到 6 格 */
export const BASE_OPTION_SLOTS = 4;
export const MAX_OPTION_SLOTS = 6;
export const MIN_FILLED_OPTIONS = 2;
/** 一批最多幾題（避免一次送太多、也避免卡片太長） */
export const MAX_QUESTIONS_PER_BATCH = 20;

export interface OptionDraft {
  text: string;
  is_correct: boolean;
  image_url: string | null;
}

export interface QuestionDraft {
  /** React key／DOM id 用，與 DB id 無關 */
  key: string;
  stem: string;
  stem_audio_url: string | null;
  explanation: string;
  allow_multiple: boolean;
  options: OptionDraft[];
  /** 是否已展開 E/F */
  extraOptionsShown: boolean;
  /** 相似題查詢結果（每卡各自） */
  similar: SimilarQuestionsResponse | null;
  /** 後端儲存失敗時的訊息（逐題送出時標在該卡） */
  serverError: string | null;
}

/** 左欄整批共用設定 */
export interface SharedSettings {
  grade_min: number | null;
  grade_max: number | null;
  exam_points: ExamPoint[];
  program_links: QuestionProgramLink[];
  visibility: QuestionVisibility;
}

let keySeq = 0;
export function nextKey(): string {
  keySeq += 1;
  return `q-${Date.now().toString(36)}-${keySeq}`;
}

export function emptyOption(): OptionDraft {
  return { text: "", is_correct: false, image_url: null };
}

export function emptyDraft(): QuestionDraft {
  return {
    key: nextKey(),
    stem: "",
    stem_audio_url: null,
    explanation: "",
    allow_multiple: false,
    options: Array.from({ length: BASE_OPTION_SLOTS }, emptyOption),
    extraOptionsShown: false,
    similar: null,
    serverError: null,
  };
}

export function draftFromQuestion(q: Question): QuestionDraft {
  const options = Array.from({ length: MAX_OPTION_SLOTS }, emptyOption);
  q.options.forEach((o, i) => {
    if (i < MAX_OPTION_SLOTS)
      options[i] = {
        text: o.text,
        is_correct: o.is_correct,
        image_url: o.image_url,
      };
  });
  const extra = q.options.length > BASE_OPTION_SLOTS;
  return {
    key: nextKey(),
    stem: q.stem,
    stem_audio_url: q.stem_audio_url,
    explanation: q.explanation ?? "",
    allow_multiple: q.allow_multiple_answers,
    options: extra ? options : options.slice(0, BASE_OPTION_SLOTS),
    extraOptionsShown: extra,
    similar: null,
    serverError: null,
  };
}

export function defaultSharedSettings(): SharedSettings {
  return {
    grade_min: null,
    grade_max: null,
    exam_points: [],
    program_links: [],
    visibility: "private",
  };
}

export function sharedSettingsFromQuestion(q: Question): SharedSettings {
  return {
    grade_min: q.grade_min,
    grade_max: q.grade_max,
    exam_points: q.exam_points.map((ep) => ({
      id: ep.id,
      code: ep.code,
      names: ep.names,
      parent_id: null,
      status: "active",
      order_index: 0,
      aliases: [],
    })),
    program_links: q.program_links,
    visibility: q.visibility,
  };
}

/** 選項「有填」= 有文字或有圖片 */
export function optionFilled(o: OptionDraft): boolean {
  return o.text.trim() !== "" || o.image_url !== null;
}

export function draftHasContent(d: QuestionDraft): boolean {
  return d.stem.trim() !== "";
}

/** 與後端 normalize_stem 對齊的粗略版：小寫、去標點、壓空白（NFKC 全形→半形） */
export function normalizeStem(stem: string): string {
  return stem
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 單題驗證，回傳 i18n key（`questionBank.form.errors.*` 的最後一段）或 null。
 * 順序刻意：先題幹、再重複、再選項。
 */
export function validateDraft(
  d: QuestionDraft,
  opts: { duplicateInBatch?: boolean } = {},
): string | null {
  if (!draftHasContent(d)) return "stemRequired";
  if (d.similar?.exact_duplicate) return "duplicate";
  if (opts.duplicateInBatch) return "duplicateInBatch";
  const filled = d.options.filter(optionFilled);
  if (filled.length < MIN_FILLED_OPTIONS) return "minOptions";
  const correct = filled.filter((o) => o.is_correct).length;
  if (correct === 0) return "noCorrect";
  if (!d.allow_multiple && correct > 1) return "singleOnly";
  return null;
}

/** 同一批內題幹正規化後相同的 key 集合 */
export function findBatchDuplicateKeys(drafts: QuestionDraft[]): Set<string> {
  const seen = new Map<string, string>();
  const dup = new Set<string>();
  for (const d of drafts) {
    const n = normalizeStem(d.stem);
    if (!n) continue;
    const first = seen.get(n);
    if (first) {
      dup.add(first);
      dup.add(d.key);
    } else {
      seen.set(n, d.key);
    }
  }
  return dup;
}

export function validateShared(s: SharedSettings): string | null {
  if (s.grade_min !== null && s.grade_max !== null && s.grade_min > s.grade_max)
    return "gradeRange";
  return null;
}

/** 組成送後端的 payload（只送有填的選項，順序依格子） */
export function toCreateInput(
  d: QuestionDraft,
  shared: SharedSettings,
  organizationId?: string,
): QuestionCreateInput {
  return {
    question_type: "multiple_choice",
    stem: d.stem.trim(),
    stem_audio_url: d.stem_audio_url,
    options: d.options.filter(optionFilled).map((o) => ({
      text: o.text.trim(),
      is_correct: o.is_correct,
      image_url: o.image_url,
    })),
    explanation: d.explanation.trim() || null,
    grade_min: shared.grade_min,
    grade_max: shared.grade_max,
    allow_multiple_answers: d.allow_multiple,
    visibility: shared.visibility,
    exam_point_ids: shared.exam_points.map((ep) => ep.id),
    program_links: shared.program_links,
    organization_id: organizationId ?? null,
  };
}
