/**
 * ScenarioDialoguePanel — 兩步驟流程與情境內容（#944）
 *
 * 釘住兩件容易在改版時走鐘、但畫面看起來都正常的行為：
 * 1. 兩步共用同一份 state，來回切換不會弄丟填過的東西
 * 2. 「標題必填」擋的是儲存、「情境內容必填」擋的是 AI 產題 —— 兩者不同
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
  skip: "scenarioDialogue.buttons.skipGeneration",
  generate: "scenarioDialogue.buttons.generateAndContinue",
  generateAnother: "scenarioDialogue.buttons.generateAnother",
  viewQuestions: "scenarioDialogue.buttons.viewQuestions",
  back: "scenarioDialogue.buttons.backToSettings",
  addQuestion: "scenarioDialogue.buttons.addQuestion",
  editSettings: "scenarioDialogue.buttons.editSettings",
  generateScenario: "scenarioDialogue.buttons.generateScenario",
  uploadImage: "scenarioDialogue.buttons.uploadImage",
  generateImage: "scenarioDialogue.buttons.generateImage",
  tabManual: "scenarioDialogue.tabs.sourceManual",
  tabAi: "scenarioDialogue.tabs.sourceAi",
  tabUpload: "scenarioDialogue.tabs.sourceUpload",
  titlePlaceholder: "scenarioDialogue.placeholders.title",
  scenarioPlaceholder: "scenarioDialogue.placeholders.scenarioContent",
  questionPlaceholder: "scenarioDialogue.placeholders.question",
  rubricPlaceholder: "scenarioDialogue.placeholders.globalRubric",
  noContextYet: "scenarioDialogue.hints.noContextYet",
  noRubricYet: "scenarioDialogue.hints.noRubricYet",
  enterTitle: "contentEditor.messages.enterTitle",
  atLeastN: "contentEditor.messages.addAtLeastNItems",
  scenarioRequired: "scenarioDialogue.messages.scenarioRequired",
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

const type = (placeholder: string, value: string) =>
  fireEvent.change(screen.getByPlaceholderText(placeholder), {
    target: { value },
  });

const fillRequiredForGenerate = () => {
  type(K.titlePlaceholder, "週末活動");
  type(K.scenarioPlaceholder, "你和同學在星期一早上聊天，聊各自的週末。");
};

/** Radix 的 TabsTrigger 是 mousedown 觸發，fireEvent.click 不會切換 */
const switchTab = (label: string) =>
  fireEvent.mouseDown(screen.getByText(label));

/** 產題是 setTimeout 驅動的 stub，用假時鐘推完 */
const runGenerate = async (label: string) => {
  vi.useFakeTimers();
  try {
    fireEvent.click(screen.getByText(label));
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
  } finally {
    vi.useRealTimers();
  }
};

beforeEach(() => {
  mockToastError.mockClear();
});

