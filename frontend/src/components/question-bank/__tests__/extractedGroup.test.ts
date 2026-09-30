/**
 * 考卷擷取 → 題組草稿（#1084 第 1 段）純函式測試。
 */
import { describe, it, expect } from "vitest";

import type { MagicPasteGroupResult } from "@/components/shared/MagicPasteInput";

import {
  boxToPixelRect,
  groupDraftFromExtracted,
  paragraphsToLayout,
} from "../extractedGroup";
import { emptyGroupDraft, toCreateGroupInput } from "../questionDraft";

const baseResult = (
  over: Partial<MagicPasteGroupResult> = {},
): MagicPasteGroupResult => ({
  title: " Vivaldi ",
  stimulus: {
    kind: "text",
    paragraphs: [
      "Antonio Vivaldi was a violin player.",
      " ",
      "Sadly, he died poor.",
    ],
    text: "",
    box_2d: null,
    page: null,
  },
  glossary: [
    { word: "timeline", zh: "時間軸" },
    { word: "", zh: "空" },
  ],
  questions: [
    {
      stem: "Which is the best title?",
      options: ["A", "B", "C", "D"],
      correct_indexes: [2],
      explanation: "",
    },
    {
      stem: "Which is WRONG?",
      options: ["x", "y"],
      correct_indexes: [],
      explanation: "because",
    },
  ],
  ...over,
});

describe("boxToPixelRect", () => {
  it("0–1000 座標依圖片尺寸換算像素", () => {
    expect(boxToPixelRect([0, 0, 500, 1000], 800, 600)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 300,
    });
    expect(boxToPixelRect([100, 250, 900, 750], 1000, 2000)).toEqual({
      x: 250,
      y: 200,
      width: 500,
      height: 1600,
    });
  });

  it("超出範圍夾回邊界；面積為 0、缺值、非數字回 null", () => {
    expect(boxToPixelRect([-50, 0, 1200, 1000], 100, 100)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(boxToPixelRect([0, 0, 0, 1000], 100, 100)).toBeNull();
    expect(boxToPixelRect(null, 100, 100)).toBeNull();
    expect(boxToPixelRect([1, 2, 3], 100, 100)).toBeNull();
    expect(boxToPixelRect([0, 0, Number.NaN, 1000], 100, 100)).toBeNull();
    expect(boxToPixelRect([0, 0, 500, 1000], 0, 100)).toBeNull();
  });
});

describe("paragraphsToLayout", () => {
  it("一段一區塊、單欄；空段落丟掉；全空回 null", () => {
    const layout = paragraphsToLayout(["  a ", "", "b"]);
    expect(layout).not.toBeNull();
    const row = layout!.rows[0];
    expect(row.type === "section").toBe(false);
    const col = (row as { columns: { blocks: unknown[] }[] }).columns[0];
    expect(col.blocks).toEqual([
      { type: "paragraph", text: "a" },
      { type: "paragraph", text: "b" },
    ]);
    expect(paragraphsToLayout([" ", ""])).toBeNull();
  });
});

describe("groupDraftFromExtracted", () => {
  it("text：段落進排版、文字版由推導（未改）、註解過濾、小題帶題組設定", () => {
    const base = {
      ...emptyGroupDraft("reading"),
      visibility: "public" as const,
      sources: [{ id: 1, label: "會考" }],
      grade: [7, 9] as [number | null, number | null],
    };
    const draft = groupDraftFromExtracted(baseResult(), base, null);
    expect(draft.key).toBe(base.key);
    expect(draft.title).toBe("Vivaldi");
    expect(draft.layout?.rows).toHaveLength(1);
    expect(draft.passage_text).toBe("");
    expect(draft.passage_text_edited).toBe(false);
    expect(draft.glossary).toEqual([{ word: "timeline", zh: "時間軸" }]);
    expect(draft.questions).toHaveLength(2);
    for (const q of draft.questions) {
      expect(q.groupKey).toBe(base.key);
      expect(q.question_type).toBe("reading");
      expect(q.visibility).toBe("public");
      expect(q.sources).toBe(base.sources);
      expect(q.grade).toEqual([7, 9]);
    }
    expect(draft.questions[0].options.map((o) => o.is_correct)).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(draft.questions[1].explanation).toBe("because");
    // 送後端：文字版由排版推導出來
    const payload = toCreateGroupInput(draft);
    expect(payload.passage_text).toContain("Antonio Vivaldi");
    expect(payload.stimulus_type).toBe("passage");
  });

  it("image：裁好的圖進排版、圖內文字當老師版文字版；沒圖時排版 null 但文字保留", () => {
    const result = baseResult({
      title: "",
      stimulus: {
        kind: "image",
        paragraphs: [],
        text: "Happy Town Lantern Festival 2026",
        box_2d: [0, 0, 600, 1000],
        page: 1,
      },
    });
    const withImage = groupDraftFromExtracted(
      result,
      emptyGroupDraft("reading"),
      "https://cdn/x.png",
    );
    expect(withImage.layout?.rows).toHaveLength(1);
    expect(JSON.stringify(withImage.layout)).toContain("https://cdn/x.png");
    expect(withImage.passage_text).toBe("Happy Town Lantern Festival 2026");
    expect(withImage.passage_text_edited).toBe(true);
    expect(toCreateGroupInput(withImage).stimulus_type).toBe("image");
    expect(toCreateGroupInput(withImage).passage_text).toBe(
      "Happy Town Lantern Festival 2026",
    );

    const noImage = groupDraftFromExtracted(
      result,
      emptyGroupDraft("reading"),
      null,
    );
    expect(noImage.layout).toBeNull();
    expect(noImage.passage_text).toBe("Happy Town Lantern Festival 2026");
    expect(noImage.passage_text_edited).toBe(true);
  });

  it("text 但 AI 沒切段落只給整段文字：文字版用它、排版留空", () => {
    const result = baseResult({
      stimulus: {
        kind: "text",
        paragraphs: [],
        text: "whole passage",
        box_2d: null,
        page: null,
      },
    });
    const draft = groupDraftFromExtracted(
      result,
      emptyGroupDraft("reading"),
      null,
    );
    expect(draft.layout).toBeNull();
    expect(draft.passage_text).toBe("whole passage");
    expect(draft.passage_text_edited).toBe(true);
  });
});
