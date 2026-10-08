/**
 * 克漏字空格運算測試（Issue #1085）：下一個編號、插入／刪除同步、重新編號、
 * 驗證（缺／多／重複／沒填）、AI 輸入（Fill in blank 與保留編號的 passage）。
 */

import { describe, it, expect } from "vitest";

import type { ExamPoint, LayoutDoc } from "@/types/questionBank";
import {
  appendBlankToLayout,
  clozeBlankDiff,
  clozeBlankError,
  clozeNeedsRenumber,
  clozeOrphanBlanks,
  insertBlankIntoText,
  duplicateBlankInLayout,
  nextBlankIndex,
  renumberLayoutBlanks,
  renumberMap,
} from "../clozeDraft";
import {
  layoutBlankIndexes,
  layoutBlankOccurrences,
  layoutToNumberedText,
} from "../layoutInline";
import {
  appendClozeBlank,
  clozeAiStem,
  clozeCanRenumber,
  clozeOrphanBlanksOf,
  emptyGroupDraft,
  emptyGroupQuestion,
  nextClozeBlankIndex,
  reinsertClozeBlank,
  renumberClozeBlanks,
  sortClozeQuestions,
  syncClozeQuestions,
  toAiInputs,
  unitPassageByKey,
  validateGroupDraft,
} from "../questionDraft";
import type { GroupDraft, QuestionDraft } from "../questionDraft";

const EP: ExamPoint = {
  id: 7,
  code: "grammar.tense.present_perfect",
  names: { "zh-TW": "現在完成式" },
  parent_id: null,
  status: "active",
  order_index: 0,
  aliases: [],
};

function doc(...paragraphs: string[]): LayoutDoc {
  return {
    version: 1,
    rows: paragraphs.map((text) => ({
      columns: [{ span: 1, blocks: [{ type: "paragraph", text }] }],
    })),
  };
}

/** 一張「填好」的小題卡：兩個選項、一個正確答案、一個考點 */
function filled(q: QuestionDraft, n: number): QuestionDraft {
  return {
    ...q,
    blank_index: n,
    options: [
      { text: "different", is_correct: true, image_url: null },
      { text: "the same", is_correct: false, image_url: null },
      ...q.options.slice(2),
    ],
    exam_points: [EP],
    visibility: "private",
  };
}

function clozeGroup(layout: LayoutDoc, blanks: number[]): GroupDraft {
  const g = {
    ...emptyGroupDraft("cloze"),
    layout,
    visibility: "private" as const,
  };
  return {
    ...g,
    questions: blanks.map((n) => filled(emptyGroupQuestion(g), n)),
  };
}

// ------------------------------------------------------------------ 編號

describe("nextBlankIndex", () => {
  it("新題組從 1 開始", () => {
    expect(nextBlankIndex([], [])).toBe(1);
  });

  it("取目前最大編號 + 1（含只存在於小題的編號）", () => {
    expect(nextBlankIndex([1, 2, 3], [1, 2, 3])).toBe(4);
    // 擷取進來的題本編號原樣保留 → 下一個是 44
    expect(nextBlankIndex([40, 41, 42, 43], [40, 41, 42, 43])).toBe(44);
    expect(nextBlankIndex([1], [1, 7])).toBe(8);
  });

  it("max + 1 超過上限時才退回最小未使用編號（不再 clamp 回已用掉的 999）", () => {
    expect(nextBlankIndex([999], [999])).toBe(1);
    expect(nextBlankIndex([1, 2, 999], [1, 2, 999])).toBe(3);
  });

  it("1..999 全滿 → null", () => {
    const all = Array.from({ length: 999 }, (_, i) => i + 1);
    expect(nextBlankIndex(all, [])).toBeNull();
    expect(nextBlankIndex(all.slice(0, 998), [])).toBe(999);
  });
});

describe("插入空格到文字", () => {
  it("在游標位置插入，不包裹選取外的文字", () => {
    const r = insertBlankIntoText("this year is  snowy", 13, 13, 4);
    expect(r.text).toBe("this year is {{4}} snowy");
    expect(r.cursor).toBe(18);
  });

  it("有選取時取代選取範圍", () => {
    const r = insertBlankIntoText("it is cold now", 6, 10, 2);
    expect(r.text).toBe("it is {{2}} now");
  });
});

