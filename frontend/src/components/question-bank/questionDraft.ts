/**
 * 題庫編輯面板的草稿型別與純驗證函式（Issue #1064 / #1082）。
 *
 * 放在獨立檔案讓 QuestionCard / QuestionSheet / QuestionUnitList 共用，也方便單測：
 * 驗證函式只回傳 i18n key（不呼叫 t），由呼叫端翻譯。
 *
 * 兩種草稿、一種「單元」：
 * - `QuestionDraft`：單題（目前只有選擇題）。每題自己帶：考點（必填）、年段、教材關聯。
 * - `GroupDraft`：題組（閱讀／克漏字…）：主圖文 layout + 多個小題 `QuestionDraft`。
 * - `UnitDraft`：sheet 右欄的一個單元 = 單題或題組；儲存逐單元送出，單題走
 *   createQuestion／updateQuestion，題組走 createQuestionGroup（整組一個交易）。
 *
 * 左側批次設定只是「覆寫所有單元」的捷徑，儲存時仍是逐單元送出各自的值。
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
  GlossaryEntry,
  LayoutDoc,
  Question,
  QuestionCreateInput,
  QuestionGroup,
  QuestionGroupCreateInput,
  QuestionGroupUpdateInput,
  QuestionType,
  QuestionUpdateInput,
  QuestionVisibility,
  SimilarQuestionsResponse,
  StimulusType,
} from "@/types/questionBank";
import { layoutToPlainText } from "./layoutInline";
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
    question_type: "multiple_choice",
    groupKey: null,
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
    question_type: q.question_type,
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
// 題組草稿與「單元」（#1082 骨架；閱讀題組編輯器在下一段接上）
// --------------------------------------------------------------------------- #

export interface GroupDraft {
  /** React key；小題的 groupKey 指向它 */
  key: string;
  question_type: QuestionType;
  stimulus_type: StimulusType;
  title: string;
  /** 主圖文排版；null = 只用 passage_text + image_url */
  layout: LayoutDoc | null;
  glossary: GlossaryEntry[];
  image_url: string | null;
  /**
   * 「文字版」（搜尋／AI 用，不顯示給學生）。沒改過時由 layout 推導（`groupPassageText`），
   * 老師在文字版分頁改過（`passage_text_edited`）就以這裡的為準；「重新產生」清掉。
   */
  passage_text: string;
  passage_text_edited: boolean;
  /** 小題（groupKey 都指向本題組） */
  questions: QuestionDraft[];
  grade: GradeRange;
  program_link: ProgramLessonLink | null;
  visibility: QuestionVisibility | null;
  sources: ComboboxItem[];
  serverError: string | null;
  existingId: number | null;
}

/** sheet 右欄的一個單元：單題或題組 */
export type UnitDraft =
  | { kind: "single"; draft: QuestionDraft }
  | { kind: "group"; draft: GroupDraft };

export function emptyGroupDraft(
  question_type: QuestionType = "reading",
  defaults: BatchDefaults = emptyBatchDefaults(),
): GroupDraft {
  return {
    key: nextKey(),
    question_type,
    stimulus_type: "passage",
    title: "",
    layout: null,
    glossary: [],
    image_url: null,
    passage_text: "",
    passage_text_edited: false,
    questions: [],
    grade: [...defaults.grade] as GradeRange,
    program_link: defaults.program_link ? { ...defaults.program_link } : null,
    visibility: null,
    sources: [],
    serverError: null,
    existingId: null,
  };
}

/** 題組內新增一個小題：帶題組的題型、年段、教材；考點各題自選 */
export function emptyGroupQuestion(g: GroupDraft): QuestionDraft {
  const d = emptyDraft({
    exam_points: [],
    grade: g.grade,
    program_link: g.program_link,
  });
  d.question_type = g.question_type;
  d.groupKey = g.key;
  d.visibility = g.visibility;
  d.sources = g.sources;
  return d;
}

export function groupDraftFromGroup(g: QuestionGroup): GroupDraft {
  const first = g.questions[0];
  const draft: GroupDraft = {
    key: nextKey(),
    question_type: g.question_type,
    stimulus_type: g.stimulus_type,
    title: g.title ?? "",
    layout: g.layout,
    glossary: g.glossary ?? [],
    image_url: g.image_url,
    passage_text: g.passage_text ?? "",
    // 存的文字跟排版推導出來的不一樣 = 老師改過（純圖題組沒有推導文字，有存就是改過）
    passage_text_edited:
      (g.passage_text ?? "").trim() !== "" &&
      (g.passage_text ?? "").trim() !== layoutToPlainText(g.layout).trim(),
    questions: [],
    grade: [g.grade_min, g.grade_max],
    // 題組層沒有教材關聯／來源欄位：以第一個小題的值當左欄預填（各小題仍各自帶）
    program_link: first?.program_links[0]
      ? {
          program_id: first.program_links[0].program_id,
          lesson_id: first.program_links[0].lesson_id,
        }
      : null,
    visibility: g.visibility,
    sources: first ? first.sources.map(sourceToItem) : [],
    serverError: null,
    existingId: g.id,
  };
  draft.questions = g.questions.map((q) => ({
    ...draftFromQuestion(q),
    groupKey: draft.key,
  }));
  return draft;
}

