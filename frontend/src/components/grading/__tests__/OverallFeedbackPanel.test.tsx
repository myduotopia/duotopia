/**
 * #1045 V7：OverallFeedbackPanel 分數 input 小數點
 * - 逐字打 "85.5" 保留小數點
 * - 拒絕 "85.55"、"101"
 * - 清空 → onScoreChange(null)
 * - blur "85." → 顯示 "85"
 * - 外部 score 變動才同步 draft
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { OverallFeedbackPanel } from "../OverallFeedbackPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

type Props = React.ComponentProps<typeof OverallFeedbackPanel>;

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    submission: null,
    score: null,
    feedback: "",
    itemFeedbacks: {},
    isAutoCalculatedScore: false,
    submitting: false,
    activeTab: "grading",
    totalQuestions: 0,
    onScoreChange: () => {},
    onFeedbackChange: () => {},
    onAutoSave: async () => {},
    onComplete: () => {},
    onJumpToItem: () => {},
    ...overrides,
  } as Props;
}

/** 父層把 onScoreChange 的值回灌成 score，模擬 GradingPage 真實行為 */
function Harness({
  onScore,
  initial = null,
}: {
  onScore: (v: number | null) => void;
  initial?: number | null;
}) {
  const [score, setScore] = useState<number | null>(initial);
  return (
    <>
      <OverallFeedbackPanel
        {...baseProps({
          score,
          onScoreChange: (v) => {
            onScore(v);
            setScore(v);
          },
        })}
      />
      <button type="button" onClick={() => setScore(42)}>
        external
      </button>
    </>
  );
}

const input = () =>
  screen.getByLabelText("gradingPage.labels.giveScore") as HTMLInputElement;

const type = (value: string) =>
  fireEvent.change(input(), { target: { value } });

describe("OverallFeedbackPanel score input (#1045 V7)", () => {
  it("keeps the decimal point while typing 85.5 char by char", () => {
    const onScore = vi.fn();
    render(<Harness onScore={onScore} />);
    for (const step of ["8", "85", "85.", "85.5"]) {
      type(step);
      expect(input().value).toBe(step);
    }
    expect(onScore).toHaveBeenLastCalledWith(85.5);
  });

  it("rejects 85.55 (two decimals) and 101 (out of range)", () => {
    const onScore = vi.fn();
    render(<Harness onScore={onScore} />);
    type("85.5");
    onScore.mockClear();
    type("85.55");
    expect(input().value).toBe("85.5");
    type("101");
    expect(input().value).toBe("85.5");
    expect(onScore).not.toHaveBeenCalled();
  });

  it("clearing the input reports null", () => {
    const onScore = vi.fn();
    render(<Harness onScore={onScore} initial={70} />);
    expect(input().value).toBe("70");
    type("");
    expect(input().value).toBe("");
    expect(onScore).toHaveBeenLastCalledWith(null);
  });

  it("normalises a trailing dot on blur (85. → 85)", () => {
    const onScore = vi.fn();
    render(<Harness onScore={onScore} />);
    type("85.");
    expect(input().value).toBe("85.");
    fireEvent.blur(input());
    expect(input().value).toBe("85");
    expect(onScore).toHaveBeenLastCalledWith(85);
  });

  it("syncs the draft only when score changes externally", () => {
    const onScore = vi.fn();
    render(<Harness onScore={onScore} />);
    type("85.");
    // 自己輸入造成的 score=85 不得把 "85." 覆寫成 "85"
    expect(input().value).toBe("85.");
    fireEvent.click(screen.getByText("external"));
    expect(input().value).toBe("42");
  });
});

// #1158：returnDisabledReason → 「要求訂正」停用並說明原因；沒傳時行為不變
describe("OverallFeedbackPanel return button (#1158)", () => {
  const submission = {
    student_id: 1,
    student_name: "Amy",
    status: "SUBMITTED",
  } as unknown as Props["submission"];

  it("停用並在按鈕與外層 title 寫原因，點了不呼叫 onRequestRevision", () => {
    const onRequestRevision = vi.fn();
    render(
      <OverallFeedbackPanel
        {...baseProps({
          submission,
          onRequestRevision,
          returnDisabledReason: "情境對話作業目前不能退回訂正",
        })}
      />,
    );
    const btn = screen
      .getAllByTitle("情境對話作業目前不能退回訂正")
      .find((el) => el.tagName === "BUTTON")!;
    expect(btn).toBeDisabled();
    expect(btn.parentElement).toHaveAttribute(
      "title",
      "情境對話作業目前不能退回訂正",
    );
    fireEvent.click(btn);
    expect(onRequestRevision).not.toHaveBeenCalled();
  });

  it("沒有原因時照舊可按（迴歸）", () => {
    const onRequestRevision = vi.fn();
    render(
      <OverallFeedbackPanel
        {...baseProps({ submission, onRequestRevision })}
      />,
    );
    const btn = screen
      .getAllByTitle("gradingHub.returnShort")
      .find((el) => el.tagName === "BUTTON")!;
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onRequestRevision).toHaveBeenCalledTimes(1);
  });
});