describe("ScenarioDialoguePanel 兩步驟流程", () => {
  it("一開啟停在 Step 1，看不到題目清單", () => {
    renderPanel();

    expect(screen.getByPlaceholderText(K.titlePlaceholder)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(K.scenarioPlaceholder),
    ).toBeInTheDocument();
    expect(onQuestionList()).toBe(false);
  });

  it("沒有步驟列，但底部按鈕仍能雙向切換", () => {
    renderPanel();

    // 步驟列已移除：畫面上不該再有「設定 / 題目清單」那組步驟按鈕
    expect(screen.queryByText("scenarioDialogue.steps.settings")).toBeNull();
    expect(screen.queryByText("scenarioDialogue.steps.questions")).toBeNull();

    fireEvent.click(screen.getByText(K.skip));
    expect(onQuestionList()).toBe(true);

    fireEvent.click(screen.getByText(K.back));
    expect(onQuestionList()).toBe(false);
  });

  it("回 Step 1 不會弄丟已經填的設定（兩步共用同一份 state）", () => {
    renderPanel();

    type(K.titlePlaceholder, "週末活動");
    fireEvent.click(screen.getByText(K.skip));
    fireEvent.click(screen.getByText(K.back));

    expect(screen.getByPlaceholderText(K.titlePlaceholder)).toHaveValue(
      "週末活動",
    );
  });

  it("已有題目時，Step 1 底部改成「查看題目清單」而不是「跳過」", async () => {
    renderPanel();
    fillRequiredForGenerate();

    expect(screen.queryByText(K.skip)).not.toBeNull();
    expect(screen.queryByText(K.viewQuestions)).toBeNull();

    await runGenerate(K.generate);
    fireEvent.click(screen.getByText(K.back));

    expect(screen.queryByText(K.skip)).toBeNull();
    expect(screen.queryByText(K.viewQuestions)).not.toBeNull();
    expect(screen.queryByText(K.generateAnother)).not.toBeNull();
  });

  it("「查看題目清單」進 Step 2 且不會動到既有題目", async () => {
    renderPanel();
    fillRequiredForGenerate();

    await runGenerate(K.generate);
    const before = screen.getAllByPlaceholderText(K.questionPlaceholder).length;
    expect(before).toBeGreaterThanOrEqual(3);

    fireEvent.click(screen.getByText(K.back));
    fireEvent.click(screen.getByText(K.viewQuestions));

    expect(onQuestionList()).toBe(true);
    expect(screen.getAllByPlaceholderText(K.questionPlaceholder).length).toBe(
      before,
    );
  });
});

describe("ScenarioDialoguePanel 情境內容", () => {
  it("三種產生方式都在，共用同一個文字框", () => {
    renderPanel();

    expect(screen.getByText(K.tabManual)).toBeInTheDocument();
    expect(screen.getByText(K.tabAi)).toBeInTheDocument();
    expect(screen.getByText(K.tabUpload)).toBeInTheDocument();
    // 文字框只有一個，不隨 tab 切換而複製
    expect(screen.getAllByPlaceholderText(K.scenarioPlaceholder).length).toBe(
      1,
    );
  });

  it("AI 生成會把情境文章填進共用文字框，切回其他 tab 也還在", async () => {
    renderPanel();

    switchTab(K.tabAi);
    await runGenerate(K.generateScenario);

    const box = screen.getByPlaceholderText(K.scenarioPlaceholder);
    expect((box as HTMLTextAreaElement).value).not.toBe("");

    switchTab(K.tabManual);
    expect(screen.getByPlaceholderText(K.scenarioPlaceholder)).toHaveValue(
      (box as HTMLTextAreaElement).value,
    );
  });

  it("再產一批題目不會貼出重複的題目", async () => {
    renderPanel();
    fillRequiredForGenerate();

    await runGenerate(K.generate);
    const first = screen
      .getAllByPlaceholderText(K.questionPlaceholder)
      .map((el) => (el as HTMLTextAreaElement).value)
      .filter(Boolean);

    fireEvent.click(screen.getByText(K.back));
    await runGenerate(K.generateAnother);
    // 「再產一批」是留在 Step 1 的，要回清單才數得到題目
    fireEvent.click(screen.getByText(K.viewQuestions));

    const all = screen
      .getAllByPlaceholderText(K.questionPlaceholder)
      .map((el) => (el as HTMLTextAreaElement).value)
      .filter(Boolean);
    expect(all.length).toBeGreaterThanOrEqual(first.length);
    expect(new Set(all).size).toBe(all.length);
  });

  it("情境內容生成中算 busy，儲存鍵才擋得住", async () => {
    const ref = renderPanel();

    switchTab(K.tabAi);
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByText(K.generateScenario));
      // 還沒 resolve：這段期間存下去會存到舊的 scenarioContent
      expect(ref.current?.isBusy).toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(900);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(ref.current?.isBusy).toBe(false);
  });

  it("沒有情境內容就按產題 → 提示並且不產題", async () => {
    renderPanel();
    type(K.titlePlaceholder, "週末活動");

    await runGenerate(K.generate);

    expect(mockToastError).toHaveBeenCalledWith(K.scenarioRequired);
    expect(onQuestionList()).toBe(false);
    // 一張預設空白卡，沒有被 AI 填進題目
    expect(
      screen
        .queryAllByPlaceholderText(K.questionPlaceholder)
        .filter((el) => (el as HTMLTextAreaElement).value !== "").length,
    ).toBe(0);
  });

  it("Step 2 對照欄帶入情境內容與作答指引，沒填則顯示空狀態", () => {
    renderPanel();

    fireEvent.click(screen.getByText(K.skip));
    expect(screen.getByText(K.noContextYet)).toBeInTheDocument();
    expect(screen.getByText(K.noRubricYet)).toBeInTheDocument();

    fireEvent.click(screen.getByText(K.back));
    type(K.scenarioPlaceholder, "你和同學在星期一早上聊天。");
    type(K.rubricPlaceholder, "請用完整句子回答。");
    // 空白卡不算題目，所以出口按鈕仍是「跳過」
    fireEvent.click(screen.getByText(K.skip));

    expect(screen.getByText("你和同學在星期一早上聊天。")).toBeInTheDocument();
    expect(screen.getByText("請用完整句子回答。")).toBeInTheDocument();
  });
});

