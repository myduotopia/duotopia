/**
 * #1045 階段 4b／4c：考後檢討預覽逐題判斷＋回饋（對齊艾賓浩斯練習版）、作答卡片無內部卷軸
 *
 *   R1 選擇題答錯：所選紅＋答錯動畫（ScoreOverlay isError）；動畫結束後正解綠；鎖定、不自動跳題
 *   R2 選擇題答對：所選綠＋答對動畫（score=100，非 isError）
 *   R3 拼字／克漏字答錯：輸入格顯示紅色正解並鎖定；無「正解：xxx」文字；不播動畫
 *   R4 拼字／克漏字答對：輸入格綠＋答對動畫
 *   R5 提交後以判斷當下的原始作答計分（答錯改顯示正解後仍算錯）
 *   Q2 拼字／克漏字沿用學生端 QuizAnswerInput 送出箭頭（aria-label "Submit answer"），
 *      未作答 disabled；畫面上沒有另加的「對答案」鈕
 *   Q3 考前說明（false）／Q5 無模式（undefined）：不播動畫、不鎖定、不變色
 *   Q6 卡片區不含 overflow-y-auto 與 max-h-[..dvh]
 *
 * ScoreOverlay 以 stub 取代（Lottie 在 jsdom 無意義）：暴露 open / isError，並提供按鈕觸發 onComplete。
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
  default: ({
    open,
    isError,
    score,
    onComplete,
  }: {
    open: boolean;
    isError: boolean;
    score: number;
    onComplete: () => void;
  }) =>
    open ? (
      <div
        data-testid="score-overlay"
        data-error={String(isError)}
        data-score={String(score)}
      >
        <button
          type="button"
          data-testid="score-overlay-complete"
          onClick={onComplete}
        >
          done
        </button>
      </div>
    ) : null,
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
const submitArrow = () => screen.getByRole("button", { name: "Submit answer" });
// WordSelectionOptionButton：showCorrect → bg-green-100、showIncorrect → bg-red-100
const isGreen = (el: HTMLElement) => el.className.includes("bg-green-100");
const isRed = (el: HTMLElement) => el.className.includes("bg-red-100");

describe("R1/R2 selection quiz — review preview feedback like practice mode", () => {
  it("R2 correct pick: chosen option green + correct animation (score 100), locked", () => {
    renderSelection(true);
    fireEvent.click(option("apple"));
    const overlay = screen.getByTestId("score-overlay");
    expect(overlay).toHaveAttribute("data-error", "false");
    expect(overlay).toHaveAttribute("data-score", "100");
    expect(isGreen(option("apple"))).toBe(true);
    expect(option("pear")).toBeDisabled();
    // 動畫結束後不自動跳題（仍在第 1 題的選項上）
    fireEvent.click(screen.getByTestId("score-overlay-complete"));
    expect(screen.queryByTestId("score-overlay")).toBeNull();
    expect(isGreen(option("apple"))).toBe(true);
  });

  it("R1 wrong pick: chosen red + error animation; correct turns green only after animation ends", () => {
    renderSelection(true);
    fireEvent.click(option("pear"));
    const overlay = screen.getByTestId("score-overlay");
    expect(overlay).toHaveAttribute("data-error", "true");
    expect(overlay).toHaveAttribute("data-score", "0");
    expect(isRed(option("pear"))).toBe(true);
    expect(isGreen(option("apple"))).toBe(false);
    // 鎖定：不可改選
    expect(option("apple")).toBeDisabled();

    fireEvent.click(screen.getByTestId("score-overlay-complete"));
    expect(screen.queryByTestId("score-overlay")).toBeNull();
    expect(isGreen(option("apple"))).toBe(true);
    expect(isRed(option("pear"))).toBe(true);
    // 不自動跳題：第 1 題的選項仍在畫面上且鎖定
    expect(option("apple")).toBeDisabled();
  });
});

describe.each([
  ["word_spelling_quiz", renderSpelling],
  ["word_cloze_quiz", renderCloze],
] as const)("R3/R4/Q2 %s — review preview", (_name, renderQuiz) => {
  it("Q2/R4 submit arrow: disabled until typed; correct → input green + correct animation", () => {
    renderQuiz(true);
    expect(screen.queryByTestId("preview-check-answer")).toBeNull();
    expect(submitArrow()).toBeDisabled();
    fireEvent.change(firstInput(), { target: { value: "apple" } });
    expect(submitArrow()).not.toBeDisabled();
    fireEvent.click(submitArrow());
    const overlay = screen.getByTestId("score-overlay");
    expect(overlay).toHaveAttribute("data-error", "false");
    expect(firstInput().className).toContain("text-green-700");
    expect(firstInput()).toBeDisabled();
    expect(submitArrow()).toBeDisabled();
  });

  it("R3 wrong (Enter): input shows the correct answer in red, locked, no animation, no text line", () => {
    renderQuiz(true);
    fireEvent.change(firstInput(), { target: { value: "appl" } });
    fireEvent.keyDown(firstInput(), { key: "Enter", code: "Enter" });
    expect(screen.queryByTestId("score-overlay")).toBeNull();
    expect(firstInput().value).toBe("apple");
    expect(firstInput().className).toContain("text-red-600");
    expect(firstInput()).toBeDisabled();
    expect(screen.queryByTestId("preview-correct-answer")).toBeNull();
    expect(screen.queryByText("wordQuiz.revision.correctAnswer")).toBeNull();
    // 鎖定：輸入不再改變
    fireEvent.change(firstInput(), { target: { value: "zzz" } });
    expect(firstInput().value).toBe("apple");
  });

  it("R5 submit scores the ORIGINAL answer: wrong stays wrong after the input shows the correct answer", async () => {
    renderQuiz(true);
    fireEvent.change(firstInput(), { target: { value: "appl" } });
    fireEvent.keyDown(firstInput(), { key: "Enter", code: "Enter" });
    expect(firstInput().value).toBe("apple");
    const submitButtons = screen
      .getAllByText("wordQuiz.submit")
      .map((el) => el.closest("button"))
      .filter((b): b is HTMLButtonElement => !!b && !b.disabled);
    fireEvent.click(submitButtons[submitButtons.length - 1]);
    expect(
      await screen.findByText("wordQuiz.review.scoreSummary"),
    ).toBeInTheDocument();
    // 2 題：第 1 題原作答 appl（錯）、第 2 題未作答 → 0 分；若誤用正解計分會變 50
    expect(
      screen.getByText((_c, el) => el?.textContent?.trim() === "0 分"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText((_c, el) => el?.textContent?.trim() === "50 分"),
    ).toBeNull();
    expect(screen.getByText("appl")).toBeInTheDocument();
  });
});

describe("Q3 explain mode (false) — no per-question feedback", () => {
  it("selection: no animation, no colours, not locked", () => {
    renderSelection(false);
    fireEvent.click(option("pear"));
    expect(screen.queryByTestId("score-overlay")).toBeNull();
    expect(isRed(option("pear"))).toBe(false);
    expect(option("apple")).not.toBeDisabled();
  });

  it.each([
    ["word_spelling_quiz", renderSpelling],
    ["word_cloze_quiz", renderCloze],
  ] as const)("%s: no animation, input unchanged and neutral", (_n, r) => {
    r(false);
    expect(screen.queryByTestId("preview-check-answer")).toBeNull();
    fireEvent.change(firstInput(), { target: { value: "appl" } });
    fireEvent.keyDown(firstInput(), { key: "Enter", code: "Enter" });
    expect(screen.queryByTestId("score-overlay")).toBeNull();
    expect(firstInput().value).toBe("appl");
    expect(firstInput().className).not.toContain("text-red-600");
  });
});

describe("Q5 no mode (undefined) — student / dispatch-dialog path unchanged", () => {
  it("selection: no animation, not locked", () => {
    renderSelection(undefined);
    fireEvent.click(option("apple"));
    expect(screen.queryByTestId("score-overlay")).toBeNull();
    expect(isGreen(option("apple"))).toBe(false);
    expect(option("pear")).not.toBeDisabled();
  });

  it.each([
    ["word_spelling_quiz", renderSpelling],
    ["word_cloze_quiz", renderCloze],
  ] as const)("%s: no extra button, no animation, neutral input", (_n, r) => {
    r(undefined);
    expect(screen.queryByTestId("preview-check-answer")).toBeNull();
    fireEvent.change(firstInput(), { target: { value: "appl" } });
    expect(screen.queryByTestId("score-overlay")).toBeNull();
    expect(firstInput().value).toBe("appl");
    expect(firstInput().className).not.toContain("text-red-600");
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
