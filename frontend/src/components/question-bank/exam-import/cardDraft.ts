/**
 * 上傳題本核對畫面（#1112 C4b）：題目卡（卡片格式）↔ 題庫編輯草稿（QuestionDraft／GroupDraft）。
 *
 * 純函式，不呼叫 API。編輯沿用 QuestionCard／GroupCard（題庫規則 7：不複製），所以卡片要先轉成
 * 它們吃的草稿；收合（完成編輯）時再把草稿轉回卡片格式送 PATCH（後端只收卡片格式，cold-read B2）。
 *
 * - `cardToUnit`／`cardToUnitWithOrder`：卡片 → `UnitDraft`（後者另回「草稿小題 key → 卡片原本第幾題」，
 *   克漏字依 `blank` 排序過也對得回原題，唯讀卡片的右邊欄、導覽格與送出順序都用它）。單題用 `draftsFromExtracted`；題組用 `groupDraftFromExtracted`
 *   排出主圖文（段落 → layout，與題庫自己出題同規則），小題則依卡片原順序另外建（每題的考點、原卷
 *   題號才對得回來；克漏字依 `blank` 排序）。老師之前改過排版（卡片帶 `layout`）就用卡片的排版。
 *   後端裁好的題幹圖、選項圖、插圖、整張圖直接帶進草稿。考點：`exam_point_ids` 優先，再用
 *   `exam_point_codes` 對考點目錄。
 * - `unitToCardPatch`：只送「跟打開編輯時比有變」的欄位（後端比對新舊記 `teacher_edited`，送了沒變的
 *   值也不會記，但考點代碼對不到目錄時會被誤記，所以前端也先比一次）；題組小題用原卷題號對回原題，
 *   小題沒增刪、沒換順序時**依卡片原順序**送（沒有原卷題號的克漏字，後端依位置對回；C4b 審查 6）。
 *   帶上打開時的卡片版本 `rev`（後端版本不符回 409，避免蓋掉編輯期間併入的下一頁內容；C4b 審查 1）。
 *   完全沒改回傳 null（不送 PATCH）。
 * - `questionInputFromDraft`：一題草稿 → 卡片格式（只留有填的選項，正確答案依留下的選項重編）。
 */
import type { MagicPasteGroupResult } from "@/components/shared/MagicPasteInput";
import type { ExamPoint, QuestionType } from "@/types/questionBank";
import { groupDraftFromExtracted } from "../extractedGroup";
import { layoutToPlainText } from "../layoutInline";
import {
  draftsFromExtracted,
  emptyBatchDefaults,
  emptyGroupDraft,
  groupPassageText,
  optionFilled,
  sortClozeQuestions,
  type GroupDraft,
  type QuestionDraft,
  type UnitDraft,
} from "../questionDraft";
import type {
  CardGroupInput,
  CardPatchInput,
  CardQuestionInput,
  ExamImportCard,
  ExamImportCardQuestion,
} from "./types";

export interface ExamPointCatalog {
  byId: Map<number, ExamPoint>;
  byCode: Map<string, ExamPoint>;
}

export function makeCatalog(points: ExamPoint[]): ExamPointCatalog {
  return {
    byId: new Map(points.map((p) => [p.id, p])),
    byCode: new Map(points.map((p) => [p.code, p])),
  };
}

export const EMPTY_CATALOG: ExamPointCatalog = makeCatalog([]);

/** 一題的考點：先 id、再 code，去重 */
export function examPointsOf(
  q: ExamImportCardQuestion,
  catalog: ExamPointCatalog,
): ExamPoint[] {
  const out: ExamPoint[] = [];
  const seen = new Set<number>();
  const push = (ep: ExamPoint | undefined) => {
    if (ep && !seen.has(ep.id)) {
      seen.add(ep.id);
      out.push(ep);
    }
  };
  (q.exam_point_ids ?? []).forEach((id) => push(catalog.byId.get(id)));
  (q.exam_point_codes ?? []).forEach((c) => push(catalog.byCode.get(c)));
  return out;
}

function questionDraftFromCard(
  q: ExamImportCardQuestion,
  catalog: ExamPointCatalog,
): QuestionDraft {
  const [d] = draftsFromExtracted(
    [
      {
        stem: q.stem ?? "",
        options: q.options ?? [],
        correct_indexes: q.correct_indexes ?? [],
        explanation: q.explanation ?? "",
        blank: q.blank ?? null,
      },
    ],
    emptyBatchDefaults(),
    {
      stemUrls: [q.image_url ?? null],
      optionUrls: [q.option_image_urls ?? []],
    },
  );
  return {
    ...d,
    blank_index: q.blank ?? null,
    exam_points: examPointsOf(q, catalog),
  };
}

