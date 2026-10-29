/**
 * 情境對話的步驟設定（Issue #1158 C 段 commit 2）—— 接上通用引擎
 * `components/shared/guided-chat/flowEngine.ts`，純資料＋純函式，沒有 UI。
 *
 * 取代 `setupFlow.ts`（#1146 的固定流程）。面板要到 C 段 commit 4 才換成這一份；在那之前
 * 現有面板仍用 `setupFlow.ts`。
 *
 * ## 步驟（依回答動態展開）
 *
 * | 步驟 | 類型 | 什麼時候出現 | 已答的判斷 |
 * |---|---|---|---|
 * | `mode` 需要情境嗎？ | 選項 | 一定 | 有值 |
 * | `goal` 訓練目標＋文章難度 | 打字 | mode = ai | 有字串（AI 已寫出情境才寫入） |
 * | `scenario` 情境卡 | 卡片 | mode = existing / ai | `true`（按「用這篇情境」） |
 * | `source` 題目怎麼來？ | 選項 | 一定 | 有值 |
 * | `manualInput` 自己打題目 | 打字（AI 判斷意圖） | source = manual | `true`（第一次加入題目） |
 * | `direction` 想問的方向 | 打字 | mode = none 且 source = ai | 有字串，或已產生過題目 |
 * | `settings` 出題設定卡 | 卡片 | source = ai | `true`（第一次產生題目） |
 *
 * 全部答完＝「題目已產生」狀態：對話框可以直接打新題目，或說「再出 3 題關於…」，
 * 交給 compose 判斷意圖（`done.intent`）。
 *
 * `direction` 在「已產生過題目」時也算已答：題目產生後才把情境改成「不需要」時，
 * 方向那一步會冒出來 —— 規格說改情境方式只重做情境那幾步，不能因此卡住對話。
 *
 * ## 已選項目列（規格第 0、2 點）
 * - 情境：答完 `mode` 就出現，一直存在。Popover＝三個方式選項＋「編輯情境內容」。
 * - 來源：答完 `source` 就出現；右欄有任一非空白題時隱藏，題目刪光就再出現。
 * - 方向：只在「不需要情境」且「AI 出題」、已答方向時出現。
 * - 設定：AI 出題的第一次產生題目後出現；自己輸入的答完來源就出現。
 *
 * ## 清除規則
 * - 改情境方式：只清 `goal`、`scenario`（情境文章、情境圖由面板依 `cleared` 清掉），
 *   題目、方向、設定保留；有情境內容或訓練目標時先確認「情境會清空，題目和設定保留」。
 * - 改來源：只在還沒有題目時能改（`editable`），清掉方向、設定、自己打題目；
 *   有東西會被清時先確認。
 * - 重寫情境文章：先確認（`REWRITE_ARTICLE_CONFIRM`，由情境區的「重寫」鈕使用）。
 * - 改方向、改設定：不清除、不重產。
 */
import {
  answersFromSaved,
  text,
  type ConfirmSpec,
  type FlowDef,
  type StepOption,
} from "@/components/shared/guided-chat/flowEngine";

export type ScenarioMode = "none" | "existing" | "ai";
export type QuestionSource = "manual" | "ai";

export const SCENARIO_MODES: readonly ScenarioMode[] = [
  "none",
  "existing",
  "ai",
];
export const QUESTION_SOURCES: readonly QuestionSource[] = ["manual", "ai"];

export type ScenarioStepId =
  | "mode"
  | "goal"
  | "scenario"
  | "source"
  | "manualInput"
  | "direction"
  | "settings";

/** 答案：`Record<stepId, value>`，`undefined` ＝沒答 */
export type ScenarioAnswers = {
  mode?: ScenarioMode;
  goal?: string;
  scenario?: boolean;
  source?: QuestionSource;
  manualInput?: boolean;
  direction?: string;
  settings?: boolean;
};

/** 答案以外、會影響流程的外部事實（面板每次 render 算好傳入） */
export interface ScenarioFlowContext {
  /** 右欄有任一非空白題 */
  hasQuestions: boolean;
  /** 情境文章或情境圖有內容 */
  hasScenarioMaterial: boolean;
  /** 摘要用：情境文章字數、情境圖張數、文章難度 */
  scenarioChars: number;
  imageCount: number;
  articleLevel: string;
  /** 正在跑 AI 的步驟（寫情境、擷取、檢查方向、產生題目） */
  pending: ScenarioStepId | null;
  /** 上一次 AI 失敗的步驟 */
  failed: ScenarioStepId | null;
}

export const EMPTY_SCENARIO_CONTEXT: ScenarioFlowContext = {
  hasQuestions: false,
  hasScenarioMaterial: false,
  scenarioChars: 0,
  imageCount: 0,
  articleLevel: "",
  pending: null,
  failed: null,
};

