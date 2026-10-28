/**
 * ScenarioDialoguePanel — 引導式對話（#1146）＋題目清單（#944）
 *
 * 釘住幾件容易在改版時走鐘、但畫面看起來都正常的行為：
 * 1. 對話與題目清單共用同一份 state，來回切換不會弄丟填過的東西
 * 2. 「標題必填」擋的是儲存、「情境／出題方向」擋的是 AI 產題 —— 兩者不同
 * 3. 回頭改前面的回答會先確認，已產生的題目保留
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef, type ReactNode } from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
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

/**
 * #1044: 生圖的前端入口由 FEATURE_FLAGS.SCENARIO_IMAGE_GENERATION 控制。
 *
 * 用可變物件而不是固定值 —— 同一個檔案裡兩種狀態都要測：關閉時是 coming soon，
 * 開啟時生圖邏輯必須照常運作（那段程式碼沒有被刪，日後要開回來）。
 * 元件是在 render 時才讀這個屬性，所以改屬性就會生效。
 */
// 空物件，由下面的 factory 用真的旗標填滿 —— 保持同一個 reference 才能靠改屬性切換
const mockFlags = vi.hoisted(() => ({}) as Record<string, boolean>);

vi.mock("@/config/featureFlags", async (importOriginal) => {
  // 從真檔案繼承，只覆蓋這張單關心的那一個旗標。
  // 自己抄一份清單的話，真檔案新增旗標時 mock 會靜靜少一個，而元件讀到 undefined
  // 不會報錯、只會行為怪掉（review 指出）。
  const actual = await importOriginal<typeof import("@/config/featureFlags")>();
  Object.assign(mockFlags, actual.FEATURE_FLAGS, {
    SCENARIO_IMAGE_GENERATION: false,
  });
  return { ...actual, FEATURE_FLAGS: mockFlags };
});

/**
 * ApiError 必須是**同一個** class：元件用 `error instanceof ApiError` 判斷狀態碼，
 * mock 掉 `@/lib/api` 之後，元件拿到的就是這裡定義的這個。原本測試用
 * `new Error('402 {...}')` 捏假錯誤 —— 那會在實作改成 status 判斷之後**仍然通過**，
 * 等於什麼都沒驗到（本機 review 抓到）。
 */
// vi.mock 的 factory 會被 hoist 到檔案最上面，所以 class 也要用 vi.hoisted 定義，
// 否則 factory 執行時它還沒初始化（ReferenceError）。
const MockApiError = vi.hoisted(
  () =>
    class MockApiError extends Error {
      status: number;
      detail: unknown;
      constructor(status: number, detail: unknown) {
        super(
          typeof detail === "object" && detail && "message" in detail
            ? String((detail as { message?: string }).message)
            : String(detail),
        );
        this.name = "ApiError";
        this.status = status;
        this.detail = detail;
      }
    },
);

vi.mock("@/lib/api", () => ({
  ApiError: MockApiError,
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

/**
 * 設定卡的題數改用標準元件 Select（Radix，#1146 review 5）。Radix 的下拉在 jsdom 裡
 * 開不起來（pointer／portal 行為不穩，同 QuizScoringMethodField 測試的說明），這裡換成
 * 原生 select 的替身：一樣用 role=combobox + aria-label 找、用 change 選值，
 * 驗的是「選了幾題就送幾題」，不是 Radix 本身。
 */
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type Ctx = {
    value?: string;
    onValueChange?: (v: string) => void;
    label: { current?: string };
  };
  const SelectCtx = React.createContext<Ctx>({ label: {} });
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (v: string) => void;
      children: ReactNode;
    }) => {
      const label = React.useRef<string | undefined>(undefined);
      return (
        <SelectCtx.Provider value={{ value, onValueChange, label }}>
          {children}
        </SelectCtx.Provider>
      );
    },
    SelectTrigger: (props: { "aria-label"?: string }) => {
      React.useContext(SelectCtx).label.current = props["aria-label"];
      return null;
    },
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => {
      const ctx = React.useContext(SelectCtx);
      return (
        <select
          aria-label={ctx.label.current}
          value={ctx.value}
          onChange={(e) => ctx.onValueChange?.(e.target.value)}
        >
          {children}
        </select>
      );
    },
    SelectItem: ({
      value,
      children,
    }: {
      value: string;
      children: ReactNode;
    }) => <option value={value}>{children}</option>,
  };
});

// t 回傳 key 本身，測試就用 key 當選取器。
// 例外：帶 `files`（擷取失敗的檔名）時接在 key 後面，才驗得到提示裡列了哪些檔。
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { files?: unknown }) =>
      typeof opts?.files === "string" ? `${key}|${opts.files}` : key,
    i18n: { language: "zh-TW" },
  }),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <SidebarProvider>{children}</SidebarProvider>
);

const K = {
  generate: "scenarioDialogue.setup.startGenerate",
  generateAnother: "scenarioDialogue.buttons.generateAnother",
  viewQuestions: "scenarioDialogue.buttons.viewQuestions",
  back: "scenarioDialogue.buttons.backToSettings",
  addQuestion: "scenarioDialogue.buttons.addQuestion",
  editSettings: "scenarioDialogue.buttons.editSettings",
  writeArticle: "scenarioDialogue.setup.writeArticle",
  next: "scenarioDialogue.setup.next",
  stepBack: "scenarioDialogue.setup.back",
  change: "scenarioDialogue.setup.change",
  reopenConfirm: "scenarioDialogue.setup.reopenConfirm",
  uploadImage: "scenarioDialogue.buttons.uploadImage",
  generateImage: "scenarioDialogue.buttons.generateImage",
  titlePlaceholder: "scenarioDialogue.placeholders.title",
  scenarioPlaceholder: "scenarioDialogue.placeholders.scenarioContent",
  goalPlaceholder: "scenarioDialogue.placeholders.goal",
  directionPlaceholder: "scenarioDialogue.setup.directionPlaceholder",
  questionPlaceholder: "scenarioDialogue.placeholders.question",
  rubricPlaceholder: "scenarioDialogue.placeholders.globalRubric",
  noContextYet: "scenarioDialogue.hints.noContextYet",
  noRubricYet: "scenarioDialogue.hints.noRubricYet",
  enterTitle: "contentEditor.messages.enterTitle",
  atLeastN: "contentEditor.messages.addAtLeastNItems",
  materialRequired: "scenarioDialogue.setup.materialRequired",
  mode: (m: "none" | "existing" | "ai") => `scenarioDialogue.setup.modes.${m}`,
  source: (s: "manual" | "ai") => `scenarioDialogue.setup.sources.${s}`,
};

/** 題目清單才有的「新增題目」按鈕，用來判斷現在在哪一個畫面 */
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

/** 對話裡的選項按鈕（已答的會變成泡泡，同一段文字不會再是按鈕） */
const choose = (label: string) =>
  fireEvent.click(screen.getByRole("button", { name: label }));
