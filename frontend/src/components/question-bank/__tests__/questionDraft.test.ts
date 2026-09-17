/**
 * questionDraft 純函式測試（Issue #1064）：選項「有填」規則、單題驗證順序、批內重複、payload 組成。
 */

import { describe, it, expect } from "vitest";

import {
  BASE_OPTION_SLOTS,
  draftFromQuestion,
  emptyDraft,
  findBatchDuplicateKeys,
  normalizeStem,
  optionFilled,
  toCreateInput,
  validateDraft,
  validateShared,
  defaultSharedSettings,
} from "../questionDraft";
import type { Question } from "@/types/questionBank";

function draftWith(stem: string, options: [string, boolean][]) {
  const d = emptyDraft();
  d.stem = stem;
  options.forEach(([text, correct], i) => {
    d.options[i] = { text, is_correct: correct, image_url: null };
  });
  return d;
}

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

describe("validateShared", () => {
  it("年級下限大於上限 → gradeRange", () => {
    expect(
      validateShared({
        ...defaultSharedSettings(),
        grade_min: 9,
        grade_max: 7,
      }),
    ).toBe("gradeRange");
    expect(
      validateShared({
        ...defaultSharedSettings(),
        grade_min: 7,
        grade_max: null,
      }),
    ).toBeNull();
  });
});

describe("toCreateInput", () => {
  it("只送有填的選項、trim 文字、併入共用設定與 organization_id", () => {
    const d = draftWith("  Pick one  ", [["alpha ", true]]);
    d.options[2] = { text: "gamma", is_correct: false, image_url: null };
    d.options[3] = { text: "", is_correct: false, image_url: "http://x/d.png" };
    const shared = {
      ...defaultSharedSettings(),
      grade_min: 3,
      grade_max: 5,
      visibility: "public" as const,
      exam_points: [
        {
          id: 7,
          code: "c",
          names: {},
          parent_id: null,
          status: "active" as const,
          order_index: 0,
          aliases: [],
        },
      ],
      program_links: [{ program_id: 1, lesson_id: null }],
    };
    const payload = toCreateInput(d, shared, "org-1");
    expect(payload.stem).toBe("Pick one");
    expect(payload.options).toEqual([
      { text: "alpha", is_correct: true, image_url: null },
      { text: "gamma", is_correct: false, image_url: null },
      { text: "", is_correct: false, image_url: "http://x/d.png" },
    ]);
    expect(payload.exam_point_ids).toEqual([7]);
    expect(payload.program_links).toEqual([{ program_id: 1, lesson_id: null }]);
    expect(payload.visibility).toBe("public");
    expect(payload.organization_id).toBe("org-1");
  });
});

describe("draftFromQuestion", () => {
  it("超過 4 個選項時展開到 6 格，否則維持 4 格", () => {
    const base: Question = {
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
      created_at: null,
      updated_at: null,
    };
    const opt = (i: number) => ({
      id: i,
      order_index: i,
      text: `o${i}`,
      is_correct: i === 0,
      audio_url: null,
      image_url: null,
    });
    expect(
      draftFromQuestion({ ...base, options: [opt(0), opt(1)] }).options.length,
    ).toBe(BASE_OPTION_SLOTS);
    const six = draftFromQuestion({
      ...base,
      options: [0, 1, 2, 3, 4].map(opt),
    });
    expect(six.options.length).toBe(6);
    expect(six.extraOptionsShown).toBe(true);
  });
});
