/**
 * 區塊編輯器的資料模型與純操作（Issue #1082）。
 *
 * `LayoutDoc`（DB 格式）沒有 id，dnd-kit 需要穩定 id，所以編輯器內部用 `EditorDoc`：
 * 同一棵樹，每個節點／欄／區塊多一個 `id`。`toEditorDoc` 進來配 id，`toLayoutDoc` 出去剝掉。
 * 所有操作都是純函式回傳新物件，方便測試，也讓 React 狀態更新單純。
 * 文件層欄位（整篇外框 `frame`）由每個操作以 `...doc` 原樣帶過，只有 GroupCard 的勾選會改它。
 *
 * 欄位比例只允許 README 定義的四種：1:1、1:2、2:1、1:1:1（單欄 = 1）。
 *
 * 老師看到的是「文件」：只有區塊，沒有列／欄。並排靠拖曳（`placeBeside`）自動產生欄，
 * 比例由 `defaultSpansFor` 決定（圖＋文 → 圖 1/3、文 2/3；其餘等分），之後可拖欄間分隔線
 * 用 `setRowSplit`（左欄 1/3／1/2／2/3）微調；拖走後 `detachBlock` 讓剩下的欄依同一規則撐滿。
 * 不變式：並排列裡一欄一區塊；多區塊的欄只出現在單欄列（舊資料），對它只允許插在前後、
 * 不再分欄。
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
  /** 整篇主圖文加外框（`LayoutDoc.frame`）；所有操作以 `...doc` 保留 */
  frame?: boolean;
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
    ...(layout.frame ? { frame: true } : {}),
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
  return { version: 1, ...(doc.frame ? { frame: true } : {}), rows };
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
  return (
    allColumns(doc).find((c) => c.blocks.some((b) => b.id === blockId)) ?? null
  );
}

export function findColumn(
  doc: EditorDoc,
  columnId: string,
): EditorColumn | null {
  return allColumns(doc).find((c) => c.id === columnId) ?? null;
}

export function blockCount(doc: EditorDoc): number {
  return allColumns(doc).reduce((n, c) => n + c.blocks.length, 0);
}

// ---- 結構操作（皆回傳新 doc） ----

function mapRows(doc: EditorDoc, fn: (row: EditorRow) => EditorRow): EditorDoc {
  return {
    ...doc,
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
      return {
        id,
        type: "dialogue",
        frame: true,
        lines: [{ speaker: "", text: "" }],
      };
  }
}

/** 在最外層（或指定 section 內）尾端加一列 */
export function addRow(
  doc: EditorDoc,
  ratio: ColumnRatio = "1",
  sectionId?: string,
): EditorDoc {
  const row = emptyRow(ratio);
  if (!sectionId) return { ...doc, rows: [...doc.rows, row] };
  return {
    ...doc,
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
  return { ...doc, rows };
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
      kept[kept.length - 1] = {
        ...last,
        blocks: [...last.blocks, ...overflow],
      };
    }
    return { ...r, columns: kept };
  });
}

/** 把最外層的一列包成 section（框起來） */
export function wrapRowInSection(doc: EditorDoc, rowId: string): EditorDoc {
  return {
    ...doc,
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
    ...doc,
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
    ...doc,
    rows: doc.rows.map((n) =>
      n.type === "section" && n.id === sectionId ? { ...n, frame } : n,
    ),
  };
}

/** 最外層節點排序（列與 section 都可以拖） */
export function moveTopLevel(
  doc: EditorDoc,
  from: number,
  to: number,
): EditorDoc {
  if (from === to || from < 0 || to < 0 || from >= doc.rows.length) return doc;
  const rows = [...doc.rows];
  const [item] = rows.splice(from, 1);
  rows.splice(Math.min(to, rows.length), 0, item);
  return { ...doc, rows };
}

