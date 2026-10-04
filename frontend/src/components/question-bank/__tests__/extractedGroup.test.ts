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

/** 沒有任何圖（PDF 或 AI 沒給座標） */
const noImages = { stimulusUrl: null };
const stimulusImage = { stimulusUrl: "https://cdn/x.png" };

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
  it("一個區塊一列（才能拖成並排）；空段落丟掉；全空回 null", () => {
    const layout = paragraphsToLayout(["  a ", "", "b"]);
    expect(layout).not.toBeNull();
    expect(layout!.rows).toHaveLength(2);
    expect(layout!.rows[0].type === "section").toBe(false);
    expect(layout!.rows).toEqual([
      { columns: [{ span: 1, blocks: [{ type: "paragraph", text: "a" }] }] },
      { columns: [{ span: 1, blocks: [{ type: "paragraph", text: "b" }] }] },
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
    const draft = groupDraftFromExtracted(baseResult(), base, noImages);
    expect(draft.key).toBe(base.key);
    expect(draft.title).toBe("Vivaldi");
    // 兩個非空段落 → 兩列（一個區塊一列）
    expect(draft.layout?.rows).toHaveLength(2);
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
      stimulusImage,
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
      noImages,
    );
    expect(noImage.layout).toBeNull();
    expect(noImage.passage_text).toBe("Happy Town Lantern Festival 2026");
    expect(noImage.passage_text_edited).toBe(true);
  });

  it("標題：AI 有給就用；沒給（空白）保留老師已打的標題", () => {
    const base = { ...emptyGroupDraft("reading"), title: "老師打的" };
    expect(groupDraftFromExtracted(baseResult(), base, noImages).title).toBe(
      "Vivaldi",
    );
    expect(
      groupDraftFromExtracted(baseResult({ title: "  " }), base, noImages)
        .title,
    ).toBe("老師打的");
    const img = baseResult({
      title: "",
      stimulus: {
        kind: "image",
        paragraphs: [],
        text: "poster",
        box_2d: [0, 0, 500, 500],
        page: null,
      },
    });
    expect(groupDraftFromExtracted(img, base, stimulusImage).title).toBe(
      "老師打的",
    );
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
      noImages,
    );
    expect(draft.layout).toBeNull();
    expect(draft.passage_text).toBe("whole passage");
    expect(draft.passage_text_edited).toBe(true);
  });
});

// ---- 插圖 / 選項圖 / 克漏字（#1084 / #1086）----

type Blocks = {
  columns: { span: number; blocks: Record<string, unknown>[] }[];
};
/** 每列攤成 `區塊型別(span)` 的字串，方便一眼比對列與欄 */
const rowShapes = (layout: unknown) =>
  (layout as { rows: Blocks[] }).rows.map((r) =>
    r.columns.map((c) => `${c.blocks[0].type}(${c.span})`).join(" | "),
  );
const allBlocks = (layout: unknown) =>
  (layout as { rows: Blocks[] }).rows.flatMap((r) =>
    r.columns.flatMap((c) => c.blocks),
  );

