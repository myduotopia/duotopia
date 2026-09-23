/**
 * 選擇題編輯面板的草稿型別與純驗證函式（Issue #1064）。
 *
 * 放在獨立檔案讓 QuestionCard / MultipleChoiceQuestionSheet 共用，也方便單測：
 * 驗證函式只回傳 i18n key（不呼叫 t），由呼叫端翻譯。
 *
 * 每題自己帶：考點（必填）、年段、教材關聯（進階設定）。左側批次設定只是「覆寫所有題」
 * 的捷徑，儲存時仍是逐題送出各自的值。整批共用、不進 draft 的只有：公開設定、考題來源。
 */

import type { GradeRange } from "@/components/shared/GradeRangeSlider";
import type { ProgramLessonLink } from "@/components/shared/ProgramLessonPicker";
import type { MagicPasteMcItem } from "@/components/shared/MagicPasteInput";
import type { ComboboxItem } from "@/components/shared/CreatableCombobox";
import type {
  AiAnalyzeResult,
  AiAnswerResult,
  AiQuestionInput,
  ExamPoint,
  Question,
  QuestionCreateInput,
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
  stem: string;
  stem_audio_url: string | null;
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
    stem: "",
    stem_audio_url: null,
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
    existingId: q.id,
    visibility: q.visibility,
    sources: q.sources.map(sourceToItem),
    stem: q.stem,
    stem_audio_url: q.stem_audio_url,
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
 * 順序刻意：題幹 → 重複 → 選項 → 考點。
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
  if (d.exam_points.length === 0) return "examPointRequired";
  if (d.visibility === null) return "visibilityRequired";
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

/** 組成送後端的 payload（只送有填的選項，順序依格子）。visibility 由 validateDraft 保證非 null */
export function toCreateInput(
  d: QuestionDraft,
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

// --------------------------------------------------------------------------- #
// AI 工具（#1065）：只填空的，不動老師已設的
// --------------------------------------------------------------------------- #

/** 可送給 AI 的題：有題幹且有填的選項 ≥ 2 */
export function draftsEligibleForAi(drafts: QuestionDraft[]): QuestionDraft[] {
  return drafts.filter(
    (d) => draftHasContent(d) && d.options.filter(optionFilled).length >= 2,
  );
}

/** 轉成 API 輸入；options 只送有填的（index 對應 applyAiAnswers 用 filled 順序） */
export function toAiInputs(drafts: QuestionDraft[]): AiQuestionInput[] {
  return drafts.map((d) => ({
    key: d.key,
    stem: d.stem.trim(),
    options: d.options
      .filter(optionFilled)
      .map((o) => o.text.trim() || "(圖片選項)"),
  }));
}

export interface ApplyResult {
  drafts: QuestionDraft[];
  applied: number;
  /** 老師已設定而略過的題數（AI 回了但不覆寫） */
  skipped: number;
}

/**
 * AI 作答：只對「沒有任何正確答案」的題套 correct_indexes（index 對應有填的選項順序）；
 * 一個以上 index 自動開啟複選；解析只在空的時候填。
 */
export function applyAiAnswers(
  drafts: QuestionDraft[],
  results: AiAnswerResult[],
): ApplyResult {
  const byKey = new Map(results.map((r) => [r.key, r]));
  let applied = 0;
  let skipped = 0;
  const next = drafts.map((d) => {
    const r = byKey.get(d.key);
    if (!r) return d;
    const hasAnswer = d.options.some((o) => o.is_correct);
    const filledIdx = d.options
      .map((o, i) => (optionFilled(o) ? i : -1))
      .filter((i) => i >= 0);
    const targets = r.correct_indexes
      .map((i) => filledIdx[i])
      .filter((i): i is number => i !== undefined);
    if (hasAnswer || targets.length === 0) {
      // 答案已設：只補空的解析，不算 applied
      if (!hasAnswer) skipped += 1;
      else {
        skipped += 1;
        if (!d.explanation.trim() && r.explanation) {
          return { ...d, explanation: r.explanation };
        }
      }
      return d;
    }
    applied += 1;
    return {
      ...d,
      allow_multiple: targets.length > 1 ? true : d.allow_multiple,
      options: d.options.map((o, i) =>
        targets.includes(i) ? { ...o, is_correct: true } : o,
      ),
      explanation: d.explanation.trim() ? d.explanation : r.explanation,
    };
  });
  return { drafts: next, applied, skipped };
}

/**
 * AI 考點分析：考點只在「沒選」時填；年段只在「不限」時填。
 * 兩者都已設定的題算 skipped。
 */
export function applyAiAnalysis(
  drafts: QuestionDraft[],
  results: AiAnalyzeResult[],
): ApplyResult {
  const byKey = new Map(results.map((r) => [r.key, r]));
  let applied = 0;
  let skipped = 0;
  const next = drafts.map((d) => {
    const r = byKey.get(d.key);
    if (!r) return d;
    const fillPoints = d.exam_points.length === 0 && r.exam_points.length > 0;
    const fillGrade =
      d.grade[0] === null &&
      d.grade[1] === null &&
      (r.grade_min !== null || r.grade_max !== null);
    if (!fillPoints && !fillGrade) {
      skipped += 1;
      return d;
    }
    applied += 1;
    return {
      ...d,
      exam_points: fillPoints ? r.exam_points : d.exam_points,
      grade: fillGrade ? ([r.grade_min, r.grade_max] as GradeRange) : d.grade,
      // 有填年段就展開進階設定讓老師看到
      advancedOpen: d.advancedOpen || fillGrade,
    };
  });
  return { drafts: next, applied, skipped };
}

/** 考卷擷取結果 → 題目卡（帶左側批次值；圖上有標的答案直接勾） */
export function draftsFromExtracted(
  items: MagicPasteMcItem[],
  defaults: BatchDefaults,
): QuestionDraft[] {
  return items.map((it) => {
    const d = emptyDraft(defaults);
    const count = Math.min(it.options.length, MAX_OPTION_SLOTS);
    const slots = Math.max(BASE_OPTION_SLOTS, count);
    const options: OptionDraft[] = Array.from({ length: slots }, (_, i) => ({
      text: it.options[i] ?? "",
      is_correct: it.correct_indexes.includes(i) && i < count,
      image_url: null,
    }));
    return {
      ...d,
      stem: it.stem,
      explanation: it.explanation ?? "",
      options,
      extraOptionsShown: slots > BASE_OPTION_SLOTS,
      allow_multiple: it.correct_indexes.length > 1,
    };
  });
}
