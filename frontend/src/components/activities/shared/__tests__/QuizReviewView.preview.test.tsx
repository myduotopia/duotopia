/**
 * #1045 階段 4 P6：QuizReviewView
 * - 預設（學生正式作答）顯示「提交後不可重做」文案
 * - isPreview（老師預覽頁）隱藏該文案
 * - footer 渲染在最下方（「重新示範」掛點）
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import QuizReviewView from "../QuizReviewView";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const data = {
  practice_mode: "word_spelling_quiz",
  words: [
    {
      content_item_id: 1,
      question_number: 1,
      is_correct: false,
      student_answer: "aple",
      correct_answer: "apple",
    },
  ],
  total_questions: 1,
  correct_count: 0,
  score: 0,
  status: null,
  submitted_at: null,
};

describe("QuizReviewView (#1045 P6)", () => {
  it("shows the locked note for students by default", () => {
    render(<QuizReviewView data={data} renderQuestion={() => null} />);
    expect(screen.getByText("wordQuiz.locked.desc")).toBeInTheDocument();
  });

  it("hides the locked note in teacher preview and renders the footer", () => {
    render(
      <QuizReviewView
        data={data}
        renderQuestion={() => null}
        isPreview
        footer={<button type="button">restart</button>}
      />,
    );
    expect(screen.queryByText("wordQuiz.locked.desc")).toBeNull();
    expect(screen.getByText("restart")).toBeInTheDocument();
  });
});

describe("QuizReviewView (#1088 樣式)", () => {
  const words = [
    {
      content_item_id: 1,
      question_number: 1,
      is_correct: true,
      student_answer: "apple",
      correct_answer: "apple",
    },
    {
      content_item_id: 2,
      question_number: 2,
      is_correct: false,
      student_answer: "aple",
      correct_answer: "apple",
    },
    {
      content_item_id: 3,
      question_number: 3,
      is_correct: false,
      student_answer: null,
      correct_answer: "apple",
    },
  ];
  const data3 = { ...data, words, total_questions: 3 };

  it("renders a three-state status chip beside the question number", () => {
    render(<QuizReviewView data={data3} renderQuestion={() => null} />);
    const chips = screen.getAllByTestId("quiz-review-status");
    expect(chips.map((c) => c.getAttribute("data-status"))).toEqual([
      "correct",
      "wrong",
      "unanswered",
    ]);
    expect(chips[0].className).toContain("bg-emerald-100");
    expect(chips[0].textContent).toContain("wordQuiz.review.correct");
    expect(chips[1].className).toContain("bg-rose-100");
    expect(chips[1].textContent).toContain("wordQuiz.review.wrong");
    expect(chips[2].className).toContain("bg-amber-100");
    expect(chips[2].textContent).toContain("wordQuiz.review.unanswered");
    // 題號放大
    const label = screen.getAllByText("wordQuiz.questionLabel")[0];
    expect(label.className).toContain("text-lg");
    expect(label.className).toContain("font-bold");
  });

  it("uses white cards regardless of correctness", () => {
    const { container } = render(
      <QuizReviewView data={data3} renderQuestion={() => null} />,
    );
    expect(container.innerHTML).not.toContain("bg-emerald-50/40");
    expect(container.innerHTML).not.toContain("bg-rose-50/40");
  });

  it("shows the answer row by default and hides it with hideAnswerRow", () => {
    const { rerender } = render(
      <QuizReviewView data={data} renderQuestion={() => null} />,
    );
    expect(screen.getByText("wordQuiz.review.yourAnswer")).toBeInTheDocument();
    rerender(
      <QuizReviewView data={data} renderQuestion={() => null} hideAnswerRow />,
    );
    expect(screen.queryByText("wordQuiz.review.yourAnswer")).toBeNull();
    expect(screen.queryByText("wordQuiz.review.correctAnswer")).toBeNull();
  });
});