describe("paragraphsToLayout 文章插圖", () => {
  it("插圖依 after_paragraph 自己一列排在該段之後，-1 排在最前面；有 caption 才帶", () => {
    const layout = paragraphsToLayout(
      ["one", "two"],
      [
        { after_paragraph: 0, caption: "聖誕老人", url: "https://cdn/a.png" },
        { after_paragraph: -1, caption: "", url: "https://cdn/head.png" },
        { after_paragraph: 1, caption: "", url: null },
      ],
    );
    expect(rowShapes(layout)).toEqual([
      "image(1)",
      "paragraph(1)",
      "image(1)",
      "paragraph(1)",
    ]);
    expect(allBlocks(layout)).toEqual([
      { type: "image", url: "https://cdn/head.png", align: "center" },
      { type: "paragraph", text: "one" },
      {
        type: "image",
        url: "https://cdn/a.png",
        align: "center",
        caption: "聖誕老人",
      },
      { type: "paragraph", text: "two" },
    ]);
  });

  it("placement=beside：與該段同一列並排，side 決定左右、width 決定 span（AI 依原卷給）", () => {
    const beside = (over: Record<string, unknown> = {}) =>
      paragraphsToLayout(
        ["one", "two"],
        [
          {
            after_paragraph: 1,
            caption: "",
            url: "https://cdn/a.png",
            placement: "beside" as const,
            side: "right" as const,
            width: 1 / 3,
            ...over,
          },
        ],
      );
    // 圖在右、佔 1/3 → 文字 span 2 + 圖 span 1
    expect(rowShapes(beside())).toEqual([
      "paragraph(1)",
      "paragraph(2) | image(1)",
    ]);
    // 圖在左、佔 2/3 → 圖 span 2 + 文字 span 1
    expect(rowShapes(beside({ side: "left", width: 2 / 3 }))).toEqual([
      "paragraph(1)",
      "image(2) | paragraph(1)",
    ]);
    // 一半 → 1:1；AI 給的奇怪值吸附到最近的比例（0.45 → 1/2）
    expect(rowShapes(beside({ width: 1 / 2 }))).toEqual([
      "paragraph(1)",
      "paragraph(1) | image(1)",
    ]);
    expect(rowShapes(beside({ width: 0.45 }))).toEqual([
      "paragraph(1)",
      "paragraph(1) | image(1)",
    ]);
    // 沒給 width → 預設 1/3
    expect(rowShapes(beside({ width: undefined }))).toEqual([
      "paragraph(1)",
      "paragraph(2) | image(1)",
    ]);
  });

  it("同一段有兩張 beside 的圖：只有第一張並排，第二張退回整行", () => {
    const fig = (url: string) => ({
      after_paragraph: 0,
      caption: "",
      url,
      placement: "beside" as const,
      side: "right" as const,
      width: 1 / 3,
    });
    expect(
      rowShapes(
        paragraphsToLayout(
          ["one"],
          [fig("https://cdn/a.png"), fig("https://cdn/b.png")],
        ),
      ),
    ).toEqual(["paragraph(2) | image(1)", "image(1)"]);
  });

  it("after_paragraph 超出段落範圍 → 收到文章最後面的整行列，不丟掉", () => {
    expect(
      rowShapes(
        paragraphsToLayout(
          ["one"],
          [
            {
              after_paragraph: 5,
              caption: "",
              url: "https://cdn/a.png",
              placement: "beside",
              side: "right",
              width: 1 / 3,
            },
          ],
        ),
      ),
    ).toEqual(["paragraph(1)", "image(1)"]);
  });

  it("beside 但 after_paragraph = -1（文章前沒有段落可並排）→ 整行", () => {
    expect(
      rowShapes(
        paragraphsToLayout(
          ["one"],
          [
            {
              after_paragraph: -1,
              caption: "",
              url: "https://cdn/a.png",
              placement: "beside",
              side: "right",
              width: 1 / 3,
            },
          ],
        ),
      ),
    ).toEqual(["image(1)", "paragraph(1)"]);
  });

  it("只有插圖沒有段落也能出排版；全部沒 url 回 null", () => {
    const onlyFigure = paragraphsToLayout(
      [],
      [{ after_paragraph: -1, caption: "", url: "https://cdn/a.png" }],
    );
    expect(onlyFigure).not.toBeNull();
    expect(
      paragraphsToLayout([], [{ after_paragraph: 0, caption: "", url: null }]),
    ).toBeNull();
  });
});

