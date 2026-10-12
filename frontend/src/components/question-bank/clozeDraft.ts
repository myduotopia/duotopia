/**
 * 克漏字題組的空格運算（Issue #1085）。
 *
 * 設計定案：**空格編號是權威**。文字裡的 `{{n}}` 的 n 就是小題的 `blank_index`，
 * 也是畫面上顯示的編號。區塊拖拉重排不會改編號；要變成閱讀順序 1..k 得由老師按
 * 「依閱讀順序重新編號」（`renumberMap` + `renumberLayoutBlanks`）。
 *
 * 這個檔刻意只依賴 `layoutInline` 與型別（不碰 `questionDraft`），方向單向：
 * `groupDraft` → `clozeDraft` → `layoutInline`，不會有循環 import。
 * GroupDraft 層的包裝（自動建卡／移除空白小題／驗證）在 `groupDraft.ts`（經 `questionDraft.ts` 轉出）。
 *
 * 打字中途的 `{{4`（未閉合）不算空格 —— 判定一律走 `layoutBlankIndexes`，
 * 只有完整 `{{n}}` 配對才會被算進來，所以邊打邊同步不會誤新增小題。
 */

import type { LayoutBlock, LayoutDoc, LayoutNode } from "@/types/questionBank";
import { layoutBlankIndexes, layoutBlankOccurrences } from "./layoutInline";

/** 空格編號上限與後端 BLANK_INDEX_MAX 一致 */
export const BLANK_INDEX_MAX = 999;

/**
 * 下一個可用的空格編號 = **目前（文章與小題）最大編號 + 1**；都沒有就從 1 開始。
 *
 * 維持 max+1 是為了手感：擷取進來的題本編號（如 40–43）原樣保留，接著插入會拿到 44，
 * 不會跳回 1。只有 max + 1 超過上限（999）時才退回「最小未使用編號」—— 以前是 clamp
 * 回 999，但 999 已經有人用了，會變成兩張小題對同一個空格。
 *
 * 1..999 全部用完時回 `null`，呼叫端要把插入按鈕 disable。
 */
export function nextBlankIndex(
  layoutBlanks: number[],
  questionBlanks: (number | null)[],
): number | null {
  const used = new Set<number>([
    ...layoutBlanks,
    ...questionBlanks.filter((n): n is number => n !== null),
  ]);
  if (used.size === 0) return 1;
  const next = Math.max(...used) + 1;
  if (next <= BLANK_INDEX_MAX) return next;
  for (let n = 1; n <= BLANK_INDEX_MAX; n += 1) {
    if (!used.has(n)) return n;
  }
  return null;
}

/** 文字改動前後的空格差集（新增／消失的編號） */
export function clozeBlankDiff(
  before: number[],
  after: number[],
): { added: number[]; removed: number[] } {
  return {
    added: after.filter((n) => !before.includes(n)),
    removed: before.filter((n) => !after.includes(n)),
  };
}

/** 小題指向的空格已經不在文章裡（「找不到空格 n」）；依編號升冪 */
export function clozeOrphanBlanks(
  layoutBlanks: number[],
  questionBlanks: (number | null)[],
): number[] {
  return questionBlanks
    .filter((n): n is number => n !== null && !layoutBlanks.includes(n))
    .sort((a, b) => a - b);
}

/** 文章有空格但沒有對應小題；依編號升冪 */
export function clozeMissingQuestions(
  layoutBlanks: number[],
  questionBlanks: (number | null)[],
): number[] {
  return layoutBlanks
    .filter((n) => !questionBlanks.includes(n))
    .sort((a, b) => a - b);
}

/**
 * 空格與小題是否一一對應（後端 `validate_cloze_blanks` 的前端版）。
 * 回傳 i18n key（`questionBank.form.errors.*` 最後一段）或 null。
 */
export function clozeBlankError(
  layoutBlanks: number[],
  questionBlanks: (number | null)[],
  layoutOccurrences: number[] = layoutBlanks,
): string | null {
  if (layoutBlanks.length === 0) return "clozeNeedsBlank";
  // 文章裡同一個編號貼了兩次：兩個空格卻只能對一張小題（後端同規則，422）
  const dup = duplicateBlankInLayout(layoutOccurrences);
  if (dup !== null) return `clozeDuplicateBlank#${dup}`;
  if (questionBlanks.some((n) => n === null)) return "clozeBlankMismatch";
  const seen = new Set<number>();
  for (const n of questionBlanks) {
    if (n !== null && seen.has(n)) return "clozeBlankMismatch";
    if (n !== null) seen.add(n);
  }
  if (clozeMissingQuestions(layoutBlanks, questionBlanks).length > 0)
    return "clozeBlankMismatch";
  if (clozeOrphanBlanks(layoutBlanks, questionBlanks).length > 0)
    return "clozeBlankMismatch";
  return null;
}

/** 文章裡第一個重複出現的空格編號（依出現順序）；沒有重複 → null */
export function duplicateBlankInLayout(occurrences: number[]): number | null {
  const seen = new Set<number>();
  for (const n of occurrences) {
    if (seen.has(n)) return n;
    seen.add(n);
  }
  return null;
}

