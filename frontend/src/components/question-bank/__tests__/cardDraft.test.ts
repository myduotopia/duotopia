/**
 * cardDraft（#1112 C4b 審查 4）：題目卡 ↔ 編輯草稿互轉，`unitToCardPatch` 只送有改的欄位。
 *
 * - 單題：沒改 → null；改題幹 → 只送題幹＋原卷題號＋打開時的 rev
 * - 考點：改考點時 id 與代碼一起送
 * - 題組：只改一小題 → 每小題都帶原卷題號、只有改的那題帶內容；沒改 → null
 * - 克漏字（沒有原卷題號）：草稿依空格排序，送出時依卡片原順序（originalIndex 對回）
 * - 小題增刪：整份送（照草稿順序、帶完整內容）
 * - 排版：layout／文字版／對話任一有改，三個一起送
 * - 舊草稿沒有 rev：不帶 rev
 */
import { describe, it, expect } from "vitest";

import {
  cardToUnitWithOrder,
  makeCatalog,
  startEdit,
  unitToCardPatch,
  type CardEditState,
} from "../exam-import/cardDraft";
import type {
  ExamImportCard,
  ExamImportCardQuestion,
} from "../exam-import/types";
import {
  emptyDraft,
  type GroupDraft,
  type QuestionDraft,
} from "../questionDraft";
import type { ExamPoint } from "@/types/questionBank";

const POINTS: ExamPoint[] = [
  {
    id: 7,
    code: "G-01",
    parent_id: null,
    names: { "zh-TW": "現在式" },
    status: "active",
    order_index: 0,
    aliases: [],
  },
  {
    id: 8,
    code: "G-02",
    parent_id: null,
    names: { "zh-TW": "過去式" },
    status: "active",
    order_index: 1,
    aliases: [],
  },
];
const catalog = makeCatalog(POINTS);

function q(
  no: string | null,
  stem: string,
  extra: Partial<ExamImportCardQuestion> = {},
): ExamImportCardQuestion {
  return {
    source_question_no: no,
    stem,
    options: ["apple", "banana", "cherry", "durian"],
    correct_indexes: [0],
    explanation: "",
    exam_point_codes: ["G-01"],
    ...extra,
  };
}

function singleCard(extra: Partial<ExamImportCard> = {}): ExamImportCard {
  return {
    card_id: "s1",
    kind: "single",
    page_no: 1,
    rev: 3,
    question: q("41", "What is it?"),
    ...extra,
  };
}

function groupCard(
  type: "reading" | "cloze",
  questions: ExamImportCardQuestion[],
  extra: Partial<ExamImportCard> = {},
): ExamImportCard {
  return {
    card_id: "g1",
    kind: "group",
    page_no: 2,
    rev: 5,
    group: {
      group_type: type,
      title: "Passage",
      stimulus: {
        kind: "text",
        paragraphs:
          type === "cloze"
            ? ["Tom {{1}} to school. He {{2}} lunch. They {{3}} home."]
            : ["Tom goes to school.", "He eats lunch."],
      },
      glossary: [],
      questions,
    },
    ...extra,
  };
}

const groupDraft = (edit: CardEditState): GroupDraft => {
  if (edit.unit.kind !== "group") throw new Error("not a group");
  return edit.unit.draft;
};
const withGroup = (edit: CardEditState, g: GroupDraft): CardEditState => ({
  ...edit,
  unit: { kind: "group", draft: g },
});

describe("cardDraft：單題", () => {
  it("沒改 → null", () => {
    expect(unitToCardPatch(startEdit(singleCard(), catalog))).toBeNull();
  });

  it("改題幹 → 只送題幹＋原卷題號＋rev", () => {
    const edit = startEdit(singleCard(), catalog);
    if (edit.unit.kind !== "single") throw new Error();
    const next: CardEditState = {
      ...edit,
      unit: { kind: "single", draft: { ...edit.unit.draft, stem: "New?" } },
    };
    expect(unitToCardPatch(next)).toEqual({
      rev: 3,
      question: { stem: "New?", source_question_no: "41" },
    });
  });

  it("改考點 → id 與代碼一起送", () => {
    const edit = startEdit(singleCard(), catalog);
    if (edit.unit.kind !== "single") throw new Error();
    expect(edit.unit.draft.exam_points.map((p) => p.id)).toEqual([7]);
    const next: CardEditState = {
      ...edit,
      unit: {
        kind: "single",
        draft: { ...edit.unit.draft, exam_points: [POINTS[0], POINTS[1]] },
      },
    };
    expect(unitToCardPatch(next)).toEqual({
      rev: 3,
      question: {
        exam_point_ids: [7, 8],
        exam_point_codes: ["G-01", "G-02"],
        source_question_no: "41",
      },
    });
  });

  it("舊草稿沒有 rev → 不帶 rev", () => {
    const edit = startEdit(singleCard({ rev: undefined }), catalog);
    if (edit.unit.kind !== "single") throw new Error();
    const patch = unitToCardPatch({
      ...edit,
      unit: { kind: "single", draft: { ...edit.unit.draft, stem: "X" } },
    });
    expect(patch).not.toHaveProperty("rev");
  });
});

