/**
 * 克漏字題組 UI 測試（Issue #1085）：
 * - 段落工具列「插入空格」只在 clozeMode 出現，插在游標處、編號遞增
 * - GroupCard 在 cloze 下：小題卡顯示「空格 n」無題幹、依編號排序、無拖曳把手
 * - 文末插入空格／缺空格警告與兩個動作／依閱讀順序重新編號
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import GroupCard from "../GroupCard";
import LayoutBlockEditor from "../LayoutBlockEditor";
import QuestionCard from "../QuestionCard";
import {
  emptyGroupDraft,
  emptyGroupQuestion,
  type GroupDraft,
} from "../questionDraft";
import { layoutBlankIndexes } from "../layoutInline";
import type { ExamPoint, LayoutBlock, LayoutDoc } from "@/types/questionBank";
import type { TTSSettingsState } from "@/components/shared/BatchTTSSettings";

// jsdom 沒有 scrollIntoView（GroupCard 插入／新增小題後會捲到該卡）；
// 不改產品碼，只在這支測試檔補 stub，避免 setTimeout 裡丟 unhandled error。
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && "n" in opts ? `${key}:${opts.n}` : key,
    i18n: { language: "zh-TW" },
  }),
}));

vi.mock("@/lib/api", () => ({
  apiClient: { aiSuggestGroupTitle: vi.fn(), ttsSynthesize: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/components/shared/GradeRangeSlider", () => ({
  GradeRangeSlider: () => <div data-testid="grade-stub" />,
}));

/** LayoutEditor stub：把 clozeMode／nextBlankIndex 露出來，並能直接換 layout */
vi.mock("../LayoutEditor", () => ({
  default: ({
    layout,
    onChange,
    testId,
    clozeMode,
    nextBlankIndex,
  }: {
    layout: LayoutDoc | null;
    onChange: (l: LayoutDoc | null) => void;
    testId: string;
    clozeMode?: boolean;
    nextBlankIndex?: number;
  }) => (
    <button
      type="button"
      data-testid={`${testId}-stub`}
      data-cloze={clozeMode ? "1" : "0"}
      data-next-blank={nextBlankIndex ?? ""}
      data-blanks={layoutBlankIndexes(layout).join(",")}
      onClick={() => onChange(doc("a {{1}} b {{2}} c"))}
    >
      layout-stub
    </button>
  ),
}));

function doc(...paragraphs: string[]): LayoutDoc {
  return {
    version: 1,
    rows: paragraphs.map((text) => ({
      columns: [{ span: 1, blocks: [{ type: "paragraph", text }] }],
    })),
  };
}

const tts = {
  accent: "en-US",
  voice: "en-US-JennyNeural",
  speed: 1,
} as unknown as TTSSettingsState;

function clozeDraft(layout: LayoutDoc | null, blanks: number[]): GroupDraft {
  const g: GroupDraft = {
    ...emptyGroupDraft("cloze"),
    layout,
    visibility: "private",
  };
  return {
    ...g,
    questions: blanks.map((n) => ({
      ...emptyGroupQuestion(g),
      blank_index: n,
      options: [
        { text: "a", is_correct: true, image_url: null },
        { text: "b", is_correct: false, image_url: null },
      ],
    })),
  };
}

const EP: ExamPoint = {
  id: 7,
  code: "grammar.tense.present_perfect",
  names: { "zh-TW": "現在完成式" },
  parent_id: null,
  status: "active",
  order_index: 0,
  aliases: [],
};

/** 選項、答案、考點都填好的克漏字題組（只缺題幹 —— 克漏字本來就沒有題幹） */
function filledClozeDraft(layout: LayoutDoc | null, blanks: number[]) {
  const g = clozeDraft(layout, blanks);
  return {
    ...g,
    questions: g.questions.map((q) => ({ ...q, exam_points: [EP] })),
  };
}

