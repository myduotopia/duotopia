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
