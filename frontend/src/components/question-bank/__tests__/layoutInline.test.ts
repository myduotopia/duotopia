/**
 * 行內標記解析與純文字副本（Issue #1082）：粗體／底線／克漏字空格／換行、
 * 落單標記照原文、layoutToPlainText 與後端規則一致。
 */

import { describe, it, expect } from "vitest";

import {
  inlineBlankIndexes,
  layoutBlankIndexes,
  layoutToPlainText,
  parseInline,
  stripInlineMarkup,
} from "../layoutInline";
import type { LayoutDoc } from "@/types/questionBank";

describe("parseInline", () => {
  it("plain text is a single text node", () => {
    expect(parseInline("hello")).toEqual([{ type: "text", text: "hello" }]);
  });

  it("bold, underline and blanks", () => {
    expect(parseInline("an **exhilarating** __experience__ {{40}}.")).toEqual([
      { type: "text", text: "an " },
      { type: "bold", children: [{ type: "text", text: "exhilarating" }] },
      { type: "text", text: " " },
      { type: "underline", children: [{ type: "text", text: "experience" }] },
      { type: "text", text: " " },
      { type: "blank", n: 40 },
      { type: "text", text: "." },
    ]);
  });

  it("nested underline inside bold", () => {
    expect(parseInline("**Mumbai __Life__**")).toEqual([
      {
        type: "bold",
        children: [
          { type: "text", text: "Mumbai " },
          { type: "underline", children: [{ type: "text", text: "Life" }] },
        ],
      },
    ]);
  });

  it("unmatched markers are kept as text", () => {
    expect(parseInline("2 ** 3 and __x")).toEqual([
      { type: "text", text: "2 ** 3 and __x" },
    ]);
  });

  it("newline becomes br", () => {
    expect(parseInline("**Mumbai Life**\nby Priya Rao")).toEqual([
      { type: "bold", children: [{ type: "text", text: "Mumbai Life" }] },
      { type: "br" },
      { type: "text", text: "by Priya Rao" },
    ]);
  });

  it("malformed blank is text", () => {
    expect(parseInline("{{x}} {{1")).toEqual([
      { type: "text", text: "{{x}} {{1" },
    ]);
  });

  // ---- 降級行為鎖定（review #1082）：落單／交錯／跨行的標記都照原文輸出，不丟字 ----

  it("single unmatched opening marker stays literal", () => {
    expect(parseInline("**a")).toEqual([{ type: "text", text: "**a" }]);
    expect(parseInline("a__")).toEqual([{ type: "text", text: "a__" }]);
  });

  it("interleaved markers: outer pair wins, inner unmatched stays literal", () => {
    // `**a __b** c__`：** 配對到第二個 **；裡面的 __ 在範圍內找不到關閉 → 照原文；
    // 外面剩下的 c__ 也照原文。原文字元一個不少。
    const nodes = parseInline("**a __b** c__");
    expect(nodes).toEqual([
      { type: "bold", children: [{ type: "text", text: "a __b" }] },
      { type: "text", text: " c__" },
    ]);
  });

  it("marker pair spanning a newline still parses and keeps the br", () => {
    expect(parseInline("**a\nb**")).toEqual([
      {
        type: "bold",
        children: [
          { type: "text", text: "a" },
          { type: "br" },
          { type: "text", text: "b" },
        ],
      },
    ]);
  });

  it("non-numeric and empty blanks are literal text", () => {
    expect(parseInline("{{abc}}")).toEqual([{ type: "text", text: "{{abc}}" }]);
    expect(parseInline("{{}}")).toEqual([{ type: "text", text: "{{}}" }]);
    expect(parseInline("{{ 1 }}")).toEqual([{ type: "text", text: "{{ 1 }}" }]);
  });

  it("same marker never nests: inner ** closes the outer", () => {
    expect(parseInline("**a **b** c**")).toEqual([
      { type: "bold", children: [{ type: "text", text: "a " }] },
      { type: "text", text: "b" },
      { type: "bold", children: [{ type: "text", text: " c" }] },
    ]);
  });

  it("every input round-trips its characters (no text lost)", () => {
    const flat = (ns: ReturnType<typeof parseInline>): string =>
      ns
        .map((n) => {
          if (n.type === "text") return n.text;
          if (n.type === "br") return "\n";
          if (n.type === "blank") return `{{${n.n}}}`;
          const m =
            n.type === "bold" ? "**" : n.type === "underline" ? "__" : "==";
          return `${m}${flat(n.children)}${m}`;
        })
        .join("");
    for (const s of [
      "**a",
      "a__",
      "**a __b** c__",
      "**a\nb**",
      "{{abc}} {{}} {{40}}",
      "**a **b** c**",
      "__x__ ** __y",
      "==a== b==",
      "**x ==y** z==",
      "====",
      "****",
      "__",
      "======",
      "===foo===",
    ]) {
      expect(flat(parseInline(s))).toBe(s);
    }
  });

  it("empty-content markers (====, ****, __) are literal text, not empty nodes", () => {
    expect(parseInline("====")).toEqual([{ type: "text", text: "====" }]);
    expect(parseInline("****")).toEqual([{ type: "text", text: "****" }]);
    expect(parseInline("__")).toEqual([{ type: "text", text: "__" }]);
    expect(parseInline("======")).toEqual([{ type: "text", text: "======" }]);
    // 前兩個 = 開啟、後面第一個成對且有內容的 == 關閉，多出的一個 = 照字面
    expect(parseInline("===foo===")).toEqual([
      { type: "doubleUnderline", children: [{ type: "text", text: "=foo" }] },
      { type: "text", text: "=" },
    ]);
    expect(parseInline("a ==== b")).toEqual([
      { type: "text", text: "a ==== b" },
    ]);
  });

  it("== is a double underline; can nest with bold/underline; unmatched stays text", () => {
    expect(parseInline("see ==this== and **==both==**")).toEqual([
      { type: "text", text: "see " },
      { type: "doubleUnderline", children: [{ type: "text", text: "this" }] },
      { type: "text", text: " and " },
      {
        type: "bold",
        children: [
          {
            type: "doubleUnderline",
            children: [{ type: "text", text: "both" }],
          },
        ],
      },
    ]);
    expect(parseInline("a == b")).toEqual([{ type: "text", text: "a == b" }]);
    expect(parseInline("==a ==b== c==")).toEqual([
      { type: "doubleUnderline", children: [{ type: "text", text: "a " }] },
      { type: "text", text: "b" },
      { type: "doubleUnderline", children: [{ type: "text", text: " c" }] },
    ]);
  });
});

