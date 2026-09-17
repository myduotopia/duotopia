/**
 * questionDraft 純函式測試（Issue #1064）：選項「有填」規則、單題驗證順序（含考點必填）、
 * 批內重複、batch 預設帶入新題、payload 組成（年段／考點／教材在 draft，公開／來源整批共用）。
 */

import { describe, it, expect } from "vitest";

import {
  BASE_OPTION_SLOTS,
  batchDefaultsFromQuestion,
  draftFromQuestion,
  emptyBatchDefaults,
  emptyDraft,
  findBatchDuplicateKeys,
  normalizeStem,
  optionFilled,
  toCreateInput,
  validateDraft,
} from "../questionDraft";
import type { ExamPoint, Question } from "@/types/questionBank";

const EP: ExamPoint = {
  id: 7,
  code: "grammar.tense.present_perfect",
  names: { "zh-TW": "現在完成式" },
  parent_id: null,
  status: "active",
  order_index: 0,
  aliases: [],
};

function draftWith(
  stem: string,
  options: [string, boolean][],
  examPoints: ExamPoint[] = [EP],
) {
  const d = emptyDraft();
  d.stem = stem;
  d.exam_points = examPoints;
  options.forEach(([text, correct], i) => {
    d.options[i] = { text, is_correct: correct, image_url: null };
  });
  return d;
}

const baseQuestion: Question = {
  id: 1,
  question_type: "multiple_choice",
  stem: "S",
  explanation: null,
  image_url: null,
  stem_audio_url: null,
  grade_min: null,
  grade_max: null,
  allow_multiple_answers: false,
  show_stem_text: true,
  visibility: "private",
  is_platform: false,
  teacher_id: 1,
  organization_id: null,
  school_id: null,
  group_id: null,
  is_owner: true,
  options: [],
  exam_points: [],
  program_links: [],
  sources: [],
  created_at: null,
  updated_at: null,
};

describe("optionFilled", () => {
  it("文字或圖片任一即算有填", () => {
    expect(optionFilled({ text: "", is_correct: false, image_url: null })).toBe(
      false,
    );
    expect(
      optionFilled({ text: "a", is_correct: false, image_url: null }),
    ).toBe(true);
    expect(
      optionFilled({
        text: "  ",
        is_correct: false,
        image_url: "http://x/y.png",
      }),
    ).toBe(true);
  });
});

describe("validateDraft", () => {
  it("空題幹 → stemRequired", () => {
    expect(validateDraft(emptyDraft())).toBe("stemRequired");
  });
  it("完全重複優先於選項錯誤", () => {
    const d = draftWith("What?", [["a", true]]);
    d.similar = {
      exact_duplicate: {
        id: 1,
        stem: "What?",
        visibility: "public",
        is_platform: false,
        is_owner: false,
      },
      similar: [],
    };
    expect(validateDraft(d)).toBe("duplicate");
    expect(
      validateDraft(draftWith("What?", [["a", true]]), {
        duplicateInBatch: true,
      }),
    ).toBe("duplicateInBatch");
  });
  it("選項不足 → minOptions；沒勾 → noCorrect；單選勾兩個 → singleOnly", () => {
    expect(validateDraft(draftWith("Q", [["a", true]]))).toBe("minOptions");
    expect(
      validateDraft(
        draftWith("Q", [
          ["a", false],
          ["b", false],
        ]),
      ),
    ).toBe("noCorrect");
    expect(
      validateDraft(
        draftWith("Q", [
          ["a", true],
          ["b", true],
        ]),
      ),
    ).toBe("singleOnly");
    const multi = draftWith("Q", [
      ["a", true],
      ["b", true],
    ]);
    multi.allow_multiple = true;
    expect(validateDraft(multi)).toBeNull();
  });
  it("選項合法但沒有考點 → examPointRequired（排在選項之後）", () => {
    const d = draftWith(
      "Q",
      [
        ["a", true],
        ["b", false],
      ],
      [],
    );
    expect(validateDraft(d)).toBe("examPointRequired");
    d.exam_points = [EP];
    expect(validateDraft(d)).toBeNull();
  });
  it("純圖選項也算有填", () => {
    const d = draftWith("Q", [["a", true]]);
    d.options[1] = { text: "", is_correct: false, image_url: "http://x/b.png" };
    expect(validateDraft(d)).toBeNull();
  });
});

