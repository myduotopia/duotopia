/**
 * ScenarioDialoguePanel — 引導式對話（#1146）＋題目清單（#944），#1158 C commit 4 起是同頁版面
 *
 * 釘住幾件容易在改版時走鐘、但畫面看起來都正常的行為：
 * 1. 左對話、右題目共用同一份 state，切分頁、跨過寬度門檻都不會弄丟填過的東西
 * 2. 「標題必填」擋的是儲存、「情境／出題方向」擋的是 AI 產題 —— 兩者不同
 * 3. 在已選項目列改答案：要清東西時先確認，已產生的題目保留；對話紀錄只往下加一句
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
import { ScenarioDialogueEditorSheet } from "../ScenarioDialogueEditorSheet";
import { SidebarProvider, useSidebar } from "@/contexts/SidebarContext";

const mockToastError = vi.fn();
const mockToastInfo = vi.fn();

// #1021: 產題／生成情境文章／擷取／TTS 都真的打 API 了，這裡一律 mock。
// 預設回傳足夠的題目，讓「產一批」相關的測試維持原本的行為斷言。
const generateScenarioQuestions = vi.fn();
const generateScenarioArticle = vi.fn();
const extractScenarioArticle = vi.fn();
const generateTTS = vi.fn();
const generateScenarioImage = vi.fn();
const getScenarioImageQuota = vi.fn();
const suggestScenarioImageDescription = vi.fn();

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
    getScenarioImageQuota: (...a: unknown[]) => getScenarioImageQuota(...a),
    suggestScenarioImageDescription: (...a: unknown[]) =>
      suggestScenarioImageDescription(...a),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: vi.fn(),
    info: (...args: unknown[]) => mockToastInfo(...args),
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
  addQuestion: "scenarioDialogue.buttons.addQuestion",
  useScenario: "scenarioDialogue.setup.useScenario",
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
  questionsEmpty: "scenarioDialogue.hints.questionsEmpty",
  enterTitle: "contentEditor.messages.enterTitle",
  atLeastN: "contentEditor.messages.addAtLeastNItems",
  materialRequired: "scenarioDialogue.setup.materialRequired",
  composer: "guidedChat.composer.label",
  send: "guidedChat.composer.send",
  choiceHint: "guidedChat.placeholders.choice",
  changed: "guidedChat.log.changed",
  apply: "guidedChat.chips.apply",
  editScenario: "scenarioDialogue.setup.chips.editScenario",
  contextEdit: "scenarioDialogue.context.edit",
  contextDone: "scenarioDialogue.context.done",
  rewrite: "scenarioDialogue.context.rewrite",
  rewriteConfirm: "scenarioDialogue.setup.rewriteConfirm",
  fullReason: "scenarioDialogue.setup.fullReason",
  mode: (m: "none" | "existing" | "ai") => `scenarioDialogue.setup.modes.${m}`,
  source: (s: "manual" | "ai") => `scenarioDialogue.setup.sources.${s}`,
};

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

/** 底部對話框 */
const composerBox = () => screen.getByRole("textbox", { name: K.composer });
const sendButton = () => screen.getByRole("button", { name: K.send });
/** 在底部對話框打字並送出（等 AI 呼叫的 promise 跑完） */
const say = async (value: string) => {
  fireEvent.change(composerBox(), { target: { value } });
  fireEvent.click(sendButton());
  await act(async () => {
    await Promise.resolve();
  });
};

/** 已選項目列的標籤 */
const chip = (id: string) =>
  document.querySelector<HTMLElement>(`[data-chip="${id}"]`);
/** 點標籤打開 Popover，回傳 Popover 內容 */
const openChip = (id: string) => {
  fireEvent.click(chip(id)!);
  return screen.getByRole("dialog");
};

/** 右欄（題目那一側）、左欄（對話那一側） */
const sideColumn = () => screen.getByTestId("guided-chat-column-side");
const chatColumn = () => screen.getByTestId("guided-chat-column-chat");

/** 在右欄新增一題並打字 */
const addTypedQuestion = (value: string) => {
  fireEvent.click(screen.getByText(K.addQuestion));
  const boxes = screen.getAllByPlaceholderText(K.questionPlaceholder);
  fireEvent.change(boxes[boxes.length - 1], { target: { value } });
};

/** 不需要情境＋自己出題，並在右欄新增一張空白題目卡 */
const goToListManually = () => {
  chooseMode("none");
  chooseSource("manual");
  fireEvent.click(screen.getByText(K.addQuestion));
};

/** 貼上現成情境 → 用這篇情境 → 請 AI 出題 → 停在出題設定卡 */
const fillRequiredForGenerate = () => {
  chooseMode("existing");
  type(K.scenarioPlaceholder, "你和同學在星期一早上聊天，聊各自的週末。");
  fireEvent.click(screen.getByText(K.useScenario));
  chooseSource("ai");
};

/** 不需要情境 → 請 AI 出題 → 在對話框給方向 → 停在出題設定卡 */
const fillDirectionForGenerate = async (direction = "問學生週末通常做什麼") => {
  chooseMode("none");
  chooseSource("ai");
  await say(direction);
};

/** 產題／生成情境文章都是 async API 呼叫（#1021），點下去等 promise 跑完即可 */
const runGenerate = async (label: string) => {
  fireEvent.click(screen.getByText(label));
  await act(async () => {
    await Promise.resolve();
  });
};

/** 對話紀錄裡的「已把○○改成：…」 */
const changedNotes = () =>
  within(chatColumn()).queryAllByText(K.changed).length;

