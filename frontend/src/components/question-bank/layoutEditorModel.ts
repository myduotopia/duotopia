/**
 * 區塊編輯器的資料模型與純操作（Issue #1082）。
 *
 * `LayoutDoc`（DB 格式）沒有 id，dnd-kit 需要穩定 id，所以編輯器內部用 `EditorDoc`：
 * 同一棵樹，每個節點／欄／區塊多一個 `id`。`toEditorDoc` 進來配 id，`toLayoutDoc` 出去剝掉。
 * 所有操作都是純函式回傳新物件，方便測試，也讓 React 狀態更新單純。
 *
 * 欄位比例只允許 README 定義的四種：1:1、1:2、2:1、1:1:1（單欄 = 1）。
 */

import type {
  LayoutBlock,
  LayoutDoc,
  LayoutNode,
  LayoutRow,
} from "@/types/questionBank";

export interface EditorColumn {
  id: string;
  span: number;
  blocks: EditorBlock[];
}
export type EditorBlock = LayoutBlock & { id: string };
export interface EditorRow {
  id: string;
  type: "row";
  columns: EditorColumn[];
}
export interface EditorSection {
  id: string;
  type: "section";
  frame: boolean;
  rows: EditorRow[];
}
export type EditorNode = EditorRow | EditorSection;
export interface EditorDoc {
  rows: EditorNode[];
}

export type ColumnRatio = "1" | "1:1" | "1:2" | "2:1" | "1:1:1";
export const COLUMN_RATIOS: ColumnRatio[] = ["1", "1:1", "1:2", "2:1", "1:1:1"];

export function ratioSpans(ratio: ColumnRatio): number[] {
  return ratio.split(":").map(Number);
}

/** 目前欄位對應的比例；不在清單內（舊資料）就回最接近的欄數 */
export function rowRatio(row: EditorRow): ColumnRatio {
  const spans = row.columns.map((c) => c.span).join(":");
  if ((COLUMN_RATIOS as string[]).includes(spans)) return spans as ColumnRatio;
  const n = row.columns.length;
  return n >= 3 ? "1:1:1" : n === 2 ? "1:1" : "1";
}

let seq = 0;
export function newId(prefix = "n"): string {
  seq += 1;
  return `${prefix}-${seq.toString(36)}`;
}

// ---- 轉換 ----

function toEditorRow(row: LayoutRow): EditorRow {
  return {
    id: newId("r"),
    type: "row",
    columns: row.columns.map((c) => ({
      id: newId("c"),
      span: c.span,
      blocks: c.blocks.map((b) => ({ ...b, id: newId("b") })),
    })),
  };
}

export function toEditorDoc(layout: LayoutDoc | null | undefined): EditorDoc {
  if (!layout) return { rows: [] };
  return {
    rows: layout.rows.map((n) =>
      n.type === "section"
        ? {
            id: newId("s"),
            type: "section",
            frame: n.frame ?? true,
            rows: n.rows.map(toEditorRow),
          }
        : toEditorRow(n),
    ),
  };
}

function stripBlock(b: EditorBlock): LayoutBlock {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, ...rest } = b;
  return rest as LayoutBlock;
}

function toLayoutRow(row: EditorRow): LayoutRow {
  return {
    columns: row.columns.map((c) => ({
      span: c.span,
      blocks: c.blocks.map(stripBlock),
    })),
  };
}

/** 出去時剝掉 id；空文件回 null（DB 存 NULL，退回 passage_text + image_url） */
export function toLayoutDoc(doc: EditorDoc): LayoutDoc | null {
  if (doc.rows.length === 0) return null;
  const rows: LayoutNode[] = doc.rows.map((n) =>
    n.type === "section"
      ? { type: "section", frame: n.frame, rows: n.rows.map(toLayoutRow) }
      : toLayoutRow(n),
  );
  return { version: 1, rows };
}

// ---- 查找 ----

