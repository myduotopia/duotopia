/**
 * 題庫草稿的單題核心（Issue #1064；#1082 自 questionDraft.ts 拆出）。
 *
 * 只放「單題」層：`QuestionDraft`／`OptionDraft`／`BatchDefaults` 型別、空白草稿、
 * 既有題目 → 草稿、單題驗證、送後端 payload。題組（groupDraft.ts）與 AI（aiDraft.ts）
 * 都依賴這裡，這裡不依賴它們——方向單向，避免循環 import。
 *
 * 外部一律從 `questionDraft.ts` 匯入（它轉出本檔），不要直接 import 本檔。
 * 驗證函式只回傳 i18n key（不呼叫 t），由呼叫端翻譯。
 */

import type { GradeRange } from "@/components/shared/GradeRangeSlider";
import type { ProgramLessonLink } from "@/components/shared/ProgramLessonPicker";
import type { ComboboxItem } from "@/components/shared/CreatableCombobox";
import type {
  ExamPoint,
  Question,
  QuestionCreateInput,
  QuestionType,
  QuestionUpdateInput,
  QuestionVisibility,
  SimilarQuestionsResponse,
} from "@/types/questionBank";
import { sourceToItem } from "./sourcesCombobox";

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

/** 左側批次設定可覆寫到每題的欄位 */
export interface BatchDefaults {
  exam_points: ExamPoint[];
  grade: GradeRange;
  program_link: ProgramLessonLink | null;
}

export interface QuestionDraft extends BatchDefaults {
  /** React key／DOM id 用，與 DB id 無關 */
  key: string;
  /** 題型；單題目前只有 multiple_choice，題組小題跟隨題組 */
  question_type: QuestionType;
  /** 所屬題組草稿的 key；單題為 null */
  groupKey: string | null;
  /** 克漏字小題對應的空格編號（文章內 `{{n}}` 的 n）；其他情況 null（#1085） */
  blank_index: number | null;
  stem: string;
  stem_audio_url: string | null;
  /** 題幹插圖（#1083：題本第 1 題的靜物圖、第 33 題的文氏圖）；題幹可空，圖或字至少一個 */
  image_url: string | null;
  explanation: string;
  allow_multiple: boolean;
  options: OptionDraft[];
  /** 是否已展開 E/F */
  extraOptionsShown: boolean;
  /** 進階設定（教材關聯、年段）是否展開 */
  advancedOpen: boolean;
  /** 相似題查詢結果（每卡各自） */
  similar: SimilarQuestionsResponse | null;
  /** 後端儲存失敗時的訊息（逐題送出時標在該卡） */
  serverError: string | null;
  /** 既有題目的 id（編輯／批次編輯）；新題為 null */
  existingId: number | null;
  /** 公開設定：新增時由左欄套用（必選），編輯時各題自帶 */
  visibility: QuestionVisibility | null;
  /** 考題來源：同上 */
  sources: ComboboxItem[];
}

let keySeq = 0;
export function nextKey(): string {
  keySeq += 1;
  return `q-${Date.now().toString(36)}-${keySeq}`;
}

export function emptyOption(): OptionDraft {
  return { text: "", is_correct: false, image_url: null };
}

export function emptyBatchDefaults(): BatchDefaults {
  return { exam_points: [], grade: [null, null], program_link: null };
}

export function emptyDraft(
  defaults: BatchDefaults = emptyBatchDefaults(),
): QuestionDraft {
  return {
    key: nextKey(),
    question_type: "multiple_choice",
    groupKey: null,
    blank_index: null,
    stem: "",
    stem_audio_url: null,
    image_url: null,
    explanation: "",
    allow_multiple: false,
    options: Array.from({ length: BASE_OPTION_SLOTS }, emptyOption),
    extraOptionsShown: false,
    advancedOpen: false,
    similar: null,
    serverError: null,
    existingId: null,
    visibility: null,
    sources: [],
    exam_points: [...defaults.exam_points],
    grade: [...defaults.grade] as GradeRange,
    program_link: defaults.program_link ? { ...defaults.program_link } : null,
  };
}

export function examPointsFromQuestion(q: Question): ExamPoint[] {
  return q.exam_points.map((ep) => ({
    id: ep.id,
    code: ep.code,
    names: ep.names,
    parent_id: null,
    status: "active",
    order_index: 0,
    aliases: [],
  }));
}