beforeEach(() => {
  mockToastError.mockClear();
  mockToastInfo.mockClear();
  generateScenarioQuestions.mockReset();
  generateScenarioArticle.mockReset();
  extractScenarioArticle.mockReset();
  generateTTS.mockReset();
  generateScenarioImage.mockReset();
  getScenarioImageQuota.mockReset();
  getScenarioImageQuota.mockResolvedValue({
    billing: "free_daily",
    remaining: 3,
    limit: 3,
    period: "day",
    points_per_image_estimate: 10,
    can_generate: true,
  });
  suggestScenarioImageDescription.mockReset();
  suggestScenarioImageDescription.mockResolvedValue({
    description: "A suggested scene",
  });

  // 每次呼叫都給「還沒出現過」的題目
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

describe("ScenarioDialoguePanel 引導式對話（#1146／#1158 同頁版面）", () => {
  it("一開啟：左邊問「需要情境嗎？」，右邊是標題與「題目會出現在這裡」", () => {
    renderPanel();

    expect(
      screen.getByText("scenarioDialogue.setup.q.mode"),
    ).toBeInTheDocument();
    for (const m of ["none", "existing", "ai"] as const) {
      expect(
        screen.getByRole("button", { name: K.mode(m) }),
      ).toBeInTheDocument();
    }
    expect(screen.getByPlaceholderText(K.titlePlaceholder)).toBeInTheDocument();
    expect(screen.getByTestId("scenario-questions-empty")).toHaveTextContent(
      K.questionsEmpty,
    );
    // 還沒回答任何一步：沒有已選項目列
    expect(screen.queryByTestId("guided-chat-chips")).toBeNull();
    // 選項步驟：灰字請老師點選項
    expect(composerBox()).toHaveAttribute("placeholder", K.choiceHint);
  });

  it("不需要情境＋自己出題：接著問「請直接把題目打在下面」，不跳到空白清單", () => {
    renderPanel();
    chooseMode("none");
    chooseSource("manual");

    expect(
      screen.getByText("scenarioDialogue.setup.q.manualInput"),
    ).toBeInTheDocument();
    // 沒有自動塞空白卡：右欄仍是空狀態，老師可按「＋ 新增題目」自己打
    expect(screen.getByTestId("scenario-questions-empty")).toBeInTheDocument();
    expect(screen.queryAllByPlaceholderText(K.questionPlaceholder)).toEqual([]);
  });

  it("「自己打題目」要交給 AI 判斷（C 段第 5 段才接上）：對話框先停用，灰字是步驟提示", () => {
    renderPanel();
    chooseMode("none");
    chooseSource("manual");

    expect(composerBox()).toBeDisabled();
    expect(composerBox()).toHaveAttribute(
      "placeholder",
      "scenarioDialogue.setup.placeholders.manualInput",
    );
    expect(sendButton()).toBeDisabled();
  });

  it("對話紀錄是連續的：已答的步驟是泡泡，沒有「改選」，也沒有上一步／下一步", () => {
    renderPanel();
    chooseMode("none");
    chooseSource("manual");

    expect(screen.getByText(K.mode("none"))).toBeInTheDocument();
    expect(screen.getByText(K.source("manual"))).toBeInTheDocument();
    // 已答的是泡泡，不是按鈕
    expect(screen.queryByRole("button", { name: K.mode("none") })).toBeNull();
    expect(screen.queryByText("guidedChat.change")).toBeNull();
    expect(screen.queryByText("scenarioDialogue.setup.back")).toBeNull();
    expect(screen.queryByText("scenarioDialogue.setup.next")).toBeNull();
    expect(
      screen.queryByText("scenarioDialogue.buttons.viewQuestions"),
    ).toBeNull();
  });

  it("選項步驟打字送出：不呼叫 AI，只回「請點選上面的選項」", async () => {
    renderPanel();
    await say("我想要 AI 幫我寫");

    const chat = chatColumn();
    expect(within(chat).getByText("我想要 AI 幫我寫")).toBeInTheDocument();
    // 機器人回同一句提示（灰字也是這句，所以至少一個泡泡）
    expect(
      within(screen.getByTestId("scenario-setup-chat")).getByText(K.choiceHint),
    ).toBeInTheDocument();
    expect(generateScenarioArticle).not.toHaveBeenCalled();
    expect(generateScenarioQuestions).not.toHaveBeenCalled();
    // 還停在第一題，對話框清空
    expect(
      screen.getByRole("button", { name: K.mode("ai") }),
    ).toBeInTheDocument();
    expect(composerBox()).toHaveValue("");
  });

  it("情境卡：沒貼東西「用這篇情境」按不下去；卡片要按確認鈕，對話框停用", () => {
    renderPanel();
    chooseMode("existing");

    expect(screen.getByText(K.useScenario).closest("button")).toBeDisabled();
    expect(composerBox()).toBeDisabled();
    expect(composerBox()).toHaveAttribute(
      "placeholder",
      "guidedChat.placeholders.card",
    );
    type(K.scenarioPlaceholder, "It is Monday.");
    expect(
      screen.getByText(K.useScenario).closest("button"),
    ).not.toBeDisabled();
  });

  it("按「用這篇情境」：對話只留「已確認情境」，情境改固定顯示在右欄", () => {
    renderPanel();
    chooseMode("existing");
    type(K.scenarioPlaceholder, "你和同學在星期一早上聊天。");
    fireEvent.click(screen.getByText(K.useScenario));

    // 情境卡不在對話裡了，只剩一句摘要
    expect(screen.queryByTestId("scenario-card")).toBeNull();
    expect(
      within(chatColumn()).getByText("scenarioDialogue.setup.answers.scenario"),
    ).toBeInTheDocument();
    // 右欄情境區顯示文章
    const section = screen.getByTestId("scenario-context-section");
    expect(
      within(section).getByTestId("reference-scenario-text"),
    ).toHaveTextContent("你和同學在星期一早上聊天。");
    // 下一步：題目怎麼來？
    expect(
      screen.getByRole("button", { name: K.source("ai") }),
    ).toBeInTheDocument();
  });

  it("貼上情境 → 請 AI 出題 → 出題設定卡 → 開始產生 → 題目出現在右欄，設定卡變成摘要", async () => {
    renderPanel();
    fillRequiredForGenerate();

    // 「開始產生」在設定卡下方（卡片自帶確認鈕），是主按鈕
    const start = screen.getByRole("button", { name: K.generate });
    expect(start).toHaveClass("bg-blue-600");
    expect(screen.getByTestId("question-settings-card")).toBeInTheDocument();
    await runGenerate(K.generate);

    expect(
      within(sideColumn()).getAllByPlaceholderText(K.questionPlaceholder)
        .length,
    ).toBe(5);
    // 舊的設定卡唯讀：卡片不在了，留一句摘要
    expect(screen.queryByTestId("question-settings-card")).toBeNull();
    expect(
      screen.getByText("scenarioDialogue.setup.generatedNote"),
    ).toBeInTheDocument();
    // 題目產生後：對話框灰字換成「可以直接打新題目…」（compose 第 5 段才接上，先停用）
    expect(composerBox()).toHaveAttribute(
      "placeholder",
      "scenarioDialogue.setup.placeholders.done",
    );
    // 清單上方不再有「再產一批」
    expect(
      screen.queryByText("scenarioDialogue.buttons.generateAnother"),
    ).toBeNull();
  });

  it("無情境＋AI 出題：方向在對話框送出，確認句帶出老師原話，產題送出方向", async () => {
    renderPanel();
    chooseMode("none");
    chooseSource("ai");
    expect(composerBox()).toHaveAttribute(
      "placeholder",
      K.directionPlaceholder,
    );
    await say("問學生週末通常做什麼");

    expect(
      screen.getByText("scenarioDialogue.setup.q.settingsWithDirection"),
    ).toBeInTheDocument();
    await runGenerate(K.generate);

    const sent = generateScenarioQuestions.mock.calls[0][0];
    expect(sent.direction).toBe("問學生週末通常做什麼");
    expect(sent.scenario_content).toBe("");
    expect(sent.scenario_images).toEqual([]);
  });

  it("出題方向答非所問 → 回到方向那一步顯示重問句，不產題", async () => {
    generateScenarioQuestions.mockResolvedValueOnce({
      usable: false,
      reask: "想問哪方面呢？例如：週末活動。",
      suggested_title: "",
      questions: [],
    });
    renderPanel();
    await fillDirectionForGenerate("你好");
    await runGenerate(K.generate);

    expect(
      screen.getByText("想問哪方面呢？例如：週末活動。"),
    ).toBeInTheDocument();
    // 回到方向那一步：設定卡收起來、對話框可以重新打方向
    expect(screen.queryByTestId("question-settings-card")).toBeNull();
    expect(composerBox()).toHaveAttribute(
      "placeholder",
      K.directionPlaceholder,
    );
    expect(screen.getByTestId("scenario-questions-empty")).toBeInTheDocument();
  });

  it("AI 出題建議的標題只在標題空白時填入", async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);
    expect(screen.getByPlaceholderText(K.titlePlaceholder)).toHaveValue(
      "AI 建議的標題",
    );
  });

  it("老師已經打了標題，AI 的建議不覆蓋", async () => {
    renderPanel();
    type(K.titlePlaceholder, "老師自己的標題");
    fillRequiredForGenerate();
    await runGenerate(K.generate);
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

  it("老師先在右欄打的題目一併送出（避開重複），AI 回了一樣的題目也不會重複貼上", async () => {
    renderPanel();
    await fillDirectionForGenerate();
    addTypedQuestion("Generated question 1?");
    await runGenerate(K.generate);

    const sent = generateScenarioQuestions.mock.calls[0][0];
    expect(sent.existing_questions).toEqual(["Generated question 1?"]);
    const all = screen
      .getAllByPlaceholderText(K.questionPlaceholder)
      .map((el) => (el as HTMLTextAreaElement).value)
      .filter(Boolean);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("ScenarioDialoguePanel 情境來源", () => {
  it("請 AI 幫我寫：在對話框送出訓練目標，帶文章難度，寫好的情境進情境卡", async () => {
    renderPanel({ programLevel: "B1" });
    chooseMode("ai");
    expect(composerBox()).toHaveAttribute(
      "placeholder",
      "scenarioDialogue.setup.placeholders.goal",
    );
    await say("這週上課學到的：交通工具與問路");

    expect(generateScenarioArticle).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: "這週上課學到的：交通工具與問路",
        level: "B1",
      }),
    );
    expect(screen.getByPlaceholderText(K.scenarioPlaceholder)).toHaveValue(
      "It is Monday morning at school.",
    );
    // 對話框送出後清空
    expect(composerBox()).toHaveValue("");
  });

  it("沒打訓練目標，送出鈕按不下去（省下一次白花的呼叫）", () => {
    renderPanel();
    chooseMode("ai");

    expect(sendButton()).toBeDisabled();
    fireEvent.click(sendButton());
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
    await say("哈囉");

    expect(screen.getByText("想訓練什麼呢？例如：問路。")).toBeInTheDocument();
    // 老師的話留在紀錄裡，還停在訓練目標這一步，沒有出現情境卡
    expect(within(chatColumn()).getByText("哈囉")).toBeInTheDocument();
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

    fireEvent.click(screen.getByText(K.useScenario));
    chooseSource("manual");
    expect(screen.getByPlaceholderText(K.titlePlaceholder)).toHaveValue(
      "講義標題",
    );
  });
  it("情境框已有文字時從「情境」標籤改方式 → 先確認，取消就保留（review 2）", () => {
    renderPanel();
    chooseMode("existing");
    type(K.scenarioPlaceholder, "老師貼好的情境。");

    const popover = openChip("mode");
    fireEvent.click(
      within(popover).getByRole("button", { name: K.mode("none") }),
    );
    expect(
      screen.getByText(
        "scenarioDialogue.setup.modeChangeKeepQuestionsDescription",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "contentEditor.buttons.cancel" }),
    );

    // 取消：情境卡和文字都還在
    expect(screen.getByPlaceholderText(K.scenarioPlaceholder)).toHaveValue(
      "老師貼好的情境。",
    );
    expect(changedNotes()).toBe(0);
  });

  it("情境框已有文字時改方式 → 確認後才清空，紀錄加一句「已把○○改成」", () => {
    renderPanel();
    chooseMode("existing");
    type(K.scenarioPlaceholder, "老師貼好的情境。");

    fireEvent.click(
      within(openChip("mode")).getByRole("button", { name: K.mode("ai") }),
    );
    fireEvent.click(screen.getByRole("button", { name: K.reopenConfirm }));

    // 換到「AI 寫」：問訓練目標，情境卡不見了
    expect(
      screen.getByText("scenarioDialogue.setup.q.goal"),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(K.scenarioPlaceholder)).toBeNull();
    expect(changedNotes()).toBe(1);
    // 前面的紀錄不動：當初選的「既有教材」泡泡還在
    expect(
      within(chatColumn()).getByText(K.mode("existing")),
    ).toBeInTheDocument();
  });

  it("情境框是空的就直接改方式，不跳確認", () => {
    renderPanel();
    chooseMode("existing");

    fireEvent.click(
      within(openChip("mode")).getByRole("button", { name: K.mode("ai") }),
    );
    expect(
      screen.queryByText(
        "scenarioDialogue.setup.modeChangeKeepQuestionsDescription",
      ),
    ).toBeNull();
    expect(
      screen.getByText("scenarioDialogue.setup.q.goal"),
    ).toBeInTheDocument();
  });

  it("情境內容生成中算 busy，儲存鍵才擋得住", async () => {
    const ref = renderPanel();
    chooseMode("ai");

    let finish!: (value: { content: string }) => void;
    generateScenarioArticle.mockReturnValue(
      new Promise<{ content: string }>((resolve) => {
        finish = resolve;
      }),
    );

    await say("這週上課學到的：交通工具與問路");
    expect(ref.current?.isBusy).toBe(true);
    // 產生中：對話框停用
    expect(composerBox()).toBeDisabled();

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

    let finish!: (value: { content: string }) => void;
    generateScenarioArticle.mockReturnValue(
      new Promise<{ content: string }>((resolve) => {
        finish = resolve;
      }),
    );

    await say("這週上課學到的：交通工具與問路");
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
  it("沒填標題就儲存 → 擋下並把游標帶到右欄的標題欄", async () => {
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
      expect(document.activeElement).toBe(
        screen.getByPlaceholderText(K.titlePlaceholder),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("題數不足就儲存 → 擋下並提示", async () => {
    const onSave = vi.fn();
    const ref = renderPanel({ onSave });
    goToListManually();
    type(K.titlePlaceholder, "週末活動");

    await act(async () => {
      await ref.current?.save();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(K.atLeastN);
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

  it("空圖框有「上傳」；旗標關閉時不顯示 AI 生成，也不再有「即將推出」（#1158）", () => {
    renderPanel();
    gotoList();

    expect(screen.getAllByText(K.uploadImage).length).toBeGreaterThan(0);
    expect(
      screen.queryByText("scenarioDialogue.buttons.generateImage"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("scenarioDialogue.buttons.comingSoon"),
    ).not.toBeInTheDocument();
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

  it("帶 initialData 時顯示既有題目與標題，情境圖在右欄情境區", () => {
    renderPanel({ initialData });

    expect(screen.getByDisplayValue("週末活動")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("What did you do last weekend?"),
    ).toBeInTheDocument();
    // 對照欄看得到情境圖（唯讀）
    expect(
      document.querySelector('img[src="https://cdn/scene-1.png"]'),
    ).toBeInTheDocument();
  });

  it("舊資料：由已存的情境推斷答案，對話是摘要紀錄，情境區在右欄", () => {
    renderPanel({ initialData });

    const chat = chatColumn();
    expect(within(chat).getByText(K.mode("existing"))).toBeInTheDocument();
    expect(within(chat).getByText(K.source("manual"))).toBeInTheDocument();
    expect(
      within(chat).getByText("scenarioDialogue.setup.answers.scenario"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("reference-scenario-text")).toHaveTextContent(
      "你和同學在星期一早上聊天。",
    );
    // 已經有題目：來源標籤藏起來（不能改來源），情境、設定標籤在
    expect(chip("mode")).not.toBeNull();
    expect(chip("source")).toBeNull();
    expect(chip("settings")).not.toBeNull();
  });

  it("新資料：照存下來的回答還原，AI 出題已產生過題目 → 不再停在設定卡", () => {
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

    const chat = chatColumn();
    expect(within(chat).getByText(K.mode("none"))).toBeInTheDocument();
    expect(within(chat).getByText(K.source("ai"))).toBeInTheDocument();
    expect(
      within(screen.getByTestId("scenario-setup-chat")).getByText(
        "問學生週末做什麼",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("question-settings-card")).toBeNull();
    // 方向標籤帶出存下來的方向
    expect(chip("direction")).toHaveTextContent("問學生週末做什麼");
    // 沒有情境：右欄沒有情境區
    expect(screen.queryByTestId("scenario-context-section")).toBeNull();
  });

  it("改情境方式後再選回同一個：選回原本的方式不算改，已填的情境還在", () => {
    renderPanel({ initialData });

    fireEvent.click(
      within(openChip("mode")).getByRole("button", {
        name: /scenarioDialogue\.setup\.modes\.existing/,
      }),
    );

    expect(screen.queryByText(K.reopenConfirm)).toBeNull();
    expect(changedNotes()).toBe(0);
    expect(screen.getByTestId("reference-scenario-text")).toHaveTextContent(
      "你和同學在星期一早上聊天。",
    );
  });

  it("題目產生後改情境方式：確認框寫「情境會清空，題目和設定保留」，題目真的留著", () => {
    renderPanel({ initialData });

    fireEvent.click(
      within(openChip("mode")).getByRole("button", { name: K.mode("none") }),
    );
    expect(
      screen.getByText(
        "scenarioDialogue.setup.modeChangeKeepQuestionsDescription",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: K.reopenConfirm }));

    expect(screen.queryByTestId("scenario-context-section")).toBeNull();
    expect(
      screen.getByDisplayValue("What did you do last weekend?"),
    ).toBeInTheDocument();
    expect(changedNotes()).toBe(1);
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

  it("產題會帶上右欄既有的題目，讓後端避開重複", async () => {
    renderPanel();
    await fillDirectionForGenerate();
    addTypedQuestion("What do you usually do on weekends?");
    await runGenerate(K.generate);

    const sent = generateScenarioQuestions.mock.calls[0][0];
    expect(sent.existing_questions).toEqual([
      "What do you usually do on weekends?",
    ]);
  });

  it("產題失敗會提示，且不會把既有題目清掉", async () => {
    renderPanel();
    await fillDirectionForGenerate();
    addTypedQuestion("What do you usually do on weekends?");

    generateScenarioQuestions.mockRejectedValueOnce(new Error("boom"));
    await runGenerate(K.generate);

    expect(mockToastError).toHaveBeenCalled();
    expect(
      screen.getByDisplayValue("What do you usually do on weekends?"),
    ).toBeInTheDocument();
    // 失敗不算產生過：設定卡還在，可以再按一次
    expect(screen.getByTestId("question-settings-card")).toBeInTheDocument();
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

  /** 方向給好、右欄先打兩題，停在出題設定卡 */
  const prepare = async () => {
    renderPanel();
    await fillDirectionForGenerate();
    addTypedQuestion("First question?");
    addTypedQuestion("Second question?");
  };

  it("等待期間改過的題目文字，回應落地後仍然在", async () => {
    await prepare();

    const settle = pendingGeneration();
    fireEvent.click(screen.getByText(K.generate));
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
    await prepare();
    const before = screen.getAllByPlaceholderText(K.questionPlaceholder).length;

    const settle = pendingGeneration();
    fireEvent.click(screen.getByText(K.generate));
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getAllByTitle("contentEditor.tooltips.delete")[0]);
    await settle();

    // 刪掉 1 題、AI 補 1 題 → 總數不變；被刪的那題不該復活
    expect(screen.getAllByPlaceholderText(K.questionPlaceholder).length).toBe(
      before,
    );
    expect(screen.queryByDisplayValue("First question?")).toBeNull();
  });
});

/**
 * 題目圖 AI 生圖（Issue #1024；#1158 起先開「AI 生圖」對話框）。
 *
 * 按「AI 生成」→ 對話框預填該題的 imagePrompt（沒有就用題目本文）→ 按「生成」才打 API。
 * 失敗訊息顯示在對話框內，依狀態碼分開講（老師的下一步不同）。
 */
describe("ScenarioDialoguePanel 題目圖 AI 生圖（#1024／#1158）", () => {
  beforeEach(() => {
    mockFlags.SCENARIO_IMAGE_GENERATION = true;
  });

  afterEach(() => {
    mockFlags.SCENARIO_IMAGE_GENERATION = false;
  });

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const descriptionBox = () =>
    within(screen.getByTestId("ai-image-generate-dialog")).getByLabelText(
      "scenarioDialogue.imageGen.descriptionLabel",
    );

  const openDialogFor = async (index: number) => {
    fireEvent.click(
      screen.getAllByText("scenarioDialogue.buttons.generateImage")[index],
    );
    await flush();
  };

  const submit = async () => {
    fireEvent.click(screen.getByText("scenarioDialogue.imageGen.generate"));
    await flush();
  };

  const prepareRows = async () => {
    renderPanel();
    fillRequiredForGenerate();
    await runGenerate(K.generate);
  };

  it("按「AI 生成」只開對話框，預填題目本文，不直接打生圖 API", async () => {
    await prepareRows();
    await openDialogFor(0);

    expect(generateScenarioImage).not.toHaveBeenCalled();
    // 題目圖直接用 imagePrompt／題目本文，不呼叫 AI 擬描述
    expect(suggestScenarioImageDescription).not.toHaveBeenCalled();
    expect(descriptionBox()).toHaveValue("Generated question 1?");
  });

  it("有 imagePrompt 時預填 imagePrompt", async () => {
    generateScenarioQuestions.mockImplementation(
      async ({ count }: { count: number }) => ({
        usable: true,
        reask: "",
        questions: Array.from({ length: count }, (_, i) => ({
          ...fakeQuestion(i + 1),
          image_prompt: `A drawing for ${i + 1}`,
        })),
      }),
    );
    await prepareRows();
    await openDialogFor(0);

    expect(descriptionBox()).toHaveValue("A drawing for 1");
  });

  it("按「生成」用老師確認過的描述呼叫，成功後把圖填進該列並關閉", async () => {
    generateScenarioImage.mockResolvedValue({
      image_url: "https://cdn/generated.png",
      prompt: "rewritten",
    });
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });
    fillRequiredForGenerate();
    await runGenerate(K.generate);

    await openDialogFor(0);
    fireEvent.change(descriptionBox(), {
      target: { value: "A cat on a desk" },
    });
    await submit();

    expect(generateScenarioImage).toHaveBeenCalledWith({
      kind: "question",
      description: "A cat on a desk",
    });
    expect(
      container.querySelector('img[src="https://cdn/generated.png"]'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-image-generate-dialog"),
    ).not.toBeInTheDocument();
  });

  it.each([
    [402, { error: "SCENARIO_IMAGE_QUOTA_EXCEEDED" }, "quota"],
    [409, { error: "SCENARIO_IMAGE_IN_PROGRESS" }, "inProgress"],
    [422, "描述被安全過濾擋下", "blocked"],
    [502, { message: "AI 服務暫時失敗" }, "failed"],
  ])("%s 時在對話框裡顯示對應原因，對話框不關", async (status, detail, key) => {
    generateScenarioImage.mockRejectedValue(
      new MockApiError(status as number, detail),
    );
    await prepareRows();
    await openDialogFor(0);
    await submit();

    expect(screen.getByRole("alert")).toHaveTextContent(
      `scenarioDialogue.imageGen.errors.${key}`,
    );
    expect(screen.getByTestId("ai-image-generate-dialog")).toBeInTheDocument();
  });

  it("生成期間該列已經換了別張圖 → AI 圖不覆蓋，提示老師（#1158 修正 B1）", async () => {
    global.URL.createObjectURL = vi.fn(
      () => "blob:teacher-upload",
    ) as unknown as typeof URL.createObjectURL;
    global.URL.revokeObjectURL =
      vi.fn() as unknown as typeof URL.revokeObjectURL;
    let resolveImage: (v: {
      image_url: string;
      prompt: string;
    }) => void = () => {};
    generateScenarioImage.mockImplementation(
      () =>
        new Promise((r) => {
          resolveImage = r;
        }),
    );
    const { container } = render(<ScenarioDialoguePanel />, { wrapper });
    fillRequiredForGenerate();
    await runGenerate(K.generate);

    await openDialogFor(0);
    await submit();
    expect(generateScenarioImage).toHaveBeenCalledTimes(1);

    // 對話框擋住畫面，正常操作做不到；直接對檔案欄位送事件模擬「生成中換了圖」
    const input = container.querySelectorAll<HTMLInputElement>(
      'input[accept="image/*"]',
    )[0];
    fireEvent.change(input, {
      target: { files: [new File(["x"], "mine.png", { type: "image/png" })] },
    });

    await act(async () => {
      resolveImage({ image_url: "https://cdn/generated.png", prompt: "p" });
    });
    await flush();

    expect(
      container.querySelector('img[src="blob:teacher-upload"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('img[src="https://cdn/generated.png"]'),
    ).not.toBeInTheDocument();
    expect(mockToastInfo).toHaveBeenCalledWith(
      "scenarioDialogue.imageGen.imageReplacedDuringGenerate",
    );
  });
});

/**
 * 生圖開關關閉時（#1044 起；#1158 拿掉「即將推出」）：只藏生圖入口，上傳照常。
 */
describe("ScenarioDialoguePanel 生圖開關關閉", () => {
  const gotoList = () => goToListManually();

  beforeEach(() => {
    mockFlags.SCENARIO_IMAGE_GENERATION = false;
    generateScenarioImage.mockReset();
    global.URL.createObjectURL = vi.fn(
      () => "blob:flag-off",
    ) as unknown as typeof URL.createObjectURL;
    global.URL.revokeObjectURL =
      vi.fn() as unknown as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    mockFlags.SCENARIO_IMAGE_GENERATION = false;
  });

  it("不顯示 AI 生成鈕，也不會打生圖 API", () => {
    renderPanel();
    gotoList();

    expect(
      screen.queryByText("scenarioDialogue.buttons.generateImage"),
    ).not.toBeInTheDocument();
    expect(generateScenarioImage).not.toHaveBeenCalled();
  });

  it("手動上傳完全不受影響", () => {
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

  it("旗標打開時顯示可按的生圖按鈕", () => {
    mockFlags.SCENARIO_IMAGE_GENERATION = true;
    renderPanel();
    gotoList();

    const button = screen
      .getAllByText("scenarioDialogue.buttons.generateImage")[0]
      .closest("button") as HTMLButtonElement;
    expect(button).not.toBeDisabled();
    expect(button.className).toContain("bg-blue-600");
    expect(button.className).toContain("whitespace-nowrap");
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
    "%s 的「AI 生成」標籤（含圖示）塞得進 92px（#1158）",
    async (locale) => {
      const dict = await import(`@/i18n/locales/${locale}/translation.json`);
      const label = dict.default.scenarioDialogue.buttons.generateImage;

      expect(estimateWidth(label) + ICON_AND_GAP).toBeLessThanOrEqual(BUDGET);
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
    await say("交通工具與問路");

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

  it("停用的生成語音會說明原因；有空狀態後最後一題也能刪", () => {
    renderPanel();
    goToListManually();

    // 還沒打題目：生成語音停用，提示說明要先輸入題目
    const audio = screen.getByTitle(
      "scenarioDialogue.tooltips.generateAudioDisabled",
    );
    expect(audio).toBeDisabled();

    type(K.questionPlaceholder, "What did you do last weekend?");
    expect(
      screen.getByTitle("scenarioDialogue.tooltips.generateAudio"),
    ).not.toBeDisabled();

    // 只有 1 題也能刪，刪光回到「題目會出現在這裡」
    fireEvent.click(screen.getByTitle("contentEditor.tooltips.delete"));
    expect(screen.getByTestId("scenario-questions-empty")).toBeInTheDocument();
  });
});

/**
 * 同頁版面（#1158 C commit 4）：取代 #1146 第 4 輪的「固定操作列」與「回對話捲動」。
 * 沒有上一步／下一步、查看題目清單、回到對話，也沒有操作列；左欄是已選項目列＋對話捲動區
 * ＋底部對話框，右欄是題目捲動區。
 */
describe("ScenarioDialoguePanel 同頁版面（#1158 C commit 4）", () => {
  it("左欄：已選項目列在上、對話捲動區在中、底部對話框在下；沒有操作列", () => {
    renderPanel();
    chooseMode("none");

    const chat = chatColumn();
    const chips = within(chat).getByTestId("guided-chat-chips");
    const scroll = within(chat).getByTestId("scenario-scroll-area");
    const composer = within(chat).getByTestId("guided-chat-composer");
    expect(scroll).toHaveClass("overflow-y-auto", "flex-1", "min-h-0");
    // 標籤列與對話框都不在捲動區裡（不隨對話捲動）
    expect(scroll.contains(chips)).toBe(false);
    expect(scroll.contains(composer)).toBe(false);
    expect(
      chips.compareDocumentPosition(scroll) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      scroll.compareDocumentPosition(composer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByRole("group", { name: "scenarioDialogue.setup.actionBar" }),
    ).toBeNull();
  });

  it("捲動區自己不再留右側工具列的留白（外框已加，避免留白兩次）", () => {
    renderPanel();
    for (const area of [
      screen.getByTestId("scenario-scroll-area"),
      screen.getByTestId("scenario-question-list"),
    ]) {
      expect(area.className).not.toMatch(/\bpr-8\b|\bsm:pr-16\b/);
    }
    expect(sideColumn()).toHaveClass("pr-8", "sm:pr-16");
  });

  it("右欄由上到下：標題 → 情境區 → 題目卡 →「＋ 新增題目」→ 題數計數", () => {
    renderPanel();
    chooseMode("existing");
    type(K.scenarioPlaceholder, "It is Monday.");
    fireEvent.click(screen.getByText(K.useScenario));
    chooseSource("manual");
    fireEvent.click(screen.getByText(K.addQuestion));

    const side = sideColumn();
    const order = [
      within(side).getByPlaceholderText(K.titlePlaceholder),
      within(side).getByTestId("scenario-context-section"),
      within(side).getByPlaceholderText(K.questionPlaceholder),
      within(side).getByText(K.addQuestion),
      within(side).getByText(/contentEditor\.messages\.items/),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    // 情境區不再放作答指引、評分標準和「回對話修改」（移到「設定」標籤）
    const section = screen.getByTestId("scenario-context-section");
    expect(
      within(section).queryByText("scenarioDialogue.labels.globalRubric"),
    ).toBeNull();
    expect(
      within(section).queryByText("scenarioDialogue.buttons.editSettings"),
    ).toBeNull();
  });

  it("Beta 標籤不在對話裡（移到 sheet 標題列）", () => {
    renderPanel();
    expect(screen.queryByTestId("scenario-setup-beta")).toBeNull();
    expect(screen.queryByText("scenarioDialogue.setup.betaNote")).toBeNull();
  });

  it("觸控裝置上輸入欄位 focus 後捲到可見處（避免被鍵盤擋住）", async () => {
    const originalMatchMedia = window.matchMedia;
    const originalScroll = Element.prototype.scrollIntoView;
    const targets: Element[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      targets.push(this);
    });
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    try {
      renderPanel();
      chooseMode("existing");
      const box = screen.getByPlaceholderText(K.scenarioPlaceholder);
      box.focus();

      await waitFor(() => expect(targets).toContain(box));
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
        block: "center",
      });
    } finally {
      window.matchMedia = originalMatchMedia;
      Element.prototype.scrollIntoView = originalScroll;
    }
  });
});

describe("ScenarioDialoguePanel 已選項目列（#1158 C commit 4）", () => {
  it("標籤的出現與消失：情境 → 來源＋設定（自己輸入）→ 有題目時來源藏起來、刪光再出現", () => {
    renderPanel();
    expect(chip("mode")).toBeNull();

    chooseMode("none");
    expect(chip("mode")).toHaveTextContent(
      "scenarioDialogue.setup.chipValues.mode.none",
    );
    expect(chip("source")).toBeNull();

    chooseSource("manual");
    expect(chip("source")).not.toBeNull();
    // 自己輸入：答完來源就有「設定」；不需要情境＋自己輸入沒有「方向」
    expect(chip("settings")).not.toBeNull();
    expect(chip("direction")).toBeNull();

    // 空白題不算題目
    fireEvent.click(screen.getByText(K.addQuestion));
    expect(chip("source")).not.toBeNull();
    type(K.questionPlaceholder, "What did you do?");
    expect(chip("source")).toBeNull();

    fireEvent.click(screen.getByTitle("contentEditor.tooltips.delete"));
    expect(chip("source")).not.toBeNull();
  });

  it("AI 出題：「方向」在不需要情境時就出現（值可空白），「設定」第一次產生題目後才出現", async () => {
    renderPanel();
    chooseMode("none");
    chooseSource("ai");
    expect(chip("direction")).not.toBeNull();
    expect(chip("settings")).toBeNull();

    await say("問學生週末通常做什麼");
    expect(chip("direction")).toHaveTextContent("問學生週末通常做什麼");
    expect(chip("settings")).toBeNull();

    await runGenerate(K.generate);
    expect(chip("settings")).not.toBeNull();
    // 已經有題目：來源標籤藏起來
    expect(chip("source")).toBeNull();
  });

  it("有情境時沒有「方向」標籤", () => {
    renderPanel();
    fillRequiredForGenerate();
    expect(chip("direction")).toBeNull();
  });

  it("改方向：不清除、不重產，紀錄加一句，之後產題用新的方向", async () => {
    renderPanel();
    await fillDirectionForGenerate("問週末");

    const popover = openChip("direction");
    fireEvent.change(
      within(popover).getByRole("textbox", {
        name: "scenarioDialogue.setup.q.direction",
      }),
      { target: { value: "問暑假計畫" } },
    );
    fireEvent.click(within(popover).getByRole("button", { name: K.apply }));

    expect(changedNotes()).toBe(1);
    expect(chip("direction")).toHaveTextContent("問暑假計畫");
    // 不重產：沒有呼叫 AI，設定卡還在
    expect(generateScenarioQuestions).not.toHaveBeenCalled();
    expect(screen.getByTestId("question-settings-card")).toBeInTheDocument();

    await runGenerate(K.generate);
    expect(generateScenarioQuestions.mock.calls[0][0].direction).toBe(
      "問暑假計畫",
    );
  });

  it("改來源（後面有東西會清）：先確認，確認後方向清掉、回到自己輸入", async () => {
    renderPanel();
    await fillDirectionForGenerate("問週末");

    fireEvent.click(
      within(openChip("source")).getByRole("button", {
        name: K.source("manual"),
      }),
    );
    expect(
      screen.getByText("scenarioDialogue.setup.sourceChangeConfirmDescription"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: K.reopenConfirm }));

    expect(chip("direction")).toBeNull();
    expect(screen.queryByTestId("question-settings-card")).toBeNull();
    expect(
      screen.getByText("scenarioDialogue.setup.q.manualInput"),
    ).toBeInTheDocument();
    expect(changedNotes()).toBe(1);
  });

  it("「設定」小框是精簡設定：不放題數，改作答指引即時生效，按「確定」加一句紀錄", async () => {
    renderPanel();
    chooseMode("none");
    chooseSource("manual");

    const popover = openChip("settings");
    expect(within(popover).getByTestId("question-settings-card")).toBeTruthy();
    expect(
      within(popover).queryByRole("combobox", {
        name: "scenarioDialogue.labels.generateCount",
      }),
    ).toBeNull();
    fireEvent.change(
      within(popover).getByPlaceholderText(K.rubricPlaceholder),
      { target: { value: "請用完整句子回答" } },
    );
    fireEvent.click(within(popover).getByRole("button", { name: K.apply }));

    expect(changedNotes()).toBe(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("情境標籤的「編輯情境內容」：情境確認後才有，按了打開右欄情境區的編輯並捲過去", () => {
    const original = Element.prototype.scrollIntoView;
    const targets: Element[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      targets.push(this);
    });
    vi.useFakeTimers();
    try {
      renderPanel();
      chooseMode("existing");
      expect(
        within(openChip("mode")).queryByRole("button", {
          name: K.editScenario,
        }),
      ).toBeNull();
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

      type(K.scenarioPlaceholder, "It is Monday.");
      fireEvent.click(screen.getByText(K.useScenario));
      fireEvent.click(
        within(openChip("mode")).getByRole("button", { name: K.editScenario }),
      );
      act(() => {
        vi.runAllTimers();
      });

      const section = screen.getByTestId("scenario-context-section");
      expect(
        within(section).getByPlaceholderText(K.scenarioPlaceholder),
      ).toHaveValue("It is Monday.");
      expect(targets).toContain(section);
    } finally {
      vi.useRealTimers();
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe("ScenarioDialoguePanel 右欄情境區原地編輯（#1158 C commit 4）", () => {
  const confirmExisting = (text = "It is Monday.") => {
    chooseMode("existing");
    type(K.scenarioPlaceholder, text);
    fireEvent.click(screen.getByText(K.useScenario));
  };

  it("預設展開、可收合", () => {
    renderPanel();
    confirmExisting();

    const section = screen.getByTestId("scenario-context-section");
    const toggle = within(section).getByRole("button", {
      name: "scenarioDialogue.buttons.collapseScenario",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      within(section).getByTestId("reference-scenario-text"),
    ).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(within(section).queryByTestId("reference-scenario-text")).toBeNull();
    expect(
      within(section).getByRole("button", {
        name: "scenarioDialogue.buttons.expandScenario",
      }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("「編輯」原地改文章，按「完成」回到唯讀並顯示新內容；存檔帶新內容", async () => {
    const onSave = vi.fn();
    const ref = renderPanel({ onSave });
    confirmExisting();

    const section = screen.getByTestId("scenario-context-section");
    fireEvent.click(within(section).getByText(K.contextEdit));
    fireEvent.change(
      within(section).getByPlaceholderText(K.scenarioPlaceholder),
      { target: { value: "It is Friday night." } },
    );
    // 情境圖可補傳（編輯時才有新增入口）
    expect(within(section).getByTestId("scenario-image-strip")).toBeTruthy();
    fireEvent.click(within(section).getByText(K.contextDone));

    expect(
      within(section).getByTestId("reference-scenario-text"),
    ).toHaveTextContent("It is Friday night.");

    type(K.titlePlaceholder, "週末");
    for (const q of ["Q1?", "Q2?", "Q3?"]) addTypedQuestion(q);
    await act(async () => {
      await ref.current?.save();
    });
    expect(onSave.mock.calls[0][0].scenarioContent).toBe("It is Friday night.");
  });

  it("AI 寫的文章：編輯時有訓練目標欄，「重寫」先確認，確認後重寫文章", async () => {
    renderPanel();
    chooseMode("ai");
    await say("問路");
    fireEvent.click(screen.getByText(K.useScenario));

    generateScenarioArticle.mockResolvedValueOnce({
      usable: true,
      reask: "",
      suggested_title: "",
      content: "A rewritten passage.",
    });
    const section = screen.getByTestId("scenario-context-section");
    fireEvent.click(within(section).getByText(K.contextEdit));
    const goalBox = within(section).getByPlaceholderText(K.goalPlaceholder);
    expect(goalBox).toHaveValue("問路");
    fireEvent.change(goalBox, { target: { value: "在夜市點餐" } });

    fireEvent.click(within(section).getByText(K.rewrite));
    expect(
      screen.getByText("scenarioDialogue.setup.rewriteConfirmDescription"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: K.rewriteConfirm }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(generateScenarioArticle).toHaveBeenLastCalledWith(
      expect.objectContaining({ goal: "在夜市點餐" }),
    );
    expect(
      within(section).getByPlaceholderText(K.scenarioPlaceholder),
    ).toHaveValue("A rewritten passage.");
  });

  it("既有教材的情境沒有訓練目標與重寫", () => {
    renderPanel();
    confirmExisting();
    const section = screen.getByTestId("scenario-context-section");
    fireEvent.click(within(section).getByText(K.contextEdit));
    expect(within(section).queryByText(K.rewrite)).toBeNull();
    expect(
      within(section).queryByPlaceholderText(K.goalPlaceholder),
    ).toBeNull();
  });
});

describe("ScenarioDialoguePanel 題數上限＝剩餘名額（#1158 使用者決定）", () => {
  const countSelect = () =>
    screen.getByRole("combobox", {
      name: "scenarioDialogue.labels.generateCount",
    }) as HTMLSelectElement;

  it("右欄已有 7 題：題數最多 3（剩餘名額），預設 min(5, 3) = 3，送出 3 題", async () => {
    renderPanel();
    await fillDirectionForGenerate();
    for (let i = 1; i <= 7; i++) addTypedQuestion(`Q${i}?`);

    const options = Array.from(countSelect().options).map((o) => o.value);
    expect(options).toEqual(["3"]);
    expect(countSelect().value).toBe("3");

    await runGenerate(K.generate);
    expect(generateScenarioQuestions.mock.calls[0][0].count).toBe(3);
  });

  it("剩餘名額 0：「開始產生」停用，旁邊說明「已滿 10 題」", async () => {
    renderPanel();
    await fillDirectionForGenerate();
    for (let i = 1; i <= 10; i++) addTypedQuestion(`Q${i}?`);

    expect(screen.getByRole("button", { name: K.generate })).toBeDisabled();
    expect(screen.getByTestId("generate-blocked-reason")).toHaveTextContent(
      K.fullReason,
    );
    expect(
      screen.queryByRole("combobox", {
        name: "scenarioDialogue.labels.generateCount",
      }),
    ).toBeNull();
  });

  it("未滿 10 題時不顯示不能產生的原因", () => {
    renderPanel();
    fillRequiredForGenerate();
    expect(screen.queryByTestId("generate-blocked-reason")).toBeNull();
  });
});

describe("ScenarioDialoguePanel 窄版分頁（#1158 C commit 4）", () => {
  type RoCallback = (entries: { contentRect: { width: number } }[]) => void;
  let roCallbacks: RoCallback[] = [];
  class FakeResizeObserver {
    private cb: RoCallback;
    constructor(cb: RoCallback) {
      this.cb = cb;
      roCallbacks.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      roCallbacks = roCallbacks.filter((c) => c !== this.cb);
    }
  }
  const resizeTo = (width: number) =>
    act(() => {
      roCallbacks.forEach((cb) => cb([{ contentRect: { width } }]));
    });

  beforeEach(() => {
    roCallbacks = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("窄版從對話產生題目後，自動切到「題目」分頁", async () => {
    renderPanel();
    resizeTo(800);
    expect(screen.getByTestId("guided-chat-layout")).toHaveAttribute(
      "data-layout",
      "narrow",
    );
    fillRequiredForGenerate();
    expect(sideColumn()).toHaveClass("hidden");

    await runGenerate(K.generate);

    expect(sideColumn()).not.toHaveClass("hidden");
    expect(chatColumn()).toHaveClass("hidden");
    expect(
      screen.getByRole("tab", { name: "guidedChat.tabs.side" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("題目卡依右欄寬度決定窄版排法（不看 viewport）", () => {
    renderPanel();
    goToListManually();
    const row = () =>
      screen
        .getAllByPlaceholderText(K.questionPlaceholder)[0]
        .closest(".flex-1")!.parentElement!;

    resizeTo(1200);
    expect(row()).toHaveClass("flex-row");
    // 右欄內容寬不到 600px（卡片不到約 552px）→ 窄版排法
    resizeTo(520);
    expect(row()).toHaveClass("flex-col");
  });
});

/**
 * Beta 標示（#1158）：C commit 4 起從對話頂端移到 sheet 標題列，放在「情境對話」徽章旁；
 * 寬度不夠時灰字隱藏。
 */
describe("ScenarioDialogueEditorSheet Beta 標示（#1158）", () => {
  it("Beta 標籤與測試版本說明在標題列的徽章旁，灰字窄時隱藏", () => {
    render(
      <ScenarioDialogueEditorSheet
        editor={{
          isOpen: true,
          isSaving: false,
          initialData: null,
          contentId: null,
          programLevel: undefined,
          openForCreate: vi.fn(),
          openForEdit: vi.fn(),
          close: vi.fn(),
          save: vi.fn(),
        }}
      />,
      { wrapper },
    );

    const badge = screen.getByText("scenarioDialogue.badge");
    const beta = screen.getByTestId("scenario-beta-badge");
    const note = screen.getByText("scenarioDialogue.setup.betaNote");
    expect(beta).toHaveTextContent("Beta");
    expect(beta.parentElement).toBe(badge.parentElement);
    expect(note).toHaveClass("hidden", "lg:inline");
    // 對話裡不再有一份
    expect(screen.queryByTestId("scenario-setup-beta")).toBeNull();
  });

  it.each(["zh-TW", "en"] as const)("%s 有測試版本說明文案", async (locale) => {
    const dict = await import(`@/i18n/locales/${locale}/translation.json`);
    expect(dict.default.scenarioDialogue.setup.betaNote).toBe(
      locale === "en"
        ? "Beta: this feature may have bugs"
        : "測試版本，可能會有錯誤",
    );
  });
});
