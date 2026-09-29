/**
 * 區塊編輯器純操作（Issue #1082）：DB 格式 ↔ 編輯格式往返不失真、
 * 列／欄／區塊的新增刪除、比例切換併欄、section 包／解、區塊同欄與跨欄搬移。
 */

import { describe, it, expect } from "vitest";

import {
  addBlock,
  addRow,
  appendBlock,
  blockCount,
  canPlaceBeside,
  columnWidth,
  defaultBlock,
  deleteBlock,
  findColumnOfBlock,
  insertBlockRow,
  locateBlock,
  moveBlock,
  moveTopLevel,
  placeAround,
  placeBeside,
  removeBlock,
  removeRow,
  rowRatio,
  setBlockWidth,
  setRowRatio,
  singleImageDoc,
  toEditorDoc,
  toggleBlockFrame,
  toLayoutDoc,
  unwrapSection,
  updateBlock,
  widthOptionsFor,
  wrapRowInSection,
  type EditorBlock,
  type EditorRow,
} from "../layoutEditorModel";
import type { LayoutDoc, LayoutRow } from "@/types/questionBank";

/** 三段獨占一行的文字（文件式編輯器的起點） */
function threeParagraphs(): LayoutDoc {
  return {
    version: 1,
    rows: ["A", "B", "C"].map((text) => ({
      columns: [{ span: 1, blocks: [{ type: "paragraph", text }] }],
    })),
  };
}

/** 一列兩欄並排（左文右圖） */
function twoBesideDoc(): LayoutDoc {
  return {
    version: 1,
    rows: [
      {
        columns: [
          { span: 2, blocks: [{ type: "paragraph", text: "L" }] },
          { span: 1, blocks: [{ type: "image", url: "r.png" }] },
        ],
      },
    ],
  };
}

/** 純函式測試用：一段文字區塊 */
const para = (text: string): EditorBlock => {
  const b = defaultBlock("paragraph");
  return { ...b, text } as EditorBlock;
};

const rowTexts = (doc: LayoutDoc | null): string[][] =>
  (doc?.rows ?? []).map((n) =>
    (n.type === "section" ? n.rows[0] : n).columns.map((c) =>
      c.blocks
        .map((b) => ("text" in b ? b.text : "url" in b ? b.url : "?"))
        .join("+"),
    ),
  );

const sample: LayoutDoc = {
  version: 1,
  rows: [
    {
      columns: [
        {
          span: 2,
          blocks: [
            { type: "paragraph", text: "A" },
            { type: "paragraph", text: "B" },
          ],
        },
        { span: 1, blocks: [{ type: "image", url: "x.png", alt: "x" }] },
      ],
    },
    {
      type: "section",
      frame: true,
      rows: [
        {
          columns: [
            { span: 1, blocks: [{ type: "heading", level: 2, text: "H" }] },
          ],
        },
      ],
    },
  ],
};

describe("round trip", () => {
  it("toEditorDoc → toLayoutDoc keeps the document", () => {
    expect(toLayoutDoc(toEditorDoc(sample))).toEqual(sample);
  });

  it("empty editor doc becomes null", () => {
    expect(toLayoutDoc(toEditorDoc(null))).toBeNull();
  });
});

describe("rows and ratios", () => {
  it("addRow / removeRow, removing the last row of a section drops the section", () => {
    let doc = toEditorDoc(sample);
    doc = addRow(doc, "1:1");
    expect(doc.rows).toHaveLength(3);
    const section = doc.rows[1];
    if (section.type !== "section") throw new Error("expected section");
    doc = removeRow(doc, section.rows[0].id);
    expect(doc.rows).toHaveLength(2);
    expect(doc.rows.every((n) => n.type === "row")).toBe(true);
  });

  it("setRowRatio merges overflow columns into the last kept column", () => {
    let doc = toEditorDoc(sample);
    const row = doc.rows[0] as EditorRow;
    expect(rowRatio(row)).toBe("2:1");
    doc = setRowRatio(doc, row.id, "1");
    const after = doc.rows[0] as EditorRow;
    expect(after.columns).toHaveLength(1);
    expect(after.columns[0].blocks.map((b) => b.type)).toEqual([
      "paragraph",
      "paragraph",
      "image",
    ]);
    doc = setRowRatio(doc, row.id, "1:1:1");
    expect((doc.rows[0] as EditorRow).columns.map((c) => c.span)).toEqual([
      1, 1, 1,
    ]);
    expect(blockCount(doc)).toBe(4);
  });

  it("wrap / unwrap section", () => {
    let doc = toEditorDoc(sample);
    const rowId = doc.rows[0].id;
    doc = wrapRowInSection(doc, rowId);
    expect(doc.rows[0].type).toBe("section");
    doc = unwrapSection(doc, doc.rows[0].id);
    expect(doc.rows[0].id).toBe(rowId);
  });

  it("moveTopLevel reorders", () => {
    let doc = toEditorDoc(sample);
    const [a, b] = doc.rows.map((n) => n.id);
    doc = moveTopLevel(doc, 0, 1);
    expect(doc.rows.map((n) => n.id)).toEqual([b, a]);
  });
});

