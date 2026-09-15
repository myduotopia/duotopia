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
import { SidebarProvider, useSidebar } from "@/contexts/SidebarContext";

const mockToastError = vi.fn();

// #1021: 產題／生成情境文章／擷取／TTS 都真的打 API 了，這裡一律 mock。
// 預設回傳足夠的題目，讓「產一批」相關的測試維持原本的行為斷言。
const generateScenarioQuestions = vi.fn();
const generateScenarioArticle = vi.fn();
const extractScenarioArticle = vi.fn();
const generateTTS = vi.fn();
const generateScenarioImage = vi.fn();

const fakeQuestion = (n: number) => ({
  question: `Generated question ${n}?`,
  translation: `翻譯 ${n}`,
  keywords: [`kw${n}`],
  reference_answer: `Reference ${n}`,
  image_prompt: "",
});

vi.mock("@/lib/api", () => ({
  apiClient: {
    generateScenarioQuestions: (...a: unknown[]) =>
      generateScenarioQuestions(...a),
    generateScenarioArticle: (...a: unknown[]) => generateScenarioArticle(...a),
    extractScenarioArticle: (...a: unknown[]) => extractScenarioArticle(...a),
    generateTTS: (...a: unknown[]) => generateTTS(...a),
    generateScenarioImage: (...a: unknown[]) => generateScenarioImage(...a),
  },
}));

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
  extractScenario: "scenarioDialogue.buttons.extractScenario",
  uploadImage: "scenarioDialogue.buttons.uploadImage",
  generateImage: "scenarioDialogue.buttons.generateImage",
  tabManual: "scenarioDialogue.tabs.sourceManual",
  tabAi: "scenarioDialogue.tabs.sourceAi",
  tabUpload: "scenarioDialogue.tabs.sourceUpload",
  titlePlaceholder: "scenarioDialogue.placeholders.title",
  scenarioPlaceholder: "scenarioDialogue.placeholders.scenarioContent",
  goalPlaceholder: "scenarioDialogue.placeholders.goal",
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

