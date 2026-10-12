/**
 * QuestionsPreview 測試（Issue #1082：小題／單題預覽共用列表）。
 *
 * 鎖住：依序編號、無字無圖的選項不渲染且字母重排、圖片選項與題幹插圖顯示 img、
 * 不出現正確答案／解析、選項 2×2／直排規則、克漏字「空格 n」、「找不到空格」與「未指定空格」標記。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import QuestionsPreview from "../QuestionsPreview";
import { emptyDraft, type QuestionDraft } from "../questionDraft";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      key === "questionBank.group.questions.blankN"
        ? `Blank ${opts?.n}`
        : key === "questionBank.group.questions.blankMissing"
          ? `Missing ${opts?.n}`
          : key === "questionBank.group.questions.blankUnassigned"
            ? "Unassigned"
            : key,
    i18n: { language: "zh-TW" },
  }),
}));

function q(patch: Partial<QuestionDraft> = {}): QuestionDraft {
  return { ...emptyDraft(), ...patch };
}

function twoQuestions(): QuestionDraft[] {
  return [
    q({
      stem: "Who is **Tom**?",
      explanation: "EXPLAIN-SECRET",
      options: [
        { text: "A boy", is_correct: true, image_url: null },
        { text: "A dog", is_correct: false, image_url: null },
        { text: "", is_correct: false, image_url: null },
        { text: "", is_correct: false, image_url: "https://x/opt-d.png" },
      ],
    }),
    q({
      stem: "Which picture shows the dog?",
      image_url: "https://x/stem.png",
      options: [
        { text: "", is_correct: false, image_url: "https://x/a.png" },
        { text: "", is_correct: true, image_url: "https://x/b.png" },
      ],
    }),
  ];
}

describe("QuestionsPreview", () => {
  it("依序編號 1、2；題幹粗體用 InlineText 渲染", () => {
    render(<QuestionsPreview questions={twoQuestions()} testId="qp" />);
    expect(screen.getByTestId("qp-q-0-number")).toHaveTextContent("1.");
    expect(screen.getByTestId("qp-q-1-number")).toHaveTextContent("2.");
    const q0 = screen.getByTestId("qp-q-0");
    expect(q0).toHaveTextContent("Who is Tom?");
    expect(q0.querySelector("strong")?.textContent).toBe("Tom");
  });

  it("無字無圖的選項不渲染，字母依顯示順序重排；圖片選項與題幹插圖顯示 img", () => {
    render(<QuestionsPreview questions={twoQuestions()} testId="qp" />);
    const opts = within(screen.getByTestId("qp-q-0-options"));
    expect(opts.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByTestId("qp-q-0-opt-2")).toHaveTextContent("(C)");
    expect(screen.getByTestId("qp-q-0-opt-2-image")).toHaveAttribute(
      "src",
      "https://x/opt-d.png",
    );
    expect(screen.getByTestId("qp-q-1-stem-image")).toHaveAttribute(
      "src",
      "https://x/stem.png",
    );
    expect(screen.getByTestId("qp-q-1-opt-1-image")).toHaveAttribute(
      "src",
      "https://x/b.png",
    );
  });

  it("圖片等比縮放不裁切：選項圖限 160px 方框、題幹圖限高且寬度自動（#1082）", () => {
    render(<QuestionsPreview questions={twoQuestions()} testId="qp" />);
    const opt = screen.getByTestId("qp-q-1-opt-1-image");
    for (const c of [
      "object-contain",
      "max-w-[160px]",
      "max-h-[160px]",
      "w-auto",
      "h-auto",
    ]) {
      expect(opt).toHaveClass(c);
    }
    const stem = screen.getByTestId("qp-q-1-stem-image");
    for (const c of ["object-contain", "max-h-60", "max-w-full", "w-auto"]) {
      expect(stem).toHaveClass(c);
    }
    expect(stem).not.toHaveClass("object-cover");
  });

  it("不顯示正確答案與解析", () => {
    const { container } = render(
      <QuestionsPreview questions={twoQuestions()} />,
    );
    expect(container).not.toHaveTextContent("EXPLAIN-SECRET");
    expect(container.querySelector("[data-correct]")).toBeNull();
    expect(container).not.toHaveTextContent("✓");
  });

  it("選項排版：四個以內短文字 → 2×2；forceStack → 直排；長文字 → 直排", () => {
    const qs = twoQuestions();
    const { unmount } = render(<QuestionsPreview questions={qs} testId="qp" />);
    const opts = screen.getByTestId("qp-q-0-options");
    expect(opts).toHaveAttribute("data-layout", "grid");
    expect(opts.className).toContain("md:grid-cols-2");
    unmount();

    const { unmount: u2 } = render(
      <QuestionsPreview questions={qs} forceStack testId="qp" />,
    );
    expect(screen.getByTestId("qp-q-0-options")).toHaveAttribute(
      "data-layout",
      "stack",
    );
    u2();

    qs[0].options[0].text =
      "A boy who lives next to the library and walks his dog every day";
    render(<QuestionsPreview questions={qs} testId="qp" />);
    expect(screen.getByTestId("qp-q-0-options")).toHaveAttribute(
      "data-layout",
      "stack",
    );
  });

  it("克漏字：「空格 n」徽章、不顯示題幹；列在 missingBlanks → 找不到空格；缺編號 → 未指定空格", () => {
    render(
      <QuestionsPreview
        numbering="blank"
        missingBlanks={[3]}
        testId="qp"
        questions={[
          q({ blank_index: 1, stem: "Fill in blank (1)." }),
          q({ blank_index: 3, stem: "Fill in blank (3)." }),
          q({ blank_index: null, stem: "Fill in blank." }),
        ]}
      />,
    );
    expect(screen.getByTestId("qp-q-0-blank")).toHaveTextContent("Blank 1");
    expect(screen.getByTestId("qp-q-1-blank-missing")).toHaveTextContent(
      "Missing 3",
    );
    expect(screen.queryByTestId("qp-q-1-blank")).toBeNull();
    const unassigned = screen.getByTestId("qp-q-2-blank-missing");
    expect(unassigned).toHaveTextContent("Unassigned");
    expect(unassigned).not.toHaveTextContent("?");
    expect(unassigned.className).toContain("text-amber-700");
    expect(screen.queryByText(/Fill in blank/)).toBeNull();
    expect(screen.queryByTestId("qp-q-0-number")).toBeNull();
  });
});
