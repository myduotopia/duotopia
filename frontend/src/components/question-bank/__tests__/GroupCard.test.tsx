/**
 * GroupCard 元件測試（Issue #1082 第 3 段；第 2 段修訂加：無素材類型下拉、小題 compact）。
 *
 * LayoutEditor 與 QuestionCard 各自有測試，這裡以 stub 取代，只測題組卡本身：
 * 標題／單字註解文字框（一行一筆）、沒中文的行送出前被丟掉、小題新增／刪除、
 * `layoutIncomplete` 讓 validateGroupDraft 阻擋儲存、錯誤訊息顯示、readOnly。
 */

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import GroupCard from "../GroupCard";
import {
  emptyGroupDraft,
  emptyGroupQuestion,
  toCreateGroupInput,
  validateGroupDraft,
  type GroupDraft,
} from "../questionDraft";
import type { TTSSettingsState } from "@/components/shared/BatchTTSSettings";
import type { LayoutDoc } from "@/types/questionBank";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      key === "questionBank.group.questions.title"
        ? `sub-questions ${opts?.count}`
        : key,
    i18n: { language: "zh-TW" },
  }),
}));

vi.mock("../LayoutEditor", () => ({
  default: ({
    layout,
    onChange,
    testId,
  }: {
    layout: LayoutDoc | null;
    onChange: (l: LayoutDoc | null) => void;
    testId: string;
  }) => (
    <button
      type="button"
      data-testid={`${testId}-stub`}
      data-rows={layout?.rows.length ?? 0}
      onClick={() =>
        onChange({
          version: 1,
          rows: [
            {
              columns: [
                { span: 1, blocks: [{ type: "paragraph", text: "P" }] },
              ],
            },
          ],
        })
      }
    >
      layout-stub
    </button>
  ),
}));

vi.mock("../QuestionCard", () => ({
  default: ({
    index,
    onRemove,
    compact,
  }: {
    index: number;
    onRemove?: () => void;
    compact?: boolean;
  }) => (
    <div data-testid={`qc-stub-${index}`} data-compact={compact || undefined}>
      question-card-stub
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          data-testid={`qc-stub-${index}-remove`}
        >
          remove
        </button>
      )}
    </div>
  ),
}));

vi.mock("@/components/shared/GradeRangeSlider", () => ({
  GradeRangeSlider: ({ value }: { value: [number | null, number | null] }) => (
    <div data-testid="grade-stub">{String(value)}</div>
  ),
}));

const tts: TTSSettingsState = {
  accent: "en-US",
  voice: "en-US-JennyNeural",
  speed: 1,
} as unknown as TTSSettingsState;

function lastDraft(onDraft: ReturnType<typeof vi.fn>): GroupDraft {
  const calls = onDraft.mock.calls;
  return calls[calls.length - 1][0] as GroupDraft;
}

/** 受控包裝：把 onChange 寫回 state，讓卡片像在 sheet 裡一樣可互動 */
function Harness({
  initial,
  onDraft,
  readOnly,
}: {
  initial: GroupDraft;
  onDraft?: (d: GroupDraft) => void;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <GroupCard
      index={0}
      draft={draft}
      onChange={(next) => {
        setDraft(next);
        onDraft?.(next);
      }}
      ttsSettings={tts}
      programs={[]}
      errorMessage={null}
      readOnly={readOnly}
    />
  );
}