/** 編輯中的一張卡：草稿＋每題（以草稿 key）對回卡片的原卷題號與打開時的卡片格式 */
export interface CardEditState {
  cardId: string;
  unit: UnitDraft;
  /** 草稿 key → 原卷題號（新加的小題沒有） */
  sourceNos: Record<string, string | null>;
  /** 打開編輯時每題的卡片格式（比對有沒有改） */
  initialQuestions: Record<string, CardQuestionInput>;
  initialGroup: CardGroupInput | null;
  /** 草稿小題 key 依卡片原順序排（小題沒增刪、沒換順序時照這個順序送） */
  originalOrder: string[];
  /** 打開編輯時的卡片版本（PATCH 帶回；舊草稿沒有就不帶） */
  rev?: number;
}

export interface UnitWithOrder {
  unit: UnitDraft;
  /** 草稿小題 key → 卡片原本第幾題（單題：0） */
  originalIndex: Record<string, number>;
}

export function cardToUnit(
  card: ExamImportCard,
  catalog: ExamPointCatalog,
): UnitDraft {
  return cardToUnitWithOrder(card, catalog).unit;
}

export function cardToUnitWithOrder(
  card: ExamImportCard,
  catalog: ExamPointCatalog,
): UnitWithOrder {
  if (card.kind !== "group") {
    const draft = questionDraftFromCard(card.question ?? {}, catalog);
    return {
      unit: { kind: "single", draft },
      originalIndex: { [draft.key]: 0 },
    };
  }
  const g = card.group ?? {};
  const type: QuestionType = g.group_type === "cloze" ? "cloze" : "reading";
  const st = g.stimulus ?? {};
  const figures = st.figures ?? [];
  const result: MagicPasteGroupResult = {
    title: g.title ?? "",
    stimulus: {
      kind: st.kind === "image" ? "image" : "text",
      paragraphs: st.paragraphs ?? [],
      text: st.text ?? "",
      box_2d: null,
      page: null,
      figures: figures.map((f) => ({
        box_2d: [],
        placement: f.placement,
        after_paragraph: f.after_paragraph,
        side: f.side,
        width: f.width,
        caption: f.caption ?? "",
      })),
      framed: st.framed,
      dialogue: st.dialogue ?? [],
    },
    glossary: g.glossary ?? [],
    questions: [],
  };
  const base = emptyGroupDraft(type);
  let draft: GroupDraft = groupDraftFromExtracted(result, base, {
    stimulusUrl: st.image_url ?? null,
    figureUrls: figures.map((f) => f.url ?? null),
  });
  // 老師之前在核對畫面改過排版：用卡片上的排版與文字版
  if (g.layout !== undefined && g.layout !== null) {
    const segments = g.segments ?? [];
    const text = g.passage_text ?? "";
    draft = {
      ...draft,
      layout: g.layout,
      passage_text: text,
      passage_text_edited:
        segments.length === 0 &&
        text.trim() !== "" &&
        text.trim() !== layoutToPlainText(g.layout).trim(),
      segments,
    };
  }
  const originalIndex: Record<string, number> = {};
  const questions = (g.questions ?? []).map((q, i) => {
    const d: QuestionDraft = {
      ...questionDraftFromCard(q, catalog),
      question_type: type,
      groupKey: draft.key,
    };
    originalIndex[d.key] = i;
    return d;
  });
  return {
    unit: {
      kind: "group",
      draft: {
        ...draft,
        questions: type === "cloze" ? sortClozeQuestions(questions) : questions,
      },
    },
    originalIndex,
  };
}

/** 一題草稿 → 卡片格式（只留有填的選項；正確答案依留下的選項重編） */
export function questionInputFromDraft(
  d: QuestionDraft,
  sourceNo: string | null,
): CardQuestionInput {
  const filled = d.options.filter(optionFilled);
  return {
    stem: d.stem.trim(),
    options: filled.map((o) => o.text.trim()),
    correct_indexes: filled.flatMap((o, i) => (o.is_correct ? [i] : [])),
    explanation: d.explanation.trim(),
    exam_point_ids: d.exam_points.map((ep) => ep.id),
    exam_point_codes: d.exam_points.map((ep) => ep.code),
    image_url: d.image_url,
    option_image_urls: filled.map((o) => o.image_url),
    source_question_no: sourceNo,
    blank: d.blank_index,
  };
}

function groupInputFromDraft(g: GroupDraft): CardGroupInput {
  return {
    title: g.title.trim(),
    glossary: g.glossary
      .map((e) => ({ word: e.word.trim(), zh: e.zh.trim() }))
      .filter((e) => e.word !== "" && e.zh !== ""),
    layout: g.layout,
    passage_text: groupPassageText(g),
    segments: g.segments,
  };
}