/** 產題／生成情境文章都是 async API 呼叫（#1021），點下去等 promise 跑完即可 */
const runGenerate = async (label: string) => {
  fireEvent.click(screen.getByText(label));
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  mockToastError.mockClear();
  generateScenarioQuestions.mockReset();
  generateScenarioArticle.mockReset();
  extractScenarioArticle.mockReset();
  generateTTS.mockReset();
  generateScenarioImage.mockReset();

  // 每次呼叫都給「還沒出現過」的題目，讓『再產一批』能像真的一樣長出新題
  let seq = 0;
  generateScenarioQuestions.mockImplementation(
    async ({ count }: { count: number }) => ({
      questions: Array.from({ length: count }, () => fakeQuestion(++seq)),
    }),
  );
  generateScenarioArticle.mockResolvedValue({
    content: "It is Monday morning at school.",
  });
  extractScenarioArticle.mockResolvedValue({ content: "Extracted passage." });
  generateTTS.mockResolvedValue({ audio_url: "https://cdn/audio.mp3" });
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
    // #1021: 訓練目標是生成的依據，沒填會被擋下（後端同樣拒收空目標）
    type(K.goalPlaceholder, "這週上課學到的：交通工具與問路");
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
    type(K.goalPlaceholder, "這週上課學到的：交通工具與問路");

    // #1021: 改成真的 API 呼叫後，用一個自己控制何時 resolve 的 promise 把
    // 「生成中」這段時間撐開，而不是推假時鐘
    let finish!: (value: { content: string }) => void;
    generateScenarioArticle.mockReturnValue(
      new Promise<{ content: string }>((resolve) => {
        finish = resolve;
      }),
    );

    fireEvent.click(screen.getByText(K.generateScenario));
    await act(async () => {
      await Promise.resolve();
    });
    // 還沒 resolve：這段期間存下去會存到舊的 scenarioContent
    expect(ref.current?.isBusy).toBe(true);

    await act(async () => {
      finish({ content: "It is Monday morning." });
      await Promise.resolve();
    });

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

describe("ScenarioDialoguePanel busy 狀態", () => {
  /** RefSaveButton 與面板的 X 都是讀 context 的 editorBusy，不是 panelRef */
  function BusyProbe() {
    const { editorBusy } = useSidebar();
    return <span data-testid="busy">{String(editorBusy)}</span>;
  }

  const busy = () => screen.getByTestId("busy").textContent;

  it("生成情境內容期間，editorBusy 會被撐起來", async () => {
    render(
      <SidebarProvider>
        <ScenarioDialoguePanel />
        <BusyProbe />
      </SidebarProvider>,
    );

    expect(busy()).toBe("false");

    switchTab(K.tabAi);
    type(K.goalPlaceholder, "這週上課學到的：交通工具與問路");

    let finish!: (value: { content: string }) => void;
    generateScenarioArticle.mockReturnValue(
      new Promise<{ content: string }>((resolve) => {
        finish = resolve;
      }),
    );

    fireEvent.click(screen.getByText(K.generateScenario));
    await act(async () => {
      await Promise.resolve();
    });
    // 沒同步的話這裡會是 false，儲存鍵就不會 disabled
    expect(busy()).toBe("true");

    await act(async () => {
      finish({ content: "It is Monday morning." });
      await Promise.resolve();
    });

    expect(busy()).toBe("false");
  });

  it("產題期間也算 busy", async () => {
    render(
      <SidebarProvider>
        <ScenarioDialoguePanel />
        <BusyProbe />
      </SidebarProvider>,
    );

    fillRequiredForGenerate();
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByText(K.generate));
      expect(busy()).toBe("true");
      await act(async () => {
        vi.advanceTimersByTime(900);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(busy()).toBe("false");
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
    const countGroup = container.querySelector(
      '[aria-labelledby="sd-generate-count-label"]',
    )!;
    fireEvent.click(
      Array.from(countGroup.querySelectorAll("button")).find(
        (b) => b.textContent === "3",
      )!,
    );
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

  it("刪掉整列題目時，它的圖也要釋放", () => {
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });
    gotoList();

    // 先多一列，刪除鍵才不會因為「至少留一列」而 disabled
    fireEvent.click(screen.getByText(K.addQuestion));
    upload(imageInputs(container)[0], "a.png");
    expect(
      container.querySelector('img[src="blob:mock-1"]'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle("contentEditor.tooltips.delete")[0]);

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
  });

  it("被複製過的圖，刪掉其中一列不會弄壞另一列", () => {
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });
    gotoList();

    upload(imageInputs(container)[0], "a.png");
    fireEvent.click(screen.getAllByTitle("contentEditor.tooltips.copy")[0]);
    expect(container.querySelectorAll('img[src="blob:mock-1"]').length).toBe(2);

    fireEvent.click(screen.getAllByTitle("contentEditor.tooltips.delete")[0]);

    // 另一列還在用，不能 revoke
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

/**
 * Issue #1013：編輯既有內容與交出存檔資料。
 *
 * 這一段盯的是「面板與呼叫端之間的交接」——面板只負責把資料交出去，
 * 打 API、關面板都是呼叫端的事。
 */
describe("ScenarioDialoguePanel 編輯模式（#1013）", () => {
  const initialData = {
    title: "週末活動",
    scenarioContent: "你和同學在星期一早上聊天。",
    questionLevel: "B1",
    globalRubric: "請用完整句子回答",
    globalTense: { time: "past", aspect: "simple" },
    globalVoice: "active",
    translateLanguage: "chinese",
    ttsSettings: { accent: "US", gender: "Female", speed: "Normal x1" },
    rows: [
      {
        id: "r1",
        contentItemId: 11,
        question: "What did you do last weekend?",
        translation: "你上週末做了什麼？",
        tenseOverride: null,
        voiceOverride: null,
        keywords: ["park"],
        referenceAnswer: "I went to the park.",
        rubricNote: "",
        imagePrompt: "",
        imageUrl: null,
        audioUrl: null,
        revision: 0,
      },
      {
        id: "r2",
        contentItemId: 12,
        question: "And on Sunday?",
        translation: "那星期天呢？",
        tenseOverride: { time: "", aspect: "" },
        voiceOverride: "",
        keywords: [],
        referenceAnswer: "",
        rubricNote: "",
        imagePrompt: "",
        imageUrl: null,
        audioUrl: null,
        revision: 0,
      },
      // 第三題純粹是為了滿足 MIN_ITEMS（3 題），存檔才不會被擋下
      {
        id: "r3",
        contentItemId: 13,
        question: "Who did you go with?",
        translation: "你和誰去的？",
        tenseOverride: null,
        voiceOverride: null,
        keywords: [],
        referenceAnswer: "",
        rubricNote: "",
        imagePrompt: "",
        imageUrl: null,
        audioUrl: null,
        revision: 0,
      },
    ],
  };

  it("帶 initialData 時直接落在題目清單，並顯示既有題目", () => {
    renderPanel({ initialData });

    expect(onQuestionList()).toBe(true);
    expect(
      screen.getByDisplayValue("What did you do last weekend?"),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("And on Sunday?")).toBeInTheDocument();
  });

  it("回設定頁看得到既有的標題與情境內容", () => {
    renderPanel({ initialData });

    fireEvent.click(screen.getByText(K.editSettings));

    expect(screen.getByDisplayValue("週末活動")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("你和同學在星期一早上聊天。"),
    ).toBeInTheDocument();
  });

  it("存檔交出的資料保留 DB id 與 override 的 null／空值差別", async () => {
    const onSave = vi.fn();
    const ref = renderPanel({ initialData, onSave });

    await act(async () => {
      await ref.current?.save();
    });

    expect(mockToastError).not.toHaveBeenCalled();
    const data = onSave.mock.calls[0][0];
    expect(data.title).toBe("週末活動");
    expect(
      data.rows.map((r: { contentItemId: number | null }) => r.contentItemId),
    ).toEqual([11, 12, 13]);
    // 第一題沿用整體（null）、第二題已脫鉤（空值）—— 兩者不可被壓平
    expect(data.rows[0].tenseOverride).toBeNull();
    expect(data.rows[0].voiceOverride).toBeNull();
    expect(data.rows[1].tenseOverride).toEqual({ time: "", aspect: "" });
    expect(data.rows[1].voiceOverride).toBe("");
  });

  it("存檔失敗（onSave 丟例外）時例外往上拋，呼叫端才知道不能關面板", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("network"));
    const ref = renderPanel({ initialData, onSave });

    await expect(ref.current!.save()).rejects.toThrow("network");
    // 面板不清空，老師填的東西還在
    expect(
      screen.getByDisplayValue("What did you do last weekend?"),
    ).toBeInTheDocument();
  });

  it("isSaving 時面板回報 busy，儲存鍵不會被連按兩次", () => {
    const ref = renderPanel({ initialData, isSaving: true });

    expect(ref.current?.isBusy).toBe(true);
  });
});

/**
 * Issue #1021：AI 真的接上後端了。
 *
 * 這張單的起因是老師填的訓練目標／出題設定完全沒被讀取（前端是寫死的示範題），
 * 所以這裡盯的就是「填了什麼，有沒有真的送出去」。
 */
describe("ScenarioDialoguePanel AI 串接（#1021）", () => {
  it("生成情境文章會把訓練目標與文章難度送出去", async () => {
    renderPanel({ programLevel: "B1" });

    switchTab(K.tabAi);
    type(K.goalPlaceholder, "這週上課學到的：交通工具與問路");
    await runGenerate(K.generateScenario);

    expect(generateScenarioArticle).toHaveBeenCalledTimes(1);
    expect(generateScenarioArticle).toHaveBeenCalledWith(
      expect.objectContaining({ goal: "這週上課學到的：交通工具與問路" }),
    );
    expect(
      (
        screen.getByPlaceholderText(
          K.scenarioPlaceholder,
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("It is Monday morning at school.");
  });

  it("沒填訓練目標就不會送出請求（省下一次白花的呼叫）", async () => {
    renderPanel();

    switchTab(K.tabAi);
    await runGenerate(K.generateScenario);

    expect(generateScenarioArticle).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalled();
  });

  it("產題會把情境內容與整份出題設定一起送出", async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);

    expect(generateScenarioQuestions).toHaveBeenCalledTimes(1);
    const sent = generateScenarioQuestions.mock.calls[0][0];
    expect(sent.scenario_content).toContain("你和同學在星期一早上聊天");
    expect(sent.count).toBeGreaterThan(0);
    // 時態送的是穩定代碼物件，不是畫面上的中文標籤
    expect(sent.global_tense).toEqual({ time: "", aspect: "" });
    expect(sent).toHaveProperty("question_level");
    expect(sent).toHaveProperty("global_rubric");
  });

  it("再產一批會帶上既有題目，讓後端避開重複", async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);
    await runGenerate(K.generateAnother);

    const second = generateScenarioQuestions.mock.calls[1][0];
    expect(second.existing_questions.length).toBeGreaterThan(0);
    expect(second.existing_questions[0]).toContain("Generated question");
  });

  it("產題失敗會提示，且不會把既有題目清掉", async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);
    const before = screen.getAllByPlaceholderText(K.questionPlaceholder).length;

    generateScenarioQuestions.mockRejectedValueOnce(new Error("boom"));
    await runGenerate(K.generateAnother);

    expect(mockToastError).toHaveBeenCalled();
    expect(screen.getAllByPlaceholderText(K.questionPlaceholder).length).toBe(
      before,
    );
  });

  it("上傳檔案後走擷取端點，多個檔案會依序擷取再接起來", async () => {
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });

    switchTab(K.tabUpload);
    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["a"], "p1.png", { type: "image/png" }),
          new File(["b"], "p2.png", { type: "image/png" }),
        ],
      },
    });

    extractScenarioArticle
      .mockResolvedValueOnce({ content: "Page one." })
      .mockResolvedValueOnce({ content: "Page two." });

    fireEvent.click(screen.getByText(K.extractScenario));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(extractScenarioArticle).toHaveBeenCalledTimes(2);
    expect(
      (
        screen.getByPlaceholderText(
          K.scenarioPlaceholder,
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("Page one.\n\nPage two.");
  });
});