/** section 內的列排序 */
export function moveRowInSection(
  doc: EditorDoc,
  sectionId: string,
  from: number,
  to: number,
): EditorDoc {
  return {
    ...doc,
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

// ---- 文件式操作（#1082 第 2 段修訂：沒有列／欄概念，只有區塊與並排） ----

export const MAX_COLUMNS = 3;

/** 雙欄列的分割位置：左欄佔 1/3、1/2、2/3（span 分別為 [1,2]、[1,1]、[2,1]） */
export type SplitPosition = 1 | 2 | 3;
export const SPLIT_SPANS: Record<SplitPosition, [number, number]> = {
  1: [1, 2],
  2: [1, 1],
  3: [2, 1],
};

export interface BlockLocation {
  row: EditorRow;
  column: EditorColumn;
  block: EditorBlock;
  /** 所在 section（最外層的列為 null） */
  sectionId: string | null;
}

export function locateBlock(
  doc: EditorDoc,
  blockId: string,
): BlockLocation | null {
  for (const n of doc.rows) {
    const rows = n.type === "section" ? n.rows : [n];
    for (const row of rows) {
      for (const column of row.columns) {
        const block = column.blocks.find((b) => b.id === blockId);
        if (block) {
          return {
            row,
            column,
            block,
            sectionId: n.type === "section" ? n.id : null,
          };
        }
      }
    }
  }
  return null;
}

/** 雙欄列目前的分割位置（左欄比例 → 最接近的 1/3、1/2、2/3）；非雙欄回 null */
export function rowSplit(row: EditorRow): SplitPosition | null {
  if (row.columns.length !== 2) return null;
  const total = row.columns.reduce((n, c) => n + c.span, 0) || 1;
  const frac = row.columns[0].span / total;
  if (frac >= 0.6) return 3;
  if (frac >= 0.45) return 2;
  return 1;
}

/** 並排時的預設比例：圖＋文 → 圖 1、文 2；其餘等分（三欄一律 1:1:1） */
export function defaultSpansFor(columns: EditorColumn[]): number[] {
  if (columns.length !== 2) return columns.map(() => 1);
  const kind = (c: EditorColumn) =>
    c.blocks.length === 1 && c.blocks[0].type === "image" ? "image" : "text";
  const [a, b] = columns.map(kind);
  if (a === "image" && b === "text") return [1, 2];
  if (a === "text" && b === "image") return [2, 1];
  return [1, 1];
}

function applySpans(row: EditorRow, spans: number[]): EditorRow {
  return {
    ...row,
    columns: row.columns.map((c, i) => ({ ...c, span: spans[i] ?? 1 })),
  };
}

/** 列裡的欄依內容重新分配比例（欄數變動後用） */
function autoSpans(row: EditorRow): EditorRow {
  return applySpans(row, defaultSpansFor(row.columns));
}

function replaceRow(doc: EditorDoc, row: EditorRow): EditorDoc {
  return mapRows(doc, (r) => (r.id === row.id ? row : r));
}

/** 移除空欄、空列、空 section；剩下的欄等分撐滿 */
function compact(doc: EditorDoc): EditorDoc {
  const cleanRow = (r: EditorRow): EditorRow | null => {
    const columns = r.columns.filter((c) => c.blocks.length > 0);
    if (columns.length === 0) return null;
    return columns.length === r.columns.length
      ? r
      : autoSpans({ ...r, columns });
  };
  const rows: EditorNode[] = [];
  for (const n of doc.rows) {
    if (n.type === "row") {
      const r = cleanRow(n);
      if (r) rows.push(r);
      continue;
    }
    const inner = n.rows.map(cleanRow).filter((r): r is EditorRow => !!r);
    if (inner.length > 0) rows.push({ ...n, rows: inner });
  }
  return { ...doc, rows };
}

/** 把區塊從文件拿出來（原欄空了就收掉、剩餘欄撐滿） */
export function detachBlock(
  doc: EditorDoc,
  blockId: string,
): { doc: EditorDoc; block: EditorBlock | null } {
  const loc = locateBlock(doc, blockId);
  if (!loc) return { doc, block: null };
  return { doc: compact(removeBlock(doc, blockId)), block: loc.block };
}

/** 刪除區塊並收掉空欄／空列（老師按刪除用這個，不留空格子） */
export function deleteBlock(doc: EditorDoc, blockId: string): EditorDoc {
  return detachBlock(doc, blockId).doc;
}

function singleBlockRow(block: EditorBlock): EditorRow {
  return {
    id: newId("r"),
    type: "row",
    columns: [{ id: newId("c"), span: 1, blocks: [block] }],
  };
}

/**
 * 以「獨占一行」插入區塊：`anchor` 列的前／後（留在同一個 section 內），
 * 沒有錨點就接在最後。
 */
export function insertBlockRow(
  doc: EditorDoc,
  block: EditorBlock,
  anchor?: { rowId: string; position: "before" | "after" } | null,
): EditorDoc {
  const row = singleBlockRow(block);
  if (!anchor) return { ...doc, rows: [...doc.rows, row] };
  const at = (idx: number) => (anchor.position === "before" ? idx : idx + 1);
  const topIdx = doc.rows.findIndex((n) => n.id === anchor.rowId);
  if (topIdx >= 0) {
    const rows = [...doc.rows];
    rows.splice(at(topIdx), 0, row);
    return { ...doc, rows };
  }
  return {
    ...doc,
    rows: doc.rows.map((n) => {
      if (n.type !== "section") return n;
      const idx = n.rows.findIndex((r) => r.id === anchor.rowId);
      if (idx < 0) return n;
      const rows = [...n.rows];
      rows.splice(at(idx), 0, row);
      return { ...n, rows };
    }),
  };
}

/** 接在文件最後（「＋」按鈕） */
export function appendBlock(doc: EditorDoc, block: EditorBlock): EditorDoc {
  return insertBlockRow(doc, block, null);
}

/**
 * 能不能把 `movingId` 放到 `targetId` 的左／右邊：
 * 目標欄只有一個區塊（舊資料多區塊欄不再分欄）、目標列扣掉搬走的那個後未滿 3 欄。
 */
export function canPlaceBeside(
  doc: EditorDoc,
  movingId: string,
  targetId: string,
): boolean {
  if (movingId === targetId) return false;
  const target = locateBlock(doc, targetId);
  const moving = locateBlock(doc, movingId);
  if (!target || !moving) return false;
  if (target.column.blocks.length !== 1) return false;
  const sameRow = moving.row.id === target.row.id;
  const cols = target.row.columns.length - (sameRow ? 1 : 0);
  return cols < MAX_COLUMNS;
}

/** 拖到某區塊的左／右邊：變成並排，比例依 `defaultSpansFor` */
export function placeBeside(
  doc: EditorDoc,
  movingId: string,
  targetId: string,
  side: "left" | "right",
): EditorDoc {
  if (!canPlaceBeside(doc, movingId, targetId)) return doc;
  const { doc: without, block } = detachBlock(doc, movingId);
  if (!block) return doc;
  const target = locateBlock(without, targetId);
  if (!target) return doc;
  const idx = target.row.columns.findIndex((c) => c.id === target.column.id);
  const columns = [...target.row.columns];
  columns.splice(side === "left" ? idx : idx + 1, 0, {
    id: newId("c"),
    span: 1,
    blocks: [block],
  });
  return replaceRow(without, autoSpans({ ...target.row, columns }));
}

/**
 * 拖到某區塊的上／下方：目標在多區塊欄（舊資料）→ 插進同一欄的前／後；
 * 否則以獨占一行插在目標列的前／後。
 */
export function placeAround(
  doc: EditorDoc,
  movingId: string,
  targetId: string,
  position: "before" | "after",
): EditorDoc {
  if (movingId === targetId) return doc;
  const { doc: without, block } = detachBlock(doc, movingId);
  if (!block) return doc;
  const target = locateBlock(without, targetId);
  if (!target) return doc;
  if (target.column.blocks.length > 1) {
    const i = target.column.blocks.findIndex((b) => b.id === targetId);
    return addBlock(
      without,
      target.column.id,
      block,
      position === "before" ? i : i + 1,
    );
  }
  return insertBlockRow(without, block, { rowId: target.row.id, position });
}

/** 拖欄間分隔線：設定雙欄列的分割位置（非雙欄列不動） */
export function setRowSplit(
  doc: EditorDoc,
  rowId: string,
  pos: SplitPosition,
): EditorDoc {
  let changed = false;
  const next = mapRows(doc, (r) => {
    if (r.id !== rowId || r.columns.length !== 2) return r;
    changed = true;
    return applySpans(r, SPLIT_SPANS[pos]);
  });
  return changed ? next : doc;
}

/** 區塊所在的列包成 section（框起來）；已在 section 內則解開 */
export function toggleBlockFrame(doc: EditorDoc, blockId: string): EditorDoc {
  const loc = locateBlock(doc, blockId);
  if (!loc) return doc;
  return loc.sectionId
    ? unwrapSection(doc, loc.sectionId)
    : wrapRowInSection(doc, loc.row.id);
}