/** 現在的編號是否已經是閱讀順序 1..k（是 → 不需要顯示「重新編號」） */
export function clozeNeedsRenumber(layoutBlanks: number[]): boolean {
  return layoutBlanks.some((n, i) => n !== i + 1);
}

/** 依閱讀順序產生「舊編號 → 新編號」對照（文章第一個空格 → 1） */
export function renumberMap(layoutBlanks: number[]): Map<number, number> {
  return new Map(layoutBlanks.map((n, i) => [n, i + 1]));
}

function renumberText(text: string, map: Map<number, number>): string {
  // 一次 replace 完成，避免「40→1、1→2」這種連續改寫互相撞號
  return text.replace(/\{\{(\d+)\}\}/g, (whole, digits: string) => {
    const to = map.get(Number(digits));
    return to === undefined ? whole : `{{${to}}}`;
  });
}

interface RowLike {
  type?: "row";
  columns: { span: number; blocks: LayoutBlock[] }[];
}

/**
 * 對 layout 內每一段文字套 fn，回傳新 layout（不改原物件）。
 * 走訪順序與 `layoutTexts` 一致（標題／段落各一段、對話每行一段），
 * `fn` 第二個參數就是那個順序的序號 —— `appendBlankToLayout` 靠它鎖定「最後一段」。
 */
export function mapLayoutTexts(
  layout: LayoutDoc,
  fn: (text: string, index: number) => string,
): LayoutDoc {
  let i = 0;
  const mapBlock = (block: LayoutBlock): LayoutBlock => {
    if (block.type === "heading" || block.type === "paragraph") {
      return { ...block, text: fn(block.text, i++) };
    }
    if (block.type === "dialogue") {
      return {
        ...block,
        lines: block.lines.map((l) => ({ ...l, text: fn(l.text, i++) })),
      };
    }
    return block;
  };
  const mapRow = (row: RowLike) => ({
    ...row,
    columns: row.columns.map((col) => ({
      ...col,
      blocks: col.blocks.map(mapBlock),
    })),
  });
  const rows: LayoutNode[] = layout.rows.map((node) =>
    node.type === "section"
      ? { ...node, rows: node.rows.map(mapRow) }
      : mapRow(node),
  );
  return { ...layout, rows };
}

/** 把 layout 內的 `{{舊}}` 依對照表換成 `{{新}}` */
export function renumberLayoutBlanks(
  layout: LayoutDoc,
  map: Map<number, number>,
): LayoutDoc {
  return mapLayoutTexts(layout, (t) => renumberText(t, map));
}

/**
 * 在文字的游標位置插入 `{{n}}`（非包裹式，和 `wrapSelection` 不同：有選取也只取代選取範圍）。
 * 回傳新文字與插入後的游標位置，呼叫端負責把游標設回去。
 */
export function insertBlankIntoText(
  text: string,
  start: number,
  end: number,
  n: number,
): { text: string; cursor: number } {
  const token = `{{${n}}}`;
  const head = text.slice(0, start);
  const tail = text.slice(end);
  return { text: head + token + tail, cursor: start + token.length };
}

/**
 * 把 `{{n}}` 加到文末：最後一個文字區塊的尾端；沒有文字區塊（或沒有排版）就補一列段落。
 * 「在文末插入空格」與「重新插入到文末」共用。
 */
export function appendBlankToLayout(
  layout: LayoutDoc | null,
  n: number,
): LayoutDoc {
  const token = `{{${n}}}`;
  const empty: LayoutDoc = { version: 1, rows: [] };
  const doc = layout ?? empty;
  const target = lastParagraphTextIndex(doc);
  if (target === null) {
    return {
      ...doc,
      rows: [
        ...doc.rows,
        {
          columns: [{ span: 1, blocks: [{ type: "paragraph", text: token }] }],
        },
      ],
    };
  }
  // 空段落（剛新增的區塊）直接放 token，不要多一個開頭空格
  return mapLayoutTexts(doc, (text, index) =>
    index === target ? (text.trim() ? `${text} ${token}` : token) : text,
  );
}

/**
 * 最後一個「段落」在 `mapLayoutTexts` 走訪順序中的序號；沒有段落 → null（改補一列新段落）。
 * 刻意不往標題或對話行裡塞空格 —— 那兩種位置插空格讀起來不合理。
 */
function lastParagraphTextIndex(layout: LayoutDoc): number | null {
  let i = 0;
  let last: number | null = null;
  const walkRow = (row: RowLike) => {
    for (const col of row.columns) {
      for (const b of col.blocks) {
        if (b.type === "paragraph") {
          last = i;
          i += 1;
        } else if (b.type === "heading") {
          i += 1;
        } else if (b.type === "dialogue") {
          i += b.lines.length;
        }
      }
    }
  };
  for (const node of layout.rows) {
    if (node.type === "section") node.rows.forEach(walkRow);
    else walkRow(node);
  }
  return last;
}

/** layout 的空格編號（依閱讀順序、去重）；re-export 讓 cloze 相關運算都從這裡拿 */
export { layoutBlankIndexes, layoutBlankOccurrences };