/**
 * Issue #1023 review：題目語音是「那句話」的 TTS 產物，題目一改就對不上。
 *
 * 這件事不只是畫面上怪 —— `audioUrl` 會跟著存進 content item，一路播給學生聽。
 */
describe("ScenarioDialoguePanel 題目語音與題目本文的一致性", () => {
  // Issue #1051：麥克風先開設定視窗，按「生成」才產生
  const generateAudioFor = async (index: number) => {
    const buttons = screen.getAllByTitle(
      "scenarioDialogue.tooltips.generateAudio",
    );
    fireEvent.click(buttons[index]);
    fireEvent.click(screen.getByText("contentEditor.ttsSettings.generate"));
    await act(async () => {
      await Promise.resolve();
    });
  };

  const playButtons = () =>
    screen.queryAllByTitle("contentEditor.tooltips.play");

  it("Issue #1051：麥克風先開設定視窗，未按生成不會呼叫 TTS", async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);

    fireEvent.click(
      screen.getAllByTitle("scenarioDialogue.tooltips.generateAudio")[0],
    );

    expect(screen.getByText("contentEditor.ttsSettings.generate")).toBeTruthy();
    expect(generateTTS).not.toHaveBeenCalled();
  });

  it("Issue #1051：視窗選定的口音／性別／語速會送進 TTS，且下次打開帶上次設定", async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);

    fireEvent.click(
      screen.getAllByTitle("scenarioDialogue.tooltips.generateAudio")[0],
    );
    const selects = () => screen.getByRole("dialog").querySelectorAll("select");
    fireEvent.change(selects()[0], { target: { value: "British English" } });
    fireEvent.change(selects()[1], { target: { value: "Female" } });
    fireEvent.change(selects()[2], { target: { value: "Slow x0.75" } });
    fireEvent.click(screen.getByText("contentEditor.ttsSettings.generate"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(generateTTS).toHaveBeenCalledWith(
      expect.any(String),
      "en-GB-SoniaNeural",
      "-25%",
      "+0%",
    );

    fireEvent.click(
      screen.getAllByTitle("scenarioDialogue.tooltips.generateAudio")[0],
    );
    expect((selects()[0] as HTMLSelectElement).value).toBe("British English");
    expect((selects()[1] as HTMLSelectElement).value).toBe("Female");
    expect((selects()[2] as HTMLSelectElement).value).toBe("Slow x0.75");
  });

  it("產生語音後會出現播放鍵", async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);

    expect(playButtons().length).toBe(0);
    await generateAudioFor(0);

    expect(generateTTS).toHaveBeenCalledTimes(1);
    expect(playButtons().length).toBe(1);
  });

  it("手動改題目文字會把舊語音清掉（否則播的是舊句子）", async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);
    await generateAudioFor(0);
    expect(playButtons().length).toBe(1);

    const questionBox = screen.getAllByPlaceholderText(
      K.questionPlaceholder,
    )[0];
    fireEvent.change(questionBox, {
      target: { value: "A totally new question?" },
    });

    expect(playButtons().length).toBe(0);
  });

  it("只是重新輸入同一段文字不會誤清語音", async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);
    await generateAudioFor(0);

    const questionBox = screen.getAllByPlaceholderText(
      K.questionPlaceholder,
    )[0] as HTMLTextAreaElement;
    fireEvent.change(questionBox, { target: { value: questionBox.value } });

    expect(playButtons().length).toBe(1);
  });

  it("重新生成整題也會清掉舊語音", async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);
    await generateAudioFor(0);
    expect(playButtons().length).toBe(1);

    fireEvent.click(
      screen.getAllByTitle("scenarioDialogue.tooltips.regenerateQuestion")[0],
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(playButtons().length).toBe(0);
  });
});

