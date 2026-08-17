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
  generateAnother: "scenarioDialogue.buttons.generateAnother",
  viewQuestions: "scenarioDialogue.buttons.viewQuestions",
  back: "scenarioDialogue.buttons.backToSettings",
  addQuestion: "scenarioDialogue.buttons.addQuestion",
  editSettings: "scenarioDialogue.buttons.editSettings",
  titlePlaceholder: "scenarioDialogue.placeholders.title",
  questionPlaceholder: "scenarioDialogue.placeholders.question",
  contextPlaceholder: "scenarioDialogue.placeholders.context",
  rubricPlaceholder: "scenarioDialogue.placeholders.globalRubric",
  noContextYet: "scenarioDialogue.hints.noContextYet",
  noRubricYet: "scenarioDialogue.hints.noRubricYet",
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

  it("已有題目時，Step 1 底部改成「查看題目清單」而不是「跳過」", async () => {
    vi.useFakeTimers();
    try {
      renderPanel();

      // 還沒題目：出口是「跳過，我想自己出題」
      expect(screen.queryByText(K.skip)).not.toBeNull();
      expect(screen.queryByText(K.viewQuestions)).toBeNull();

      fireEvent.click(screen.getByText(K.generate));
      await act(async () => {
        vi.advanceTimersByTime(700);
      });
      fireEvent.click(screen.getByText(K.stepSettings));
    } finally {
      vi.useRealTimers();
    }

    // 回到設定頁，出口換成「查看題目清單」，老師才找得到回清單的路
    expect(screen.queryByText(K.skip)).toBeNull();
    expect(screen.queryByText(K.viewQuestions)).not.toBeNull();
    expect(screen.queryByText(K.generateAnother)).not.toBeNull();
  });

  it("「查看題目清單」進 Step 2 且不會動到既有題目", async () => {
    vi.useFakeTimers();
    let before = 0;
    try {
      renderPanel();
      fireEvent.click(screen.getByText(K.generate));
      await act(async () => {
        vi.advanceTimersByTime(700);
      });
      before = screen.getAllByPlaceholderText(K.questionPlaceholder).length;
      fireEvent.click(screen.getByText(K.stepSettings));
    } finally {
      vi.useRealTimers();
    }

    fireEvent.click(screen.getByText(K.viewQuestions));

    expect(onQuestionList()).toBe(true);
    expect(screen.getAllByPlaceholderText(K.questionPlaceholder).length).toBe(
      before,
    );
  });
});

describe("ScenarioDialoguePanel Step 2 設定對照欄", () => {
  it("帶入 Step 1 填的情境說明與作答指引", () => {
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText(K.contextPlaceholder), {
      target: { value: "你和同學在星期一早上聊天。" },
    });
    fireEvent.change(screen.getByPlaceholderText(K.rubricPlaceholder), {
      target: { value: "請用完整句子回答。" },
    });
    fireEvent.click(screen.getByText(K.skip));

    expect(screen.getByText("你和同學在星期一早上聊天。")).toBeInTheDocument();
    expect(screen.getByText("請用完整句子回答。")).toBeInTheDocument();
  });

  it("兩者都沒填時顯示空狀態，而不是留一塊空白", () => {
    renderPanel();

    fireEvent.click(screen.getByText(K.skip));

    expect(screen.getByText(K.noContextYet)).toBeInTheDocument();
    expect(screen.getByText(K.noRubricYet)).toBeInTheDocument();
  });

  it("對照欄的「回設定修改」可以回 Step 1", () => {
    renderPanel();

    fireEvent.click(screen.getByText(K.skip));
    fireEvent.click(screen.getByText(K.editSettings));

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

describe("ScenarioDialoguePanel 情境圖片手動上傳", () => {
  const createObjectURL = vi.fn();
  const revokeObjectURL = vi.fn();
  let seq = 0;

  beforeEach(() => {
    seq = 0;
    createObjectURL.mockReset().mockImplementation(() => `blob:mock-${++seq}`);
    revokeObjectURL.mockReset();
    // jsdom 沒有這兩個 API，要自己補
    global.URL.createObjectURL =
      createObjectURL as unknown as typeof URL.createObjectURL;
    global.URL.revokeObjectURL =
      revokeObjectURL as unknown as typeof URL.revokeObjectURL;
  });

  /** 情境圖片的 input 用 accept="image/*"，與 PDF 上傳的 input 區分得開 */
  const imageInput = (container: HTMLElement) =>
    container.querySelector<HTMLInputElement>('input[accept="image/*"]')!;

  const upload = (input: HTMLInputElement, name: string) =>
    fireEvent.change(input, {
      target: { files: [new File(["x"], name, { type: "image/png" })] },
    });

  it("上傳後顯示預覽圖", () => {
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });

    upload(imageInput(container), "a.png");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "blob:mock-1",
    );
  });

  it("換圖時釋放舊的 blob，不會一路累積", () => {
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });

    upload(imageInput(container), "a.png");
    upload(imageInput(container), "b.png");

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "blob:mock-2",
    );
  });

  it("複製題目後，其中一列換圖不會弄壞另一列（共用同一個 blob）", () => {
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });

    // 先進 Step 2 才有題目卡可以複製
    fireEvent.click(screen.getByText(K.skip));

    const slots = () =>
      container.querySelectorAll<HTMLInputElement>('input[accept="image/*"]');
    // Step 2 的第一張圖是對照欄以外的題目卡；上傳到第 1 題
    const rowSlot = slots()[slots().length - 1];
    upload(rowSlot, "a.png");
    expect(container.querySelectorAll("img").length).toBeGreaterThan(0);

    // 複製這一題 → 兩列共用同一個 blob:mock-1
    fireEvent.click(screen.getAllByTitle("contentEditor.tooltips.copy")[0]);
    const shared = Array.from(container.querySelectorAll("img")).filter(
      (img) => img.getAttribute("src") === "blob:mock-1",
    );
    expect(shared.length).toBe(2);

    // 換掉其中一列的圖：另一列還在用，所以不能 revoke
    upload(slots()[slots().length - 1], "b.png");

    expect(revokeObjectURL).not.toHaveBeenCalledWith("blob:mock-1");
    expect(
      container.querySelector('img[src="blob:mock-1"]'),
    ).toBeInTheDocument();
  });

  it("卸載時把還沒釋放的 blob 清乾淨", () => {
    const { container, unmount } = render(<ScenarioDialoguePanel />, {
      wrapper,
    });

    upload(imageInput(container), "a.png");
    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
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