const chooseMode = (m: "none" | "existing" | "ai") => choose(K.mode(m));
const chooseSource = (s: "manual" | "ai") => choose(K.source(s));

/** 不需要情境＋自己出題 → 直接進題目清單（舊版的「跳過」） */
const goToListManually = () => {
  chooseMode("none");
  chooseSource("manual");
};

/** 貼上現成情境 → 請 AI 出題 → 停在出題設定卡 */
const fillRequiredForGenerate = () => {
  chooseMode("existing");
  type(K.scenarioPlaceholder, "你和同學在星期一早上聊天，聊各自的週末。");
  fireEvent.click(screen.getByText(K.next));
  chooseSource("ai");
};

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
      usable: true,
      reask: "",
      suggested_title: "AI 建議的標題",
      questions: Array.from({ length: count }, () => fakeQuestion(++seq)),
    }),
  );
  generateScenarioArticle.mockResolvedValue({
    usable: true,
    reask: "",
    suggested_title: "情境標題",
    content: "It is Monday morning at school.",
  });
  extractScenarioArticle.mockResolvedValue({ content: "Extracted passage." });
  generateTTS.mockResolvedValue({ audio_url: "https://cdn/audio.mp3" });
});

describe("ScenarioDialoguePanel 引導式對話（#1146）", () => {
  it("一開啟就是對話，第一題問「需要情境嗎？」，看不到題目清單", () => {
    renderPanel();

    expect(
      screen.getByText("scenarioDialogue.setup.q.mode"),
    ).toBeInTheDocument();
    for (const m of ["none", "existing", "ai"] as const) {
      expect(
        screen.getByRole("button", { name: K.mode(m) }),
      ).toBeInTheDocument();
    }
    // 舊的三分頁設定頁已移除
    expect(screen.queryByText("scenarioDialogue.tabs.sourceManual")).toBeNull();
    expect(onQuestionList()).toBe(false);
  });

  it("不需要情境＋自己出題 → 直接進題目清單，標題在清單頁", () => {
    renderPanel();
    goToListManually();

    expect(onQuestionList()).toBe(true);
    expect(screen.getByPlaceholderText(K.titlePlaceholder)).toBeInTheDocument();
  });

  it("題目清單按「上一步」回到對話，已答步驟顯示為泡泡，標題不會掉", () => {
    renderPanel();
    goToListManually();
    type(K.titlePlaceholder, "週末活動");

    fireEvent.click(screen.getByText(K.back));
    expect(onQuestionList()).toBe(false);
    expect(screen.getByText(K.mode("none"))).toBeInTheDocument();
    expect(screen.getByText(K.source("manual"))).toBeInTheDocument();
    // 已答的是泡泡，不是按鈕
    expect(screen.queryByRole("button", { name: K.mode("none") })).toBeNull();

    fireEvent.click(screen.getByText(K.viewQuestions));
    expect(screen.getByPlaceholderText(K.titlePlaceholder)).toHaveValue(
      "週末活動",
    );
  });

  it("「回上一步」重開前一步，不必確認", () => {
    renderPanel();
    chooseMode("existing");

    fireEvent.click(screen.getByText(K.stepBack));

    expect(
      screen.getByRole("button", { name: K.mode("ai") }),
    ).toBeInTheDocument();
    expect(screen.queryByText(K.reopenConfirm)).toBeNull();
  });

  it("改前面的回答而後面已經答過 → 先確認，確認後後面清空", () => {
    renderPanel();
    goToListManually();
    fireEvent.click(screen.getByText(K.back));

    // 第一個「改選」是「需要情境嗎？」那一步
    fireEvent.click(screen.getAllByText(K.change)[0]);
    expect(
      screen.getByText("scenarioDialogue.setup.reopenConfirmDescription"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: K.reopenConfirm }));

    expect(
      screen.getByRole("button", { name: K.mode("ai") }),
    ).toBeInTheDocument();
    // 「題目怎麼來？」的回答被清掉了
    expect(screen.queryByText(K.source("manual"))).toBeNull();
  });

  it("重開「需要情境嗎？」而情境框有內容 → 確認文字講明情境也會清掉（review 2-2）", () => {
    renderPanel();
    chooseMode("existing");
    type(K.scenarioPlaceholder, "老師貼好的情境。");
    fireEvent.click(screen.getByText(K.next));
    chooseSource("ai");

    fireEvent.click(screen.getAllByText(K.change)[0]);
    expect(
      screen.getByText("scenarioDialogue.setup.modeChangeConfirmDescription"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("scenarioDialogue.setup.reopenConfirmDescription"),
    ).toBeNull();
  });

  it("下一步／開始產生在底部列，不在輸入區或設定卡裡（修正第 2 輪）", () => {
    renderPanel();
    chooseMode("existing");
    const scenarioStep = document.querySelector('[data-step="scenario"]')!;
    expect(within(scenarioStep as HTMLElement).queryByText(K.next)).toBeNull();
    expect(screen.getByText(K.next)).toBeInTheDocument();

    type(K.scenarioPlaceholder, "It is Monday.");
    fireEvent.click(screen.getByText(K.next));
    chooseSource("ai");

    const card = screen.getByTestId("question-settings-card");
    expect(within(card).queryByText(K.generate)).toBeNull();
    expect(screen.getByText(K.generate)).toBeInTheDocument();
  });

  it("有現成的情境：沒貼東西「下一步」按不下去", () => {
    renderPanel();
    chooseMode("existing");

    expect(screen.getByText(K.next).closest("button")).toBeDisabled();
    type(K.scenarioPlaceholder, "It is Monday.");
    expect(screen.getByText(K.next).closest("button")).not.toBeDisabled();
  });

  it("貼上情境 → 請 AI 出題 → 出題設定卡 → 開始產生 → 題目清單", async () => {
    renderPanel();
    fillRequiredForGenerate();

    expect(screen.getByTestId("question-settings-card")).toBeInTheDocument();
    await runGenerate(K.generate);

    expect(onQuestionList()).toBe(true);
    expect(
      screen.getAllByPlaceholderText(K.questionPlaceholder).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("已有題目時回到對話，設定卡改成「再產一批」並可直接回清單", async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);
    const before = screen.getAllByPlaceholderText(K.questionPlaceholder).length;

    fireEvent.click(screen.getByText(K.back));
    expect(screen.queryByText(K.generate)).toBeNull();
    expect(screen.getByText(K.generateAnother)).toBeInTheDocument();

    fireEvent.click(screen.getByText(K.viewQuestions));
    expect(screen.getAllByPlaceholderText(K.questionPlaceholder).length).toBe(
      before,
    );
  });

  it("再產一批題目不會貼出重複的題目", async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);

    fireEvent.click(screen.getByText(K.back));
    await runGenerate(K.generateAnother);

    const all = screen
      .getAllByPlaceholderText(K.questionPlaceholder)
      .map((el) => (el as HTMLTextAreaElement).value)
      .filter(Boolean);
    expect(all.length).toBeGreaterThan(5);
    expect(new Set(all).size).toBe(all.length);
  });

  it("沒有情境時要先給「想問的方向」才能往下", () => {
    renderPanel();
    chooseMode("none");
    chooseSource("ai");

    expect(screen.getByText(K.next).closest("button")).toBeDisabled();
    type(K.directionPlaceholder, "問學生週末通常做什麼");
    fireEvent.click(screen.getByText(K.next));

    // 確認句帶出老師原話（t 被 mock 成回傳 key，所以驗的是用了帶方向的那一句）
    expect(
      screen.getByText("scenarioDialogue.setup.q.settingsWithDirection"),
    ).toBeInTheDocument();
  });

  it("無情境＋AI 出題：送出方向、情境留空", async () => {
    renderPanel();
    chooseMode("none");
    chooseSource("ai");
    type(K.directionPlaceholder, "問學生週末通常做什麼");
    fireEvent.click(screen.getByText(K.next));
    await runGenerate(K.generate);

    const sent = generateScenarioQuestions.mock.calls[0][0];
    expect(sent.direction).toBe("問學生週末通常做什麼");
    expect(sent.scenario_content).toBe("");
    expect(sent.scenario_images).toEqual([]);
    expect(onQuestionList()).toBe(true);
  });

  it("出題方向答非所問 → 回到方向那一步顯示重問句，不產題", async () => {
    generateScenarioQuestions.mockResolvedValueOnce({
      usable: false,
      reask: "想問哪方面呢？例如：週末活動。",
      suggested_title: "",
      questions: [],
    });
    renderPanel();
    chooseMode("none");
    chooseSource("ai");
    type(K.directionPlaceholder, "你好");
    fireEvent.click(screen.getByText(K.next));
    await runGenerate(K.generate);

    expect(
      screen.getByText("想問哪方面呢？例如：週末活動。"),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText(K.directionPlaceholder)).toHaveValue(
      "你好",
    );
    expect(onQuestionList()).toBe(false);
  });

  it("AI 出題建議的標題只在標題空白時填入", async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);

    expect(screen.getByPlaceholderText(K.titlePlaceholder)).toHaveValue(
      "AI 建議的標題",
    );

    // 老師改過之後，再產一批不會覆蓋
    type(K.titlePlaceholder, "老師自己的標題");
    await runGenerate(K.generateAnother);
    expect(screen.getByPlaceholderText(K.titlePlaceholder)).toHaveValue(
      "老師自己的標題",
    );
  });

  it("翻譯開關關著 → 不送語言、題目不填翻譯", async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);

    expect(generateScenarioQuestions.mock.calls[0][0].translate_language).toBe(
      "",
    );
    const translations = screen
      .queryAllByPlaceholderText("contentEditor.labels.selectLanguage")
      .map((el) => (el as HTMLTextAreaElement).value)
      .filter(Boolean);
    expect(translations).toEqual([]);
  });

  it("設定卡改題數會生效", async () => {
    renderPanel();
    fillRequiredForGenerate();
    fireEvent.change(
      screen.getByRole("combobox", {
        name: "scenarioDialogue.labels.generateCount",
      }),
      { target: { value: "8" } },
    );
    await runGenerate(K.generate);

    expect(generateScenarioQuestions.mock.calls[0][0].count).toBe(8);
  });

  it("題目清單對照欄帶入情境內容與作答指引，沒填則顯示空狀態", () => {
    renderPanel();
    goToListManually();
    expect(screen.getByText(K.noContextYet)).toBeInTheDocument();
    expect(screen.getByText(K.noRubricYet)).toBeInTheDocument();
  });
});