describe("cardDraft：題組", () => {
  const reading = () =>
    groupCard("reading", [q("1", "First?"), q("2", "Second?")]);

  it("沒改 → null", () => {
    expect(unitToCardPatch(startEdit(reading(), catalog))).toBeNull();
  });

  it("只改第二小題 → 每小題帶原卷題號、只有第二題帶內容", () => {
    const edit = startEdit(reading(), catalog);
    const g = groupDraft(edit);
    const questions = g.questions.map((d, i) =>
      i === 1 ? { ...d, stem: "Changed?" } : d,
    );
    expect(unitToCardPatch(withGroup(edit, { ...g, questions }))).toEqual({
      rev: 5,
      group: {
        questions: [
          { source_question_no: "1" },
          { stem: "Changed?", source_question_no: "2" },
        ],
      },
    });
  });

  it("加一小題 → 整份送（帶完整內容）", () => {
    const edit = startEdit(reading(), catalog);
    const g = groupDraft(edit);
    const extra: QuestionDraft = {
      ...emptyDraft(),
      question_type: "reading",
      groupKey: g.key,
      stem: "Third?",
    };
    const patch = unitToCardPatch(
      withGroup(edit, { ...g, questions: [...g.questions, extra] }),
    );
    const sent = patch?.group?.questions ?? [];
    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatchObject({ stem: "First?", source_question_no: "1" });
    expect(sent[2]).toMatchObject({ stem: "Third?", source_question_no: null });
  });

  it("刪一小題 → 整份送剩下的", () => {
    const edit = startEdit(reading(), catalog);
    const g = groupDraft(edit);
    const patch = unitToCardPatch(
      withGroup(edit, { ...g, questions: g.questions.slice(1) }),
    );
    expect(patch?.group?.questions).toHaveLength(1);
    expect(patch?.group?.questions?.[0]).toMatchObject({
      stem: "Second?",
      source_question_no: "2",
      options: ["apple", "banana", "cherry", "durian"],
      correct_indexes: [0],
      exam_point_ids: [7],
      exam_point_codes: ["G-01"],
    });
  });

  it("改排版 → layout、文字版、對話一起送", () => {
    const edit = startEdit(reading(), catalog);
    const g = groupDraft(edit);
    expect(g.layout).not.toBeNull();
    const layout = { ...g.layout!, frame: !g.layout!.frame };
    const patch = unitToCardPatch(withGroup(edit, { ...g, layout }));
    expect(patch?.group).toHaveProperty("layout", layout);
    expect(patch?.group).toHaveProperty("passage_text");
    expect(patch?.group).toHaveProperty("segments");
    expect(patch?.group).not.toHaveProperty("questions");
  });

  it("老師之前改過排版（卡片帶 layout）→ 草稿用卡片的排版", () => {
    const base = startEdit(reading(), catalog);
    const layout = { ...groupDraft(base).layout!, frame: true };
    const card = reading();
    card.group = {
      ...card.group!,
      layout,
      passage_text: "Edited text",
      segments: [],
    };
    const g = groupDraft(startEdit(card, catalog));
    expect(g.layout).toEqual(layout);
    expect(g.passage_text).toBe("Edited text");
    expect(g.passage_text_edited).toBe(true);
  });
});

describe("cardDraft：克漏字沒有原卷題號", () => {
  // 卡片原順序：空格 3、1、2（AI 讀出來的順序），都沒有原卷題號
  const cloze = () =>
    groupCard("cloze", [
      q(null, "", { blank: 3, options: ["c1", "c2"] }),
      q(null, "", { blank: 1, options: ["a1", "a2"] }),
      q(null, "", { blank: 2, options: ["b1", "b2"] }),
    ]);

  it("草稿依空格排序，originalIndex 對回卡片原題", () => {
    const { unit, originalIndex } = cardToUnitWithOrder(cloze(), catalog);
    if (unit.kind !== "group") throw new Error();
    expect(unit.draft.questions.map((d) => d.blank_index)).toEqual([1, 2, 3]);
    expect(unit.draft.questions.map((d) => originalIndex[d.key])).toEqual([
      1, 2, 0,
    ]);
  });

  it("只改空格 1 的選項 → 依卡片原順序送（第 2 個位置）", () => {
    const edit = startEdit(cloze(), catalog);
    const g = groupDraft(edit);
    const questions = g.questions.map((d) =>
      d.blank_index === 1
        ? {
            ...d,
            options: d.options.map((o, i) =>
              i === 0 ? { ...o, text: "A1!" } : o,
            ),
          }
        : d,
    );
    const sent = unitToCardPatch(withGroup(edit, { ...g, questions }))?.group
      ?.questions;
    expect(sent).toHaveLength(3);
    expect(sent?.[0]).toEqual({ source_question_no: null });
    expect(sent?.[1]).toEqual({
      options: ["A1!", "a2"],
      source_question_no: null,
    });
    expect(sent?.[2]).toEqual({ source_question_no: null });
  });
});