describe("GroupCard", () => {
  it("標題輸入、單字註解文字框一行一筆；沒中文的行送出前被丟掉", async () => {
    const onDraft = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={emptyGroupDraft()} onDraft={onDraft} />);

    await user.type(screen.getByTestId("qg-0-title"), "Vivaldi");
    const box = screen.getByTestId("qg-0-glossary");
    await user.type(box, "timeline 時間軸{enter}compose");
    let draft = lastDraft(onDraft);
    expect(draft.title).toBe("Vivaldi");
    expect(draft.glossary).toEqual([
      { word: "timeline", zh: "時間軸" },
      { word: "compose", zh: "" },
    ]);
    expect(toCreateGroupInput(draft).glossary).toEqual([
      { word: "timeline", zh: "時間軸" },
    ]);
    // 文字框保留打到一半的內容
    expect(box).toHaveValue("timeline 時間軸
compose");

    await user.clear(box);
    draft = lastDraft(onDraft);
    expect(toCreateGroupInput(draft).glossary).toBeNull();
    expect(screen.queryByTestId("qg-0-glossary-add")).toBeNull();
  });

  it("沒有素材類型下拉；小題以 compact（不包外框）呈現", async () => {
    const user = userEvent.setup();
    render(<Harness initial={emptyGroupDraft()} />);
    expect(screen.queryByTestId("qg-0-stimulus")).toBeNull();
    await user.click(screen.getByTestId("qg-0-add-question"));
    expect(await screen.findByTestId("qc-stub-0")).toHaveAttribute(
      "data-compact",
      "true",
    );
  });

  it("新增小題 → 出現小題卡並帶題組年段；刪除小題 → 移除", async () => {
    const onDraft = vi.fn();
    const user = userEvent.setup();
    const initial = { ...emptyGroupDraft(), grade: [7, 9] as [number, number] };
    render(<Harness initial={initial} onDraft={onDraft} />);
    expect(screen.getByText("questionBank.group.questions.empty")).toBeTruthy();

    await user.click(screen.getByTestId("qg-0-add-question"));
    expect(await screen.findByTestId("qc-stub-0")).toBeTruthy();
    let draft = lastDraft(onDraft);
    expect(draft.questions).toHaveLength(1);
    expect(draft.questions[0].groupKey).toBe(draft.key);
    expect(draft.questions[0].grade).toEqual([7, 9]);
    expect(screen.getByText("sub-questions 1")).toBeTruthy();

    await user.click(screen.getByTestId("qc-stub-0-remove"));
    draft = lastDraft(onDraft);
    expect(draft.questions).toHaveLength(0);
  });

  it("LayoutEditor 的 onChange 回寫 draft.layout 並清掉 serverError", async () => {
    const onDraft = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness
        initial={{ ...emptyGroupDraft(), serverError: "boom" }}
        onDraft={onDraft}
      />,
    );
    expect(screen.getByTestId("qg-0-layout-stub")).toHaveAttribute(
      "data-rows",
      "0",
    );
    await user.click(screen.getByTestId("qg-0-layout-stub"));
    const draft = lastDraft(onDraft);
    expect(draft.layout?.rows).toHaveLength(1);
    expect(draft.serverError).toBeNull();
  });

  it("errorMessage 顯示在卡片底部；readOnly 隱藏新增小題／新增註解", () => {
    const { rerender } = render(
      <GroupCard
        index={0}
        draft={emptyGroupDraft()}
        onChange={vi.fn()}
        ttsSettings={tts}
        programs={[]}
        errorMessage="layout incomplete!"
      />,
    );
    expect(screen.getByTestId("qg-0-error")).toHaveTextContent(
      "layout incomplete!",
    );
    rerender(
      <GroupCard
        index={0}
        draft={emptyGroupDraft()}
        onChange={vi.fn()}
        ttsSettings={tts}
        programs={[]}
        errorMessage={null}
        readOnly
      />,
    );
    expect(screen.queryByTestId("qg-0-error")).toBeNull();
    expect(screen.queryByTestId("qg-0-add-question")).toBeNull();
    expect(screen.queryByTestId("qg-0-glossary-add")).toBeNull();
  });
});

describe("validateGroupDraft（儲存前的阻擋）", () => {
  function completeGroup(): GroupDraft {
    const g = emptyGroupDraft();
    g.layout = {
      version: 1,
      rows: [
        {
          columns: [
            { span: 1, blocks: [{ type: "paragraph", text: "Passage" }] },
          ],
        },
      ],
    };
    g.visibility = "private";
    const q = emptyGroupQuestion(g);
    q.stem = "Q1";
    q.options[0] = { text: "A", is_correct: true, image_url: null };
    q.options[1] = { text: "B", is_correct: false, image_url: null };
    q.exam_points = [
      {
        id: 3,
        code: "grammar.tense.present_perfect",
        parent_id: null,
        names: { "zh-TW": "現在完成式" },
        status: "active",
        order_index: 0,
        aliases: [],
      },
    ];
    g.questions = [q];
    return g;
  }

  it("排版有沒填完的區塊 → layoutIncomplete；填完就通過", () => {
    const g = completeGroup();
    expect(validateGroupDraft(g)).toBeNull();

    const incomplete = completeGroup();
    incomplete.layout!.rows.push({
      columns: [{ span: 1, blocks: [{ type: "image", url: "", alt: "" }] }],
    });
    expect(validateGroupDraft(incomplete)).toBe("layoutIncomplete");

    const emptyDialogue = completeGroup();
    emptyDialogue.layout!.rows.push({
      columns: [
        {
          span: 1,
          blocks: [{ type: "dialogue", lines: [{ speaker: "A", text: "" }] }],
        },
      ],
    });
    expect(validateGroupDraft(emptyDialogue)).toBe("layoutIncomplete");
  });

  it("沒有主圖文 → groupNeedsContent；沒有小題 → groupNeedsQuestions", () => {
    const noStimulus = completeGroup();
    noStimulus.layout = null;
    expect(validateGroupDraft(noStimulus)).toBe("groupNeedsContent");

    const noQuestions = completeGroup();
    noQuestions.questions = [];
    expect(validateGroupDraft(noQuestions)).toBe("groupNeedsQuestions");
  });
});
