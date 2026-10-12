/**
 * #1092：QuizScoringMethodField 評分方式下拉選單
 * - 未選（method null）：trigger 顯示 placeholder、aria-required，不顯示任何方式說明與試算表
 * - 選了某一種：下方只顯示那一種的說明（不驅動 Radix Select 開選單，直接以 value.method 渲染，
 *   避免 jsdom 下 pointer／portal 行為不穩）
 * - 扣分輸入只在 fixed_per_word / fixed_per_letter 出現
 * - 有 questionCount 且選了方式 → 試算表各列出現
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { QuizScoringMethodField } from "../QuizScoringMethodField";
import {
  QUIZ_SCORING_METHODS,
  type QuizScoringMethod,
  type QuizScoringSettings,
} from "@/lib/quizScoring";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

vi.mock("@/lib/api", () => ({
  apiClient: {
    getContentDetail: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

const settings = (
  method: QuizScoringMethod | null,
  points: number | null = null,
): QuizScoringSettings => ({ method, points, caseSensitive: false });

const renderField = (value: QuizScoringSettings, questionCount = 10) =>
  render(
    <QuizScoringMethodField
      value={value}
      onChange={() => {}}
      practiceMode="word_spelling_quiz"
      questionCount={questionCount}
    />,
  );

const descKey = (m: QuizScoringMethod) => `quizScoring.methods.${m}.desc`;

describe("QuizScoringMethodField (#1092 dropdown)", () => {
  it("method null → placeholder, aria-required, no description, no preview", () => {
    renderField(settings(null));
    const trigger = screen.getByTestId("quiz-scoring-method-trigger");
    expect(trigger.textContent).toContain("quizScoring.placeholder");
    expect(trigger.getAttribute("aria-required")).toBe("true");
    for (const m of QUIZ_SCORING_METHODS) {
      expect(screen.queryByText(descKey(m))).toBeNull();
    }
    expect(screen.queryByTestId("quiz-scoring-preview")).toBeNull();
  });

  it("selected method → shows only that method's description", () => {
    renderField(settings("per_word"));
    expect(screen.getByText(descKey("per_word"))).toBeTruthy();
    for (const m of QUIZ_SCORING_METHODS.filter((x) => x !== "per_word")) {
      expect(screen.queryByText(descKey(m))).toBeNull();
    }
    expect(
      screen.getByTestId("quiz-scoring-method-trigger").textContent,
    ).not.toContain("quizScoring.placeholder");
  });

  it("points input only for fixed_per_word / fixed_per_letter", () => {
    for (const m of QUIZ_SCORING_METHODS) {
      const { container, unmount } = renderField(settings(m, 1));
      const input = container.querySelector("#quiz-scoring-points");
      if (m === "fixed_per_word" || m === "fixed_per_letter") {
        expect(input).not.toBeNull();
      } else {
        expect(input).toBeNull();
      }
      unmount();
    }
  });

  it("preview rows render when a method is set and questionCount is given", () => {
    renderField(settings("whole_question"), 10);
    expect(screen.getByTestId("quiz-scoring-preview")).toBeTruthy();
    expect(screen.getByTestId("quiz-scoring-per-q")).toBeTruthy();
    for (const key of [
      "allCorrect",
      "oneLetter",
      "oneWord",
      "blankSlot",
      "unanswered",
    ]) {
      expect(screen.getByTestId(`quiz-scoring-row-${key}`)).toBeTruthy();
    }
  });
});
