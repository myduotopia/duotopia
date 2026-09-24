/**
 * 區塊編輯器純操作（Issue #1082）：DB 格式 ↔ 編輯格式往返不失真、
 * 列／欄／區塊的新增刪除、比例切換併欄、section 包／解、區塊同欄與跨欄搬移。
 */

import { describe, it, expect } from "vitest";

import {
  addBlock,
  addRow,
  blockCount,
  defaultBlock,
  findColumnOfBlock,
  moveBlock,
  moveTopLevel,
  removeBlock,
  removeRow,
  rowRatio,
  setRowRatio,
  singleImageDoc,
  toEditorDoc,
  toLayoutDoc,
  unwrapSection,
  updateBlock,
  wrapRowInSection,
  type EditorRow,
} from "../layoutEditorModel";
import type { LayoutDoc } from "@/types/questionBank";

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
