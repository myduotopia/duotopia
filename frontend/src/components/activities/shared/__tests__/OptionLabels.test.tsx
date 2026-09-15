/**
 * #1045：選擇題選項 A/B/C/D 左上角標
 * - WordSelectionOptionButton 傳 label 時渲染角標，不傳則無
 * - QuizOptionChip（檢討頁／批改頁共用）渲染角標與正解/學生選項標記
 * - optionLabelAt 與 OPTION_LABELS 順序一致
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import WordSelectionOptionButton from "../WordSelectionOptionButton";
import QuizOptionChip from "../QuizOptionChip";
import { OPTION_LABELS, optionLabelAt } from "../optionLabels";

vi.mock("../useShrinkToFit", () => ({
  useShrinkToFit: () => ({ fontSize: 20, ready: true }),
}));

describe("option labels (#1045)", () => {
  it("optionLabelAt maps index to A-D and undefined beyond", () => {
    expect(OPTION_LABELS).toEqual(["A", "B", "C", "D"]);
    expect([0, 1, 2, 3].map(optionLabelAt)).toEqual(["A", "B", "C", "D"]);
    expect(optionLabelAt(4)).toBeUndefined();
  });

  it("WordSelectionOptionButton renders the corner label when given", () => {
    render(
      <WordSelectionOptionButton
        text="apple"
        showAsImage={false}
        colorIndex={1}
        isSelected={false}
        onClick={() => {}}
        label="B"
      />,
    );
    expect(screen.getByTestId("option-label")).toHaveTextContent("B");
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-label",
      "B. apple",
    );
  });

  it("WordSelectionOptionButton renders no label when omitted", () => {
    render(
      <WordSelectionOptionButton
        text="apple"
        showAsImage={false}
        colorIndex={0}
        isSelected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.queryByTestId("option-label")).toBeNull();
  });

  it("QuizOptionChip shows label, correct tick and wrong-pick cross", () => {
    render(
      <>
        <QuizOptionChip
          text="apple"
          label="A"
          isCorrect
          isStudentPick={false}
        />
        <QuizOptionChip text="pear" label="C" isCorrect={false} isStudentPick />
      </>,
    );
    const chips = screen.getAllByTestId("quiz-option-chip");
    expect(chips[0]).toHaveTextContent("A");
    expect(chips[0]).toHaveTextContent("apple ✓");
    expect(chips[1]).toHaveTextContent("C");
    expect(chips[1]).toHaveTextContent("pear ✗");
  });
});