/** 打開編輯：卡片 → 草稿＋比對用的初始值 */
export function startEdit(
  card: ExamImportCard,
  catalog: ExamPointCatalog,
): CardEditState {
  const { unit, originalIndex } = cardToUnitWithOrder(card, catalog);
  const sourceNos: Record<string, string | null> = {};
  const initialQuestions: Record<string, CardQuestionInput> = {};
  let originalOrder: string[];
  if (unit.kind === "single") {
    const no = card.question?.source_question_no ?? null;
    sourceNos[unit.draft.key] = no;
    initialQuestions[unit.draft.key] = questionInputFromDraft(unit.draft, no);
    originalOrder = [unit.draft.key];
  } else {
    // 草稿小題（克漏字排序過）以 originalIndex 對回卡片原本那一題
    const qs = card.group?.questions ?? [];
    unit.draft.questions.forEach((d) => {
      const no = qs[originalIndex[d.key]]?.source_question_no ?? null;
      sourceNos[d.key] = no;
      initialQuestions[d.key] = questionInputFromDraft(d, no);
    });
    originalOrder = unit.draft.questions
      .map((d) => d.key)
      .sort((a, b) => originalIndex[a] - originalIndex[b]);
  }
  return {
    cardId: card.card_id,
    unit,
    sourceNos,
    initialQuestions,
    initialGroup:
      unit.kind === "group" ? groupInputFromDraft(unit.draft) : null,
    originalOrder,
    ...(typeof card.rev === "number" ? { rev: card.rev } : {}),
  };
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** 一題只留有改的欄位（原卷題號一律帶，後端用它對回原題） */
function changedQuestion(
  next: CardQuestionInput,
  initial: CardQuestionInput | undefined,
): CardQuestionInput | null {
  if (!initial) return next;
  const out: CardQuestionInput = {};
  let changed = false;
  (Object.keys(next) as (keyof CardQuestionInput)[]).forEach((k) => {
    if (k === "source_question_no") return;
    if (!same(next[k], initial[k])) {
      (out as Record<string, unknown>)[k] = next[k];
      changed = true;
    }
  });
  // 改考點時 id 與代碼一起送（後端兩個都看）
  if ("exam_point_ids" in out || "exam_point_codes" in out) {
    out.exam_point_ids = next.exam_point_ids;
    out.exam_point_codes = next.exam_point_codes;
  }
  if (!same(next.source_question_no, initial.source_question_no))
    changed = true;
  out.source_question_no = next.source_question_no;
  return changed ? out : null;
}

/** 收合編輯：草稿 → 只含有改欄位的 PATCH；完全沒改回傳 null */
export function unitToCardPatch(edit: CardEditState): CardPatchInput | null {
  const { unit } = edit;
  const rev = typeof edit.rev === "number" ? { rev: edit.rev } : {};
  if (unit.kind === "single") {
    const next = questionInputFromDraft(
      unit.draft,
      edit.sourceNos[unit.draft.key] ?? null,
    );
    const q = changedQuestion(next, edit.initialQuestions[unit.draft.key]);
    return q ? { ...rev, question: q } : null;
  }
  const g = unit.draft;
  const nextGroup = groupInputFromDraft(g);
  const init = edit.initialGroup ?? {};
  const group: CardGroupInput = {};
  if (!same(nextGroup.title, init.title)) group.title = nextGroup.title;
  if (!same(nextGroup.glossary, init.glossary))
    group.glossary = nextGroup.glossary;
  // 排版：layout／文字版／對話任一有改，三個一起送（存入時原樣採用）
  if (
    !same(nextGroup.layout, init.layout) ||
    !same(nextGroup.passage_text, init.passage_text) ||
    !same(nextGroup.segments, init.segments)
  ) {
    group.layout = nextGroup.layout;
    group.passage_text = nextGroup.passage_text;
    group.segments = nextGroup.segments;
  }
  const initialKeys = Object.keys(edit.initialQuestions);
  const currentKeys = g.questions.map((q) => q.key);
  const structureChanged = !same(initialKeys, currentKeys);
  // 結構沒變：依卡片原順序（後端沒有原卷題號時依位置對回原題）；有增刪、換順序：照草稿順序整份送
  const byKey = new Map(g.questions.map((d) => [d.key, d]));
  const ordered = structureChanged
    ? g.questions
    : edit.originalOrder.flatMap((k) => {
        const d = byKey.get(k);
        return d ? [d] : [];
      });
  const questions = ordered.map((d) => {
    const next = questionInputFromDraft(d, edit.sourceNos[d.key] ?? null);
    return {
      full: next,
      diff: changedQuestion(next, edit.initialQuestions[d.key]),
    };
  });
  if (structureChanged || questions.some((q) => q.diff)) {
    // 小題增刪、換順序時整份送；否則每題只送有改的欄位（沒改的只帶原卷題號）
    group.questions = questions.map((q) =>
      structureChanged
        ? q.full
        : (q.diff ?? { source_question_no: q.full.source_question_no }),
    );
  }
  return Object.keys(group).length > 0 ? { ...rev, group } : null;
}
