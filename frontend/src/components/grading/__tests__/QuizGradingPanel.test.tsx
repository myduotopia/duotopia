import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QuizGradingPanel } from "../QuizGradingPanel";
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

const settings = (showExampleSentence: boolean, showImage = true) => ({
  show_example_sentence: showExampleSentence,
  show_image: showImage,
  show_option_images: false,
  show_translation: true,
  show_word: true,
});

const questionItem = (overrides: Partial<SubmissionItem> = {}) =>
  ({
    content_item_id: 11,
    question_number: 1,
    question_text: "apple",
    question_translation: "蘋果",
    student_answer: "pear",
    correct_answer: "apple",
    is_correct: false,
    image_url: "https://img.test/apple.png",
    blanked_sentence: "I eat an _ every day.",
    options: [
      { text: "pear" },
      { text: "apple" },
      { text: "grape" },
      { text: "lemon" },
    ],
    ...overrides,
  }) as SubmissionItem;

describe("QuizGradingPanel — summary", () => {
  it("renders score, per-question points and correct count", () => {
    const submission = makeSubmission({
      score: 85,
      total: 3,
      correct_count: 2,
      submissions: [
        { question_text: "Q1", is_correct: true } as never,
        { question_text: "Q2", is_correct: true } as never,
        { question_text: "Q3", is_correct: false } as never,
      ],
    });
    render(<QuizGradingPanel submission={submission} activeTab="content" />);
    expect(screen.getByText("85")).toBeInTheDocument();
    // 100 / 3 = 33.33… → displayed rounded to 1dp
    expect(screen.getByText("33.3")).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
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
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("shows em-dash when score and current_score are absent, else falls back to current_score", () => {
    const { unmount } = render(
      <QuizGradingPanel
        submission={makeSubmission({ score: null, submissions: [] })}
        activeTab="content"
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    unmount();
    render(
      <QuizGradingPanel
        submission={makeSubmission({ current_score: 70, submissions: [] })}
        activeTab="content"
      />,
    );
    expect(screen.getByText("70")).toBeInTheDocument();
  });

  it("renders student/correct answers; correct answer only for wrong items", () => {
    const submission = makeSubmission({
      practice_mode: "word_spelling_quiz",
      quiz_settings: settings(false),
      submissions: [
        questionItem({
          content_item_id: 1,
          question_text: "What is an apple?",
          student_answer: "fruit",
          correct_answer: "a fruit",
          is_correct: true,
          question_translation: "",
        }),
        questionItem({
          content_item_id: 2,
          question_text: "Capital of France?",
          student_answer: "London",
          correct_answer: "Paris",
          is_correct: false,
          question_translation: "",
        }),
      ],
    });
    render(<QuizGradingPanel submission={submission} activeTab="content" />);
    expect(screen.getByText("What is an apple?")).toBeInTheDocument();
    expect(screen.getByText(/Paris/)).toBeInTheDocument();
    expect(screen.getByText(/London/)).toBeInTheDocument();
  });

  it("renders the no-answers empty state when submissions is empty", () => {
    render(
      <QuizGradingPanel
        submission={makeSubmission({ submissions: [] })}
        activeTab="content"
      />,
    );
    expect(screen.getByText("gradingPage.quiz.noAnswers")).toBeInTheDocument();
    expect(screen.getByText("0 / 0")).toBeInTheDocument();
  });

  it("hides the panel column on non-content tabs at small width but stays in DOM", () => {
    const { container } = render(
      <QuizGradingPanel
        submission={makeSubmission({
          submissions: [{ question_text: "Q1", is_correct: true } as never],
        })}
        activeTab="grading"
      />,
    );
    const col = container.firstElementChild as HTMLElement;
    expect(col.className).toContain("hidden");
    expect(col.className).toContain("lg:block");
  });
});

// #1045 V9：三模式 × show_example_sentence 開/關
describe("QuizGradingPanel — question area (#1045 V9)", () => {
  const renderMode = (
    mode: "word_selection_quiz" | "word_spelling_quiz" | "word_cloze_quiz",
    showExample: boolean,
    item: SubmissionItem = questionItem(),
    showImage = true,
  ) => {
    const submission = makeSubmission({
      practice_mode: mode,
      quiz_settings: settings(showExample, showImage),
      total: 1,
      correct_count: 0,
      submissions: [
        mode === "word_selection_quiz" ? item : { ...item, options: null },
      ],
    });
    return render(
      <QuizGradingPanel submission={submission} activeTab="content" />,
    );
  };

  it.each([true, false])(
    "selection quiz (example=%s): options with A-D labels, correct green, wrong pick red",
    (showExample) => {
      renderMode("word_selection_quiz", showExample);
      const chips = screen.getAllByTestId("quiz-option-chip");
      expect(chips).toHaveLength(4);
      expect(chips.map((c) => c.textContent?.charAt(0))).toEqual([
        "A",
        "B",
        "C",
        "D",
      ]);
      expect(chips[0]).toHaveTextContent("pear ✗");
      expect(chips[0].className).toContain("rose");
      expect(chips[1]).toHaveTextContent("apple ✓");
      expect(chips[1].className).toContain("emerald");
      expect(chips[2].className).toContain("gray");

      const area = screen.getByTestId("quiz-question-area");
      if (showExample) {
        expect(within(area).getByTestId("quiz-question-cloze")).toBeTruthy();
        expect(within(area).getAllByTestId("cloze-blank-slot")).toHaveLength(1);
        expect(within(area).queryByTestId("quiz-question-word")).toBeNull();
      } else {
        expect(within(area).queryByTestId("quiz-question-cloze")).toBeNull();
        expect(
          within(area).getByTestId("quiz-question-word"),
        ).toHaveTextContent("apple");
      }
    },
  );

  it.each([true, false])(
    "spelling quiz (example=%s): cloze when on, translation prompt when off, no options",
    (showExample) => {
      renderMode("word_spelling_quiz", showExample);
      expect(screen.queryAllByTestId("quiz-option-chip")).toHaveLength(0);
      const area = screen.getByTestId("quiz-question-area");
      if (showExample) {
        expect(within(area).getAllByTestId("cloze-blank-slot")).toHaveLength(1);
        expect(within(area).queryByTestId("quiz-question-word")).toBeNull();
      } else {
        expect(within(area).queryByTestId("cloze-blank-slot")).toBeNull();
        expect(
          within(area).getByTestId("quiz-question-word"),
        ).toHaveTextContent("蘋果");
      }
    },
  );

  it.each([true, false])(
    "cloze quiz (example=%s): always shows the blanked sentence, no options",
    (showExample) => {
      renderMode("word_cloze_quiz", showExample);
      expect(screen.queryAllByTestId("quiz-option-chip")).toHaveLength(0);
      const area = screen.getByTestId("quiz-question-area");
      expect(within(area).getAllByTestId("cloze-blank-slot")).toHaveLength(1);
    },
  );

  it("falls back to the word when there is no blanked sentence", () => {
    renderMode("word_cloze_quiz", true, questionItem({ blanked_sentence: "" }));
    expect(screen.queryByTestId("cloze-blank-slot")).toBeNull();
    expect(screen.getByTestId("quiz-question-word")).toHaveTextContent("apple");
  });

  it("shows the question image only when show_image is on", () => {
    const { unmount } = renderMode("word_selection_quiz", false);
    expect(screen.getByTestId("quiz-question-image")).toHaveAttribute(
      "src",
      "https://img.test/apple.png",
    );
    unmount();
    renderMode("word_selection_quiz", false, questionItem(), false);
    expect(screen.queryByTestId("quiz-question-image")).toBeNull();
  });
});