describe("blocks", () => {
  it("add / update / remove", () => {
    let doc = toEditorDoc(sample);
    const col = (doc.rows[0] as EditorRow).columns[1];
    const block = defaultBlock("heading");
    doc = addBlock(doc, col.id, block, 0);
    doc = updateBlock(doc, block.id, { text: "New" });
    expect(findColumnOfBlock(doc, block.id)?.blocks[0]).toMatchObject({
      type: "heading",
      text: "New",
    });
    doc = removeBlock(doc, block.id);
    expect(findColumnOfBlock(doc, block.id)).toBeNull();
  });

  it("moveBlock within a column and across columns", () => {
    let doc = toEditorDoc(sample);
    const row = doc.rows[0] as EditorRow;
    const [a, b] = row.columns[0].blocks.map((x) => x.id);
    doc = moveBlock(doc, a, row.columns[0].id, 1);
    expect(
      (doc.rows[0] as EditorRow).columns[0].blocks.map((x) => x.id),
    ).toEqual([b, a]);
    doc = moveBlock(doc, a, row.columns[1].id);
    const after = doc.rows[0] as EditorRow;
    expect(after.columns[0].blocks.map((x) => x.id)).toEqual([b]);
    expect(after.columns[1].blocks.map((x) => x.id)).toEqual([
      after.columns[1].blocks[0].id,
      a,
    ]);
  });

  it("deleteBlock 收掉空欄：2 欄刪一個 → 剩下的撐滿；全刪 → 列消失", () => {
    let doc = toEditorDoc(twoBesideDoc());
    const row = doc.rows[0] as EditorRow;
    doc = deleteBlock(doc, row.columns[1].blocks[0].id);
    const after = doc.rows[0] as EditorRow;
    expect(after.columns).toHaveLength(1);
    expect(after.columns[0].span).toBe(1);
    doc = deleteBlock(doc, after.columns[0].blocks[0].id);
    expect(doc.rows).toHaveLength(0);
  });

  it("singleImageDoc", () => {
    const layout = toLayoutDoc(singleImageDoc("p.png", "poster"));
    expect(layout?.rows).toHaveLength(1);
    const row = layout!.rows[0];
    if (row.type === "section") throw new Error("expected row");
    expect(row.columns[0].blocks[0]).toMatchObject({
      type: "image",
      url: "p.png",
      alt: "poster",
    });
  });
});