describe("findBatchDuplicateKeys / normalizeStem", () => {
  it("正規化後相同的題幹互相標記；空題幹不算", () => {
    const a = draftWith("She HAS lived here!", [
      ["x", true],
      ["y", false],
    ]);
    const b = draftWith("she has lived   here", [
      ["x", true],
      ["y", false],
    ]);
    const c = draftWith("Different", [
      ["x", true],
      ["y", false],
    ]);
    const e1 = emptyDraft();
    const e2 = emptyDraft();
    const dup = findBatchDuplicateKeys([a, b, c, e1, e2]);
    expect(dup.has(a.key) && dup.has(b.key)).toBe(true);
    expect(dup.has(c.key) || dup.has(e1.key) || dup.has(e2.key)).toBe(false);
    expect(normalizeStem("Ｉ  have,  NEVER been!!")).toBe("i have never been");
  });
});

describe("emptyDraft(batch)", () => {
  it("新題帶入左側批次值，且是複本（改新題不動 batch）", () => {
    const batch = {
      exam_points: [EP],
      grade: [3, 5] as [number, number],
      program_link: { program_id: 9, lesson_id: null },
    };
    const d = emptyDraft(batch);
    expect(d.exam_points).toEqual([EP]);
    expect(d.grade).toEqual([3, 5]);
    expect(d.program_link).toEqual({ program_id: 9, lesson_id: null });
    d.exam_points.push({ ...EP, id: 8 });
    d.grade[0] = 1;
    expect(batch.exam_points.length).toBe(1);
    expect(batch.grade[0]).toBe(3);
    expect(emptyDraft(emptyBatchDefaults()).advancedOpen).toBe(false);
  });
});

describe("toCreateInput", () => {
  it("只送有填的選項、trim 文字；年段／考點／教材來自 draft，公開／來源／機構來自 shared", () => {
    const d = draftWith("  Pick one  ", [["alpha ", true]]);
    d.options[2] = { text: "gamma", is_correct: false, image_url: null };
    d.options[3] = { text: "", is_correct: false, image_url: "http://x/d.png" };
    d.grade = [3, 5];
    d.program_link = { program_id: 1, lesson_id: 4 };
    const payload = toCreateInput(d, {
      visibility: "public",
      source_ids: [11, 12],
      organizationId: "org-1",
    });
    expect(payload.stem).toBe("Pick one");
    expect(payload.options).toEqual([
      { text: "alpha", is_correct: true, image_url: null },
      { text: "gamma", is_correct: false, image_url: null },
      { text: "", is_correct: false, image_url: "http://x/d.png" },
    ]);
    expect(payload.grade_min).toBe(3);
    expect(payload.grade_max).toBe(5);
    expect(payload.exam_point_ids).toEqual([7]);
    expect(payload.program_links).toEqual([{ program_id: 1, lesson_id: 4 }]);
    expect(payload.visibility).toBe("public");
    expect(payload.source_ids).toEqual([11, 12]);
    expect(payload.organization_id).toBe("org-1");
  });
  it("沒有教材關聯 → program_links 空陣列", () => {
    const d = draftWith("Q", [
      ["a", true],
      ["b", false],
    ]);
    expect(
      toCreateInput(d, { visibility: "private", source_ids: [] }).program_links,
    ).toEqual([]);
  });
});

describe("draftFromQuestion / batchDefaultsFromQuestion", () => {
  const opt = (i: number) => ({
    id: i,
    order_index: i,
    text: `o${i}`,
    is_correct: i === 0,
    audio_url: null,
    image_url: null,
  });

  it("超過 4 個選項時展開到 6 格，否則維持 4 格", () => {
    expect(
      draftFromQuestion({ ...baseQuestion, options: [opt(0), opt(1)] }).options
        .length,
    ).toBe(BASE_OPTION_SLOTS);
    const six = draftFromQuestion({
      ...baseQuestion,
      options: [0, 1, 2, 3, 4].map(opt),
    });
    expect(six.options.length).toBe(6);
    expect(six.extraOptionsShown).toBe(true);
  });

  it("既有題目的年段／考點／第一個教材關聯帶入；有設定過就展開進階設定", () => {
    const q: Question = {
      ...baseQuestion,
      grade_min: 7,
      grade_max: 9,
      exam_points: [
        { id: 7, code: EP.code, names: EP.names, source: "manual" },
      ],
      program_links: [
        { program_id: 2, lesson_id: 5 },
        { program_id: 3, lesson_id: null },
      ],
    };
    const b = batchDefaultsFromQuestion(q);
    expect(b.grade).toEqual([7, 9]);
    expect(b.exam_points.map((e) => e.id)).toEqual([7]);
    expect(b.program_link).toEqual({ program_id: 2, lesson_id: 5 });
    expect(draftFromQuestion(q).advancedOpen).toBe(true);
    expect(draftFromQuestion(baseQuestion).advancedOpen).toBe(false);
  });
});