describe("ScenarioDialoguePanel 情境來源", () => {
  it("請 AI 幫我寫：送出訓練目標與文章難度，寫好的情境進情境框", async () => {
    renderPanel({ programLevel: "B1" });
    chooseMode("ai");
    type(K.goalPlaceholder, "這週上課學到的：交通工具與問路");
    await runGenerate(K.writeArticle);

    expect(generateScenarioArticle).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: "這週上課學到的：交通工具與問路",
        level: "B1",
      }),
    );
    expect(screen.getByPlaceholderText(K.scenarioPlaceholder)).toHaveValue(
      "It is Monday morning at school.",
    );
  });

  it("沒填訓練目標，「請 AI 寫情境」按不下去（省下一次白花的呼叫）", () => {
    renderPanel();
    chooseMode("ai");

    const button = screen.getByText(K.writeArticle).closest("button")!;
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(generateScenarioArticle).not.toHaveBeenCalled();
  });

  it("訓練目標答非所問 → 顯示重問句，不產情境", async () => {
    generateScenarioArticle.mockResolvedValueOnce({
      usable: false,
      reask: "想訓練什麼呢？例如：問路。",
      suggested_title: "",
      content: "",
    });
    renderPanel();
    chooseMode("ai");
    type(K.goalPlaceholder, "哈囉");
    await runGenerate(K.writeArticle);

    expect(screen.getByText("想訓練什麼呢？例如：問路。")).toBeInTheDocument();
    // 還停在訓練目標這一步，沒有出現情境框
    expect(screen.queryByPlaceholderText(K.scenarioPlaceholder)).toBeNull();
  });

  it("上傳檔案走擷取端點，多個檔案依序擷取再接起來", async () => {
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });
    chooseMode("existing");

    extractScenarioArticle
      .mockResolvedValueOnce({ content: "Page one." })
      .mockResolvedValueOnce({ content: "Page two." });

    const fileInput = container.querySelector(
      'input[accept="image/*,application/pdf"]',
    ) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["a"], "p1.png", { type: "image/png" }),
          new File(["b"], "p2.png", { type: "image/png" }),
        ],
      },
    });
    await waitFor(() =>
      expect(screen.getByPlaceholderText(K.scenarioPlaceholder)).toHaveValue(
        "Page one.\n\nPage two.",
      ),
    );
    expect(extractScenarioArticle).toHaveBeenCalledTimes(2);
  });

  it("多檔擷取中間一檔失敗：其他檔的文字照樣寫入，最後列出失敗檔名（review 1）", async () => {
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });
    chooseMode("existing");

    extractScenarioArticle
      .mockResolvedValueOnce({ content: "Page one." })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ content: "Page three." });

    const fileInput = container.querySelector(
      'input[accept="image/*,application/pdf"]',
    ) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["a"], "p1.png", { type: "image/png" }),
          new File(["b"], "p2.png", { type: "image/png" }),
          new File(["c"], "p3.png", { type: "image/png" }),
        ],
      },
    });
    await waitFor(() =>
      expect(screen.getByPlaceholderText(K.scenarioPlaceholder)).toHaveValue(
        "Page one.\n\nPage three.",
      ),
    );
    expect(extractScenarioArticle).toHaveBeenCalledTimes(3);
    // 提示只列第 2 檔（review 2-3：要驗到檔名，不只是 key）
    expect(mockToastError).toHaveBeenCalledWith(
      "scenarioDialogue.messages.extractFailedFiles|p2.png",
    );
  });

  it("擷取撞到額度（402）就停，不再送剩下的檔，沒送的也列進失敗（review 2-1）", async () => {
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });
    chooseMode("existing");

    extractScenarioArticle
      .mockResolvedValueOnce({ content: "Page one." })
      .mockRejectedValueOnce(new MockApiError(402, "quota"))
      .mockResolvedValueOnce({ content: "Page three." });

    const fileInput = container.querySelector(
      'input[accept="image/*,application/pdf"]',
    ) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["a"], "p1.png", { type: "image/png" }),
          new File(["b"], "p2.png", { type: "image/png" }),
          new File(["c"], "p3.png", { type: "image/png" }),
        ],
      },
    });
    await waitFor(() =>
      expect(screen.getByPlaceholderText(K.scenarioPlaceholder)).toHaveValue(
        "Page one.",
      ),
    );
    expect(extractScenarioArticle).toHaveBeenCalledTimes(2);
    expect(mockToastError).toHaveBeenCalledWith(
      "scenarioDialogue.messages.textQuotaExceeded",
    );
    expect(mockToastError).toHaveBeenCalledWith(
      "scenarioDialogue.messages.extractFailedFiles|p2.png, p3.png",
    );
  });

  it("每個檔都擷取失敗 → 用「全部失敗」那句，不說其他檔已放進情境框（review 2-1）", async () => {
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });
    chooseMode("existing");

    extractScenarioArticle
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ content: "" });

    const fileInput = container.querySelector(
      'input[accept="image/*,application/pdf"]',
    ) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["a"], "p1.png", { type: "image/png" }),
          new File(["b"], "p2.png", { type: "image/png" }),
        ],
      },
    });
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        "scenarioDialogue.messages.extractAllFailed|p1.png, p2.png",
      ),
    );
    expect(mockToastError).not.toHaveBeenCalledWith(
      expect.stringContaining("scenarioDialogue.messages.extractFailedFiles"),
    );
    expect(screen.getByPlaceholderText(K.scenarioPlaceholder)).toHaveValue("");
  });

  it("擷取回的標題建議在標題空白時填入（使用者決定 5）", async () => {
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });
    chooseMode("existing");
    extractScenarioArticle.mockResolvedValueOnce({
      content: "Extracted passage.",
      suggested_title: "講義標題",
    });

    const fileInput = container.querySelector(
      'input[accept="image/*,application/pdf"]',
    ) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["a"], "p1.png", { type: "image/png" })] },
    });
    await waitFor(() =>
      expect(screen.getByPlaceholderText(K.scenarioPlaceholder)).toHaveValue(
        "Extracted passage.",
      ),
    );
    expect(extractScenarioArticle).toHaveBeenCalledWith(
      expect.any(File),
      "zh-TW",
    );

    fireEvent.click(screen.getByText(K.next));
    chooseSource("manual");
    expect(screen.getByPlaceholderText(K.titlePlaceholder)).toHaveValue(
      "講義標題",
    );
  });

  it("情境框已有文字時改選別的情境來源 → 先確認，取消就保留（review 2）", () => {
    renderPanel();
    chooseMode("existing");
    type(K.scenarioPlaceholder, "老師貼好的情境。");

    // 「回上一步」不必確認（後面沒有已答步驟）……
    fireEvent.click(screen.getByText(K.stepBack));
    expect(screen.queryByText(K.reopenConfirm)).toBeNull();

    // ……但改選別的來源會清掉情境框，要先確認
    chooseMode("none");
    expect(
      screen.getByText("scenarioDialogue.setup.modeChangeConfirmDescription"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "contentEditor.buttons.cancel" }),
    );

    // 取消：還停在「需要情境嗎？」，選回原本的來源，文字還在
    chooseMode("existing");
    expect(screen.getByPlaceholderText(K.scenarioPlaceholder)).toHaveValue(
      "老師貼好的情境。",
    );
  });

  it("情境框已有文字時改選別的情境來源 → 確認後才清空", () => {
    renderPanel();
    chooseMode("existing");
    type(K.scenarioPlaceholder, "老師貼好的情境。");
    fireEvent.click(screen.getByText(K.stepBack));

    chooseMode("ai");
    fireEvent.click(screen.getByRole("button", { name: K.reopenConfirm }));

    expect(screen.getByPlaceholderText(K.goalPlaceholder)).toBeInTheDocument();
  });

  it("情境框是空的就直接改選，不跳確認", () => {
    renderPanel();
    chooseMode("existing");
    fireEvent.click(screen.getByText(K.stepBack));

    chooseMode("ai");
    expect(
      screen.queryByText("scenarioDialogue.setup.modeChangeConfirmDescription"),
    ).toBeNull();
    expect(screen.getByPlaceholderText(K.goalPlaceholder)).toBeInTheDocument();
  });

  it("情境內容生成中算 busy，儲存鍵才擋得住", async () => {
    const ref = renderPanel();
    chooseMode("ai");
    type(K.goalPlaceholder, "這週上課學到的：交通工具與問路");

    let finish!: (value: { content: string }) => void;
    generateScenarioArticle.mockReturnValue(
      new Promise<{ content: string }>((resolve) => {
        finish = resolve;
      }),
    );

    fireEvent.click(screen.getByText(K.writeArticle));
    await act(async () => {
      await Promise.resolve();
    });
    expect(ref.current?.isBusy).toBe(true);

    await act(async () => {
      finish({ content: "It is Monday morning." });
      await Promise.resolve();
    });

    expect(ref.current?.isBusy).toBe(false);
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
    chooseMode("ai");
    type(K.goalPlaceholder, "這週上課學到的：交通工具與問路");

    let finish!: (value: { content: string }) => void;
    generateScenarioArticle.mockReturnValue(
      new Promise<{ content: string }>((resolve) => {
        finish = resolve;
      }),
    );

    fireEvent.click(screen.getByText(K.writeArticle));
    await act(async () => {
      await Promise.resolve();
    });
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
    let finish!: (value: unknown) => void;
    generateScenarioQuestions.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(screen.getByText(K.generate));
    await act(async () => {
      await Promise.resolve();
    });
    expect(busy()).toBe("true");

    await act(async () => {
      finish({ usable: true, questions: [fakeQuestion(1)] });
      await Promise.resolve();
    });
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
    renderPanel();
    fillRequiredForGenerate();
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

    fireEvent.click(screen.getAllByTitle(REGEN)[0]);
    await act(async () => {
      await Promise.resolve();
    });

    expect(firstQuestion()).not.toBe(oldQuestion);
    expect(firstKeywords()).not.toBe(oldKeywords);
  });
});

