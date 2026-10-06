/**
 * GroupPreview 測試（Issue #1082：預覽完整題組）。
 *
 * 鎖住：主圖文＋小題＋選項都畫出來、圖片選項顯示 img、克漏字顯示「空格 n」且不顯示題幹、
 * 無字無圖的選項不渲染、不出現正確答案／解析、forceStack 選項直排、沒有 layout 時退回題組圖與文字。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import GroupPreview from "../GroupPreview";
import {
  emptyGroupDraft,
  emptyGroupQuestion,
  type GroupDraft,
  type QuestionDraft,
} from "../questionDraft";
import type { LayoutDoc } from "@/types/questionBank";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      key === "questionBank.group.questions.blankN"
        ? `Blank ${opts?.n}`
        : key,
    i18n: { language: "zh-TW" },
  }),
}));

const passageDoc: LayoutDoc = {
  version: 1,
  rows: [
    {
      columns: [
        {
          span: 1,
          blocks: [{ type: "paragraph", text: "Tom has a {{1}} dog." }],
        },
      ],
    },
  ],
};

function question(
  g: GroupDraft,
  patch: Partial<QuestionDraft> = {},
): QuestionDraft {
  return { ...emptyGroupQuestion(g), ...patch };
}

function readingGroup(): GroupDraft {
  const g = { ...emptyGroupDraft("reading"), layout: passageDoc };
  g.questions = [
    question(g, {
      stem: "Who is **Tom**?",
      explanation: "EXPLAIN-SECRET",
      options: [
        { text: "A boy", is_correct: true, image_url: null },
        { text: "A dog", is_correct: false, image_url: null },
        { text: "", is_correct: false, image_url: null },
        { text: "", is_correct: false, image_url: "https://x/opt-d.png" },
      ],
    }),
    question(g, {
      stem: "Which picture shows the dog?",
      image_url: "https://x/stem.png",
      options: [
        { text: "", is_correct: false, image_url: "https://x/a.png" },
        { text: "", is_correct: true, image_url: "https://x/b.png" },
      ],
    }),
  ];
  return g;
}

describe("GroupPreview", () => {
  it("閱讀題組：主圖文＋兩題（編號 1、2）＋選項；粗體用 InlineText 渲染", () => {
    render(<GroupPreview draft={readingGroup()} />);
    expect(screen.getByTestId("layout-renderer")).toHaveTextContent(
      "Tom has a",
    );
    expect(screen.getByTestId("group-preview-q-0-number")).toHaveTextContent(
      "1.",
    );
    expect(screen.getByTestId("group-preview-q-1-number")).toHaveTextContent(
      "2.",
    );
    const q0 = screen.getByTestId("group-preview-q-0");
    expect(q0).toHaveTextContent("Who is Tom?");
    expect(q0.querySelector("strong")?.textContent).toBe("Tom");
    expect(q0).toHaveTextContent("A boy");
    expect(q0).toHaveTextContent("A dog");
    expect(
      screen.getByText("questionBank.group.preview.questionsTitle"),
    ).toBeTruthy();
  });

  it("無字無圖的選項不渲染，字母依顯示順序重排；只有圖的選項顯示 img", () => {
    render(<GroupPreview draft={readingGroup()} />);
    const opts = within(screen.getByTestId("group-preview-q-0-options"));
    expect(opts.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByTestId("group-preview-q-0-opt-2")).toHaveTextContent(
      "(C)",
    );
    expect(
      screen.getByTestId("group-preview-q-0-opt-2-image"),
    ).toHaveAttribute("src", "https://x/opt-d.png");
    // 第二題：題幹插圖＋兩個圖片選項
    expect(
      screen.getByTestId("group-preview-q-1-stem-image"),
    ).toHaveAttribute("src", "https://x/stem.png");
    expect(
      screen.getByTestId("group-preview-q-1-opt-0-image"),
    ).toHaveAttribute("src", "https://x/a.png");
    expect(
      screen.getByTestId("group-preview-q-1-opt-1-image"),
    ).toHaveAttribute("src", "https://x/b.png");
  });

  it("不顯示正確答案與解析", () => {
    const { container } = render(<GroupPreview draft={readingGroup()} />);
    expect(container).not.toHaveTextContent("EXPLAIN-SECRET");
    expect(container.querySelector("[data-correct]")).toBeNull();
    expect(container).not.toHaveTextContent("✓");
  });

  it("克漏字：依空格編號排序、顯示「空格 n」徽章、不顯示題幹", () => {
    const g = { ...emptyGroupDraft("cloze"), layout: passageDoc };
    g.questions = [
      question(g, {
        blank_index: 2,
        stem: "Fill in blank (2).",
        options: [{ text: "big", is_correct: true, image_url: null }],
      }),
      question(g, {
        blank_index: 1,
        stem: "Fill in blank (1).",
        options: [{ text: "small", is_correct: true, image_url: null }],
      }),
    ];
    render(<GroupPreview draft={g} />);
    expect(screen.getByTestId("group-preview-q-0-blank")).toHaveTextContent(
      "Blank 1",
    );
    expect(screen.getByTestId("group-preview-q-1-blank")).toHaveTextContent(
      "Blank 2",
    );
    expect(screen.getByTestId("group-preview-q-0")).toHaveTextContent("small");
    expect(screen.queryByText(/Fill in blank/)).toBeNull();
    expect(screen.queryByTestId("group-preview-q-0-number")).toBeNull();
  });

  it("選項排版：四個以內短文字 → 2×2；forceStack → 直排；長文字 → 直排", () => {
    const g = readingGroup();
    const { unmount } = render(<GroupPreview draft={g} />);
    const opts = screen.getByTestId("group-preview-q-0-options");
    expect(opts).toHaveAttribute("data-layout", "grid");
    expect(opts.className).toContain("md:grid-cols-2");
    unmount();

    const { unmount: unmount2 } = render(
      <GroupPreview draft={g} forceStack />,
    );
    const stacked = screen.getByTestId("group-preview-q-0-options");
    expect(stacked).toHaveAttribute("data-layout", "stack");
    expect(stacked.className).toContain("flex-col");
    expect(screen.getByTestId("layout-renderer")).toHaveAttribute(
      "data-stack",
      "true",
    );
    unmount2();

    g.questions[0].options[0].text =
      "A boy who lives next to the library and walks his dog every day";
    render(<GroupPreview draft={g} />);
    expect(screen.getByTestId("group-preview-q-0-options")).toHaveAttribute(
      "data-layout",
      "stack",
    );
  });

  it("沒有 layout：退回顯示題組圖與 passage_text；全空顯示空狀態", () => {
    const g = {
      ...emptyGroupDraft("reading"),
      image_url: "https://x/poster.png",
      passage_text: "Poster text",
    };
    const { unmount } = render(<GroupPreview draft={g} />);
    const fallback = screen.getByTestId("group-preview-fallback");
    expect(fallback.querySelector("img")).toHaveAttribute(
      "src",
      "https://x/poster.png",
    );
    expect(fallback).toHaveTextContent("Poster text");
    expect(screen.queryByTestId("layout-renderer")).toBeNull();
    unmount();

    render(<GroupPreview draft={emptyGroupDraft()} />);
    expect(screen.getByTestId("group-preview-empty")).toBeTruthy();
  });
});