/** 已存資料（`ScenarioDialogueInitialState` 取出的部分） */
export interface ScenarioSaved {
  scenarioMode: string;
  questionSource: string;
  goal: string;
  direction: string;
  /** 存了情境文章或情境圖 */
  hasScenario: boolean;
  /** 存了任一非空白題 */
  hasQuestions: boolean;
}

const P = "scenarioDialogue.setup";

const asyncOf =
  (id: ScenarioStepId) =>
  (ctx: ScenarioFlowContext): "idle" | "pending" | "failed" =>
    ctx.pending === id ? "pending" : ctx.failed === id ? "failed" : "idle";

const isText = (v: unknown): v is string => typeof v === "string";

const MODE_OPTIONS: readonly StepOption[] = [
  { value: "none", label: text(`${P}.modes.none`) },
  {
    value: "existing",
    label: text(`${P}.modes.existing`),
    hint: text(`${P}.modeHints.existing`),
  },
  { value: "ai", label: text(`${P}.modes.ai`) },
];

const SOURCE_OPTIONS: readonly StepOption[] = [
  { value: "manual", label: text(`${P}.sources.manual`) },
  { value: "ai", label: text(`${P}.sources.ai`) },
];

// ============================================================ 由已存資料還原

/**
 * 新資料存了 `scenario_mode` / `question_source`；舊資料（#1146 以前）沒有，就由情境
 * 文章與情境圖推斷：有情境 → 「我有現成的」，沒有 → 「不需要」；題目一律視為「自己
 * 輸入」（舊流程無從得知當初是不是 AI 出的；選自己輸入至少不會讓老師以為還要再產一次題）。
 */
export function savedMode(saved: ScenarioSaved): ScenarioMode {
  if ((SCENARIO_MODES as readonly string[]).includes(saved.scenarioMode)) {
    return saved.scenarioMode as ScenarioMode;
  }
  return saved.hasScenario ? "existing" : "none";
}

export function savedSource(saved: ScenarioSaved): QuestionSource {
  return (QUESTION_SOURCES as readonly string[]).includes(saved.questionSource)
    ? (saved.questionSource as QuestionSource)
    : "manual";
}

// ============================================================ 確認框

/** 改情境方式（規格第 0 點）：只清情境，題目和設定保留 */
export const MODE_CHANGE_CONFIRM: ConfirmSpec = {
  title: text(`${P}.modeChangeConfirmTitle`),
  description: text(`${P}.modeChangeKeepQuestionsDescription`),
  confirmLabel: text(`${P}.reopenConfirm`),
};

/** 改來源：清掉方向和設定 */
export const SOURCE_CHANGE_CONFIRM: ConfirmSpec = {
  title: text(`${P}.sourceChangeConfirmTitle`),
  description: text(`${P}.sourceChangeConfirmDescription`),
  confirmLabel: text(`${P}.reopenConfirm`),
};

/** 情境區按「重寫」：會重寫情境文章 */
export const REWRITE_ARTICLE_CONFIRM: ConfirmSpec = {
  title: text(`${P}.rewriteConfirmTitle`),
  description: text(`${P}.rewriteConfirmDescription`),
  confirmLabel: text(`${P}.rewriteConfirm`),
};

/** 情境標籤 Popover 裡的額外按鈕：把畫面帶到右欄情境區（窄版先切到「題目」分頁） */
export const EDIT_SCENARIO_ACTION = "editScenario";

/** 設定標籤 Popover 是情境對話自己畫的精簡設定 */
export const SETTINGS_POPOVER = "scenarioSettings";

// ============================================================ 流程

type Flow = FlowDef<ScenarioAnswers, ScenarioFlowContext, ScenarioSaved>;