describe("stripInlineMarkup / blank indexes", () => {
  it("strips markers and replaces blanks", () => {
    expect(stripInlineMarkup("a **b** __c__ {{2}}")).toBe("a b c ____");
    expect(stripInlineMarkup("==d== e")).toBe("d e");
    expect(inlineBlankIndexes("{{40}} x {{41}} {{40}}")).toEqual([40, 41]);
  });

  it("keeps empty-content or unmatched markers as literal text", () => {
    expect(stripInlineMarkup("====")).toBe("====");
    expect(stripInlineMarkup("****")).toBe("****");
    expect(stripInlineMarkup("__")).toBe("__");
    expect(stripInlineMarkup("======")).toBe("======");
    expect(stripInlineMarkup("===foo===")).toBe("=foo=");
    expect(stripInlineMarkup("**a")).toBe("**a");
    expect(stripInlineMarkup("line1\nline2")).toBe("line1\nline2");
  });
});

const doc: LayoutDoc = {
  version: 1,
  rows: [
    {
      type: "section",
      frame: true,
      rows: [
        {
          columns: [
            {
              span: 2,
              blocks: [{ type: "heading", level: 2, text: "Vivaldi" }],
            },
            {
              span: 1,
              blocks: [{ type: "image", url: "x.png", alt: "x" }],
            },
          ],
        },
      ],
    },
    {
      columns: [
        {
          span: 1,
          blocks: [
            { type: "paragraph", text: "He wrote **500** pieces. {{40}}" },
            {
              type: "dialogue",
              lines: [
                { speaker: "Roger", text: "Excuse me." },
                { speaker: "Jim", text: "Yes, {{41}}." },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("layoutToPlainText / layoutBlankIndexes", () => {
  it("joins texts in reading order, strips markup, ignores images", () => {
    expect(layoutToPlainText(doc)).toBe(
      "Vivaldi\n\nHe wrote 500 pieces. ____\n\nRoger: Excuse me.\n\nJim: Yes, ____.",
    );
    expect(layoutToPlainText(null)).toBe("");
  });

  it("collects blank indexes in order", () => {
    expect(layoutBlankIndexes(doc)).toEqual([40, 41]);
  });
});