describe("ScenarioDialoguePanel 儲存擋關", () => {
  it("沒填標題就儲存 → 擋下、留在題目清單並把游標帶到標題欄", async () => {
    vi.useFakeTimers();
    try {
      const onSave = vi.fn();
      const ref = renderPanel({ onSave });

      await act(async () => {
        await ref.current?.save();
      });
      await act(async () => {
        vi.runAllTimers();
      });

      expect(onSave).not.toHaveBeenCalled();
      expect(mockToastError).toHaveBeenCalledWith(K.enterTitle);
      expect(onQuestionList()).toBe(true);
      expect(document.activeElement).toBe(
        screen.getByPlaceholderText(K.titlePlaceholder),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("題數不足就儲存 → 擋下並把老師帶到題目清單", async () => {
    const onSave = vi.fn();
    const ref = renderPanel({ onSave });
    goToListManually();
    type(K.titlePlaceholder, "週末活動");

    await act(async () => {
      await ref.current?.save();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(K.atLeastN);
    expect(onQuestionList()).toBe(true);
  });

  it("情境內容是空的照樣能存 —— 它擋的是產題，不是儲存", async () => {
    const onSave = vi.fn();
    const ref = renderPanel({ onSave });
    goToListManually();
    type(K.titlePlaceholder, "週末活動");

    // 自己在題目清單打滿 3 題，全程沒碰情境內容
    fireEvent.change(screen.getAllByPlaceholderText(K.questionPlaceholder)[0], {
      target: { value: "Question one?" },
    });
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
      // 對話紀錄一起存，「上一步」才還原得出來
      scenarioMode: "none",
      questionSource: "manual",
      scenarioImages: [],
    });
  });

  it("標題、情境內容、題數都齊全 → 真的送出，對話紀錄一起帶上", async () => {
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
    expect(payload.title).toBe("AI 建議的標題");
    expect(payload.scenarioContent).not.toBe("");
    expect(payload.scenarioMode).toBe("existing");
    expect(payload.questionSource).toBe("ai");
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

  /** 圖片欄位只存在於題目卡，所以每個案例都得先進題目清單 */
  const gotoList = () => goToListManually();

  const imageInputs = (container: HTMLElement) =>
    container.querySelectorAll<HTMLInputElement>('input[accept="image/*"]');

  const upload = (input: HTMLInputElement, name: string) =>
    fireEvent.change(input, {
      target: { files: [new File(["x"], name, { type: "image/png" })] },
    });

  it("空圖框有「上傳」，AI 那顆則標示為即將推出（#1044）", () => {
    // 兩個版位都還在畫面上 —— 整個藏起來的話，老師會以為沒有這個功能。
    // AI 那顆的文字換成「即將推出」，原因看得見、不必點（見 #1044 的 describe）。
    renderPanel();
    gotoList();

    expect(screen.getAllByText(K.uploadImage).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("scenarioDialogue.buttons.comingSoon").length,
    ).toBeGreaterThan(0);
  });

  it("對話一開始沒有題目圖片欄位", () => {
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
    fireEvent.click(
      screen.getAllByTitle("contentEditor.tooltips.duplicate")[0],
    );

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
    fireEvent.click(
      screen.getAllByTitle("contentEditor.tooltips.duplicate")[0],
    );
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
describe("ScenarioDialoguePanel 編輯模式（#1013 / #1146）", () => {
  const row = (
    id: string,
    contentItemId: number,
    question: string,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    contentItemId,
    question,
    translation: "",
    tenseOverride: null,
    voiceOverride: null,
    keywords: [],
    referenceAnswer: "",
    rubricNote: "",
    imagePrompt: "",
    imageUrl: null,
    audioUrl: null,
    revision: 0,
    ...extra,
  });

  const initialData = {
    title: "週末活動",
    scenarioContent: "你和同學在星期一早上聊天。",
    scenarioImages: ["https://cdn/scene-1.png"],
    // 舊資料沒有對話紀錄 → 由情境有無推斷
    scenarioMode: "",
    questionSource: "",
    goal: "",
    articleLevel: "",
    direction: "",
    questionLevel: "B1",
    globalRubric: "請用完整句子回答",
    globalTense: { time: "past", aspect: "simple" },
    globalVoice: "active",
    translateLanguage: "chinese",
    ttsSettings: { accent: "US", gender: "Female", speed: "Normal x1" },
    rows: [
      row("r1", 11, "What did you do last weekend?", {
        translation: "你上週末做了什麼？",
        keywords: ["park"],
        referenceAnswer: "I went to the park.",
      }),
      row("r2", 12, "And on Sunday?", {
        tenseOverride: { time: "", aspect: "" },
        voiceOverride: "",
      }),
      // 第三題純粹是為了滿足 MIN_ITEMS（3 題），存檔才不會被擋下
      row("r3", 13, "Who did you go with?"),
    ],
  };

  it("帶 initialData 時直接落在題目清單，並顯示既有題目與標題", () => {
    renderPanel({ initialData });

    expect(onQuestionList()).toBe(true);
    expect(screen.getByDisplayValue("週末活動")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("What did you do last weekend?"),
    ).toBeInTheDocument();
    // 對照欄看得到情境圖（唯讀）
    expect(
      document.querySelector('img[src="https://cdn/scene-1.png"]'),
    ).toBeInTheDocument();
  });

  it("舊資料按「上一步」回對話：由已存的情境推斷已答步驟", () => {
    renderPanel({ initialData });

    fireEvent.click(screen.getByText(K.editSettings));

    expect(screen.getByText(K.mode("existing"))).toBeInTheDocument();
    expect(screen.getByText(K.source("manual"))).toBeInTheDocument();
  });

  it("新資料按「上一步」回對話：照存下來的回答還原，AI 出題時停在設定卡", () => {
    renderPanel({
      initialData: {
        ...initialData,
        scenarioContent: "",
        scenarioImages: [],
        scenarioMode: "none",
        questionSource: "ai",
        direction: "問學生週末做什麼",
      },
    });

    fireEvent.click(screen.getByText(K.back));

    expect(screen.getByText(K.mode("none"))).toBeInTheDocument();
    expect(screen.getByText(K.source("ai"))).toBeInTheDocument();
    expect(screen.getByText("「問學生週末做什麼」")).toBeInTheDocument();
    expect(screen.getByTestId("question-settings-card")).toBeInTheDocument();
  });

  it("改選情境模式後再選回同一個，已填的情境還在", () => {
    renderPanel({ initialData });
    fireEvent.click(screen.getByText(K.editSettings));

    fireEvent.click(screen.getAllByText(K.change)[0]);
    fireEvent.click(screen.getByRole("button", { name: K.reopenConfirm }));
    chooseMode("existing");

    expect(screen.getByPlaceholderText(K.scenarioPlaceholder)).toHaveValue(
      "你和同學在星期一早上聊天。",
    );
  });

  it("存檔交出的資料保留 DB id、override 的 null／空值差別與情境圖", async () => {
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
    expect(data.scenarioImages).toEqual(["https://cdn/scene-1.png"]);
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
 * Issue #1021：AI 真的接上後端了 —— 填了什麼，有沒有真的送出去。
 */
describe("ScenarioDialoguePanel AI 串接（#1021）", () => {
  it("產題會把情境內容與整份出題設定一起送出", async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);

    expect(generateScenarioQuestions).toHaveBeenCalledTimes(1);
    const sent = generateScenarioQuestions.mock.calls[0][0];
    expect(sent.scenario_content).toContain("你和同學在星期一早上聊天");
    expect(sent.count).toBe(5);
    // 時態送的是穩定代碼物件，不是畫面上的中文標籤
    expect(sent.global_tense).toEqual({ time: "", aspect: "" });
    expect(sent).toHaveProperty("question_level");
    expect(sent).toHaveProperty("global_rubric");
    // 有情境時不帶出題方向
    expect(sent.direction).toBe("");
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
});

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
  /**
   * #1044 把生圖入口關掉了，但**生圖的程式碼路徑完整保留著**（之後要開回來）。
   * 這個 describe 驗的就是那條路徑，所以明確把旗標開起來 —— 否則這些測試會跟著
   * 當下的開關狀態一起紅，而開關狀態不是它們要守的東西。
   * 關閉時的行為由下面「生圖 coming soon」那個 describe 負責。
   */
  beforeEach(() => {
    mockFlags.SCENARIO_IMAGE_GENERATION = true;
  });

  afterEach(() => {
    mockFlags.SCENARIO_IMAGE_GENERATION = false;
  });

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
      new MockApiError(402, {
        error: "SCENARIO_IMAGE_QUOTA_EXCEEDED",
        message: "本月 AI 生成圖片次數已用完，可以改用手動上傳圖片。",
      }),
    );
    await prepareRows();

    await generateImageFor(0);

    expect(mockToastError).toHaveBeenCalledWith(
      "scenarioDialogue.messages.imageQuotaExceeded",
    );
  });

  it("被安全過濾擋下（422）會請老師換個描述", async () => {
    generateScenarioImage.mockRejectedValue(
      new MockApiError(422, { message: "描述被安全過濾擋下，請換個說法" }),
    );
    await prepareRows();

    await generateImageFor(0);

    expect(mockToastError).toHaveBeenCalledWith(
      "scenarioDialogue.messages.imageBlocked",
    );
  });

  it("其他錯誤是「稍後再試」，不會誤導成額度或描述問題", async () => {
    generateScenarioImage.mockRejectedValue(
      new MockApiError(500, { message: "伺服器錯誤" }),
    );
    await prepareRows();

    await generateImageFor(0);

    expect(mockToastError).toHaveBeenCalledWith(
      "scenarioDialogue.messages.imageFailed",
    );
  });
});

/**
 * 生圖 coming soon（Issue #1044）
 *
 * 實測發現生圖品質與流程還要調整，團隊決定先把「出內容 → 出作業 → 學生作答」整條
 * 主線做完整，之後再回頭修。這段期間入口關著，但要關得讓老師看得懂。
 *
 * 最重要的一條是**原因要看得見，不必點才知道**：按鈕文字直接寫「即將推出」，
 * title 補完整說明（ui-style-guide §3 規則 3 與 BulkActionBar 的 disabledBadge
 * 就是這個慣例）。
 *
 * 原因既然不藏在 click 後面，就沒有 #1033 那個坑 —— 那次的問題是「唯一的說明被原生
 * disabled 吃掉」，不是「不能用原生 disabled」。所以這裡用原生 disabled 是對的。
 */
describe("ScenarioDialoguePanel 生圖 coming soon（#1044）", () => {
  const gotoList = () => goToListManually();

  beforeEach(() => {
    mockFlags.SCENARIO_IMAGE_GENERATION = false;
    generateScenarioImage.mockReset();
    // 本機 review 抓到：這個 describe 原本沒自己補 createObjectURL，
    // 只是靠別的 describe 洩漏的 global stub 才過。單獨跑會 TypeError。
    global.URL.createObjectURL = vi.fn(
      () => "blob:coming-soon",
    ) as unknown as typeof URL.createObjectURL;
    global.URL.revokeObjectURL =
      vi.fn() as unknown as typeof URL.revokeObjectURL;
  });

  // 最後一條會把旗標開起來，不還原會汙染後面的 describe（本機 review 抓到）
  afterEach(() => {
    mockFlags.SCENARIO_IMAGE_GENERATION = false;
  });

  const generateButton = () =>
    screen
      .getAllByText("scenarioDialogue.buttons.comingSoon")[0]
      .closest("button") as HTMLButtonElement;

  it("原因直接寫在按鈕上，不必點才知道", () => {
    renderPanel();
    gotoList();

    // 專案慣例（ui-style-guide §3 規則 3 / BulkActionBar 的 disabledBadge）是
    // 「原因要看得見」。原因不藏在 click 後面，就沒有 #1033 那個坑。
    expect(generateButton()).toHaveAttribute(
      "title",
      "scenarioDialogue.messages.imageGenerationComingSoon",
    );
  });

  it("停用狀態不會打生圖 API", () => {
    renderPanel();
    gotoList();

    // 先釘住「它真的是停用的」—— 否則下面那句 click 在原生 disabled 的按鈕上
    // 本來就不會派發事件，斷言會**不管實作對不對都通過**（review 指出的空驗）
    expect(generateButton()).toBeDisabled();

    fireEvent.click(generateButton());

    expect(generateScenarioImage).not.toHaveBeenCalled();
  });

  it("看得出是停用狀態", () => {
    renderPanel();
    gotoList();

    expect(generateButton()).toBeDisabled();
    const className = generateButton().className;
    expect(className).not.toContain("bg-blue-600");
    // 明確釘住停用的視覺，否則被人改成「看起來可按」也不會紅
    expect(className).toContain("bg-gray-100");
    expect(className).toContain("text-gray-400");
    expect(className).toContain("cursor-not-allowed");
  });

  it("長文字不會把 104px 的圖框擠爆", () => {
    renderPanel();
    gotoList();

    // 兩顆按鈕都要 nowrap —— 英文標籤在 12px 下接近框寬上限，換行會把圖框撐開
    expect(generateButton().className).toContain("whitespace-nowrap");
    const uploadButton = screen
      .getAllByText(K.uploadImage)[0]
      .closest("button") as HTMLButtonElement;
    expect(uploadButton.className).toContain("whitespace-nowrap");
  });

  it("手動上傳完全不受影響 —— 這段期間它是主要途徑", () => {
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });
    gotoList();

    const input = container.querySelector<HTMLInputElement>(
      'input[accept="image/*"]',
    )!;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "a.png", { type: "image/png" })] },
    });

    expect(container.querySelector("img")).toBeInTheDocument();
  });

  it("旗標打開時回到正常的生圖按鈕", () => {
    mockFlags.SCENARIO_IMAGE_GENERATION = true;
    renderPanel();
    gotoList();

    expect(
      screen.queryByText("scenarioDialogue.buttons.comingSoon"),
    ).not.toBeInTheDocument();
    const button = screen
      .getAllByText("scenarioDialogue.buttons.generateImage")[0]
      .closest("button") as HTMLButtonElement;
    expect(button).not.toBeDisabled();
    expect(button.className).toContain("bg-blue-600");
  });
});

/**
 * 字級（Issue #1044）
 *
 * 面板原本有 34 處低於 12px（21 個 10px、13 個 11px），而專案對照的
 * VocabularySetPanel 以 14px 為主體 —— 整個面板比專案其他地方小了約一個級距。
 *
 * 這條守的是「不要再有人補一個 text-[10px] 回來」。驗 class 而不是驗算出來的像素，
 * 因為 jsdom 不跑 Tailwind，算出來的值一律是預設字級。
 *
 * **兩個步驟都要掃，而且要把收合區塊展開**（本機 review 抓到）：Step 1 是
 * `{step === 1 && …}`，進 Step 2 後整個卸載，這張單修的多數位置其實在 Step 1；
 * 逐題的備註區塊預設收合，裡面的輸入也掃不到。只掃 Step 2 的話，把
 * `text-[10px]` 放回去測試還是綠的。
 */
describe("ScenarioDialoguePanel 字級收斂回 Tailwind 級距（#1044）", () => {
  /**
   * 禁止**所有**任意字級值（`text-[...]`），不只 10／11px。
   *
   * 這張單的目的是把字級收斂回 Tailwind 既有級距，所以守衛也照這個標準 ——
   * 只擋 10/11px 的話，`text-[0.7rem]`、`text-[9px]` 這類寫法會漏掉（review 指出）。
   * 真的需要某個中間級距時，應該是先問「為什麼級距不夠用」，不是繞過守衛。
   */
  const tooSmallIn = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("*"))
      .map((el) => el.className?.toString?.() ?? "")
      .filter((c) => /\btext-\[[^\]]+\]/.test(c));

  it("對話（含出題設定卡）沒有任意字級值", () => {
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });
    expect(tooSmallIn(container)).toEqual([]);

    fillRequiredForGenerate();
    expect(screen.getByTestId("question-settings-card")).toBeInTheDocument();
    expect(tooSmallIn(container)).toEqual([]);
  });

  it("Step 2（題目清單）沒有任意字級值，含展開的備註區塊", () => {
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });
    goToListManually();

    // 備註／參考答案預設收合，不展開就掃不到裡面的輸入
    screen
      .getAllByText("scenarioDialogue.labels.advanced")
      .forEach((el) => fireEvent.click(el));

    expect(tooSmallIn(container)).toEqual([]);
  });
});

