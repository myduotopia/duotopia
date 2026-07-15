/**
 * ClozeBlankText — #880：挖空格數等於答案的「單字數量」（不是字母數）
 *
 * 後端 `build_blank()` 對單字答案吐一個底線、片語答案吐以空白分隔的多個底線
 * （"_ _ _ _"）。這裡鎖住渲染契約：每個底線串渲染成一個方格。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ClozeBlankText from "../ClozeBlankText";

describe("ClozeBlankText", () => {
  it("單字答案（一個底線）渲染一個方格", () => {
    render(<ClozeBlankText text="I drink from a _." />);
    expect(screen.getAllByTestId("cloze-blank-slot")).toHaveLength(1);
  });

  it("方格數不隨字母數變化（多字母答案仍是一格）", () => {
    // 後端對 "elephant" 只吐一個底線
    render(<ClozeBlankText text="The _ is huge." />);
    expect(screen.getAllByTestId("cloze-blank-slot")).toHaveLength(1);
  });

  it("片語答案每個單字一格", () => {
    // "two pieces of cake" → "_ _ _ _" → 4 格
    render(<ClozeBlankText text="I ate _ _ _ _." />);
    expect(screen.getAllByTestId("cloze-blank-slot")).toHaveLength(4);
  });

  it("保留挖空以外的原文字", () => {
    const { container } = render(<ClozeBlankText text="I ate _ today." />);
    expect(container.textContent).toBe("I ate  today.");
  });

  it("空字串不渲染任何東西", () => {
    const { container } = render(<ClozeBlankText text="" />);
    expect(container).toBeEmptyDOMElement();
  });
});