describe("文件式操作（並排／寬度／插入）", () => {
  const blockIds = (doc: ReturnType<typeof toEditorDoc>) =>
    doc.rows.flatMap((n) =>
      (n.type === "section" ? n.rows : [n]).flatMap((r) =>
        r.columns.flatMap((c) => c.blocks.map((b) => b.id)),
      ),
    );

  it("placeBeside：拖到右側 → 兩欄各 1/2；第三個 → 三等分；第四個拒絕", () => {
    let doc = toEditorDoc(threeParagraphs());
    let [a, b, c] = blockIds(doc);
    expect(canPlaceBeside(doc, b, a)).toBe(true);
    doc = placeBeside(doc, b, a, "right");
    expect(rowTexts(toLayoutDoc(doc))).toEqual([["A", "B"], ["C"]]);
    expect((doc.rows[0] as EditorRow).columns.map((x) => x.span)).toEqual([
      1, 1,
    ]);

    doc = placeBeside(doc, c, a, "left");
    expect(rowTexts(toLayoutDoc(doc))).toEqual([["C", "A", "B"]]);
    expect((doc.rows[0] as EditorRow).columns.map((x) => x.span)).toEqual([
      1, 1, 1,
    ]);

    doc = appendBlock(doc, para("D"));
    [a, b, c] = blockIds(doc);
    const d = blockIds(doc)[3];
    expect(canPlaceBeside(doc, d, a)).toBe(false);
    const before = doc;
    doc = placeBeside(doc, d, a, "right");
    expect(doc).toBe(before);
  });

  it("placeBeside 同列換邊：兩欄互換不會多出欄", () => {
    let doc = toEditorDoc(twoBesideDoc());
    const [l, r] = blockIds(doc);
    doc = placeBeside(doc, l, r, "right");
    expect(rowTexts(toLayoutDoc(doc))).toEqual([["r.png", "L"]]);
    expect((doc.rows[0] as EditorRow).columns).toHaveLength(2);
  });

  it("placeBeside 目標欄有多個區塊（舊資料）→ 拒絕", () => {
    const doc = toEditorDoc(sample);
    const ids = blockIds(doc);
    // sample 第一欄有 A、B 兩段；把 H 拖到 A 旁邊不允許
    expect(canPlaceBeside(doc, ids[3], ids[0])).toBe(false);
    expect(placeBeside(doc, ids[3], ids[0], "left")).toBe(doc);
  });

  it("拖走後剩餘撐滿：三欄拖走一個 → 兩欄 1:1；再拖走 → 整行", () => {
    let doc = toEditorDoc({
      version: 1,
      rows: [
        {
          columns: ["A", "B", "C"].map((text) => ({
            span: 1,
            blocks: [{ type: "paragraph", text }],
          })),
        },
      ],
    });
    const [a, b] = blockIds(doc);
    doc = placeAround(doc, a, b, "after");
    // A 獨占一行接在該列之後
    expect(rowTexts(toLayoutDoc(doc))).toEqual([["B", "C"], ["A"]]);
    expect((doc.rows[0] as EditorRow).columns.map((x) => x.span)).toEqual([
      1, 1,
    ]);
    doc = placeAround(doc, b, a, "before");
    expect(rowTexts(toLayoutDoc(doc))).toEqual([["C"], ["B"], ["A"]]);
    expect((doc.rows[0] as EditorRow).columns[0].span).toBe(1);
  });

  it("placeAround：目標在多區塊欄 → 插進同一欄前後，不新開列", () => {
    let doc = toEditorDoc(sample);
    const ids = blockIds(doc);
    // 把 section 裡的 H 放到第一欄 A 的前面
    doc = placeAround(doc, ids[3], ids[0], "before");
    const first = doc.rows[0] as EditorRow;
    expect(first.columns[0].blocks.map((b) => b.id)).toEqual([
      ids[3],
      ids[0],
      ids[1],
    ]);
    // 原 section 只剩空列 → 整個消失
    expect(doc.rows).toHaveLength(1);
  });

  it("setBlockWidth：雙欄 2/3 → 另一欄 1/3；1/3 → 另一欄 2/3；單欄／三欄不變", () => {
    let doc = toEditorDoc(twoBesideDoc());
    const [l, r] = blockIds(doc);
    let row = doc.rows[0] as EditorRow;
    expect(columnWidth(row, row.columns[0].id)).toBe("2/3");
    expect(columnWidth(row, row.columns[1].id)).toBe("1/3");
    expect(widthOptionsFor(row)).toEqual(["2/3", "1/2", "1/3"]);

    doc = setBlockWidth(doc, r, "2/3");
    row = doc.rows[0] as EditorRow;
    expect(row.columns.map((c) => c.span)).toEqual([1, 2]);
    doc = setBlockWidth(doc, l, "1/2");
    row = doc.rows[0] as EditorRow;
    expect(row.columns.map((c) => c.span)).toEqual([1, 1]);
    expect(columnWidth(row, row.columns[0].id)).toBe("1/2");

    const single = toEditorDoc(threeParagraphs());
    const sid = blockIds(single)[0];
    expect(setBlockWidth(single, sid, "1/3")).toBe(single);
    expect(widthOptionsFor(single.rows[0] as EditorRow)).toEqual(["full"]);
    expect(
      columnWidth(
        single.rows[0] as EditorRow,
        (single.rows[0] as EditorRow).columns[0].id,
      ),
    ).toBe("full");
  });

  it("insertBlockRow：錨點前／後、section 內維持在 section 裡；appendBlock 接最後", () => {
    let doc = toEditorDoc(sample);
    const sectionRowId = (doc.rows[1] as { rows: EditorRow[] }).rows[0].id;
    doc = insertBlockRow(doc, para("S"), {
      rowId: sectionRowId,
      position: "after",
    });
    const section = doc.rows[1];
    if (section.type !== "section") throw new Error("expected section");
    expect(section.rows).toHaveLength(2);
    expect(section.rows[1].columns[0].blocks[0]).toMatchObject({ text: "S" });

    doc = insertBlockRow(doc, para("T"), {
      rowId: doc.rows[0].id,
      position: "before",
    });
    expect(rowTexts(toLayoutDoc(doc))[0]).toEqual(["T"]);
    doc = appendBlock(doc, para("U"));
    const texts = rowTexts(toLayoutDoc(doc));
    expect(texts[texts.length - 1]).toEqual(["U"]);
  });

  it("toggleBlockFrame：包成 section 再解開；locateBlock 回報 sectionId", () => {
    let doc = toEditorDoc(threeParagraphs());
    const [a] = blockIds(doc);
    expect(locateBlock(doc, a)?.sectionId).toBeNull();
    doc = toggleBlockFrame(doc, a);
    expect(doc.rows[0].type).toBe("section");
    expect(locateBlock(doc, a)?.sectionId).toBe(doc.rows[0].id);
    doc = toggleBlockFrame(doc, a);
    expect(doc.rows[0].type).toBe("row");
    expect(rowTexts(toLayoutDoc(doc))).toEqual([["A"], ["B"], ["C"]]);
  });

  it("舊資料（一欄多區塊、2:1 比例）round-trip 不遷移", () => {
    const layout = toLayoutDoc(toEditorDoc(sample));
    expect(layout).toEqual(sample);
    const row = layout!.rows[0] as LayoutRow;
    expect(row.columns[0].blocks).toHaveLength(2);
    expect(row.columns.map((c) => c.span)).toEqual([2, 1]);
  });
});