/**
 * 圖片欄位的標籤寬度預算（Issue #1044）
 *
 * 圖框固定 `w-[104px]` 且 `overflow-hidden`，扣掉 `p-1.5` 兩側只剩 92px。字級從 10px
 * 提到 12px 之後，標籤再長一點就會被切掉 —— 而 jsdom 量不到版面，`whitespace-nowrap`
 * 的測試也偵測不到溢出。
 *
 * 所以把那個預算從「註解裡的一行字」變成**會紅的測試**：新增語系或改標籤時會直接
 * 在這裡被攔下來，而不是等到有人回報畫面被切掉（review R3 第 3 點）。
 */
describe("ScenarioDialoguePanel 圖框標籤寬度預算（#1044）", () => {
  // text-xs（12px）下的粗略字寬：CJK 約等於字級，拉丁字母約一半多一點。
  //
  // 用 charCodeAt 判斷而不是字元類別的正規表示式 —— 那種寫法要嵌 U+3000（全角空格）
  // 之類的碼點，會被 eslint 的 no-irregular-whitespace 擋下來（而且那個錯誤訊息
  // 完全看不出跟寬度估算有關）。
  const CJK_START = 0x2e80;
  const estimateWidth = (text: string) =>
    [...text].reduce(
      (sum, ch) => sum + ((ch.codePointAt(0) ?? 0) >= CJK_START ? 12 : 6.7),
      0,
    );

  const SLOT_WIDTH = 104;
  const PADDING = 6 * 2; // p-1.5 兩側
  const ICON_AND_GAP = 14 + 4; // h-3.5 圖示 + gap-1
  const BUDGET = SLOT_WIDTH - PADDING;

  const locales = ["zh-TW", "en"] as const;

  it.each(locales)("%s 的「上傳」標籤（含圖示）塞得進 92px", async (locale) => {
    const dict = await import(`@/i18n/locales/${locale}/translation.json`);
    const label = dict.default.scenarioDialogue.buttons.uploadImage;

    expect(estimateWidth(label) + ICON_AND_GAP).toBeLessThanOrEqual(BUDGET);
  });

  it.each(locales)(
    "%s 的「即將推出」標籤（無圖示）塞得進 92px",
    async (locale) => {
      const dict = await import(`@/i18n/locales/${locale}/translation.json`);
      const label = dict.default.scenarioDialogue.buttons.comingSoon;

      expect(estimateWidth(label)).toBeLessThanOrEqual(BUDGET);
    },
  );
});

