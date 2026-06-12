import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuizGradingPanel } from "../QuizGradingPanel";
import type { StudentSubmission } from "@/pages/teacher/GradingPage";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

// Minimal StudentSubmission factory; only the fields QuizGradingPanel reads
// matter, the rest are filled to satisfy the type.
const makeSubmission = (
  overrides: Partial<StudentSubmission>,
): StudentSubmission =>
  ({
    student_number: 1,
    student_name: "Test Student",
    student_email: "s@example.com",
    status: "SUBMITTED",
    content_type: "quiz",
    submissions: [],
    ...overrides,
  }) as StudentSubmission;

describe("QuizGradingPanel", () => {
  it("shows accuracy 0 when backend sends accuracy:0 (does NOT recompute)", () => {
    // 2 of 4 correct would naively be 50%, but backend explicitly says 0.
    const submission = makeSubmission({
      accuracy: 0,
      total: 4,
      correct_count: 2,
      submissions: [
        { question_text: "Q1", is_correct: true } as never,
        { question_text: "Q2", is_correct: true } as never,
        { question_text: "Q3", is_correct: false } as never,
        { question_text: "Q4", is_correct: false } as never,
      ],
    });
    render(<QuizGradingPanel submission={submission} activeTab="content" />);
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.queryByText("50%")).not.toBeInTheDocument();
  });

  it("falls back to correct/total when accuracy is absent", () => {
    const submission = makeSubmission({
      // accuracy omitted on purpose
      total: 4,
      correct_count: 2,
      submissions: [
        { question_text: "Q1", is_correct: true } as never,
        { question_text: "Q2", is_correct: true } as never,
        { question_text: "Q3", is_correct: false } as never,
        { question_text: "Q4", is_correct: false } as never,
      ],
    });
    render(<QuizGradingPanel submission={submission} activeTab="content" />);
    // 2/4 → 50.0% → rounded display "50%"
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("derives counts from submissions when correct_count/total are absent", () => {
    const submission = makeSubmission({
      submissions: [
        { question_text: "Q1", is_correct: true } as never,
        { question_text: "Q2", is_correct: false } as never,
        { question_text: "Q3", is_correct: true } as never,
      ],
    });
    render(<QuizGradingPanel submission={submission} activeTab="content" />);
    // correctCount=2, total=3 → "2 / 3"
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    // accuracy = round(2/3*1000)/10 = 66.7
    expect(screen.getByText("66.7%")).toBeInTheDocument();
  });

  it("renders the score when provided", () => {
    const submission = makeSubmission({
      score: 85,
      accuracy: 100,
      total: 2,
      correct_count: 2,
      submissions: [
        { question_text: "Q1", is_correct: true } as never,
        { question_text: "Q2", is_correct: true } as never,
      ],
    });
    render(<QuizGradingPanel submission={submission} activeTab="content" />);
    expect(screen.getByText("85")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("shows em-dash for score when score and current_score are null/absent", () => {
    const submission = makeSubmission({
      score: null,
      accuracy: 50,
      total: 2,
      correct_count: 1,
      submissions: [
        { question_text: "Q1", is_correct: true } as never,
        { question_text: "Q2", is_correct: false } as never,
      ],
    });
    render(<QuizGradingPanel submission={submission} activeTab="content" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("falls back to current_score when score is absent", () => {
    const submission = makeSubmission({
      current_score: 70,
      accuracy: 100,
      total: 1,
      correct_count: 1,
      submissions: [{ question_text: "Q1", is_correct: true } as never],
    });
    render(<QuizGradingPanel submission={submission} activeTab="content" />);
    expect(screen.getByText("70")).toBeInTheDocument();
  });

  it("renders per-question rows with question text and student/correct answers for wrong items", () => {
    const submission = makeSubmission({
      total: 2,
      correct_count: 1,
      accuracy: 50,
      submissions: [
        {
          question_number: 1,
          question_text: "What is an apple?",
          student_answer: "fruit",
          correct_answer: "a fruit",
          is_correct: true,
        } as never,
        {
          question_number: 2,
          question_text: "Capital of France?",
          student_answer: "London",
          correct_answer: "Paris",
          is_correct: false,
        } as never,
      ],
    });
    render(<QuizGradingPanel submission={submission} activeTab="content" />);
    expect(screen.getByText("What is an apple?")).toBeInTheDocument();
    expect(screen.getByText("Capital of France?")).toBeInTheDocument();
    // Wrong item shows the correct answer; correct item does not surface its.
    expect(screen.getByText(/Paris/)).toBeInTheDocument();
    expect(screen.getByText(/London/)).toBeInTheDocument();
  });

  it("renders the no-answers empty state when submissions is empty", () => {
    const submission = makeSubmission({ submissions: [] });
    render(<QuizGradingPanel submission={submission} activeTab="content" />);
    // t mock returns the key; the noAnswers key falls back via `|| ...`
    expect(screen.getByText("gradingPage.quiz.noAnswers")).toBeInTheDocument();
    // total=0 → accuracy guard yields 0
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText("0 / 0")).toBeInTheDocument();
  });

  it("hides the panel column on non-content tabs at small width but stays in DOM", () => {
    const submission = makeSubmission({
      total: 1,
      correct_count: 1,
      accuracy: 100,
      submissions: [{ question_text: "Q1", is_correct: true } as never],
    });
    const { container } = render(
      <QuizGradingPanel submission={submission} activeTab="grading" />,
    );
    const col = container.firstElementChild as HTMLElement;
    expect(col.className).toContain("hidden");
    expect(col.className).toContain("lg:block");
  });
});
