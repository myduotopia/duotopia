/**
 * #1045 階段 4b：考後檢討預覽逐題判斷＋正確動畫、作答卡片無內部卷軸
 *
 *   Q1 選擇題（revealAnswersOnSubmit=true）：點對 → ScoreOverlay 開；點錯 → 不開、該題鎖定不可改選
 *   Q2 拼字／克漏字（true）：沿用學生端 QuizAnswerInput 送出箭頭（aria-label "Submit answer"），
 *      未作答 disabled；箭頭或 Enter 判斷；答對 → overlay；答錯 → 顯示正解；畫面上沒有另加的「對答案」鈕
 *   Q3 考前說明（false）：三種小考作答時不播動畫、無對答案鈕、不鎖定
 *   Q5 無模式（undefined，學生作答／派發 dialog 即時預覽同一路徑）：無對答案鈕、不播動畫
 *   Q6 卡片區不含 overflow-y-auto 與 max-h-[..dvh]
 *
 * ScoreOverlay 以 stub 取代（Lottie 動畫在 jsdom 無意義），只驗證 open。
 */
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
vi.mock("../shared/ScoreOverlay", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="score-overlay" /> : null,
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

const options = [
  { text: "apple" },
  { text: "pear" },
  { text: "grape" },
  { text: "lemon" },
];
const selectionWords = [
  {
    content_item_id: 1,
    text: "apple",
    translation: "蘋果",
    correct_text: "apple",
    question_number: 1,
    options,
  },
  {
    content_item_id: 2,
    text: "pear",
    translation: "梨子",
    correct_text: "pear",
    question_number: 2,
    options,
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

const renderSelection = (reveal?: boolean) =>
  render(
    <WordSelectionQuizActivity
      assignmentId={0}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      previewWords={selectionWords as any}
      previewSettings={{ show_word: true, show_image: false }}
      revealAnswersOnSubmit={reveal}
    />,
  );
const renderSpelling = (reveal?: boolean) =>
  render(
    <WordSpellingQuizActivity
      assignmentId={0}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      previewWords={spellingWords as any}
      previewSettings={{ show_translation: true, show_image: false }}
      revealAnswersOnSubmit={reveal}
    />,
  );
const renderCloze = (reveal?: boolean) =>
  render(
    <WordClozeQuizActivity
      assignmentId={0}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      previewWords={clozeWords as any}
      previewSettings={{ show_translation: true }}
      revealAnswersOnSubmit={reveal}
    />,
  );

const option = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`\\. ${name}$`) });
const firstInput = () => screen.getAllByRole("textbox")[0] as HTMLInputElement;

describe("Q1 selection quiz — review preview judges on click", () => {
  it("correct pick opens the correct-answer animation and locks the question", () => {
    renderSelection(true);
    fireEvent.click(option("apple"));
    expect(screen.getByTestId("score-overlay")).toBeInTheDocument();
    expect(option("pear")).toBeDisabled();
  });

  it("wrong pick shows no animation and locks the question (cannot re-pick)", () => {
    renderSelection(true);
    fireEvent.click(option("pear"));
    expect(screen.queryByTestId("score-overlay")).toBeNull();
    expect(option("apple")).toBeDisabled();
    fireEvent.click(option("apple"));
    expect(screen.queryByTestId("score-overlay")).toBeNull();
  });
});

describe.each([
  ["word_spelling_quiz", renderSpelling],
  ["word_cloze_quiz", renderCloze],
] as const)("Q2 %s — review preview check answer", (_name, renderQuiz) => {
  const submitArrow = () =>
    screen.getByRole("button", { name: "Submit answer" });

  it("uses the student submit arrow (no extra check button): disabled until typed; correct → animation", () => {
    renderQuiz(true);
    expect(screen.queryByTestId("preview-check-answer")).toBeNull();
    expect(submitArrow()).toBeDisabled();
    fireEvent.change(firstInput(), { target: { value: "apple" } });
    expect(submitArrow()).not.toBeDisabled();
    fireEvent.click(submitArrow());
    expect(screen.getByTestId("score-overlay")).toBeInTheDocument();
    expect(screen.queryByTestId("preview-correct-answer")).toBeNull();
    // 已判斷 → 輸入鎖定、箭頭不可再按
    expect(submitArrow()).toBeDisabled();
    expect(screen.queryByTestId("preview-check-answer")).toBeNull();
  });

  it("Enter judges too; wrong answer reveals the correct answer without animation", () => {
    renderQuiz(true);
    expect(screen.queryByTestId("preview-check-answer")).toBeNull();
    fireEvent.change(firstInput(), { target: { value: "appl" } });
    fireEvent.keyDown(firstInput(), { key: "Enter", code: "Enter" });
    expect(screen.queryByTestId("score-overlay")).toBeNull();
    expect(screen.getByTestId("preview-correct-answer")).toBeInTheDocument();
  });
});

describe("Q3 explain mode (false) — no per-question reveal", () => {
  it("selection: no animation, question not locked", () => {
    renderSelection(false);
    fireEvent.click(option("pear"));
    expect(screen.queryByTestId("score-overlay")).toBeNull();
    expect(option("apple")).not.toBeDisabled();
  });

  it.each([
    ["word_spelling_quiz", renderSpelling],
    ["word_cloze_quiz", renderCloze],
  ] as const)("%s: no check-answer button, no correct answer", (_n, r) => {
    r(false);
    expect(screen.queryByTestId("preview-check-answer")).toBeNull();
    fireEvent.change(firstInput(), { target: { value: "appl" } });
    fireEvent.keyDown(firstInput(), { key: "Enter", code: "Enter" });
    expect(screen.queryByTestId("score-overlay")).toBeNull();
    expect(screen.queryByTestId("preview-correct-answer")).toBeNull();
  });
});

describe("Q5 no mode (undefined) — student / dispatch-dialog path unchanged", () => {
  it("selection: no animation, not locked", () => {
    renderSelection(undefined);
    fireEvent.click(option("apple"));
    expect(screen.queryByTestId("score-overlay")).toBeNull();
    expect(option("pear")).not.toBeDisabled();
  });

  it.each([
    ["word_spelling_quiz", renderSpelling],
    ["word_cloze_quiz", renderCloze],
  ] as const)("%s: no check-answer button", (_n, r) => {
    r(undefined);
    expect(screen.queryByTestId("preview-check-answer")).toBeNull();
    expect(screen.queryByTestId("score-overlay")).toBeNull();
  });
});

describe.each([
  ["word_selection_quiz", renderSelection],
  ["word_spelling_quiz", renderSpelling],
  ["word_cloze_quiz", renderCloze],
] as const)("Q6 %s — answer card has no inner scrollbar", (_name, r) => {
  it.each([true, undefined])("reveal=%s", (reveal) => {
    const { container } = r(reveal);
    const scrollables = Array.from(
      container.querySelectorAll<HTMLElement>("[class]"),
    ).filter((el) => {
      const cls = el.getAttribute("class") || "";
      return (
        cls.split(/\s+/).includes("overflow-y-auto") ||
        /\bmax-h-\[\d+dvh\]/.test(cls)
      );
    });
    expect(scrollables).toHaveLength(0);
  });
});