export function allRows(doc: EditorDoc): EditorRow[] {
  return doc.rows.flatMap((n) => (n.type === "section" ? n.rows : [n]));
}

export function allColumns(doc: EditorDoc): EditorColumn[] {
  return allRows(doc).flatMap((r) => r.columns);
}

export function findColumnOfBlock(
  doc: EditorDoc,
  blockId: string,
): EditorColumn | null {
  return allColumns(doc).find((c) => c.blocks.some((b) => b.id === blockId)) ?? null;
}

export function findColumn(doc: EditorDoc, columnId: string): EditorColumn | null {
  return allColumns(doc).find((c) => c.id === columnId) ?? null;
}

export function blockCount(doc: EditorDoc): number {
  return allColumns(doc).reduce((n, c) => n + c.blocks.length, 0);
}

// ---- 結構操作（皆回傳新 doc） ----

function mapRows(doc: EditorDoc, fn: (row: EditorRow) => EditorRow): EditorDoc {
  return {
    rows: doc.rows.map((n) =>
      n.type === "section" ? { ...n, rows: n.rows.map(fn) } : fn(n),
    ),
  };
}

function mapColumns(
  doc: EditorDoc,
  fn: (col: EditorColumn) => EditorColumn,
): EditorDoc {
  return mapRows(doc, (r) => ({ ...r, columns: r.columns.map(fn) }));
}

export function emptyRow(ratio: ColumnRatio = "1"): EditorRow {
  return {
    id: newId("r"),
    type: "row",
    columns: ratioSpans(ratio).map((span) => ({
      id: newId("c"),
      span,
      blocks: [],
    })),
  };
}

export function defaultBlock(type: LayoutBlock["type"]): EditorBlock {
  const id = newId("b");
  switch (type) {
    case "heading":
      return { id, type: "heading", level: 2, text: "" };
    case "paragraph":
      return { id, type: "paragraph", text: "" };
    case "image":
      return { id, type: "image", url: "", alt: "" };
    case "dialogue":
      return { id, type: "dialogue", frame: true, lines: [{ speaker: "", text: "" }] };
  }
}

/** 在最外層（或指定 section 內）尾端加一列 */
export function addRow(
  doc: EditorDoc,
  ratio: ColumnRatio = "1",
  sectionId?: string,
): EditorDoc {
  const row = emptyRow(ratio);
  if (!sectionId) return { rows: [...doc.rows, row] };
  return {
    rows: doc.rows.map((n) =>
      n.type === "section" && n.id === sectionId
        ? { ...n, rows: [...n.rows, row] }
        : n,
    ),
  };
}

/** 刪一列（section 內最後一列刪掉時整個 section 一起移除） */
export function removeRow(doc: EditorDoc, rowId: string): EditorDoc {
  const rows: EditorNode[] = [];
  for (const n of doc.rows) {
    if (n.type === "row") {
      if (n.id !== rowId) rows.push(n);
      continue;
    }
    const inner = n.rows.filter((r) => r.id !== rowId);
    if (inner.length > 0) rows.push({ ...n, rows: inner });
  }
  return { rows };
}

/** 改欄位比例；多出的欄位刪除時其區塊併到最後一個保留的欄 */
export function setRowRatio(
  doc: EditorDoc,
  rowId: string,
  ratio: ColumnRatio,
): EditorDoc {
  const spans = ratioSpans(ratio);
  return mapRows(doc, (r) => {
    if (r.id !== rowId) return r;
    const kept = r.columns.slice(0, spans.length).map((c, i) => ({
      ...c,
      span: spans[i],
    }));
    while (kept.length < spans.length) {
      kept.push({ id: newId("c"), span: spans[kept.length], blocks: [] });
    }
    const overflow = r.columns.slice(spans.length).flatMap((c) => c.blocks);
    if (overflow.length > 0) {
      const last = kept[kept.length - 1];
      kept[kept.length - 1] = { ...last, blocks: [...last.blocks, ...overflow] };
    }
    return { ...r, columns: kept };
  });
}