function Harness({ initial }: { initial: GroupDraft }) {
  const [draft, setDraft] = useState(initial);
  return (
    <GroupCard
      index={0}
      draft={draft}
      onChange={setDraft}
      ttsSettings={tts}
      programs={[]}
      errorMessage={null}
    />
  );
}

// -------------------------------------------------------- 插入空格按鈕

describe("LayoutBlockEditor 插入空格", () => {
  const renderBlock = (clozeMode: boolean, nextBlankIndex = 3) => {
    const onChange = vi.fn<(p: Partial<LayoutBlock>) => void>();
    render(
      <LayoutBlockEditor
        block={{ id: "b1", type: "paragraph", text: "it is cold" }}
        onChange={onChange}
        testId="blk"
        clozeMode={clozeMode}
        nextBlankIndex={nextBlankIndex}
      />,
    );
    return onChange;
  };

  it("非克漏字時不出現", async () => {
    const user = userEvent.setup();
    renderBlock(false);
    await user.click(screen.getByTestId("blk-text"));
    expect(await screen.findByTestId("blk-toolbar")).toBeTruthy();
    expect(screen.queryByTestId("blk-insert-blank")).toBeNull();
  });

  it("克漏字時插在游標位置，用給的編號", async () => {
    const user = userEvent.setup();
    const onChange = renderBlock(true, 4);
    const area = screen.getByTestId("blk-text") as HTMLTextAreaElement;
    await user.click(area);
    area.setSelectionRange(6, 6);
    await user.click(await screen.findByTestId("blk-insert-blank"));
    expect(onChange).toHaveBeenCalledWith({ text: "it is {{4}}cold" });
  });
});

// -------------------------------------------------------- 小題卡外觀

describe("QuestionCard 克漏字外觀", () => {
  it("顯示「空格 n」徽章、沒有題幹文字框", () => {
    const g = clozeDraft(doc("a {{2}} b"), [2]);
    render(
      <QuestionCard
        index={0}
        draft={g.questions[0]}
        onChange={vi.fn()}
        ttsSettings={tts}
        programs={[]}
        errorMessage={null}
        stemOptional
        clozeBlank={2}
        testIdPrefix="qg-0-q"
        compact
      />,
    );
    expect(screen.getByTestId("qg-0-q-0-blank-badge").textContent).toContain(
      "questionBank.group.questions.blankN:2",
    );
    expect(screen.queryByTestId("qg-0-q-0-stem")).toBeNull();
    expect(screen.queryByTestId("qg-0-q-0-stem-image")).toBeNull();
  });

  it("非克漏字仍有題幹文字框與題號", () => {
    const g = clozeDraft(doc("a {{1}} b"), [1]);
    render(
      <QuestionCard
        index={0}
        draft={g.questions[0]}
        onChange={vi.fn()}
        ttsSettings={tts}
        programs={[]}
        errorMessage={null}
        testIdPrefix="qg-0-q"
        compact
      />,
    );
    expect(screen.getByTestId("qg-0-q-0-stem")).toBeTruthy();
    expect(screen.queryByTestId("qg-0-q-0-blank-badge")).toBeNull();
  });
});

// -------------------------------------------------------- GroupCard 整合

