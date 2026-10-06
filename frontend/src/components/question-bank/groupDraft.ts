/**
 * 題組草稿（#1082 / #1083 / #1085；自 questionDraft.ts 拆出）。
 *
 * - `GroupDraft`：題組（閱讀／克漏字…）= 主圖文 layout + 多個小題 `QuestionDraft`。
 * - `UnitDraft`：sheet 右欄的一個單元 = 單題或題組；儲存逐單元送出，單題走
 *   createQuestion／updateQuestion，題組走 createQuestionGroup／updateQuestionGroup（整組一個交易）。
 * - 克漏字包裝：空格運算本身在 clozeDraft.ts，這裡處理 GroupDraft 層（自動建卡、重新編號、驗證）。
 * - 文字版：`groupPassageText`（老師改過／排版推導／對話文稿 segments 三種來源）。
 * - 送後端：`toCreateGroupInput`／`toUpdateGroupInput`；`passage_view` 是純 UI 狀態不送。
 *
 * 依賴方向：groupDraft → draftCore（單題核心），不反向。外部一律從 `questionDraft.ts` 匯入。
 */

import type { GradeRange } from "@/components/shared/GradeRangeSlider";
import type { ProgramLessonLink } from "@/components/shared/ProgramLessonPicker";
import type { ComboboxItem } from "@/components/shared/CreatableCombobox";
import type {
  GlossaryEntry,
  GroupSegmentInput,
  LayoutDoc,
  QuestionGroup,
  QuestionGroupCreateInput,
  QuestionGroupUpdateInput,
  QuestionType,
  QuestionVisibility,
  StimulusType,
} from "@/types/questionBank";
import {
  layoutBlankIndexes,
  layoutBlankOccurrences,
  layoutToNumberedText,
  layoutToPlainText,
} from "./layoutInline";
import {
  appendBlankToLayout,
  clozeBlankDiff,
  clozeBlankError,
  clozeNeedsRenumber,
  clozeOrphanBlanks,
  nextBlankIndex,
  renumberLayoutBlanks,
  renumberMap,
} from "./clozeDraft";
import { dialogueNarration, dialoguePassageText } from "./dialogueTranscript";
import { sourceToItem } from "./sourcesCombobox";
import {
  type BatchDefaults,
  type QuestionDraft,
  draftFromQuestion,
  draftHasContent,
  emptyBatchDefaults,
  emptyDraft,
  nextKey,
  optionFilled,
  toCreateInput,
  validateDraft,
} from "./draftCore";

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
  /**
   * 對話文稿（#1083）：圖片有人物對話時 AI 整理的逐句「說話者: 台詞」，老師不可修改。
   * 有值時文字版 = 開頭的非對話文字＋逐句對話（dialogueTranscript.ts），不看 edited。
   */
  segments: GroupSegmentInput[];
  /** 純 UI 狀態（不送後端）：主圖文目前分頁；標題列「預覽」跟著它畫排版或文字版 */
  passage_view: "layout" | "text";
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
    segments: [],
    passage_view: "layout",
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
  const segments = (g.segments ?? []).map((s) => ({
    speaker_label: s.speaker_label,
    transcript: s.transcript,
  }));
  const draft: GroupDraft = {
    key: nextKey(),
    question_type: g.question_type,
    stimulus_type: g.stimulus_type,
    title: g.title ?? "",
    layout: g.layout,
    glossary: g.glossary ?? [],
    image_url: g.image_url,
    passage_text: g.passage_text ?? "",
    // 存的文字跟排版推導出來的不一樣 = 老師改過（純圖題組沒有推導文字，有存就是改過）；
    // 有對話文稿時文字版由 segments 推導、不可改，edited 無意義
    passage_text_edited:
      segments.length === 0 &&
      (g.passage_text ?? "").trim() !== "" &&
      (g.passage_text ?? "").trim() !== layoutToPlainText(g.layout).trim(),
    segments,
    passage_view: "layout",
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

// --------------------------------------------------------------------------- #
// 克漏字（#1085）：GroupDraft 層的包裝，空格運算本身在 clozeDraft.ts
// --------------------------------------------------------------------------- #

export function isClozeGroup(g: GroupDraft): boolean {
  return g.question_type === "cloze";
}

/** 題組（文章）內的空格編號，依閱讀順序（去重） */
export function clozeBlanks(g: GroupDraft): number[] {
  return layoutBlankIndexes(g.layout);
}

/** 題組（文章）內的空格編號，依出現順序、**不去重**（偵測同編號貼兩次用） */
export function clozeBlankOccurrences(g: GroupDraft): number[] {
  return layoutBlankOccurrences(g.layout);
}

function questionBlanks(g: GroupDraft): (number | null)[] {
  return g.questions.map((q) => q.blank_index);
}

/** 手動插入時要用的新編號 = 最大編號 + 1（匯入 40–43 後接 44）；超過 999 才改找最小未使用，1..999 全滿回 null（按鈕要 disable） */
export function nextClozeBlankIndex(g: GroupDraft): number | null {
  return nextBlankIndex(clozeBlanks(g), questionBlanks(g));
}

/** 小題依空格編號升冪（沒編號的排最後）；克漏字不開放拖曳排序 */
export function sortClozeQuestions(
  questions: QuestionDraft[],
): QuestionDraft[] {
  return [...questions].sort(
    (a, b) => (a.blank_index ?? Infinity) - (b.blank_index ?? Infinity),
  );
}

/** 「空白」小題 = 沒題幹沒圖、沒填選項、沒考點、沒解析 → 空格被刪掉時可以自動移除 */
function clozeQuestionIsBlank(q: QuestionDraft): boolean {
  return (
    !draftHasContent(q) &&
    q.options.every((o) => !optionFilled(o)) &&
    q.exam_points.length === 0 &&
    q.explanation.trim() === ""
  );
}

/** 建一張對應空格 n 的小題卡 */
export function clozeQuestionFor(g: GroupDraft, n: number): QuestionDraft {
  return { ...emptyGroupQuestion(g), blank_index: n };
}

/**
 * 文字改動後同步小題：新出現的空格自動建卡，消失的空格若對應小題還是空白就移除
 * （有內容就留著並由 `clozeOrphanBlanksOf` 標成「找不到空格 n」，驗證會擋住儲存）。
 * 非克漏字題組原樣回傳。
 */
export function syncClozeQuestions(
  g: GroupDraft,
  beforeLayout: LayoutDoc | null,
  afterLayout: LayoutDoc | null,
): GroupDraft {
  if (!isClozeGroup(g)) return g;
  const { added, removed } = clozeBlankDiff(
    layoutBlankIndexes(beforeLayout),
    layoutBlankIndexes(afterLayout),
  );
  if (added.length === 0 && removed.length === 0) return g;
  const next = { ...g, layout: afterLayout };
  let questions = g.questions;
  if (removed.length > 0) {
    questions = questions.filter(
      (q) =>
        q.blank_index === null ||
        !removed.includes(q.blank_index) ||
        !clozeQuestionIsBlank(q),
    );
  }
  const taken = new Set(questions.map((q) => q.blank_index));
  const fresh = added
    .filter((n) => !taken.has(n))
    .map((n) => clozeQuestionFor(next, n));
  return { ...next, questions: sortClozeQuestions([...questions, ...fresh]) };
}

/** 小題指向的空格已不在文章裡的編號清單 */
export function clozeOrphanBlanksOf(g: GroupDraft): number[] {
  if (!isClozeGroup(g)) return [];
  return clozeOrphanBlanks(clozeBlanks(g), questionBlanks(g));
}

/** 編號是否已經是閱讀順序 1..k（否 → 顯示「依閱讀順序重新編號」） */
export function clozeCanRenumber(g: GroupDraft): boolean {
  return isClozeGroup(g) && clozeNeedsRenumber(clozeBlanks(g));
}

/** 依閱讀順序重新編號：layout 的 `{{n}}` 與小題 `blank_index` 一起映射 */
export function renumberClozeBlanks(g: GroupDraft): GroupDraft {
  if (!isClozeGroup(g) || g.layout === null) return g;
  const map = renumberMap(clozeBlanks(g));
  return {
    ...g,
    layout: renumberLayoutBlanks(g.layout, map),
    questions: sortClozeQuestions(
      g.questions.map((q) => ({
        ...q,
        blank_index:
          q.blank_index === null
            ? null
            : (map.get(q.blank_index) ?? q.blank_index),
      })),
    ),
  };
}

/** 「在文末插入空格」：layout 文末加 `{{n}}` 並建對應小題卡 */
export function appendClozeBlank(g: GroupDraft): GroupDraft {
  const n = nextClozeBlankIndex(g);
  if (n === null) return g; // 編號用完了，不做事（UI 會 disable 按鈕）
  const layout = appendBlankToLayout(g.layout, n);
  return {
    ...g,
    layout,
    questions: sortClozeQuestions([...g.questions, clozeQuestionFor(g, n)]),
  };
}

/** 「重新插入到文末」：小題還在、但文章裡的空格 n 被刪了 → 把 `{{n}}` 加回文末 */
export function reinsertClozeBlank(g: GroupDraft, n: number): GroupDraft {
  return { ...g, layout: appendBlankToLayout(g.layout, n) };
}

/** 題組有內容 = 有排版、有文字版、有圖或有對話文稿 */
export function groupHasStimulus(g: GroupDraft): boolean {
  return (
    (g.layout !== null && g.layout.rows.length > 0) ||
    g.passage_text.trim() !== "" ||
    g.image_url !== null ||
    g.segments.length > 0
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
  if (isClozeGroup(g)) {
    // 空格與小題必須一一對應（後端同規則，不合格 422）
    const err = clozeBlankError(
      clozeBlanks(g),
      questionBlanks(g),
      clozeBlankOccurrences(g),
    );
    if (err) return err;
  }
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
 * 有對話文稿時：開頭的非對話文字＋逐句對話（後端同規則重組，#1083）。
 */
export function groupPassageText(g: GroupDraft): string | null {
  if (g.segments.length > 0) {
    const narration = dialogueNarration(g.passage_text, g.segments);
    return dialoguePassageText(narration, g.segments) || null;
  }
  const own = g.passage_text.trim();
  const text = g.passage_text_edited ? own : groupDerivedText(g) || own;
  return text || null;
}

function groupQuestionInput(q: QuestionDraft, i: number) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { question_type, organization_id, school_id, visibility, ...rest } =
    toCreateInput(q);
  return { ...rest, group_order: i, blank_index: q.blank_index };
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
    segments: g.segments.length > 0 ? g.segments : null,
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
    // 一律送：重新擷取成沒有對話的圖時 [] 會清掉舊的對話文稿
    segments: g.segments,
  };
}

/** 題組小題的 AI 上下文：key → 主圖文純文字（單題沒有） */
export function unitPassageByKey(units: UnitDraft[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const u of units) {
    if (u.kind !== "group") continue;
    // 克漏字要讓模型看得到是哪個空格 → 用保留編號的版本（`(3)____`），不是 passage_text 的 `____`
    const passage = isClozeGroup(u.draft)
      ? layoutToNumberedText(u.draft.layout) || groupPassageText(u.draft)
      : groupPassageText(u.draft);
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
