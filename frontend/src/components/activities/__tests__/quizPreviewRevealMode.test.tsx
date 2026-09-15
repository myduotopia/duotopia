/**
 * #1045 階段 4：老師預覽小考「考前說明／考後檢討」
 *
 * 三種小考 Activity（previewWords 路徑，不打 API）× revealAnswersOnSubmit：
 *   - true（考後檢討，P2）：提交後 QuizReviewView（分數摘要＋正解）＋「重新示範」，
 *     且不顯示「提交後不可重做」（P6）
 *   - false（考前說明，P3）：提交後無分數摘要、無正解、無 ✓/✗，只有「示範結束」＋「重新示範」
 *   - undefined（派發 dialog 即時預覽，P7）：維持原本 QuizReviewView，含「提交後不可重做」、無「重新示範」
 * P4：「重新示範」→ 父層遞增 key 重掛載 → 回到作答畫面、作答清空。
 */
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import WordSelectionQuizActivity from "../WordSelectionQuizActivity";
import WordSpellingQuizActivity from "../WordSpellingQuizActivity";
import WordClozeQuizActivity from "../WordClozeQuizActivity";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));
vi.mock("@/lib/api", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
vi.mock("../shared/useShrinkToFit", () => ({
  useShrinkToFit: () => ({ fontSize: 20, ready: true }),
}));

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  Element.prototype.scrollIntoView = vi.fn();
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  window.HTMLMediaElement.prototype.pause = vi.fn();
});

const selectionWords = [
  {
    content_item_id: 1,
    text: "apple",
    translation: "蘋果",
    correct_text: "apple",
    question_number: 1,
    options: [
      { text: "apple" },
      { text: "pear" },
      { text: "grape" },
      { text: "lemon" },
    ],
  },
  {
    content_item_id: 2,
    text: "pear",
    translation: "梨子",
    correct_text: "pear",
    question_number: 2,
    options: [
      { text: "apple" },
      { text: "pear" },
      { text: "grape" },
      { text: "lemon" },
    ],
  },
];

const spellingWords = [
  {
    content_item_id: 1,
    text: "apple",
    translation: "蘋果",
    question_number: 1,
  },
  { content_item_id: 2, text: "pear", translation: "梨子", question_number: 2 },
];

const clozeWords = [
  {
    content_item_id: 1,
    text: "apple",
    translation: "蘋果",
    example_sentence: "I eat an apple.",
    example_sentence_translation: "我吃蘋果。",
    cloze_answer: "apple",
    question_number: 1,
  },
  {
    content_item_id: 2,
    text: "pear",
    translation: "梨子",
    example_sentence: "A pear is sweet.",
    example_sentence_translation: "梨子很甜。",
    cloze_answer: "pear",
    question_number: 2,
  },
];

type Variant = {
  name: string;
  render: (props: {
    revealAnswersOnSubmit?: boolean;
    onRestartDemo?: () => void;
  }) => JSX.Element;
};

const variants: Variant[] = [
  {
    name: "word_selection_quiz",
    render: (p) => (
      <WordSelectionQuizActivity
        assignmentId={0}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        previewWords={selectionWords as any}
        previewSettings={{ show_word: true, show_image: false }}
        {...p}
      />
    ),
  },
  {
    name: "word_spelling_quiz",
    render: (p) => (
      <WordSpellingQuizActivity
        assignmentId={0}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        previewWords={spellingWords as any}
        previewSettings={{ show_translation: true, show_image: false }}
        {...p}
      />
    ),
  },
  {
    name: "word_cloze_quiz",
    render: (p) => (
      <WordClozeQuizActivity
        assignmentId={0}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        previewWords={clozeWords as any}
        previewSettings={{ show_translation: true }}
        {...p}
      />
    ),
  },
];

const clickSubmit = () => {
  const submitButtons = screen
    .getAllByText("wordQuiz.submit")
    .map((el) => el.closest("button"))
    .filter((b): b is HTMLButtonElement => !!b && !b.disabled);
  expect(submitButtons.length).toBeGreaterThan(0);
  fireEvent.click(submitButtons[submitButtons.length - 1]);
};

describe.each(variants)("$name preview reveal modes (#1045 stage 4)", (v) => {
  it("P2 review (true): score summary + correct answers + restart, no locked note", async () => {
    const onRestart = vi.fn();
    render(v.render({ revealAnswersOnSubmit: true, onRestartDemo: onRestart }));
    clickSubmit();
    expect(
      await screen.findByText("wordQuiz.review.scoreSummary"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("wordQuiz.review.correctAnswer").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("wordQuiz.locked.desc")).toBeNull();
    expect(screen.queryByTestId("preview-demo-done")).toBeNull();
    fireEvent.click(screen.getByTestId("preview-restart-demo"));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("P3 explain (false): no score, no ✓/✗, no correct answers — only demo done + restart", async () => {
    const onRestart = vi.fn();
    render(
      v.render({ revealAnswersOnSubmit: false, onRestartDemo: onRestart }),
    );
    clickSubmit();
    expect(await screen.findByTestId("preview-demo-done")).toBeInTheDocument();
    expect(
      screen.getByText("previewPage.quizMode.demoDone"),
    ).toBeInTheDocument();
    expect(screen.queryByText("wordQuiz.review.scoreSummary")).toBeNull();
    expect(screen.queryByText("wordQuiz.review.correctAnswer")).toBeNull();
    expect(screen.queryByText("wordQuiz.review.correct")).toBeNull();
    expect(screen.queryByText("wordQuiz.review.wrong")).toBeNull();
    fireEvent.click(screen.getByTestId("preview-restart-demo"));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("P7 undefined (dispatch-dialog live preview): unchanged review with locked note, no restart", async () => {
    render(v.render({}));
    clickSubmit();
    expect(
      await screen.findByText("wordQuiz.review.scoreSummary"),
    ).toBeInTheDocument();
    expect(screen.getByText("wordQuiz.locked.desc")).toBeInTheDocument();
    expect(screen.queryByTestId("preview-restart-demo")).toBeNull();
    expect(screen.queryByTestId("preview-demo-done")).toBeNull();
  });

  it("P4 restart remounts: back to answering screen", async () => {
    function Harness() {
      const [key, setKey] = useState(0);
      return (
        <div key={key}>
          {v.render({
            revealAnswersOnSubmit: false,
            onRestartDemo: () => setKey((k) => k + 1),
          })}
        </div>
      );
    }
    render(<Harness />);
    clickSubmit();
    expect(await screen.findByTestId("preview-demo-done")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("preview-restart-demo"));
    expect(screen.queryByTestId("preview-demo-done")).toBeNull();
    expect(screen.getAllByText("wordQuiz.submit").length).toBeGreaterThan(0);
  });
});

describe("P4 restart clears typed answers (spelling)", () => {
  it("typed answer is empty after restart", async () => {
    function Harness() {
      const [key, setKey] = useState(0);
      return (
        <WordSpellingQuizActivity
          key={key}
          assignmentId={0}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          previewWords={spellingWords as any}
          previewSettings={{ show_translation: true, show_image: false }}
          revealAnswersOnSubmit={false}
          onRestartDemo={() => setKey((k) => k + 1)}
        />
      );
    }
    render(<Harness />);
    const input = screen.getAllByRole("textbox")[0] as HTMLInputElement;
    fireEvent.change(input, { target: { value: "appl" } });
    expect(input.value).toBe("appl");
    clickSubmit();
    expect(await screen.findByTestId("preview-demo-done")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("preview-restart-demo"));
    const fresh = screen.getAllByRole("textbox")[0] as HTMLInputElement;
    expect(fresh.value).toBe("");
  });
});