export function batchDefaultsFromQuestion(q: Question): BatchDefaults {
  const first = q.program_links[0];
  return {
    exam_points: examPointsFromQuestion(q),
    grade: [q.grade_min, q.grade_max],
    program_link: first
      ? { program_id: first.program_id, lesson_id: first.lesson_id }
      : null,
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
  const defaults = batchDefaultsFromQuestion(q);
  return {
    ...emptyDraft(defaults),
    question_type: q.question_type,
    blank_index: q.blank_index ?? null,
    existingId: q.id,
    visibility: q.visibility,
    sources: q.sources.map(sourceToItem),
    stem: q.stem,
    stem_audio_url: q.stem_audio_url,
    image_url: q.image_url,
    explanation: q.explanation ?? "",
    allow_multiple: q.allow_multiple_answers,
    options: extra ? options : options.slice(0, BASE_OPTION_SLOTS),
    extraOptionsShown: extra,
    // 既有題目有設定過就展開給老師看
    advancedOpen:
      defaults.program_link !== null ||
      defaults.grade[0] !== null ||
      defaults.grade[1] !== null,
  };
}

/** 選項「有填」= 有文字或有圖片 */
export function optionFilled(o: OptionDraft): boolean {
  return o.text.trim() !== "" || o.image_url !== null;
}

/** 題目「有內容」= 有題幹文字或有插圖（後端同規則：stem／image_url／stem_audio_url 至少一個） */
export function draftHasContent(d: QuestionDraft): boolean {
  return d.stem.trim() !== "" || d.image_url !== null;
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
 * 順序刻意：題幹 → 重複 → 選項 → 考點。
 */
export function validateDraft(
  d: QuestionDraft,
  opts: { duplicateInBatch?: boolean; stemOptional?: boolean } = {},
): string | null {
  if (!opts.stemOptional && !draftHasContent(d)) return "stemRequired";
  if (d.similar?.exact_duplicate) return "duplicate";
  if (opts.duplicateInBatch) return "duplicateInBatch";
  const filled = d.options.filter(optionFilled);
  if (filled.length < MIN_FILLED_OPTIONS) return "minOptions";
  const correct = filled.filter((o) => o.is_correct).length;
  if (correct === 0) return "noCorrect";
  if (!d.allow_multiple && correct > 1) return "singleOnly";
  if (d.exam_points.length === 0) return "examPointRequired";
  if (d.visibility === null) return "visibilityRequired";
  return null;
}

/**
 * 驗證回傳的 key 可能帶一個數字參數（例如 `clozeDuplicateBlank#3`）。
 * 拆成 i18n key 與插值參數，讓 `t()` 能把「文章裡的空格 {{n}} 出現了兩次」填完整。
 */
export function errorKeyParts(key: string): {
  key: string;
  params?: { n: number };
} {
  const at = key.indexOf("#");
  if (at < 0) return { key };
  return { key: key.slice(0, at), params: { n: Number(key.slice(at + 1)) } };
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

/** 組成送後端的 payload（只送有填的選項，順序依格子）。visibility 由 validateDraft 保證非 null */
export function toCreateInput(
  d: QuestionDraft,
  organizationId?: string,
): QuestionCreateInput {
  return {
    question_type: d.question_type,
    stem: d.stem.trim(),
    stem_audio_url: d.stem_audio_url,
    image_url: d.image_url,
    options: d.options.filter(optionFilled).map((o) => ({
      text: o.text.trim(),
      is_correct: o.is_correct,
      image_url: o.image_url,
    })),
    explanation: d.explanation.trim() || null,
    grade_min: d.grade[0],
    grade_max: d.grade[1],
    allow_multiple_answers: d.allow_multiple,
    visibility: d.visibility ?? "private",
    exam_point_ids: d.exam_points.map((ep) => ep.id),
    program_links: d.program_link ? [d.program_link] : [],
    source_ids: d.sources.map((s) => s.id),
    organization_id: organizationId ?? null,
  };
}

/** 編輯既有題目的 PATCH payload（不含 question_type／歸屬） */
export function toUpdateInput(d: QuestionDraft): QuestionUpdateInput {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { question_type, organization_id, school_id, ...update } =
    toCreateInput(d);
  return update;
}