describe("ScenarioDialoguePanel 單題重新生成", () => {
  const KEYWORDS = "scenarioDialogue.placeholders.keywords";
  const REGEN = "scenarioDialogue.tooltips.regenerateQuestion";

  /**
   * 重新生成沿用同一個 row id，所以 SortableRow 不會重新掛載。若關鍵字草稿
   * 沒跟著更新，輸入框會停在舊字；老師只要 focus 再 blur，onBlur 就用舊草稿
   * 把新關鍵字蓋回去，而且全程沒有提示。
   */
  it("重新生成後關鍵字輸入框跟著換，不會留在舊值", async () => {
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });

    type(K.titlePlaceholder, "週末活動");
    type(K.scenarioPlaceholder, "情境");
    // 只產 3 題，才留得下沒被用過的示範題可以換
    fireEvent.change(container.querySelector("#sd-generate-count")!, {
      target: { value: "3" },
    });
    await runGenerate(K.generate);

    const firstQuestion = () =>
      (
        screen.getAllByPlaceholderText(
          K.questionPlaceholder,
        )[0] as HTMLTextAreaElement
      ).value;
    const firstKeywords = () =>
      (screen.getAllByPlaceholderText(KEYWORDS)[0] as HTMLInputElement).value;

    const oldQuestion = firstQuestion();
    const oldKeywords = firstKeywords();
    expect(oldKeywords).not.toBe("");

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getAllByTitle(REGEN)[0]);
      await act(async () => {
        vi.advanceTimersByTime(900);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(firstQuestion()).not.toBe(oldQuestion);
    expect(firstKeywords()).not.toBe(oldKeywords);
  });
});

