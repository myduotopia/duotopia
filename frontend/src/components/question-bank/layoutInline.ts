/**
 * 題組排版的行內標記解析與純文字副本（Issue #1082）。
 *
 * 行內 markdown 子集（老師預覽＝學生端＝考卷共用）：
 *   `**粗體**`、`__底線__`、`{{n}}`（克漏字空格，畫成底線＋編號）、`\n`（換行）
 * 不引入 markdown 套件、不產生 HTML 字串：解析成節點樹交給 React 渲染，
 * 所以永遠不需要 dangerouslySetInnerHTML。
 *
 * `layoutToPlainText` 與後端 services/question_bank_layout.layout_to_plain_text 對齊：
 * 去標記、`{{n}}` → `____`、區塊之間空一行，供 passage_text（搜尋／AI 上下文）使用。
 */

import type { LayoutDoc, LayoutNode, LayoutRow } from "@/types/questionBank";

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "bold"; children: InlineNode[] }
  | { type: "underline"; children: InlineNode[] }
  | { type: "blank"; n: number }
  | { type: "br" };

const BLANK_RE = /\{\{(\d+)\}\}/g;

/**
 * 解析一段文字。`**` / `__` 成對才算標記，落單的照原文輸出；
 * 允許粗體內含底線（反之亦然），同種標記不巢狀。
 */
export function parseInline(text: string): InlineNode[] {
  return parseRange(text, 0, text.length, null).nodes;
}

type Marker = "**" | "__";

function parseRange(
  text: string,
  start: number,
  end: number,
  closing: Marker | null,
): { nodes: InlineNode[]; next: number } {
  const nodes: InlineNode[] = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      nodes.push({ type: "text", text: buf });
      buf = "";
    }
  };
  let i = start;
  while (i < end) {
    const two = text.slice(i, i + 2);
    if (closing && two === closing) {
      flush();
      return { nodes, next: i + 2 };
    }
    if (two === "**" || two === "__") {
      const marker = two as Marker;
      // 只有在後面找得到成對的關閉標記時才當標記
      const close = text.indexOf(marker, i + 2);
      if (close !== -1 && close < end && marker !== closing) {
        flush();
        const inner = parseRange(text, i + 2, close, marker);
        nodes.push({
          type: marker === "**" ? "bold" : "underline",
          children: inner.nodes,
        });
        i = inner.next;
        continue;
      }
      buf += two;
      i += 2;
      continue;
    }
    if (text[i] === "{" && text[i + 1] === "{") {
      BLANK_RE.lastIndex = i;
      const m = BLANK_RE.exec(text);
      if (m && m.index === i) {
        flush();
        nodes.push({ type: "blank", n: Number(m[1]) });
        i += m[0].length;
        continue;
      }
    }
    if (text[i] === "\n") {
      flush();
      nodes.push({ type: "br" });
      i += 1;
      continue;
    }
    buf += text[i];
    i += 1;
  }
  flush();
  return { nodes, next: end };
}

/** 去掉行內標記；`{{n}}` → `____` */
export function stripInlineMarkup(text: string): string {
  return text.replace(/\*\*/g, "").replace(/__/g, "").replace(BLANK_RE, "____");
}

/** 行內標記裡出現的克漏字編號（依出現順序、去重） */
export function inlineBlankIndexes(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(BLANK_RE)) {
    const n = Number(m[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

function rowsOf(node: LayoutNode): LayoutRow[] {
  return node.type === "section" ? node.rows : [node];
}

/** layout 內所有文字（標題／段落／對話「說話者: 內容」），依閱讀順序 */
export function layoutTexts(layout: LayoutDoc | null | undefined): string[] {
  if (!layout) return [];
  const out: string[] = [];
  for (const node of layout.rows) {
    for (const row of rowsOf(node)) {
      for (const col of row.columns) {
        for (const block of col.blocks) {
          if (block.type === "heading" || block.type === "paragraph") {
            out.push(block.text);
          } else if (block.type === "dialogue") {
            for (const line of block.lines) {
              out.push(`${line.speaker}: ${line.text}`);
            }
          }
        }
      }
    }
  }
  return out;
}

/** 純文字副本（passage_text）；與後端 layout_to_plain_text 相同規則 */
export function layoutToPlainText(layout: LayoutDoc | null | undefined): string {
  return layoutTexts(layout)
    .map((t) => stripInlineMarkup(t).trim())
    .filter(Boolean)
    .join("\n\n");
}

/** layout 內出現的克漏字編號（依出現順序、去重） */
export function layoutBlankIndexes(
  layout: LayoutDoc | null | undefined,
): number[] {
  const out: number[] = [];
  for (const t of layoutTexts(layout)) {
    for (const n of inlineBlankIndexes(t)) if (!out.includes(n)) out.push(n);
  }
  return out;
}
