/**
 * ScenarioDialoguePanel — 兩步驟流程（#944）
 *
 * 重點在「兩步共用同一份 state」與「儲存擋關會把老師帶回出問題的那一步」：
 * 這兩件事壞掉的時候畫面看起來都還是正常的，只有操作到一半才會發現，
 * 所以用測試釘住。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRef, type ReactNode } from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import ScenarioDialoguePanel, {
  type ScenarioDialoguePanelHandle,
} from "../ScenarioDialoguePanel";
import { SidebarProvider } from "@/contexts/SidebarContext";

const mockToastError = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

// t 回傳 key 本身，測試就用 key 當選取器
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <SidebarProvider>{children}</SidebarProvider>
);

const K = {
  stepSettings: "scenarioDialogue.steps.settings",
  stepQuestions: "scenarioDialogue.steps.questions",
  skip: "scenarioDialogue.buttons.skipGeneration",
  generate: "scenarioDialogue.buttons.generateAndContinue",
  back: "scenarioDialogue.buttons.backToSettings",
  addQuestion: "scenarioDialogue.buttons.addQuestion",
  titlePlaceholder: "scenarioDialogue.placeholders.title",
  questionPlaceholder: "scenarioDialogue.placeholders.question",
  enterTitle: "contentEditor.messages.enterTitle",
  atLeastN: "contentEditor.messages.addAtLeastNItems",
};

/** Step 2 才有的「新增題目」按鈕，用來判斷現在在哪一步 */
const onQuestionList = () => screen.queryByText(K.addQuestion) !== null;

const renderPanel = (
  props: Parameters<typeof ScenarioDialoguePanel>[0] = {},
) => {
  const ref = createRef<ScenarioDialoguePanelHandle>();
  render(<ScenarioDialoguePanel ref={ref} {...props} />, { wrapper });
  return ref;
};

const typeTitle = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText(K.titlePlaceholder), {
    target: { value },
  });

describe("ScenarioDialoguePanel 兩步驟流程", () => {
  beforeEach(() => {
    mockToastError.mockClear();
  });

  it("一開啟停在 Step 1，看不到題目清單", () => {
    renderPanel();

    expect(screen.getByText(K.stepSettings)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(K.titlePlaceholder)).toBeInTheDocument();
    expect(onQuestionList()).toBe(false);
  });

  it("「跳過，我想自己出題」直接進 Step 2 並留一張可打字的空白卡", () => {
    renderPanel();

    fireEvent.click(screen.getByText(K.skip));

    expect(onQuestionList()).toBe(true);
    expect(
      screen.getAllByPlaceholderText(K.questionPlaceholder).length,
    ).toBeGreaterThan(0);
  });

  it("回 Step 1 不會弄丟已經填的設定（兩步共用同一份 state）", () => {
    renderPanel();

    typeTitle("週末活動");
    fireEvent.click(screen.getByText(K.skip));
    expect(onQuestionList()).toBe(true);

    fireEvent.click(screen.getByText(K.back));

    expect(onQuestionList()).toBe(false);
    expect(screen.getByPlaceholderText(K.titlePlaceholder)).toHaveValue(
      "週末活動",
    );
  });

  it("步驟列本身可以直接跳回 Step 1", () => {
    renderPanel();

    fireEvent.click(screen.getByText(K.skip));
    expect(onQuestionList()).toBe(true);

    fireEvent.click(screen.getByText(K.stepSettings));

    expect(onQuestionList()).toBe(false);
  });

  it("產生題目後自動翻到 Step 2，並帶入題目", async () => {
    vi.useFakeTimers();
    try {
      renderPanel();

      fireEvent.click(screen.getByText(K.generate));
      await act(async () => {
        vi.advanceTimersByTime(700);
      });

      expect(onQuestionList()).toBe(true);
      expect(
        screen.getAllByPlaceholderText(K.questionPlaceholder).length,
      ).toBeGreaterThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ScenarioDialoguePanel 儲存擋關", () => {
  beforeEach(() => {
    mockToastError.mockClear();
  });

  it("沒填標題就儲存 → 擋下並留在 Step 1", async () => {
    const onSave = vi.fn();
    const ref = renderPanel({ onSave });

    await act(async () => {
      await ref.current?.save();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(K.enterTitle);
    expect(onQuestionList()).toBe(false);
  });

  it("題數不足就儲存 → 擋下並把老師帶到 Step 2 看題目", async () => {
    const onSave = vi.fn();
    const ref = renderPanel({ onSave });

    typeTitle("週末活動");

    await act(async () => {
      await ref.current?.save();
    });

    expect(onSave).not.toHaveBeenCalled();
    // t 被 mock 成只回傳 key，插值參數不會傳到 toast
    expect(mockToastError).toHaveBeenCalledWith(K.atLeastN);
    // 問題出在題目上，所以要停在題目清單而不是設定頁
    expect(onQuestionList()).toBe(true);
  });

  it("標題與題數都齊全 → 真的送出", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    let ref: ReturnType<typeof renderPanel>;
    try {
      ref = renderPanel({ onSave });

      typeTitle("週末活動");
      fireEvent.click(screen.getByText(K.generate));
      await act(async () => {
        vi.advanceTimersByTime(700);
      });
    } finally {
      vi.useRealTimers();
    }

    await act(async () => {
      await ref!.current?.save();
    });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(mockToastError).not.toHaveBeenCalled();
    expect(onSave.mock.calls[0][0]).toMatchObject({ title: "週末活動" });
    expect(onSave.mock.calls[0][0].rows.length).toBeGreaterThanOrEqual(3);
  });
});
