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
});

describe("stripInlineMarkup / blank indexes", () => {
  it("strips markers and replaces blanks", () => {
    expect(stripInlineMarkup("a **b** __c__ {{2}}")).toBe("a b c ____");
    expect(inlineBlankIndexes("{{40}} x {{41}} {{40}}")).toEqual([40, 41]);
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
