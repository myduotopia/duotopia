/**
 * #1045 V10（前端）：批改頁每題扣分 input
 * - 答對預設 0、答錯預設 100/題數（顯示 round 1）；已存扣分優先
 * - 修改扣分回報 onDeductionChange(content_item_id, value)；最多一位小數、≤100
 * - 父層依回報值以 scoreFromDeductions 重算總分（這裡以 harness 模擬 GradingPage）
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { QuizGradingPanel } from "../QuizGradingPanel";
import { initialDeductions, scoreFromDeductions } from "../quizDeductions";
import type {
  StudentSubmission,
  SubmissionItem,
} from "@/pages/teacher/GradingPage";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

const item = (id: number, isCorrect: boolean, deduction?: number | null) =>
  ({
    content_item_id: id,
    question_number: id,
    question_text: `w${id}`,
    student_answer: isCorrect ? `w${id}` : "x",
    correct_answer: `w${id}`,
    is_correct: isCorrect,
    deduction: deduction ?? null,
  }) as SubmissionItem;

const submissionOf = (items: SubmissionItem[]) =>
  ({
    student_number: 1,
    student_name: "s",
    student_email: "s@example.com",
    status: "SUBMITTED",
    content_type: "QUIZ",
    practice_mode: "word_spelling_quiz",
    total: items.length,
    correct_count: items.filter((i) => i.is_correct).length,
    submissions: items,
  }) as StudentSubmission;

function Harness({
  submission,
  onScore,
}: {
  submission: StudentSubmission;
  onScore: (score: number) => void;
}) {
  const [deductions, setDeductions] = useState(() =>
    initialDeductions(submission.submissions, submission.total ?? 0),
  );
  return (
    <QuizGradingPanel
      submission={submission}
      activeTab="content"
      deductions={deductions}
      onDeductionChange={(id, value) => {
        const next = { ...deductions, [id]: value };
        setDeductions(next);
        onScore(scoreFromDeductions(next));
      }}
    />
  );
}

const inputs = () =>
  screen.getAllByTestId("quiz-deduction-input") as HTMLInputElement[];

describe("QuizGradingPanel deductions (#1045 V10)", () => {
  it("defaults: correct → 0, wrong → 100/total shown rounded to 1dp", () => {
    render(
      <Harness
        submission={submissionOf([
          item(1, true),
          item(2, false),
          item(3, false),
        ])}
        onScore={() => {}}
      />,
    );
    expect(inputs().map((i) => i.value)).toEqual(["0", "33.3", "33.3"]);
  });

  it("saved deduction takes priority over the default", () => {
    render(
      <Harness
        submission={submissionOf([item(1, false, 5), item(2, true, 2.5)])}
        onScore={() => {}}
      />,
    );
    expect(inputs().map((i) => i.value)).toEqual(["5", "2.5"]);
  });

  it("editing a deduction recomputes the total instantly", () => {
    const onScore = vi.fn();
    render(
      <Harness
        submission={submissionOf([
          item(1, true),
          item(2, false),
          item(3, false),
        ])}
        onScore={onScore}
      />,
    );
    // 100 − (0 + 10 + 33.33…) = 56.67 → 56.7
    fireEvent.change(inputs()[1], { target: { value: "10" } });
    expect(onScore).toHaveBeenLastCalledWith(56.7);
    fireEvent.change(inputs()[1], { target: { value: "10.5" } });
    expect(inputs()[1].value).toBe("10.5");
    expect(onScore).toHaveBeenLastCalledWith(56.2);
  });

  it("rejects two decimals and values over 100; blur normalises the display", () => {
    const onScore = vi.fn();
    render(
      <Harness
        submission={submissionOf([item(1, false), item(2, false)])}
        onScore={onScore}
      />,
    );
    fireEvent.change(inputs()[0], { target: { value: "12." } });
    expect(inputs()[0].value).toBe("12.");
    onScore.mockClear();
    fireEvent.change(inputs()[0], { target: { value: "12.55" } });
    fireEvent.change(inputs()[0], { target: { value: "101" } });
    expect(onScore).not.toHaveBeenCalled();
    expect(inputs()[0].value).toBe("12.");
    fireEvent.blur(inputs()[0]);
    expect(inputs()[0].value).toBe("12");
  });

  it("#1092: uses backend default_deduction and shows the reason for partial ones", () => {
    const partial = {
      ...item(2, false),
      default_deduction: 16.7,
      deduction_detail: { word_total: 3, wrong_words: 1, wrong_letters: 1 },
    } as SubmissionItem;
    const full = {
      ...item(3, false),
      default_deduction: 100 / 3,
      deduction_detail: { word_total: 3, wrong_words: 3, wrong_letters: 9 },
    } as SubmissionItem;
    const sub = {
      ...submissionOf([item(1, true), partial, full]),
      quiz_settings: {
        show_example_sentence: false,
        show_image: true,
        show_option_images: false,
        show_translation: true,
        show_word: true,
        quiz_scoring_method: "per_word",
        quiz_scoring_points: null,
        quiz_case_sensitive: false,
      },
    } as StudentSubmission;
    const onScore = vi.fn();
    render(<Harness submission={sub} onScore={onScore} />);
    expect(inputs().map((i) => i.value)).toEqual(["0", "16.7", "33.3"]);
    // 只有部分扣分題顯示原因
    expect(screen.getAllByTestId("quiz-deduction-reason")).toHaveLength(1);
    // 彙總卡顯示目前評分方式
    expect(screen.getByTestId("quiz-scoring-summary").textContent).toContain(
      "quizScoring.methods.per_word.label",
    );
  });

  it("#1092: legacy submission without default_deduction falls back to 0 / 100÷N", () => {
    render(
      <Harness
        submission={submissionOf([item(1, true), item(2, false)])}
        onScore={() => {}}
      />,
    );
    expect(inputs().map((i) => i.value)).toEqual(["0", "50"]);
    expect(screen.queryByTestId("quiz-deduction-reason")).toBeNull();
    // 舊作業（無設定）顯示整題計分
    expect(screen.getByTestId("quiz-scoring-summary").textContent).toContain(
      "quizScoring.methods.whole_question.label",
    );
  });

  it("hides deduction inputs when no onDeductionChange is given", () => {
    render(
      <QuizGradingPanel
        submission={submissionOf([item(1, false)])}
        activeTab="content"
      />,
    );
    expect(screen.queryByTestId("quiz-deduction-input")).toBeNull();
  });
});