/**
 * 文字 AI 額度用完的提示（Issue #1025）
 *
 * 402 要與一般失敗分開講。老師可能已經填好半份設定，給他一句「稍後再試」等於叫他
 * 白等 —— 這個月不會再成功。所以要明講額度用完、下個月重置、現在改用手動輸入。
 */
describe("ScenarioDialoguePanel 文字 AI 額度用完（#1025）", () => {
  // 後端回的 detail 形狀；message 是中文句子，**不含** "402" 或錯誤碼 ——
  // 這正是為什麼不能比對字串
  const QUOTA_ERROR = new MockApiError(402, {
    error: "SCENARIO_TEXT_QUOTA_EXCEEDED",
    message:
      "本月情境對話 AI 次數已用完，可以改用手動輸入；下個月 1 日自動重置。",
  });

  beforeEach(() => {
    mockToastError.mockClear();
  });

  it("產題撞到額度 → 講額度，不是「稍後再試」", async () => {
    generateScenarioQuestions.mockRejectedValue(QUOTA_ERROR);
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);

    expect(mockToastError).toHaveBeenCalledWith(
      "scenarioDialogue.messages.textQuotaExceeded",
    );
  });

  it("生成情境文章撞到額度 → 同一句提示", async () => {
    // 生成情境文章在對話「請 AI 幫我寫」那一步，訓練目標是必填（#1021）
    generateScenarioArticle.mockRejectedValue(QUOTA_ERROR);
    renderPanel();
    chooseMode("ai");
    type(K.goalPlaceholder, "交通工具與問路");
    await runGenerate(K.writeArticle);

    expect(mockToastError).toHaveBeenCalledWith(
      "scenarioDialogue.messages.textQuotaExceeded",
    );
  });

  it("其他失敗仍然是一般的「產生失敗」，不會誤報成額度問題", async () => {
    generateScenarioQuestions.mockRejectedValue(
      new MockApiError(500, { message: "伺服器錯誤" }),
    );
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);

    expect(mockToastError).toHaveBeenCalledWith(
      "scenarioDialogue.messages.generateFailed",
    );
  });

  it("撞到額度之後，老師填過的設定不會被清掉", async () => {
    // 這是「改用手動輸入」這句話成立的前提 —— 設定被清掉的話等於前功盡棄
    generateScenarioQuestions.mockRejectedValue(QUOTA_ERROR);
    renderPanel();
    fillRequiredForGenerate();
    type(K.rubricPlaceholder, "請用完整句子回答");

    await runGenerate(K.generate);

    // 還停在設定卡，填過的作答指引還在
    expect(screen.getByTestId("question-settings-card")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(K.rubricPlaceholder)).toHaveValue(
      "請用完整句子回答",
    );
  });
});

