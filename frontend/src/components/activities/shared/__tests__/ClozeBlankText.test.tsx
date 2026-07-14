/**
 * ClozeBlankText — #880：挖空數量必須等於答案字母數
 *
 * 舊行為（#867）把任意長度的底線串壓成「一個固定寬度的方塊」，
 * 所以後端就算按答案長度吐底線，學生也看不出差別。這裡鎖住新行為：
 * 一個底線 = 一個方格，多字答案分組。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ClozeBlankText from "../ClozeBlankText";

describe("ClozeBlankText", () => {
  it("一個底線渲染一個方格", () => {
    render(<ClozeBlankText text="I drink from a ___." />);
    expect(screen.getAllByTestId("cloze-blank-slot")).toHaveLength(3);
    expect(screen.getAllByTestId("cloze-blank-group")).toHaveLength(1);
  });

  it("方格數跟著答案長度走", () => {
    render(<ClozeBlankText text="I eat an _____ every day." />);
    expect(screen.getAllByTestId("cloze-blank-slot")).toHaveLength(5);
  });

  it("多字答案分成多組，每組字母數各自對應", () => {
    // "two pieces of cake" → 3 / 6 / 2 / 4
    render(<ClozeBlankText text="I ate ___ ______ __ ____." />);
    const groups = screen.getAllByTestId("cloze-blank-group");
    expect(groups).toHaveLength(4);
    expect(groups.map((g) => g.childElementCount)).toEqual([3, 6, 2, 4]);
    expect(screen.getAllByTestId("cloze-blank-slot")).toHaveLength(15);
  });

  it("保留挖空以外的原文字", () => {
    const { container } = render(<ClozeBlankText text="I ate ____ today." />);
    expect(container.textContent).toBe("I ate  today.");
  });

  it("空字串不渲染任何東西", () => {
    const { container } = render(<ClozeBlankText text="" />);
    expect(container).toBeEmptyDOMElement();
  });
});