describe("groupDraftFromExtracted 小題圖與選項圖", () => {
  it("題幹圖填 image_url；圖片選項 text 空字串但帶 image_url", () => {
    const result = baseResult({
      questions: [
        {
          stem: "Which picture shows the answer?",
          stem_box_2d: [0, 0, 100, 100],
          options: ["", "", "", ""],
          option_boxes: [
            [100, 0, 200, 250],
            [100, 250, 200, 500],
            [100, 500, 200, 750],
            [100, 750, 200, 1000],
          ],
          correct_indexes: [1],
          explanation: "",
        },
      ],
    });
    const draft = groupDraftFromExtracted(result, emptyGroupDraft("reading"), {
      stimulusUrl: null,
      questions: {
        stemUrls: ["https://cdn/stem.png"],
        optionUrls: [
          [
            "https://cdn/o1.png",
            null,
            "https://cdn/o3.png",
            "https://cdn/o4.png",
          ],
        ],
      },
    });
    const q = draft.questions[0];
    expect(q.image_url).toBe("https://cdn/stem.png");
    expect(q.options.map((o) => o.text)).toEqual(["", "", "", ""]);
    expect(q.options.map((o) => o.image_url)).toEqual([
      "https://cdn/o1.png",
      null,
      "https://cdn/o3.png",
      "https://cdn/o4.png",
    ]);
    expect(q.options[1].is_correct).toBe(true);
  });

  it("插圖進排版（整行插圖排在該段之後，各自一列）", () => {
    const result = baseResult({
      stimulus: {
        kind: "text",
        paragraphs: ["Santa is busy.", "He flies at night."],
        text: "",
        box_2d: null,
        page: null,
        figures: [
          { box_2d: [0, 600, 300, 1000], after_paragraph: 0, caption: "" },
        ],
      },
    });
    const draft = groupDraftFromExtracted(result, emptyGroupDraft("reading"), {
      stimulusUrl: null,
      figureUrls: ["https://cdn/santa.png"],
    });
    expect(rowShapes(draft.layout)).toEqual([
      "paragraph(1)",
      "image(1)",
      "paragraph(1)",
    ]);
  });

  it("插圖的 placement／side／width 會從擷取結果傳到排版", () => {
    const result = baseResult({
      stimulus: {
        kind: "text",
        paragraphs: ["Santa is busy."],
        text: "",
        box_2d: null,
        page: null,
        figures: [
          {
            box_2d: [0, 600, 300, 1000],
            after_paragraph: 0,
            caption: "",
            placement: "beside",
            side: "left",
            width: 1 / 2,
          },
        ],
      },
    });
    const draft = groupDraftFromExtracted(result, emptyGroupDraft("reading"), {
      stimulusUrl: null,
      figureUrls: ["https://cdn/santa.png"],
    });
    expect(rowShapes(draft.layout)).toEqual(["image(1) | paragraph(1)"]);
  });
});