describe("ScenarioDialoguePanel 第 3 輪畫面修正（#1146）", () => {
  it("「需要情境嗎？」是直排選項卡：主句當按鈕名稱，說明行另外掛上", () => {
    renderPanel();

    const existing = screen.getByRole("button", { name: K.mode("existing") });
    expect(existing).toHaveAccessibleDescription(
      "scenarioDialogue.setup.modeHints.existing",
    );
    // 沒有說明的選項不掛說明
    expect(
      screen.getByRole("button", { name: K.mode("none") }),
    ).not.toHaveAttribute("aria-describedby");
  });

  it("「題目怎麼來？」用同一種選項卡", () => {
    renderPanel();
    chooseMode("none");

    const manual = screen.getByRole("button", { name: K.source("manual") });
    const ai = screen.getByRole("button", { name: K.source("ai") });
    expect(manual.className).toBe(ai.className);
    expect(manual).toHaveClass("w-full", "text-left");
  });

  it("選完後老師泡泡只顯示主句，不含說明行", () => {
    renderPanel();
    chooseMode("existing");

    expect(screen.getByText(K.mode("existing"))).toBeInTheDocument();
    expect(
      screen.queryByText("scenarioDialogue.setup.modeHints.existing"),
    ).toBeNull();
  });

  it("從題目清單回到設定卡：「查看題目清單」是主按鈕，「再產一批」是次要", async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);

    fireEvent.click(screen.getByText(K.back));

    const view = screen.getByRole("button", { name: K.viewQuestions });
    const again = screen.getByRole("button", { name: K.generateAnother });
    // 主按鈕＝預設變體（藍底）；次要＝outline 變體（灰框、不帶藍底）。
    // 不能用 shadcn 原本的 border-input 判斷：本專案 outline 變體是 border-gray-300。
    expect(view).toHaveClass("bg-blue-600");
    expect(again).toHaveClass("border-gray-300");
    expect(again).not.toHaveClass("bg-blue-600");
  });

  it("從題目清單回到設定卡：主按鈕在最右，「再產一批」排在它左邊", async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);

    fireEvent.click(screen.getByText(K.back));

    const view = screen.getByRole("button", { name: K.viewQuestions });
    const again = screen.getByRole("button", { name: K.generateAnother });
    // 同一排裡 DOM 順序就是左到右
    expect(
      again.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(view.parentElement?.lastElementChild).toBe(view);
  });

  it("從題目清單回到對話時，自動捲到底部列", async () => {
    const original = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      renderPanel();
      fillRequiredForGenerate();
      await runGenerate(K.generate);
      scrollIntoView.mockClear();

      fireEvent.click(screen.getByText(K.back));

      expect(scrollIntoView).toHaveBeenCalledWith({ block: "end" });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("還沒有題目時：設定卡的「開始產生」是主按鈕，沒有「查看題目清單」", () => {
    renderPanel();
    fillRequiredForGenerate();

    const start = screen.getByRole("button", { name: K.generate });
    expect(start).toHaveClass("bg-blue-600");
    expect(screen.queryByRole("button", { name: K.viewQuestions })).toBeNull();
  });

  it("滿 10 題時題目卡的複製鍵停用，並說明已達上限", () => {
    renderPanel();
    goToListManually();
    for (let i = 0; i < 9; i++) {
      fireEvent.click(screen.getByText(K.addQuestion));
    }

    const copies = screen.getAllByTitle("scenarioDialogue.hints.maxReached");
    expect(copies).toHaveLength(10);
    for (const btn of copies) expect(btn).toBeDisabled();
    expect(screen.queryByTitle("contentEditor.tooltips.duplicate")).toBeNull();
  });

  it("題目卡的複製鍵有正確的提示文字", () => {
    renderPanel();
    goToListManually();

    expect(
      screen.getByTitle("contentEditor.tooltips.duplicate"),
    ).toBeInTheDocument();
    expect(screen.queryByTitle("contentEditor.tooltips.copy")).toBeNull();
  });

  it("停用的刪除與生成語音會說明原因", () => {
    renderPanel();
    goToListManually();

    // 只有 1 題：刪除停用，提示說明至少要留 1 題
    const del = screen.getByTitle("scenarioDialogue.tooltips.deleteDisabled");
    expect(del).toBeDisabled();
    // 還沒打題目：生成語音停用，提示說明要先輸入題目
    const audio = screen.getByTitle(
      "scenarioDialogue.tooltips.generateAudioDisabled",
    );
    expect(audio).toBeDisabled();

    type(K.questionPlaceholder, "What did you do last weekend?");
    expect(
      screen.getByTitle("scenarioDialogue.tooltips.generateAudio"),
    ).not.toBeDisabled();

    fireEvent.click(screen.getByText(K.addQuestion));
    expect(
      screen.getAllByTitle("contentEditor.tooltips.delete")[0],
    ).not.toBeDisabled();
  });

  it("題目清單的情境文章：長文在窄寬度先收合，可展開", async () => {
    renderPanel();
    chooseMode("existing");
    type(K.scenarioPlaceholder, "It is Monday morning. ".repeat(20));
    fireEvent.click(screen.getByText(K.next));
    chooseSource("manual");

    const text = screen.getByTestId("reference-scenario-text");
    expect(text).toHaveClass("line-clamp-4");
    const toggle = screen.getByRole("button", {
      name: "scenarioDialogue.buttons.expandScenario",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(text).not.toHaveClass("line-clamp-4");
    expect(
      screen.getByRole("button", {
        name: "scenarioDialogue.buttons.collapseScenario",
      }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("短的情境文章不收合、也沒有展開鍵", () => {
    renderPanel();
    chooseMode("existing");
    type(K.scenarioPlaceholder, "It is Monday.");
    fireEvent.click(screen.getByText(K.next));
    chooseSource("manual");

    expect(screen.getByTestId("reference-scenario-text")).not.toHaveClass(
      "line-clamp-4",
    );
    expect(
      screen.queryByRole("button", {
        name: "scenarioDialogue.buttons.expandScenario",
      }),
    ).toBeNull();
  });
});