describe("appendBlankToLayout", () => {
  it("加到最後一個段落的尾端", () => {
    const after = appendBlankToLayout(doc("first para", "second para"), 3);
    expect(layoutBlankIndexes(after)).toEqual([3]);
    expect(JSON.stringify(after)).toContain("second para {{3}}");
  });

  it("沒有排版時補一列段落", () => {
    const after = appendBlankToLayout(null, 1);
    expect(layoutBlankIndexes(after)).toEqual([1]);
    expect(after.rows).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ 同步

describe("clozeBlankDiff", () => {
  it("只看完整配對的 {{n}}：打字中途的 {{4 不算", () => {
    const before = layoutBlankIndexes(doc("a {{1}} b"));
    const typing = layoutBlankIndexes(doc("a {{1}} b {{4"));
    expect(clozeBlankDiff(before, typing)).toEqual({ added: [], removed: [] });
    const closed = layoutBlankIndexes(doc("a {{1}} b {{4}}"));
    expect(clozeBlankDiff(before, closed)).toEqual({ added: [4], removed: [] });
  });
});

describe("syncClozeQuestions", () => {
  it("新出現的空格自動建卡，依編號排序", () => {
    const g = clozeGroup(doc("a {{1}} b"), [1]);
    const next = syncClozeQuestions(g, g.layout, doc("a {{1}} b {{2}}"));
    expect(next.questions.map((q) => q.blank_index)).toEqual([1, 2]);
    expect(next.questions[1].question_type).toBe("cloze");
    expect(next.questions[1].groupKey).toBe(g.key);
  });

  it("空格消失且小題還是空白 → 自動移除", () => {
    const base = clozeGroup(doc("a {{1}} b {{2}}"), [1]);
    const g: GroupDraft = {
      ...base,
      questions: [
        base.questions[0],
        { ...emptyGroupQuestion(base), blank_index: 2 },
      ],
    };
    const next = syncClozeQuestions(g, g.layout, doc("a {{1}} b"));
    expect(next.questions.map((q) => q.blank_index)).toEqual([1]);
  });

  it("空格消失但小題已填內容 → 保留並標成找不到空格", () => {
    const g = clozeGroup(doc("a {{1}} b {{2}}"), [1, 2]);
    const next = syncClozeQuestions(g, g.layout, doc("a {{1}} b"));
    expect(next.questions.map((q) => q.blank_index)).toEqual([1, 2]);
    expect(clozeOrphanBlanksOf(next)).toEqual([2]);
    expect(validateGroupDraft(next)).toBe("clozeBlankMismatch");
  });

  it("重新插入到文末 → 恢復合法", () => {
    const g = clozeGroup(doc("a {{1}} b {{2}}"), [1, 2]);
    const broken = syncClozeQuestions(g, g.layout, doc("a {{1}} b"));
    const fixed = reinsertClozeBlank(broken, 2);
    expect(clozeOrphanBlanksOf(fixed)).toEqual([]);
    expect(validateGroupDraft(fixed)).toBeNull();
  });

  it("非克漏字題組原樣回傳", () => {
    const g = { ...emptyGroupDraft("reading"), layout: doc("a {{1}} b") };
    expect(syncClozeQuestions(g, null, g.layout)).toBe(g);
  });
});

describe("appendClozeBlank", () => {
  it("在文末插入空格並建小題卡", () => {
    const g = clozeGroup(doc("a {{1}} b"), [1]);
    const next = appendClozeBlank(g);
    expect(layoutBlankIndexes(next.layout)).toEqual([1, 2]);
    expect(next.questions.map((q) => q.blank_index)).toEqual([1, 2]);
  });

  it("空段落插入空格不會多一個開頭空格", () => {
    const after = appendBlankToLayout(doc(""), 1);
    expect(JSON.stringify(after)).toContain('"text":"{{1}}"');
    expect(JSON.stringify(after)).not.toContain('" {{1}}"');
  });

  it("編號用完時 appendClozeBlank 不做事", () => {
    const g = clozeGroup(doc("a {{1}} b"), [1]);
    const full = {
      ...g,
      questions: Array.from({ length: 999 }, (_, i) => ({
        ...g.questions[0],
        key: `k${i}`,
        blank_index: i + 1,
      })),
    };
    expect(nextClozeBlankIndex(full)).toBeNull();
    expect(appendClozeBlank(full)).toBe(full);
  });

  it("空題組從 1 開始", () => {
    const g = { ...emptyGroupDraft("cloze"), visibility: "private" as const };
    const next = appendClozeBlank(g);
    expect(nextClozeBlankIndex(g)).toBe(1);
    expect(layoutBlankIndexes(next.layout)).toEqual([1]);
  });
});

// ------------------------------------------------------------------ 重新編號

describe("重新編號", () => {
  it("已是閱讀順序 1..k 就不需要", () => {
    expect(clozeNeedsRenumber([1, 2, 3])).toBe(false);
    expect(clozeNeedsRenumber([40, 41])).toBe(true);
    expect(clozeNeedsRenumber([2, 1])).toBe(true);
  });

  it("layout 與小題 blank_index 一起映射", () => {
    const g = clozeGroup(doc("x {{40}} y", "z {{41}} w"), [41, 40]);
    expect(clozeCanRenumber(g)).toBe(true);
    const next = renumberClozeBlanks(g);
    expect(layoutBlankIndexes(next.layout)).toEqual([1, 2]);
    expect(next.questions.map((q) => q.blank_index)).toEqual([1, 2]);
    expect(clozeCanRenumber(next)).toBe(false);
    expect(validateGroupDraft(next)).toBeNull();
  });

  it("交換編號不會互撞（1→2、2→1 同時完成）", () => {
    const map = renumberMap([2, 1]);
    const after = renumberLayoutBlanks(doc("a {{2}} b {{1}} c"), map);
    expect(layoutBlankIndexes(after)).toEqual([1, 2]);
  });

  it("重排區塊不動編號", () => {
    const g = clozeGroup(doc("x {{1}} y", "z {{2}} w"), [1, 2]);
    // 段落互換（模擬拖拉）：編號照舊，驗證仍通過
    const swapped: GroupDraft = {
      ...g,
      layout: { version: 1, rows: [g.layout!.rows[1], g.layout!.rows[0]] },
    };
    expect(layoutBlankIndexes(swapped.layout)).toEqual([2, 1]);
    expect(validateGroupDraft(swapped)).toBeNull();
    expect(clozeCanRenumber(swapped)).toBe(true);
  });
});

describe("sortClozeQuestions", () => {
  it("依編號升冪，沒編號排最後", () => {
    const g = emptyGroupDraft("cloze");
    const mk = (n: number | null) => ({
      ...emptyGroupQuestion(g),
      blank_index: n,
    });
    const sorted = sortClozeQuestions([mk(3), mk(null), mk(1)]);
    expect(sorted.map((q) => q.blank_index)).toEqual([1, 3, null]);
  });
});

// ------------------------------------------------------------------ 驗證

describe("clozeBlankError / validateGroupDraft", () => {
  it("一一對應 → 通過（順序無關）", () => {
    expect(clozeBlankError([1, 2], [2, 1])).toBeNull();
    expect(
      validateGroupDraft(clozeGroup(doc("a {{1}} b {{2}}"), [1, 2])),
    ).toBeNull();
  });

  it("文章沒有空格", () => {
    expect(clozeBlankError([], [])).toBe("clozeNeedsBlank");
    const g = clozeGroup(doc("no blanks at all"), [1]);
    expect(validateGroupDraft(g)).toBe("clozeNeedsBlank");
  });

  it("缺小題、多小題、重複、沒填編號都是 clozeBlankMismatch", () => {
    expect(clozeBlankError([1, 2], [1])).toBe("clozeBlankMismatch");
    expect(clozeBlankError([1], [1, 9])).toBe("clozeBlankMismatch");
    expect(clozeBlankError([1, 2], [1, 1])).toBe("clozeBlankMismatch");
    expect(clozeBlankError([1, 2], [1, null])).toBe("clozeBlankMismatch");
  });

  it("文章裡同一個編號貼了兩次 → clozeDuplicateBlank#n", () => {
    expect(duplicateBlankInLayout([1, 2, 1])).toBe(1);
    expect(duplicateBlankInLayout([1, 2, 3])).toBeNull();
    const dupLayout = doc("a {{1}} b {{2}}", "c {{1}}");
    expect(layoutBlankOccurrences(dupLayout)).toEqual([1, 2, 1]);
    // 去重版本看不出重複，所以兩個都要傳
    expect(layoutBlankIndexes(dupLayout)).toEqual([1, 2]);
    expect(clozeBlankError([1, 2], [1, 2], [1, 2, 1])).toBe(
      "clozeDuplicateBlank#1",
    );
    expect(validateGroupDraft(clozeGroup(dupLayout, [1, 2]))).toBe(
      "clozeDuplicateBlank#1",
    );
  });

  it("clozeOrphanBlanks 回傳升冪編號", () => {
    expect(clozeOrphanBlanks([1], [3, 1, 2])).toEqual([2, 3]);
  });
});

// ------------------------------------------------------------------ AI

describe("克漏字 AI 輸入", () => {
  it("題幹空白 → Fill in blank (n).，老師打了就用老師的", () => {
    const g = clozeGroup(doc("a {{3}} b"), [3]);
    expect(clozeAiStem(g.questions[0])).toBe("Fill in blank (3).");
    expect(clozeAiStem({ ...g.questions[0], stem: "Which word fits?" })).toBe(
      "Which word fits?",
    );
  });

  it("passage 保留空格編號（(3)____），題幹用 Fill in blank", () => {
    const g = clozeGroup(doc("this year is {{3}} snowy"), [3]);
    const passages = unitPassageByKey([{ kind: "group", draft: g }]);
    expect(passages.get(g.questions[0].key)).toBe("this year is (3)____ snowy");
    const inputs = toAiInputs(g.questions, passages);
    expect(inputs[0].stem).toBe("Fill in blank (3).");
    expect(inputs[0].passage).toContain("(3)____");
  });

  it("閱讀題組的 passage 仍是 ____（不帶編號）", () => {
    const g: GroupDraft = {
      ...emptyGroupDraft("reading"),
      layout: doc("plain reading passage"),
    };
    expect(layoutToNumberedText(g.layout)).toBe("plain reading passage");
  });
});