/**
 * PR #1023 review round 3：AI 呼叫要等好幾秒，那段期間老師還是可以繼續編輯
 * （題目文字、刪題、加題、拖曳都沒有被擋）。回應落地時若用發送前的快照覆蓋整個
 * 陣列，他等待期間做的事會無聲消失。
 */
describe("ScenarioDialoguePanel 產題等待期間的編輯不可被吃掉", () => {
  const pendingGeneration = () => {
    let finish!: (value: { questions: unknown[] }) => void;
    generateScenarioQuestions.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    return () =>
      act(async () => {
        finish({ questions: [fakeQuestion(99)] });
        await Promise.resolve();
      });
  };

  it("等待期間改過的題目文字，回應落地後仍然在", async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);

    const settle = pendingGeneration();
    fireEvent.click(screen.getByText(K.generateAnother));
    await act(async () => {
      await Promise.resolve();
    });

    // 還在等 AI 的時候老師改了第一題
    const box = screen.getAllByPlaceholderText(K.questionPlaceholder)[0];
    fireEvent.change(box, { target: { value: "老師等待時改的題目？" } });

    await settle();

    const values = screen
      .getAllByPlaceholderText(K.questionPlaceholder)
      .map((el) => (el as HTMLTextAreaElement).value);
    expect(values).toContain("老師等待時改的題目？");
  });

  it("等待期間刪掉的題目不會被回應救回來", async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);
    const before = screen.getAllByPlaceholderText(K.questionPlaceholder).length;

    const settle = pendingGeneration();
    fireEvent.click(screen.getByText(K.generateAnother));
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getAllByTitle("contentEditor.tooltips.delete")[0]);
    await settle();

    // 刪掉 1 題、AI 補 1 題 → 總數不變；被刪的那題不該復活
    expect(screen.getAllByPlaceholderText(K.questionPlaceholder).length).toBe(
      before,
    );
  });
});

