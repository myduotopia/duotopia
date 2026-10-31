/**
 * 情境對話的作答頁外框（#1158 E1）：
 *
 * - 不顯示頂部列「提交」、外層進度條、卡片標題；
 * - 保留題號方格並接到對話：還沒到的題目 aria-disabled，點了提示「還沒到這題」、不會動；
 *   已出現的題目點了捲到那一題；目前這題標示（aria-current）跟著對話進度更新；
 *   老師預覽開始對話前全部不能點，開始後可以跳題；
 * - 其他作答模式的方格行為不變（迴歸）。
 * - #1158 E-3：情境對話要求學生版面窄螢幕隱藏標題列（其他模式不要求）；題號列只留方格
 *   （不顯示內容標題與「N 題」）。
 */
import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StudentActivityPageContent from "../StudentActivityPageContent";
import { StudentLayoutChromeContext } from "@/contexts/StudentLayoutChromeContext";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
  Element.prototype.scrollTo =
    vi.fn() as unknown as typeof Element.prototype.scrollTo;
  Object.defineProperty(window, "scrollTo", {
    value: () => {},
    writable: true,
  });
});

const scenarioActivities = [
  {
    id: 1,
    content_id: 1,
    order: 1,
    type: "SCENARIO_DIALOGUE",
    title: "週末計畫",
    content: "",
    target_text: "",
    duration: 300,
    points: 10,
    status: "IN_PROGRESS",
    score: null,
    completed_at: null,
    scenario_settings: {
      scenario_content: "你和朋友在討論這個週末要做什麼。",
      global_rubric: "請用完整句子回答。",
    },
    items: [
      { id: 9001, text: "What did you do last weekend?" },
      { id: 9002, text: "Who did you go with?" },
      { id: 9003, text: "How was it?" },
    ],
  },
];

/** 沒有作答要求：按「開始對話」直接出第 1 題（有作答要求時先倒數，見 rubricCountdown.test） */
const noRubricActivities = [
  {
    ...scenarioActivities[0],
    scenario_settings: {
      scenario_content:
        scenarioActivities[0].scenario_settings.scenario_content,
      global_rubric: "",
    },
  },
];

function renderScenario(isPreviewMode = false, withRubric = true) {
  return render(
    <StudentActivityPageContent
      activities={
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (withRubric ? scenarioActivities : noRubricActivities) as any
      }
      assignmentTitle="情境作業"
      assignmentId={1}
      practiceMode="scenario_dialogue"
      isPreviewMode={isPreviewMode}
      onSubmit={vi.fn()}
    />,
  );
}

const navButton = (no: number) => screen.getByTestId(`scenario-nav-${no}`);
const startButton = () =>
  screen.getByRole("button", { name: "scenarioDialogue.chat.start" });