describe("groupDraftFromExtracted 克漏字", () => {
  const clozeResult = (over: Partial<MagicPasteGroupResult> = {}) =>
    baseResult({
      title: "Santa's Letter",
      stimulus: {
        kind: "text",
        paragraphs: ["Dear Santa, I {{1}} a bike.", "I will {{2}} good."],
        text: "",
        box_2d: null,
        page: null,
        blanks_renumbered: true,
      },
      questions: [
        {
          stem: "",
          blank: 1,
          options: ["want", "wants", "wanted", "wanting"],
          correct_indexes: [0],
          explanation: "",
        },
        {
          stem: "",
          blank: 2,
          options: ["be", "being", "been", "to be"],
          correct_indexes: [0],
          explanation: "",
        },
      ],
      ...over,
    });

  it("段落旁有 beside 插圖時，空格編號的閱讀順序不受影響", async () => {
    const { layoutBlankIndexes } = await import("../layoutInline");
    const result = clozeResult();
    result.stimulus.figures = [
      {
        box_2d: [0, 600, 300, 1000],
        after_paragraph: 0,
        caption: "",
        placement: "beside",
        side: "right",
        width: 1 / 3,
      },
    ];
    const draft = groupDraftFromExtracted(result, emptyGroupDraft("cloze"), {
      stimulusUrl: null,
      figureUrls: ["https://cdn/santa.png"],
    });
    // 第一段與圖並排（圖在右欄），空格仍是 1 → 2
    expect(rowShapes(draft.layout)).toEqual([
      "paragraph(2) | image(1)",
      "paragraph(1)",
    ]);
    expect(layoutBlankIndexes(draft.layout)).toEqual([1, 2]);
    expect(draft.questions.map((q) => q.blank_index)).toEqual([1, 2]);
  });

  it("保留 {{n}}、小題 blank_index 取 AI 的 blank、題幹可空", () => {
    const draft = groupDraftFromExtracted(
      clozeResult(),
      emptyGroupDraft("cloze"),
      noImages,
    );
    expect(JSON.stringify(draft.layout)).toContain("{{1}}");
    expect(draft.questions.map((q) => q.blank_index)).toEqual([1, 2]);
    expect(draft.questions.map((q) => q.stem)).toEqual(["", ""]);
  });

  it("AI 漏給 blank（或編號對不上文章）→ 依閱讀順序補配", () => {
    const missing = clozeResult();
    missing.questions = missing.questions.map((q, i) =>
      i === 1 ? { ...q, blank: null } : q,
    );
    expect(
      groupDraftFromExtracted(
        missing,
        emptyGroupDraft("cloze"),
        noImages,
      ).questions.map((q) => q.blank_index),
    ).toEqual([1, 2]);

    const wrong = clozeResult();
    wrong.questions = wrong.questions.map((q) => ({ ...q, blank: 40 }));
    expect(
      groupDraftFromExtracted(
        wrong,
        emptyGroupDraft("cloze"),
        noImages,
      ).questions.map((q) => q.blank_index),
    ).toEqual([1, 2]);
  });

  it("小題比空格多：多出來的 blank_index 留 null（交驗證提示）", () => {
    const extra = clozeResult();
    extra.questions = [
      ...extra.questions,
      {
        stem: "",
        blank: 3,
        options: ["a", "b", "c", "d"],
        correct_indexes: [],
        explanation: "",
      },
    ];
    expect(
      groupDraftFromExtracted(
        extra,
        emptyGroupDraft("cloze"),
        noImages,
      ).questions.map((q) => q.blank_index),
    ).toEqual([1, 2, null]);
  });

  it("閱讀題組誤帶 {{n}} → 轉回底線（避免後端 422）", () => {
    const draft = groupDraftFromExtracted(
      clozeResult(),
      emptyGroupDraft("reading"),
      noImages,
    );
    const text = JSON.stringify(draft.layout);
    expect(text).not.toContain("{{1}}");
    expect(text).toContain("____");
    expect(draft.questions.every((q) => q.blank_index === null)).toBe(true);
  });
});

describe("閱讀題組的文字版也要去掉 {{n}}", () => {
  const withTokens = (over: Partial<MagicPasteGroupResult> = {}) =>
    baseResult({
      stimulus: {
        kind: "text",
        paragraphs: [],
        text: "Dear Santa, I {{1}} a bike and I will {{2}} good.",
        box_2d: null,
        page: null,
      },
      ...over,
    });

  it("AI 沒切段落只給整段文字：reading 的 fallback 文字版轉回底線", () => {
    const draft = groupDraftFromExtracted(
      withTokens(),
      emptyGroupDraft("reading"),
      noImages,
    );
    expect(draft.layout).toBeNull();
    expect(draft.passage_text).not.toContain("{{1}}");
    expect(draft.passage_text).toContain("____");
    expect(draft.passage_text_edited).toBe(true);
  });

  it("kind=image 的圖內文字：reading 轉回底線", () => {
    const draft = groupDraftFromExtracted(
      withTokens({
        stimulus: {
          kind: "image",
          paragraphs: [],
          text: "Choose: he {{1}} happy.",
          box_2d: [0, 0, 500, 1000],
          page: null,
        },
      }),
      emptyGroupDraft("reading"),
      stimulusImage,
    );
    expect(draft.passage_text).toBe("Choose: he ____ happy.");
  });

  it("克漏字不處理：fallback 與圖內文字都保留 {{n}}", () => {
    expect(
      groupDraftFromExtracted(withTokens(), emptyGroupDraft("cloze"), noImages)
        .passage_text,
    ).toContain("{{1}}");
    expect(
      groupDraftFromExtracted(
        withTokens({
          stimulus: {
            kind: "image",
            paragraphs: [],
            text: "he {{1}} happy",
            box_2d: [0, 0, 500, 1000],
            page: null,
          },
        }),
        emptyGroupDraft("cloze"),
        stimulusImage,
      ).passage_text,
    ).toBe("he {{1}} happy");
  });
});