describe("GroupCard 克漏字", () => {
  it("把 clozeMode 與下一個編號傳給 LayoutEditor", () => {
    render(<Harness initial={clozeDraft(doc("a {{1}} b"), [1])} />);
    const stub = screen.getByTestId("qg-0-layout-stub");
    expect(stub.dataset.cloze).toBe("1");
    expect(stub.dataset.nextBlank).toBe("2");
  });

  it("填好選項與答案的克漏字小題不顯示 stemRequired", () => {
    // 卡片層驗證要帶 stemOptional：克漏字小題沒有自己的題幹（題幹是文章的空格）
    render(<Harness initial={filledClozeDraft(doc("a {{1}} b"), [1])} />);
    expect(screen.queryByTestId("qg-0-q-0-error")).toBeNull();
    expect(
      screen.queryByText(/questionBank\.form\.errors\.stemRequired/),
    ).toBeNull();
  });

  it("閱讀題組不開啟 clozeMode，且小題有拖曳把手", () => {
    const g: GroupDraft = {
      ...emptyGroupDraft("reading"),
      layout: doc("plain"),
      visibility: "private",
    };
    render(<Harness initial={{ ...g, questions: [emptyGroupQuestion(g)] }} />);
    expect(screen.getByTestId("qg-0-layout-stub").dataset.cloze).toBe("0");
    expect(
      screen.getByLabelText("questionBank.group.questions.drag"),
    ).toBeTruthy();
  });

  it("克漏字小題依編號排序且沒有拖曳把手", () => {
    render(<Harness initial={clozeDraft(doc("a {{2}} b {{1}} c"), [2, 1])} />);
    const badges = screen
      .getAllByTestId(/^qg-0-q-\d+-blank-badge$/)
      .map((el) => el.textContent);
    expect(badges).toEqual([
      "questionBank.group.questions.blankN:1",
      "questionBank.group.questions.blankN:2",
    ]);
    expect(
      screen.queryByLabelText("questionBank.group.questions.drag"),
    ).toBeNull();
  });

  it("排版新增空格 → 自動建小題卡", async () => {
    const user = userEvent.setup();
    render(<Harness initial={clozeDraft(doc("a {{1}} b"), [1])} />);
    await user.click(screen.getByTestId("qg-0-layout-stub"));
    expect(screen.getAllByTestId(/^qg-0-q-\d+-blank-badge$/)).toHaveLength(2);
  });

  it("「在文末插入空格」加空格也加卡片", async () => {
    const user = userEvent.setup();
    render(<Harness initial={clozeDraft(doc("a {{1}} b"), [1])} />);
    await user.click(screen.getByTestId("qg-0-add-question"));
    expect(screen.getByTestId("qg-0-layout-stub").dataset.blanks).toBe("1,2");
    expect(screen.getAllByTestId(/^qg-0-q-\d+-blank-badge$/)).toHaveLength(2);
  });

  it("小題找不到空格 → 警告＋重新插入／刪除小題", async () => {
    const user = userEvent.setup();
    // 文章只有 {{1}}，小題卻有 1、2
    render(<Harness initial={clozeDraft(doc("a {{1}} b"), [1, 2])} />);
    const warn = screen.getByTestId("qg-0-q-1-blank-missing");
    expect(warn.textContent).toContain(
      "questionBank.group.questions.blankMissing:2",
    );
    await user.click(screen.getByTestId("qg-0-q-1-reinsert-blank"));
    expect(screen.getByTestId("qg-0-layout-stub").dataset.blanks).toBe("1,2");
    expect(screen.queryByTestId("qg-0-q-1-blank-missing")).toBeNull();
  });

  it("刪除小題也能解決找不到空格", async () => {
    const user = userEvent.setup();
    render(<Harness initial={clozeDraft(doc("a {{1}} b"), [1, 2])} />);
    await user.click(screen.getByTestId("qg-0-q-1-remove-blank"));
    expect(screen.getAllByTestId(/^qg-0-q-\d+-blank-badge$/)).toHaveLength(1);
    expect(screen.queryByTestId("qg-0-q-1-blank-missing")).toBeNull();
  });

  it("「依閱讀順序重新編號」只在編號不是 1..k 時出現，按下後文章與小題一起改", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={clozeDraft(doc("x {{40}} y", "z {{41}} w"), [41, 40])}
      />,
    );
    await user.click(screen.getByTestId("qg-0-renumber-blanks"));
    expect(screen.getByTestId("qg-0-layout-stub").dataset.blanks).toBe("1,2");
    expect(
      screen
        .getAllByTestId(/^qg-0-q-\d+-blank-badge$/)
        .map((e) => e.textContent),
    ).toEqual([
      "questionBank.group.questions.blankN:1",
      "questionBank.group.questions.blankN:2",
    ]);
    expect(screen.queryByTestId("qg-0-renumber-blanks")).toBeNull();
  });
});