describe("StudentActivityPageContent — 情境對話外框（#1158 E1）", () => {
  test("不顯示頂部提交鈕、進度條與卡片標題", () => {
    renderScenario();
    expect(
      screen.queryByRole("button", {
        name: /studentActivityPage\.buttons\.submit/,
      }),
    ).toBeNull();
    expect(document.querySelector('[role="progressbar"]')).toBeNull();
    expect(
      screen.queryByText(/studentActivityPage\.labels\.questionNumber/),
    ).toBeNull();
    // 方格保留
    expect(navButton(1)).toBeInTheDocument();
    expect(navButton(3)).toBeInTheDocument();
  });

  test("開始前：全部題號不能點，點了提示「還沒到這題」、不會捲動", async () => {
    const user = userEvent.setup();
    renderScenario();
    for (const no of [1, 2, 3]) {
      expect(navButton(no)).toHaveAttribute("aria-disabled", "true");
    }
    expect(screen.queryByText("scenarioDialogue.chat.notYet")).toBeNull();
    await user.click(navButton(2));
    expect(
      screen.getByText("scenarioDialogue.chat.notYet"),
    ).toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  test("學生開始對話後：第 1 題標示目前、可點並捲到該題；未到的題目仍鎖住", async () => {
    const user = userEvent.setup();
    renderScenario(false, false);
    await user.click(startButton());

    await waitFor(() =>
      expect(navButton(1)).toHaveAttribute("aria-current", "step"),
    );
    // 等第 1 題出現在對話裡（打字中 → 出題）才算「已出現」
    await waitFor(() =>
      expect(
        screen.getAllByText(/What did you do last weekend\?/).length,
      ).toBeGreaterThan(0),
    );
    expect(navButton(1)).not.toHaveAttribute("aria-disabled");
    expect(navButton(2)).toHaveAttribute("aria-disabled", "true");
    scrollIntoView.mockClear();
    await user.click(navButton(1));
    expect(scrollIntoView).toHaveBeenCalled();

    scrollIntoView.mockClear();
    await user.click(navButton(3));
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(
      screen.getByText("scenarioDialogue.chat.notYet"),
    ).toBeInTheDocument();
  });

  test("老師預覽：開始前鎖住；開始後可跳題，目前題標示跟著更新", async () => {
    const user = userEvent.setup();
    renderScenario(true, false);
    expect(navButton(3)).toHaveAttribute("aria-disabled", "true");

    await user.click(startButton());
    await waitFor(() =>
      expect(navButton(1)).toHaveAttribute("aria-current", "step"),
    );
    expect(navButton(3)).not.toHaveAttribute("aria-disabled");

    await user.click(navButton(3));
    await waitFor(() =>
      expect(navButton(3)).toHaveAttribute("aria-current", "step"),
    );
    expect(navButton(1)).not.toHaveAttribute("aria-current");
  });

  test("重新進入：已答（綠）但對話還沒走到的題目點了不跳，提示「已作答，對話到這題後可查看」", async () => {
    const user = userEvent.setup();
    const acts = [
      {
        ...scenarioActivities[0],
        items: [
          scenarioActivities[0].items[0],
          {
            ...scenarioActivities[0].items[1],
            recording_url: "https://example.com/a.webm",
          },
          scenarioActivities[0].items[2],
        ],
      },
    ];
    render(
      <StudentActivityPageContent
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        activities={acts as any}
        assignmentTitle="情境作業"
        assignmentId={1}
        practiceMode="scenario_dialogue"
        onSubmit={vi.fn()}
      />,
    );
    const btn = navButton(2);
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn.className).toMatch(/bg-green-100/);
    expect(btn).toHaveAttribute(
      "aria-label",
      "scenarioDialogue.chat.dotAnsweredLocked",
    );
    await user.click(btn);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(
      screen.getByText("scenarioDialogue.chat.answeredNotReached"),
    ).toBeInTheDocument();
    expect(screen.queryByText("scenarioDialogue.chat.notYet")).toBeNull();
  });

  test("已提交重開：顯示作答紀錄、沒有「開始對話」；題號每題都能點並捲到該題（#1158 E6）", async () => {
    const user = userEvent.setup();
    render(
      <StudentActivityPageContent
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        activities={scenarioActivities as any}
        assignmentTitle="情境作業"
        assignmentId={1}
        practiceMode="scenario_dialogue"
        assignmentStatus="SUBMITTED"
        onSubmit={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("scenario-submitted-transcript"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "scenarioDialogue.chat.start" }),
    ).toBeNull();
    await waitFor(() =>
      expect(navButton(3)).not.toHaveAttribute("aria-disabled"),
    );
    await user.click(navButton(3));
    expect(scrollIntoView).toHaveBeenCalled();
  });

  test("題號列只留方格：不顯示內容標題與「N 題」（#1158 E-3）", () => {
    renderScenario();
    // 內容標題只出現在情境卡裡（情境卡標題＝活動標題），題號列沒有
    for (const el of screen.queryAllByText("週末計畫")) {
      expect(
        el.closest('section[aria-label="scenarioDialogue.chat.scenario"]'),
      ).not.toBeNull();
    }
    expect(
      screen.queryByText("studentActivityPage.labels.itemCount"),
    ).toBeNull();
    expect(navButton(1)).toBeInTheDocument();
  });

  test("要求學生版面窄螢幕隱藏標題列，卸載時恢復（#1158 E-3）", () => {
    const setHideHeaderOnMobile = vi.fn();
    const { unmount } = render(
      <StudentLayoutChromeContext.Provider value={{ setHideHeaderOnMobile }}>
        <StudentActivityPageContent
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          activities={scenarioActivities as any}
          assignmentTitle="情境作業"
          assignmentId={1}
          practiceMode="scenario_dialogue"
          onSubmit={vi.fn()}
        />
      </StudentLayoutChromeContext.Provider>,
    );
    expect(setHideHeaderOnMobile).toHaveBeenLastCalledWith(true);
    unmount();
    expect(setHideHeaderOnMobile).toHaveBeenLastCalledWith(false);
  });

  test("預覽：對話裡沒有上一題／下一題按鈕", () => {
    renderScenario(true);
    expect(
      screen.queryByRole("button", {
        name: /studentActivityPage\.buttons\.(previous|next)/,
      }),
    ).toBeNull();
  });
});

describe("StudentActivityPageContent — 其他模式的方格不變（迴歸）", () => {
  test("題組：方格可直接點、沒有 aria-disabled，頂部提交鈕與進度條照舊", async () => {
    const activities = [
      {
        id: 1,
        content_id: 1,
        order: 1,
        type: "grouped_questions",
        title: "Test Activity",
        content: "Test content",
        target_text: "Test text",
        duration: 300,
        points: 10,
        status: "IN_PROGRESS",
        score: null,
        completed_at: null,
        items: [
          { id: 101, text: "Item 1" },
          { id: 102, text: "Item 2" },
        ],
      },
    ];
    const setHideHeaderOnMobile = vi.fn();
    render(
      <StudentLayoutChromeContext.Provider value={{ setHideHeaderOnMobile }}>
        <StudentActivityPageContent
          activities={activities}
          assignmentTitle="Test"
          assignmentId={1}
          onSubmit={vi.fn()}
        />
      </StudentLayoutChromeContext.Provider>,
    );
    // #1158 E-3：其他模式不隱藏學生版面標題列，題號列照舊有內容標題與「N 題」
    expect(setHideHeaderOnMobile).not.toHaveBeenCalled();
    expect(screen.getAllByText("Test Activity").length).toBeGreaterThan(0);
    expect(
      screen.getByText("studentActivityPage.labels.itemCount"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("scenario-nav-1")).toBeNull();
    const item2 = screen.getByRole("button", { name: "2" });
    expect(item2).not.toHaveAttribute("aria-disabled");
    expect(item2).not.toBeDisabled();
    expect(document.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(
      screen.getAllByText("studentActivityPage.buttons.submit").length,
    ).toBeGreaterThan(0);
  });
});