/**
 * Issue #1024：逐題 AI 生圖接上 Imagen。
 *
 * 三種失敗要分開講，因為老師的下一步完全不同（額度用完 → 改手動上傳、被安全過濾
 * 擋下 → 換描述、其他 → 稍後再試）。
 */
describe("ScenarioDialoguePanel AI 生圖（#1024）", () => {
  const generateImageFor = async (index: number) => {
    fireEvent.click(
      screen.getAllByText("scenarioDialogue.buttons.generateImage")[index],
    );
    await act(async () => {
      await Promise.resolve();
    });
  };

  const prepareRows = async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);
  };

  it("用該題的 imagePrompt 呼叫生圖，成功後把圖填進該列", async () => {
    generateScenarioImage.mockResolvedValue({
      image_url: "https://cdn/generated.png",
      prompt: "rewritten",
    });
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });
    fillRequiredForGenerate();
    await runGenerate(K.generate);

    await generateImageFor(0);

    expect(generateScenarioImage).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('img[src="https://cdn/generated.png"]'),
    ).toBeInTheDocument();
  });

  it("額度用完（402）會告訴老師改用手動上傳", async () => {
    generateScenarioImage.mockRejectedValue(
      new Error('402 {"error":"SCENARIO_IMAGE_QUOTA_EXCEEDED"}'),
    );
    await prepareRows();

    await generateImageFor(0);

    expect(mockToastError).toHaveBeenCalledWith(
      "scenarioDialogue.messages.imageQuotaExceeded",
    );
  });

  it("被安全過濾擋下（422）會請老師換個描述", async () => {
    generateScenarioImage.mockRejectedValue(new Error("422 blocked"));
    await prepareRows();

    await generateImageFor(0);

    expect(mockToastError).toHaveBeenCalledWith(
      "scenarioDialogue.messages.imageBlocked",
    );
  });

  it("其他錯誤是「稍後再試」，不會誤導成額度或描述問題", async () => {
    generateScenarioImage.mockRejectedValue(new Error("500 boom"));
    await prepareRows();

    await generateImageFor(0);

    expect(mockToastError).toHaveBeenCalledWith(
      "scenarioDialogue.messages.imageFailed",
    );
  });
});