/** 把最外層的一列包成 section（框起來） */
export function wrapRowInSection(doc: EditorDoc, rowId: string): EditorDoc {
  return {
    rows: doc.rows.map((n) =>
      n.type === "row" && n.id === rowId
        ? { id: newId("s"), type: "section", frame: true, rows: [n] }
        : n,
    ),
  };
}

/** 解開 section：裡面的列放回最外層原位 */
export function unwrapSection(doc: EditorDoc, sectionId: string): EditorDoc {
  return {
    rows: doc.rows.flatMap((n) =>
      n.type === "section" && n.id === sectionId ? n.rows : [n],
    ),
  };
}

export function setSectionFrame(
  doc: EditorDoc,
  sectionId: string,
  frame: boolean,
): EditorDoc {
  return {
    rows: doc.rows.map((n) =>
      n.type === "section" && n.id === sectionId ? { ...n, frame } : n,
    ),
  };
}

/** 最外層節點排序（列與 section 都可以拖） */
export function moveTopLevel(doc: EditorDoc, from: number, to: number): EditorDoc {
  if (from === to || from < 0 || to < 0 || from >= doc.rows.length) return doc;
  const rows = [...doc.rows];
  const [item] = rows.splice(from, 1);
  rows.splice(Math.min(to, rows.length), 0, item);
  return { rows };
}

/** section 內的列排序 */
export function moveRowInSection(
  doc: EditorDoc,
  sectionId: string,
  from: number,
  to: number,
): EditorDoc {
  return {
    rows: doc.rows.map((n) => {
      if (n.type !== "section" || n.id !== sectionId || from === to) return n;
      const rows = [...n.rows];
      const [item] = rows.splice(from, 1);
      rows.splice(Math.min(to, rows.length), 0, item);
      return { ...n, rows };
    }),
  };
}

// ---- 區塊操作 ----

export function addBlock(
  doc: EditorDoc,
  columnId: string,
  block: EditorBlock,
  index?: number,
): EditorDoc {
  return mapColumns(doc, (c) => {
    if (c.id !== columnId) return c;
    const blocks = [...c.blocks];
    blocks.splice(index ?? blocks.length, 0, block);
    return { ...c, blocks };
  });
}

export function updateBlock(
  doc: EditorDoc,
  blockId: string,
  patch: Partial<LayoutBlock>,
): EditorDoc {
  return mapColumns(doc, (c) => ({
    ...c,
    blocks: c.blocks.map((b) =>
      b.id === blockId ? ({ ...b, ...patch } as EditorBlock) : b,
    ),
  }));
}

export function removeBlock(doc: EditorDoc, blockId: string): EditorDoc {
  return mapColumns(doc, (c) => ({
    ...c,
    blocks: c.blocks.filter((b) => b.id !== blockId),
  }));
}

/**
 * 把區塊搬到某欄的某個位置（同欄排序或跨欄）。`toIndex` 省略 = 該欄尾端。
 * 同欄搬移時 index 以「移除後」的陣列計算，與 dnd-kit arrayMove 語意一致。
 */
export function moveBlock(
  doc: EditorDoc,
  blockId: string,
  toColumnId: string,
  toIndex?: number,
): EditorDoc {
  const from = findColumnOfBlock(doc, blockId);
  if (!from) return doc;
  const block = from.blocks.find((b) => b.id === blockId)!;
  const removed = removeBlock(doc, blockId);
  return addBlock(removed, toColumnId, block, toIndex);
}

/** 只有一張圖（以圖為準模式）的 layout */
export function singleImageDoc(url: string, alt = ""): EditorDoc {
  const row = emptyRow("1");
  row.columns[0].blocks = [
    { id: newId("b"), type: "image", url, alt, align: "center" },
  ];
  return { rows: [row] };
}