describe("ScenarioDialoguePanel 儲存擋關", () => {
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

    type(K.titlePlaceholder, "週末活動");
    await act(async () => {
      await ref.current?.save();
    });

    expect(onSave).not.toHaveBeenCalled();
    // t 被 mock 成只回傳 key，插值參數不會傳到 toast
    expect(mockToastError).toHaveBeenCalledWith(K.atLeastN);
    expect(onQuestionList()).toBe(true);
  });

  it("情境內容是空的照樣能存 —— 它擋的是產題，不是儲存", async () => {
    const onSave = vi.fn();
    const ref = renderPanel({ onSave });

    type(K.titlePlaceholder, "週末活動");
    fireEvent.click(screen.getByText(K.skip));

    // 自己在題目清單打滿 3 題，全程沒碰情境內容
    screen
      .getAllByPlaceholderText(K.questionPlaceholder)
      .slice(0, 1)
      .forEach((el) =>
        fireEvent.change(el, { target: { value: "Question one?" } }),
      );
    fireEvent.click(screen.getByText(K.addQuestion));
    fireEvent.click(screen.getByText(K.addQuestion));
    const boxes = screen.getAllByPlaceholderText(K.questionPlaceholder);
    fireEvent.change(boxes[1], { target: { value: "Question two?" } });
    fireEvent.change(boxes[2], { target: { value: "Question three?" } });

    await act(async () => {
      await ref.current?.save();
    });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(mockToastError).not.toHaveBeenCalled();
    expect(onSave.mock.calls[0][0]).toMatchObject({
      title: "週末活動",
      scenarioContent: "",
    });
  });

  it("標題、情境內容、題數都齊全 → 真的送出", async () => {
    const onSave = vi.fn();
    const ref = renderPanel({ onSave });

    fillRequiredForGenerate();
    await runGenerate(K.generate);

    await act(async () => {
      await ref.current?.save();
    });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(mockToastError).not.toHaveBeenCalled();
    const payload = onSave.mock.calls[0][0];
    expect(payload.title).toBe("週末活動");
    expect(payload.scenarioContent).not.toBe("");
    expect(payload.rows.length).toBeGreaterThanOrEqual(3);
  });
});

describe("ScenarioDialoguePanel 單題情境圖片", () => {
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

  /** 圖片欄位已經只存在於題目卡，所以每個案例都得先進 Step 2 */
  const gotoList = () => fireEvent.click(screen.getByText(K.skip));

  const imageInputs = (container: HTMLElement) =>
    container.querySelectorAll<HTMLInputElement>('input[accept="image/*"]');

  const upload = (input: HTMLInputElement, name: string) =>
    fireEvent.change(input, {
      target: { files: [new File(["x"], name, { type: "image/png" })] },
    });

  it("空圖框同時提供「上傳」與「AI 生成」兩個入口", () => {
    renderPanel();
    gotoList();

    expect(screen.getAllByText(K.uploadImage).length).toBeGreaterThan(0);
    expect(screen.getAllByText(K.generateImage).length).toBeGreaterThan(0);
  });

  it("Step 1 已經沒有整份情境圖片欄位", () => {
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });

    expect(imageInputs(container).length).toBe(0);
  });

  it("上傳後顯示預覽圖", () => {
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });
    gotoList();

    upload(imageInputs(container)[0], "a.png");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "blob:mock-1",
    );
  });

  it("換圖時釋放舊的 blob，不會一路累積", () => {
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });
    gotoList();

    upload(imageInputs(container)[0], "a.png");
    upload(imageInputs(container)[0], "b.png");

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "blob:mock-2",
    );
  });

  it("複製題目後，其中一列換圖不會弄壞另一列（共用同一個 blob）", () => {
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });
    gotoList();

    upload(imageInputs(container)[0], "a.png");
    fireEvent.click(screen.getAllByTitle("contentEditor.tooltips.copy")[0]);

    const shared = Array.from(container.querySelectorAll("img")).filter(
      (img) => img.getAttribute("src") === "blob:mock-1",
    );
    expect(shared.length).toBe(2);

    // 換掉其中一列：另一列還在用，所以不能 revoke
    upload(imageInputs(container)[0], "b.png");

    expect(revokeObjectURL).not.toHaveBeenCalledWith("blob:mock-1");
    expect(
      container.querySelector('img[src="blob:mock-1"]'),
    ).toBeInTheDocument();
  });

  it("卸載時把還沒釋放的 blob 清乾淨", () => {
    const { container, unmount } = render(<ScenarioDialoguePanel />, {
      wrapper,
    });
    gotoList();

    upload(imageInputs(container)[0], "a.png");
    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
  });
});
