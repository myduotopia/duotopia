/**
 * GroupPreview 測試（Issue #1082：預覽完整題組）。
 *
 * 鎖住：主圖文＋小題＋選項都畫出來、克漏字顯示「空格 n」且不顯示題幹、文章已刪掉的空格顯示
 * 「找不到空格」、不出現正確答案／解析、forceStack 傳到主圖文、沒有 layout 時退回題組圖、文字與單字註解（只有註解也畫）。
 * 選項顯示規則（無字無圖不渲染、2×2／直排、圖片選項）在 QuestionsPreview.test.tsx。
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
        : key === "questionBank.group.questions.blankMissing"
          ? `Missing ${opts?.n}`
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
          blocks: [
            { type: "paragraph", text: "Tom has a {{1}} dog and a {{2}} cat." },
          ],
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
  it("克漏字：小題指向的空格已不在文章裡 → 顯示「找不到空格」標記", () => {
    const g = { ...emptyGroupDraft("cloze"), layout: passageDoc };
    g.questions = [
      question(g, { blank_index: 1 }),
      question(g, { blank_index: 5 }),
    ];
    render(<GroupPreview draft={g} />);
    expect(screen.getByTestId("group-preview-q-0-blank")).toHaveTextContent(
      "Blank 1",
    );
    expect(
      screen.getByTestId("group-preview-q-1-blank-missing"),
    ).toHaveTextContent("Missing 5");
  });

  it("forceStack 傳到主圖文（欄位堆疊）", () => {
    render(<GroupPreview draft={readingGroup()} forceStack />);
    expect(screen.getByTestId("layout-renderer")).toHaveAttribute(
      "data-stack",
      "true",
    );
    expect(screen.getByTestId("group-preview-q-0-options")).toHaveAttribute(
      "data-layout",
      "stack",
    );
  });

  it("沒有 layout 但有單字註解：退回顯示也畫註解框", () => {
    const g = {
      ...emptyGroupDraft("reading"),
      passage_text: "Poster text",
      glossary: [{ word: "poster", zh: "海報" }],
    };
    render(<GroupPreview draft={g} />);
    const fallback = screen.getByTestId("group-preview-fallback");
    expect(within(fallback).getByTestId("layout-glossary")).toHaveTextContent(
      "poster 海報",
    );
  });

  it("沒有 layout、圖、文章，只有單字註解＋小題：註解框照樣出現", () => {
    const g = {
      ...emptyGroupDraft("reading"),
      glossary: [
        { word: "poster", zh: "海報" },
        { word: "half", zh: "" },
      ],
    };
    g.questions = [question(g, { stem: "What is on the wall?" })];
    render(<GroupPreview draft={g} />);
    const fallback = screen.getByTestId("group-preview-fallback");
    expect(within(fallback).getByTestId("layout-glossary")).toHaveTextContent(
      "poster 海報",
    );
    expect(screen.getByTestId("group-preview-q-0")).toHaveTextContent(
      "What is on the wall?",
    );
  });

  it("題組標題（#1082）：有值才顯示、置中加粗、在主圖文之前；空白標題不顯示", () => {
    const { unmount } = render(
      <GroupPreview
        draft={{ ...readingGroup(), title: "  A Trip to Tainan " }}
      />,
    );
    const title = screen.getByTestId("group-preview-title");
    expect(title).toHaveTextContent("A Trip to Tainan");
    expect(title.className).toContain("text-center");
    expect(title.className).toContain("font-bold");
    const renderer = screen.getByTestId("layout-renderer");
    expect(
      title.compareDocumentPosition(renderer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    unmount();
    render(<GroupPreview draft={{ ...readingGroup(), title: "   " }} />);
    expect(screen.queryByTestId("group-preview-title")).toBeNull();
  });

  it("沒有排版的退回顯示也有標題；整篇外框時標題在框外", () => {
    const g = {
      ...emptyGroupDraft("reading"),
      title: "Poster",
      passage_text: "Hello",
    };
    const { unmount } = render(<GroupPreview draft={g} />);
    expect(screen.getByTestId("group-preview-title")).toHaveTextContent(
      "Poster",
    );
    unmount();
    render(
      <GroupPreview
        draft={{
          ...readingGroup(),
          title: "Framed",
          layout: { ...passageDoc, frame: true },
        }}
      />,
    );
    const frame = screen.getByTestId("layout-frame");
    expect(within(frame).queryByTestId("group-preview-title")).toBeNull();
  });
});