/** 克漏字小題題幹可空 */
export function groupStemOptional(g: GroupDraft): boolean {
  return g.question_type === "cloze";
}

/** 題組有內容 = 有排版、有文字版或有圖 */
export function groupHasStimulus(g: GroupDraft): boolean {
  return (
    (g.layout !== null && g.layout.rows.length > 0) ||
    g.passage_text.trim() !== "" ||
    g.image_url !== null
  );
}

/** 排版裡有沒有沒填完的區塊（空標題／段落、沒圖的圖片、對話缺說話者或內容） */
export function layoutIncomplete(layout: LayoutDoc | null): boolean {
  if (!layout) return false;
  for (const node of layout.rows) {
    const rows = node.type === "section" ? node.rows : [node];
    for (const row of rows) {
      for (const col of row.columns) {
        for (const b of col.blocks) {
          if (b.type === "heading" || b.type === "paragraph") {
            if (!b.text.trim()) return true;
          } else if (b.type === "image") {
            if (!b.url) return true;
          } else if (
            b.lines.length === 0 ||
            b.lines.some((l) => !l.speaker.trim() || !l.text.trim())
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/** 送後端前丟掉空白的單字註解列 */
export function cleanGlossary(
  entries: GlossaryEntry[],
): GlossaryEntry[] | null {
  const kept = entries
    .map((e) => ({ word: e.word.trim(), zh: e.zh.trim() }))
    .filter((e) => e.word && e.zh);
  return kept.length > 0 ? kept : null;
}

/**
 * 單字註解文字框 ↔ 陣列：一行一筆「word 中文」，第一段空白（含全形空白）之後全是中文。
 * 沒有第二段 → zh 空字串（送出前由 cleanGlossary 丟掉）；空白行保留為空列，方便打字中途。
 */
export function parseGlossaryText(text: string): GlossaryEntry[] {
  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    const m = trimmed.match(/^(\S+)[\s\u3000]+(.*)$/);
    if (m) return { word: m[1], zh: m[2].trim() };
    return { word: trimmed, zh: "" };
  });
}

export function glossaryToText(entries: GlossaryEntry[]): string {
  return entries.map((e) => (e.zh ? `${e.word} ${e.zh}` : e.word)).join("\n");
}

/** 題組驗證：主圖文、排版填完、至少一個小題、每個小題合法、公開必選。回傳 i18n key 或 null */
export function validateGroupDraft(g: GroupDraft): string | null {
  if (!groupHasStimulus(g)) return "groupNeedsContent";
  if (layoutIncomplete(g.layout)) return "layoutIncomplete";
  if (g.questions.length === 0) return "groupNeedsQuestions";
  const stemOptional = groupStemOptional(g);
  for (const q of g.questions) {
    const err = validateDraft(
      { ...q, visibility: g.visibility },
      { stemOptional },
    );
    if (err) return err;
  }
  if (g.visibility === null) return "visibilityRequired";
  return null;
}

/**
 * 素材類型不再讓老師選，由內容判定：只有圖片區塊 → image、沒有圖片 → passage、
 * 圖文都有 → mixed；沒有排版時看有沒有整組圖片（以圖為準）。
 */
export function deriveStimulusType(
  layout: LayoutDoc | null,
  imageUrl: string | null,
): StimulusType {
  if (!layout || layout.rows.length === 0) {
    return imageUrl ? "image" : "passage";
  }
  let images = 0;
  let texts = 0;
  for (const node of layout.rows) {
    const rows = node.type === "section" ? node.rows : [node];
    for (const row of rows) {
      for (const col of row.columns) {
        for (const b of col.blocks) {
          if (b.type === "image") images += 1;
          else texts += 1;
        }
      }
    }
  }
  if (images > 0 && texts === 0) return "image";
  if (images === 0) return "passage";
  return "mixed";
}

/** 排版推導出的文字版（去標記、段落以空行隔開）；沒有排版或排版沒有文字 → "" */
export function groupDerivedText(g: GroupDraft): string {
  return layoutToPlainText(g.layout);
}

/**
 * 送後端的文字版：老師改過就用老師的；否則用排版推導，推導不出（純圖／沒排版）才用
 * 老師手打的；都空 → null。後端規則是「有送 passage_text 就存它」，所以這裡決定的就是最終值。
 */
export function groupPassageText(g: GroupDraft): string | null {
  const own = g.passage_text.trim();
  const text = g.passage_text_edited ? own : groupDerivedText(g) || own;
  return text || null;
}

function groupQuestionInput(q: QuestionDraft, i: number) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { question_type, organization_id, school_id, visibility, ...rest } =
    toCreateInput(q);
  return { ...rest, group_order: i };
}

/** 題組送後端的 payload：小題不帶 question_type／歸屬／公開（跟隨題組） */
export function toCreateGroupInput(
  g: GroupDraft,
  organizationId?: string,
): QuestionGroupCreateInput {
  return {
    question_type: g.question_type,
    stimulus_type: deriveStimulusType(g.layout, g.image_url),
    title: g.title.trim() || null,
    passage_text: groupPassageText(g),
    image_url: g.image_url,
    layout: g.layout,
    glossary: cleanGlossary(g.glossary),
    grade_min: g.grade[0],
    grade_max: g.grade[1],
    visibility: g.visibility ?? "private",
    questions: g.questions.map(groupQuestionInput),
    organization_id: organizationId ?? null,
  };
}

/** 編輯既有題組的 PATCH payload：整組欄位 + 小題整份對齊（帶 existingId 的更新、其餘新增） */
export function toUpdateGroupInput(g: GroupDraft): QuestionGroupUpdateInput {
  return {
    stimulus_type: deriveStimulusType(g.layout, g.image_url),
    title: g.title.trim() || null,
    passage_text: groupPassageText(g),
    image_url: g.image_url,
    layout: g.layout,
    glossary: cleanGlossary(g.glossary),
    grade_min: g.grade[0],
    grade_max: g.grade[1],
    visibility: g.visibility ?? "private",
    questions: g.questions.map((q, i) => ({
      ...groupQuestionInput(q, i),
      ...(q.existingId !== null ? { id: q.existingId } : {}),
    })),
  };
}

/** 題組小題的 AI 上下文：key → 主圖文純文字（單題沒有） */
export function unitPassageByKey(units: UnitDraft[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const u of units) {
    if (u.kind !== "group") continue;
    const passage = groupPassageText(u.draft);
    if (!passage) continue;
    for (const q of u.draft.questions) map.set(q.key, passage);
  }
  return map;
}

/** 單元內所有單題草稿（含題組小題），供批次語音／AI／重複偵測沿用單題邏輯 */
export function unitQuestions(units: UnitDraft[]): QuestionDraft[] {
  return units.flatMap((u) =>
    u.kind === "single" ? [u.draft] : u.draft.questions,
  );
}

/** 對單元內每個單題草稿套 fn（含題組小題），回傳新的單元陣列 */
export function mapUnitQuestions(
  units: UnitDraft[],
  fn: (d: QuestionDraft) => QuestionDraft,
): UnitDraft[] {
  return units.map((u) =>
    u.kind === "single"
      ? { kind: "single", draft: fn(u.draft) }
      : {
          kind: "group",
          draft: { ...u.draft, questions: u.draft.questions.map(fn) },
        },
  );
}

/** 單元 key（單題 = draft.key；題組 = group key），DOM id 與 React key 共用 */
export function unitKey(u: UnitDraft): string {
  return u.draft.key;
}

export function unitHasContent(u: UnitDraft): boolean {
  return u.kind === "single"
    ? draftHasContent(u.draft)
    : u.draft.questions.length > 0 || groupHasStimulus(u.draft);
}

// --------------------------------------------------------------------------- #
// AI 工具（#1065）：只填空的，不動老師已設的
// --------------------------------------------------------------------------- #

/** 可送給 AI 的題：有題幹（或題組小題有主圖文上下文）且有填的選項 ≥ 2 */
export function draftsEligibleForAi(
  drafts: QuestionDraft[],
  passageByKey: Map<string, string> = new Map(),
): QuestionDraft[] {
  return drafts.filter(
    (d) =>
      (draftHasContent(d) || passageByKey.has(d.key)) &&
      d.options.filter(optionFilled).length >= 2,
  );
}

/** 轉成 API 輸入；options 只送有填的（index 對應 applyAiAnswers 用 filled 順序）；題組小題附主圖文 */
export function toAiInputs(
  drafts: QuestionDraft[],
  passageByKey: Map<string, string> = new Map(),
): AiQuestionInput[] {
  return drafts.map((d) => {
    const passage = passageByKey.get(d.key);
    return {
      key: d.key,
      stem: d.stem.trim(),
      options: d.options
        .filter(optionFilled)
        .map((o) => o.text.trim() || "(圖片選項)"),
      ...(passage ? { passage } : {}),
    };
  });
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