export const SCENARIO_FLOW: Flow = {
  choicePlaceholder: text("guidedChat.placeholders.choice"),
  cardPlaceholder: text("guidedChat.placeholders.card"),
  pendingPlaceholder: text("guidedChat.placeholders.pending"),
  done: {
    placeholder: () => text(`${P}.placeholders.done`),
    intent: true,
  },
  steps: [
    {
      id: "mode",
      kind: "choice",
      question: () => text(`${P}.q.mode`),
      options: MODE_OPTIONS,
      clears: () => ["goal", "scenario"],
      confirm: (a, _next, ctx) =>
        ctx.hasScenarioMaterial || !!a.goal?.trim()
          ? MODE_CHANGE_CONFIRM
          : null,
      answerText: (a) => (a.mode ? text(`${P}.modes.${a.mode}`) : null),
      chip: {
        label: text(`${P}.chips.scenario`),
        value: (a) => (a.mode ? text(`${P}.chipValues.mode.${a.mode}`) : null),
        popover: {
          type: "options",
          actions: [
            {
              id: EDIT_SCENARIO_ACTION,
              label: text(`${P}.chips.editScenario`),
            },
          ],
        },
      },
      restore: savedMode,
    },
    {
      id: "goal",
      kind: "text",
      question: () => text(`${P}.q.goal`),
      reask: text(`${P}.reaskFallback`),
      when: (a) => a.mode === "ai",
      isAnswered: (a) => isText(a.goal),
      asyncState: asyncOf("goal"),
      placeholder: () => text(`${P}.placeholders.goal`),
      answerText: (a, ctx) =>
        isText(a.goal)
          ? text(`${P}.answers.goal`, {
              goal: a.goal,
              level: ctx.articleLevel,
            })
          : null,
      // 訓練目標不另做標籤，放在情境的編輯裡（規格第 0 點）
      restore: (saved) =>
        savedMode(saved) === "ai" ? (saved.goal ?? "") : undefined,
    },
    {
      id: "scenario",
      kind: "card",
      question: (a) =>
        text(a.mode === "ai" ? `${P}.q.scenarioAi` : `${P}.q.scenarioExisting`),
      when: (a) => a.mode === "ai" || a.mode === "existing",
      isAnswered: (a) => a.scenario === true,
      asyncState: asyncOf("scenario"),
      answerText: (_a, ctx) =>
        text(`${P}.answers.scenario`, {
          chars: ctx.scenarioChars,
          images: ctx.imageCount,
        }),
      restore: (saved) => (savedMode(saved) !== "none" ? true : undefined),
    },
    {
      id: "source",
      kind: "choice",
      question: () => text(`${P}.q.source`),
      options: SOURCE_OPTIONS,
      // 已經有題目就不能改來源（標籤也藏起來）
      editable: (_a, ctx) => !ctx.hasQuestions,
      clears: () => ["direction", "settings", "manualInput"],
      confirm: (a) =>
        a.direction !== undefined ||
        a.settings !== undefined ||
        a.manualInput !== undefined
          ? SOURCE_CHANGE_CONFIRM
          : null,
      answerText: (a) => (a.source ? text(`${P}.sources.${a.source}`) : null),
      chip: {
        visible: (a, ctx) => !!a.source && !ctx.hasQuestions,
        label: text(`${P}.chips.source`),
        value: (a) =>
          a.source ? text(`${P}.chipValues.source.${a.source}`) : null,
        popover: { type: "options" },
      },
      restore: savedSource,
    },
    {
      id: "manualInput",
      kind: "text",
      question: () => text(`${P}.q.manualInput`),
      when: (a) => a.source === "manual",
      isAnswered: (a) => a.manualInput === true,
      asyncState: asyncOf("manualInput"),
      placeholder: () => text(`${P}.placeholders.manualInput`),
      // 「自己打題目」這一步打的字交給 compose 判斷是加題還是出題
      intent: true,
      restore: (saved) =>
        savedSource(saved) === "manual" && saved.hasQuestions
          ? true
          : undefined,
    },
    {
      id: "direction",
      kind: "text",
      question: () => text(`${P}.q.direction`),
      reask: text(`${P}.reaskFallback`),
      when: (a) => a.mode === "none" && a.source === "ai",
      isAnswered: (a) => isText(a.direction) || a.settings === true,
      asyncState: asyncOf("direction"),
      placeholder: () => text(`${P}.directionPlaceholder`),
      answerText: (a) => (isText(a.direction) ? a.direction : null),
      chip: {
        visible: (a) =>
          a.mode === "none" && a.source === "ai" && isText(a.direction),
        label: text(`${P}.chips.direction`),
        value: (a) => (isText(a.direction) ? a.direction : null),
        popover: {
          type: "text",
          placeholder: text(`${P}.directionPlaceholder`),
        },
      },
      restore: (saved) =>
        savedMode(saved) === "none" && savedSource(saved) === "ai"
          ? (saved.direction ?? "")
          : undefined,
    },
    {
      id: "settings",
      kind: "card",
      question: (a) =>
        a.mode === "none" && a.direction?.trim()
          ? text(`${P}.q.settingsWithDirection`, { direction: a.direction })
          : text(`${P}.q.settings`),
      when: (a) => a.source === "ai",
      isAnswered: (a) => a.settings === true,
      asyncState: asyncOf("settings"),
      chip: {
        visible: (a) =>
          (a.source === "ai" && a.settings === true) || a.source === "manual",
        label: text(`${P}.chips.settings`),
        popover: { type: "custom", id: SETTINGS_POPOVER },
      },
      restore: (saved) =>
        savedSource(saved) === "ai" && saved.hasQuestions ? true : undefined,
    },
  ],
};

/** 由已存資料還原答案（編輯既有內容） */
export function scenarioAnswersFromSaved(
  saved: ScenarioSaved,
): ScenarioAnswers {
  return answersFromSaved(SCENARIO_FLOW, saved);
}
