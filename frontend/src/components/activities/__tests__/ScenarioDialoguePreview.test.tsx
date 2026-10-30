/**
 * 派發預覽改用對話式 UI 之後，真的掛得起來（Issue #1140 Stage 2）。
 *
 * 資料對映已經由 `scenario-dialogue/__tests__/fromApi.test.ts` 逐欄驗過；這支守的是
 * **接線**：預覽元件把 context／items／settings／adapters 餵給學生端同一個
 * `ScenarioChatActivity`，而且
 *
 * 1. 預覽**不打 AI**（不扣老師點數，preview-architecture.md 的既有規則）；
 * 2. 沒有教材時說明原因，不借示範單字集。
 *
 * 不斷言版面細節 —— 那是 `ScenarioChatActivity` 自己的事，寫在這裡只會因為改 UI 就碎。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getContentDetail = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    getContentDetail: (...args: unknown[]) => getContentDetail(...args),
  },
}));

import ScenarioDialoguePreview from "../ScenarioDialoguePreview";

const DETAIL = {
  id: 501,
  title: "週末計畫",
  type: "SCENARIO_DIALOGUE",
  scenario_settings: {
    scenario_content: "你和朋友在討論這個週末要做什麼。",
    global_rubric: "請用完整句子回答。",
    translate_language: "chinese",
    question_level: "A2",
  },
  items: [
    {
      id: 9001,
      text: "What did you do last weekend?",
      translation: "你上週末做了什麼？",
      scenario_dialogue: {
        keywords: ["went"],
        rubric_note: "",
        reference_answer: "I went to a movie with my cousin.",
        image_prompt: "a cinema",
        tense_override: null,
        voice_override: null,
      },
    },
  ],
};

beforeEach(() => {
  getContentDetail.mockReset();
  getContentDetail.mockResolvedValue(DETAIL);
});

/** 「開始對話」鈕：測試環境沒有 i18next 實例，t() 會回 key 本身。 */
function startButton(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find((b) =>
    /chat\.start|開始對話/.test(b.textContent || ""),
  ) as HTMLButtonElement | undefined;
}

describe("ScenarioDialoguePreview", () => {
  it("掛上對話式作答畫面：開始前顯示情境與「開始對話」", async () => {
    render(<ScenarioDialoguePreview contentId={501} showTranslation />);
    // 情境卡在 <lg 與 ≥lg 各渲染一份（CSS 決定顯示哪一份），所以用 getAllByText
    await waitFor(() =>
      expect(
        screen.getAllByText(/你和朋友在討論這個週末要做什麼。/).length,
      ).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/請用完整句子回答。/).length).toBeGreaterThan(0);
    expect(getContentDetail).toHaveBeenCalledWith(501);
    expect(startButton()).toBeTruthy();
  });

  it("按下「開始對話」才問第一題（與設計稿的流程一致）", async () => {
    const user = userEvent.setup();
    render(<ScenarioDialoguePreview contentId={501} showTranslation />);
    await waitFor(() => expect(startButton()).toBeTruthy());

    // 開始之前不該有題目
    expect(screen.queryByText(/What did you do last weekend\?/)).toBeNull();

    await user.click(startButton()!);
    await waitFor(() =>
      expect(
        screen.getAllByText(/What did you do last weekend\?/).length,
      ).toBeGreaterThan(0),
    );
  });

  it("換教材會重新開始，不帶著舊教材的對話", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ScenarioDialoguePreview contentId={501} showTranslation />,
    );
    await waitFor(() => expect(startButton()).toBeTruthy());
    await user.click(startButton()!);
    await waitFor(() =>
      expect(
        screen.getAllByText(/What did you do last weekend\?/).length,
      ).toBeGreaterThan(0),
    );

    getContentDetail.mockResolvedValue({
      ...DETAIL,
      id: 777,
      title: "另一份教材",
      items: [{ ...DETAIL.items[0], id: 7001, text: "Where did you go?" }],
    });
    rerender(<ScenarioDialoguePreview contentId={777} showTranslation />);

    // 回到「開始對話」那一步，而且舊教材的題目不該還留在對話裡
    await waitFor(() => expect(startButton()).toBeTruthy());
    expect(screen.queryByText(/What did you do last weekend\?/)).toBeNull();
  });

  it("預覽欄用單欄（compact）：情境卡只排一份，不分左欄（#1158 E2）", async () => {
    render(<ScenarioDialoguePreview contentId={501} showTranslation />);
    await waitFor(() => expect(startButton()).toBeTruthy());
    expect(document.querySelector('[data-layout="compact"]')).not.toBeNull();
    expect(document.querySelector("aside")).toBeNull();
    expect(
      screen.getAllByText(/你和朋友在討論這個週末要做什麼。/),
    ).toHaveLength(1);
    // 右側留白讓開數位教學工具列
    expect(screen.getByTestId("scenario-preview-frame").className).toMatch(
      /pr-8/,
    );
  });

  it("預覽欄有題號方格：開始前全部鎖住，開始後可跳題、目前題標示（#1158 E-1 修正）", async () => {
    const user = userEvent.setup();
    getContentDetail.mockResolvedValue({
      ...DETAIL,
      items: [
        DETAIL.items[0],
        { ...DETAIL.items[0], id: 9002, text: "Who did you go with?" },
      ],
    });
    render(<ScenarioDialoguePreview contentId={501} showTranslation />);
    await waitFor(() => expect(startButton()).toBeTruthy());
    expect(screen.getByTestId("scenario-question-nav")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-nav-1")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByTestId("scenario-nav-2")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await user.click(startButton()!);
    await waitFor(() =>
      expect(screen.getByTestId("scenario-nav-1")).toHaveAttribute(
        "aria-current",
        "step",
      ),
    );
    expect(screen.getByTestId("scenario-nav-2")).not.toHaveAttribute(
      "aria-disabled",
    );
    await user.click(screen.getByTestId("scenario-nav-2"));
    await waitFor(() =>
      expect(screen.getByTestId("scenario-nav-2")).toHaveAttribute(
        "aria-current",
        "step",
      ),
    );
  });

  it("沒有 contentId 時說明原因，不去抓任何教材", () => {
    render(<ScenarioDialoguePreview />);
    expect(getContentDetail).not.toHaveBeenCalled();
    expect(
      screen.getByText(/scenarioPreviewNeedsContent|請先選擇/),
    ).toBeInTheDocument();
  });

  it("教材沒有題目時說明原因", async () => {
    getContentDetail.mockResolvedValue({ ...DETAIL, items: [] });
    render(<ScenarioDialoguePreview contentId={501} />);
    await waitFor(() =>
      expect(
        screen.getByText(/scenarioPreviewEmpty|沒有題目/),
      ).toBeInTheDocument(),
    );
  });

  it("抓教材失敗時顯示錯誤，不是一片空白", async () => {
    getContentDetail.mockRejectedValue(new Error("boom"));
    render(<ScenarioDialoguePreview contentId={501} />);
    await waitFor(() =>
      expect(screen.getByText(/previewLoadFailed|boom/)).toBeInTheDocument(),
    );
  });
});
