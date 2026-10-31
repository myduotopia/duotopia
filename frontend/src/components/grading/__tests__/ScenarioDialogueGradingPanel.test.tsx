/**
 * 情境對話批改 Panel 的 AI 建議 — Issue #1035。
 *
 * 這裡要守的是「AI 只給建議」這條線：畫面上不能出現任何讓老師以為分數已經定案的
 * 東西，而且 AI 建議按鈕不會去動通過／不通過。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScenarioDialogueGradingPanel } from "../ScenarioDialogueGradingPanel";
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

const getContentDetail = vi.fn();
vi.mock("@/lib/api", () => ({
  apiClient: {
    getContentDetail: (...args: unknown[]) => getContentDetail(...args),
  },
}));

const ITEM: SubmissionItem = {
  question_text: "What did you do last weekend?",
  audio_url: "https://storage.googleapis.com/b/recordings/a.webm",
  item_progress_id: 42,
  scenario_dialogue: {
    keywords: ["went"],
    rubric_note: "",
    reference_answer: "I went to the park.",
    tense: { time: "past", aspect: "simple" },
    voice: "active",
  },
};

const makeSubmission = (items: SubmissionItem[]): StudentSubmission =>
  ({
    student_number: 1,
    student_name: "S",
    student_email: "s@example.com",
    status: "SUBMITTED",
    content_type: "scenario_dialogue",
    submissions: items,
  }) as StudentSubmission;

function renderPanel(
  items: SubmissionItem[],
  over: Partial<React.ComponentProps<typeof ScenarioDialogueGradingPanel>> = {},
) {
  const props = {
    submission: makeSubmission(items),
    selectedGroupIndex: 0,
    expandedRows: new Set([0]),
    activeTab: "content" as const,
    itemFeedbacks: {},
    onToggleRow: vi.fn(),
    onTogglePassed: vi.fn(),
    onItemFeedbackChange: vi.fn(),
    onAutoSave: vi.fn(),
    gradingItems: new Set<number>(),
    onAiGrade: vi.fn(),
    ...over,
  };
  render(<ScenarioDialogueGradingPanel {...props} />);
  return props;
}

describe("ScenarioDialogueGradingPanel — AI 建議", () => {
  it("按下 AI 建議不會改動通過／不通過", async () => {
    const props = renderPanel([ITEM]);
    await userEvent.click(
      screen.getByRole("button", {
        name: /gradingPage.scenarioDialogue.aiGrade/,
      }),
    );
    expect(props.onAiGrade).toHaveBeenCalledWith(42, false);
    // AI 不替老師定案
    expect(props.onTogglePassed).not.toHaveBeenCalled();
  });

  it("已經有建議時再按會帶 force，讓後端知道要重跑", async () => {
    const props = renderPanel([
      {
        ...ITEM,
        scenario_grading: {
          transcript: "I went to the park.",
          scores: { content: 80, grammar: 70, vocabulary: 75, keywords: 100 },
          overall: 78,
          feedback: "不錯",
          suggested_pass: true,
          cached: true,
        },
      },
    ]);
    await userEvent.click(
      screen.getByRole("button", {
        name: /gradingPage.scenarioDialogue.aiGradeAgain/,
      }),
    );
    expect(props.onAiGrade).toHaveBeenCalledWith(42, true);
  });

  it("沒評到的面向顯示破折號，不顯示 0 分", () => {
    renderPanel([
      {
        ...ITEM,
        scenario_grading: {
          transcript: "hello",
          // grammar 這次沒評出來
          scores: { content: 80, grammar: null },
          overall: null,
          feedback: "",
          cached: false,
        },
      },
    ]);
    // 0 分是「答得很差」，沒評到是「這次沒有這個面向的資訊」，不能混為一談
    expect(screen.queryByText(/grammar 0$/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/gradingPage.scenarioDialogue.aspects.grammar —/),
    ).toBeInTheDocument();
  });

  it("沒有錄音就不給 AI 按鈕（按了必定失敗）", () => {
    renderPanel([{ ...ITEM, audio_url: undefined }]);
    expect(
      screen.queryByRole("button", {
        name: /gradingPage.scenarioDialogue.aiGrade/,
      }),
    ).not.toBeInTheDocument();
  });

  it("跑分析中時按鈕不能重複按", () => {
    renderPanel([ITEM], { gradingItems: new Set([42]) });
    expect(
      screen.getByRole("button", {
        name: /gradingPage.scenarioDialogue.aiGrade/,
      }),
    ).toBeDisabled();
  });

  it("建議區塊一定要標明這只是建議", () => {
    renderPanel([
      {
        ...ITEM,
        scenario_grading: {
          transcript: "hi",
          scores: { content: 90 },
          overall: 90,
          feedback: "",
          suggested_pass: true,
          cached: false,
        },
      },
    ]);
    expect(
      screen.getByText("gradingPage.scenarioDialogue.aiSuggestionHint"),
    ).toBeInTheDocument();
  });
});

describe("ScenarioDialogueGradingPanel — 已完成批改", () => {
  it("作業批改完成後不再給 AI 按鈕燒 token", () => {
    const submission = makeSubmission([ITEM]);
    render(
      <ScenarioDialogueGradingPanel
        submission={{ ...submission, status: "GRADED" }}
        selectedGroupIndex={0}
        expandedRows={new Set([0])}
        activeTab="content"
        itemFeedbacks={{}}
        onToggleRow={vi.fn()}
        onTogglePassed={vi.fn()}
        onItemFeedbackChange={vi.fn()}
        onAutoSave={vi.fn()}
        gradingItems={new Set()}
        onAiGrade={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: /gradingPage.scenarioDialogue.aiGrade/,
      }),
    ).toBeDisabled();
  });
});

describe("ScenarioDialogueGradingPanel — 情境卡（#1158 E5）", () => {
  it("依 content_id 抓情境，顯示情境文章與情境圖", async () => {
    getContentDetail.mockResolvedValue({
      id: 77,
      title: "週末去夜市",
      items: [],
      scenario_settings: {
        scenario_content: "Amy went to the night market.",
        scenario_images: ["https://example.com/s1.jpg"],
      },
    });
    const submission = {
      ...makeSubmission([]),
      content_groups: [
        {
          content_id: 77,
          content_title: "週末去夜市",
          submissions: [ITEM],
        },
      ],
    } as StudentSubmission;
    renderPanel([ITEM], { submission });
    await waitFor(() =>
      expect(
        screen.getByText("Amy went to the night market."),
      ).toBeInTheDocument(),
    );
    expect(getContentDetail).toHaveBeenCalledWith(77);
    const img = document.querySelector('img[src="https://example.com/s1.jpg"]');
    expect(img).not.toBeNull();
  });

  it("沒有 content_groups 時不抓、不顯示情境卡", () => {
    getContentDetail.mockClear();
    renderPanel([ITEM]);
    expect(getContentDetail).not.toHaveBeenCalled();
    expect(
      screen.queryByLabelText("scenarioDialogue.chat.scenario"),
    ).toBeNull();
  });
});
