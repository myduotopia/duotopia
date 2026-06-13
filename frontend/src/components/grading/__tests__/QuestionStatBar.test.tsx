import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import QuestionStatBar, { type StudentRef } from "../QuestionStatBar";

// i18n: follow repo convention — t returns the key (or the provided default).
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, defaultOrOpts?: unknown) =>
      typeof defaultOrOpts === "string" ? defaultOrOpts : key,
    i18n: { language: "zh-TW" },
  }),
}));

const mkStudents = (n: number, startNum = 1): StudentRef[] =>
  Array.from({ length: n }, (_, i) => ({
    student_id: i + 1,
    name: `Student${i + 1}`,
    number: startNum + i,
  }));

describe("QuestionStatBar", () => {
  it("renders empty state without crashing when total is 0", () => {
    render(
      <QuestionStatBar correct={[]} wrong={[]} unanswered={[]} total={0} />,
    );
    expect(screen.getByText("尚無提交資料")).toBeInTheDocument();
    // No segment bars rendered in the empty case.
    expect(screen.queryByLabelText(/答對/)).not.toBeInTheDocument();
  });

  it("renders empty state when total is negative (guard)", () => {
    render(
      <QuestionStatBar correct={[]} wrong={[]} unanswered={[]} total={-3} />,
    );
    expect(screen.getByText("尚無提交資料")).toBeInTheDocument();
  });

  it("computes 50% width for 2 correct of 4 total", () => {
    render(
      <QuestionStatBar
        correct={mkStudents(2)}
        wrong={mkStudents(1, 3)}
        unanswered={mkStudents(1, 4)}
        total={4}
      />,
    );
    const correctSeg = screen.getByLabelText("答對 2/4");
    expect(correctSeg).toHaveStyle({ width: "50%" });
  });

  it("computes correct widths for each segment proportional to total", () => {
    render(
      <QuestionStatBar
        correct={mkStudents(5)}
        wrong={mkStudents(3, 6)}
        unanswered={mkStudents(2, 9)}
        total={10}
      />,
    );
    expect(screen.getByLabelText("答對 5/10")).toHaveStyle({ width: "50%" });
    expect(screen.getByLabelText("答錯 3/10")).toHaveStyle({ width: "30%" });
    expect(screen.getByLabelText("未作答 2/10")).toHaveStyle({ width: "20%" });
  });

  it("renders aria-labels showing counts over total", () => {
    render(
      <QuestionStatBar
        correct={mkStudents(1)}
        wrong={mkStudents(1, 2)}
        unanswered={[]}
        total={2}
      />,
    );
    expect(screen.getByLabelText("答對 1/2")).toBeInTheDocument();
    expect(screen.getByLabelText("答錯 1/2")).toBeInTheDocument();
  });

  it("omits segments whose list is empty (no zero-length bars rendered)", () => {
    render(
      <QuestionStatBar
        correct={mkStudents(4)}
        wrong={[]}
        unanswered={[]}
        total={4}
      />,
    );
    expect(screen.getByLabelText("答對 4/4")).toHaveStyle({ width: "100%" });
    // wrong + unanswered have empty lists → filtered out.
    expect(screen.queryByLabelText(/答錯/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/未作答/)).not.toBeInTheDocument();
  });

  it("shows the submitted-count header label", () => {
    render(
      <QuestionStatBar
        correct={mkStudents(2)}
        wrong={[]}
        unanswered={[]}
        total={2}
      />,
    );
    // Header title (default text) is rendered.
    expect(screen.getByText("班級報告")).toBeInTheDocument();
  });

  it("renders three segments when all categories are present", () => {
    const { container } = render(
      <QuestionStatBar
        correct={mkStudents(1)}
        wrong={mkStudents(1, 2)}
        unanswered={mkStudents(1, 3)}
        total={3}
      />,
    );
    // Each segment is a TooltipTrigger (button) with an aria-label.
    const segments = container.querySelectorAll("[aria-label]");
    expect(segments).toHaveLength(3);
  });
});
