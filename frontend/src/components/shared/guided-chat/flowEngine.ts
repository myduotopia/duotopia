/**
 * 引導式對話的通用流程引擎（Issue #1158 C 段 commit 2）—— 純 TypeScript，沒有 UI。
 *
 * 「把開始前的設定改成一問一答」這件事，情境對話、例句集、單字集都會用到。流程本身
 * （有哪些步驟、什麼時候出現、答了沒、改答案要清掉什麼、要不要先確認）放在各功能的
 * **步驟設定**裡（例如 `scenario-dialogue-editor/scenarioSteps.ts`），這支檔只管通用的
 * 推導：展開步驟、找目前這一步、套用答案、已選項目列、底部對話框狀態、對話紀錄。
 *
 * ## 資料
 * - 答案：`Record<stepId, value>`（`FlowAnswers`）。值是什麼由步驟設定決定；`undefined`
 *   ＝沒答。也可以放不是步驟的旗標。
 * - 情境（`C`，context）：答案以外、但會影響流程的外部事實，例如「右欄有沒有題目」
 *   「情境框有沒有內容」「哪一步正在產生中」。由呼叫端每次算好傳進來。
 * - 文字：一律回 `TextRef`（i18n key＋參數），不在這裡翻譯；畫面用 `resolveText` 轉字串。
 *
 * ## 步驟定義（`StepDef`）
 * | 欄位 | 用途 |
 * |---|---|
 * | `question` / `reask` | 機器人問句／答非所問時的重問句（AI 有回重問句時以 AI 為準） |
 * | `kind` | `choice` 選項、`text` 打字、`card` 卡片（卡片自帶確認鈕，對話框停用） |
 * | `options` | 選項步驟的選項（值＋文字＋小字說明） |
 * | `when` | 出現條件（預設一定出現） |
 * | `isAnswered` | 已答判斷（預設：值不是 undefined／null） |
 * | `terminal` | 永遠是最後一步、不會「已答」（例如舊版的出題設定卡） |
 * | `editable` | 已答過的這一步現在能不能改答案（例如「來源」只在還沒有題目時能改）。第一次回答不檢查；不能改時 `confirmForChange` 回 `CHANGE_BLOCKED`、不跳確認框 |
 * | `clears` | 改成不同答案時要一併清掉的步驟 |
 * | `confirm` | 改答案前要先跳的確認框（回 null ＝不必確認） |
 * | `asyncState` | 非同步狀態：`idle`／`pending`（產生中）／`failed` |
 * | `placeholder` / `pendingPlaceholder` | 底部對話框灰字（這一步、產生中）。打字步驟沒設時用流程的 `textPlaceholder` |
 * | `intent` | 這一步打字要不要交給 AI 判斷意圖（例如情境對話的「自己打題目」） |
 * | `chip` | 已選項目列的標籤：出現條件、標籤文字、目前值、Popover 內容描述 |
 * | `answerText` | 老師這一步的回答怎麼寫進對話紀錄（還原摘要也用它） |
 * | `restore` | 從已存資料還原這一步的值（`answersFromSaved`） |
 *
 * ## 對話紀錄（log）
 * 對話裡顯示的泡泡另存一份 log state，不從答案即時推導：老師在已選項目列改答案時，
 * 前面的紀錄不動，只往下加一句「已把○○改成：…」（`appendChange`）。編輯既有內容時，
 * 由 `summaryLog` 依還原的答案拼出摘要紀錄。
 */

// ============================================================ 文字

/** i18n key＋參數。參數本身也可以是 `TextRef`（例如「已把{{label}}改成」的 label） */
export interface TextRef {
  key: string;
  values?: Record<string, string | number | TextRef>;
}

export const text = (
  key: string,
  values?: Record<string, string | number | TextRef>,
): TextRef => (values ? { key, values } : { key });

/** 把 `TextRef`（含巢狀參數）轉成字串。`t` 就是 react-i18next 的 `t` */
export function resolveText(
  ref: TextRef,
  t: (key: string, values?: Record<string, unknown>) => string,
): string {
  if (!ref.values) return t(ref.key);
  const values: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(ref.values)) {
    values[name] =
      typeof value === "object" && value !== null
        ? resolveText(value, t)
        : value;
  }
  return t(ref.key, values);
}

// ============================================================ 型別

export type FlowAnswers = Record<string, unknown>;
export type StepKind = "choice" | "text" | "card";
export type AsyncState = "idle" | "pending" | "failed";

export interface StepOption {
  value: string;
  label: TextRef;
  /** 選項下方的小字說明 */
  hint?: TextRef;
}

export interface ConfirmSpec {
  title: TextRef;
  description: TextRef;
  confirmLabel: TextRef;
}

/**
 * Popover 內容的描述（只是資料，畫面由共用元件或功能自己畫）：
 * - `options`：直接列出這一步的選項，點了就是改答案；`actions` 是額外的按鈕
 *   （例如情境的「編輯情境內容」），由呼叫端依 `id` 處理。
 * - `text`：一個文字框，改的是這一步的字串答案。
 * - `custom`：功能自己畫（例如情境對話的「設定」精簡版）。
 */
export type PopoverSpec =
  | {
      type: "options";
      actions?: { id: string; label: TextRef }[];
    }
  | { type: "text"; placeholder?: TextRef }
  | { type: "custom"; id: string };

export interface ChipDef<A extends FlowAnswers, C> {
  /** 什麼時候出現在已選項目列（預設：這一步出現且已答） */
  visible?: (a: A, ctx: C) => boolean;
  label: TextRef;
  /** 標籤上顯示的目前值（字串＝老師打的原文；null ＝只顯示標籤文字） */
  value?: (a: A, ctx: C) => TextRef | string | null;
  popover: PopoverSpec;
}

export interface StepDef<A extends FlowAnswers, C, S = unknown> {
  id: keyof A & string;
  kind: StepKind;
  question: (a: A, ctx: C) => TextRef;
  reask?: TextRef;
  options?: readonly StepOption[];
  when?: (a: A, ctx: C) => boolean;
  isAnswered?: (a: A, ctx: C) => boolean;
  terminal?: boolean;
  editable?: (a: A, ctx: C) => boolean;
  clears?: (prev: A, nextValue: unknown, ctx: C) => (keyof A & string)[];
  confirm?: (prev: A, nextValue: unknown, ctx: C) => ConfirmSpec | null;
  asyncState?: (ctx: C) => AsyncState;
  placeholder?: (a: A, ctx: C) => TextRef;
  pendingPlaceholder?: TextRef;
  intent?: boolean;
  chip?: ChipDef<A, C>;
  answerText?: (a: A, ctx: C) => TextRef | string | null;
  restore?(saved: S): unknown;
}

/**
 * 整個流程。`done` 是「全部答完、沒有下一步」時的狀態 —— 情境對話就是「題目已產生」：
 * 對話框可以直接打新題目或請 AI 再出題（`intent: true`）。
 */
export interface FlowDef<A extends FlowAnswers, C, S = unknown> {
  steps: readonly StepDef<A, C, S>[];
  /** 選項步驟的灰字（送出不呼叫 AI，只回同一句提示） */
  choicePlaceholder: TextRef;
  /** 打字步驟沒設 `placeholder` 時的通用灰字 */
  textPlaceholder: TextRef;
  /** 卡片步驟的灰字（對話框停用，說明原因） */
  cardPlaceholder: TextRef;
  /** 產生中的預設灰字 */
  pendingPlaceholder: TextRef;
  done: {
    placeholder: (a: A, ctx: C) => TextRef;
    intent: boolean;
    /**
     * 全部答完後仍可能在跑 AI（例如情境對話題目產生後，老師打字交給 compose）：
     * `pending` 時對話框停用，灰字用 `pendingPlaceholder`（沒設就用流程的預設）。
     */
    asyncState?: (ctx: C) => AsyncState;
    pendingPlaceholder?: TextRef;
  };
}

// ============================================================ 步驟推導

export function findStep<A extends FlowAnswers, C>(
  flow: FlowDef<A, C>,
  id: string,
): StepDef<A, C> {
  const step = flow.steps.find((s) => s.id === id);
  if (!step) throw new Error(`guided-chat: 找不到步驟 ${id}`);
  return step;
}

/** 依目前回答展開出來的步驟序列（只留出現條件成立的） */
export function visibleSteps<A extends FlowAnswers, C>(
  flow: FlowDef<A, C>,
  a: NoInfer<A>,
  ctx: NoInfer<C>,
): StepDef<A, C>[] {
  return flow.steps.filter((s) => (s.when ? s.when(a, ctx) : true));
}

export function isStepAnswered<A extends FlowAnswers, C>(
  step: StepDef<A, C>,
  a: NoInfer<A>,
  ctx: NoInfer<C>,
): boolean {
  if (step.terminal) return false;
  if (step.isAnswered) return step.isAnswered(a, ctx);
  return a[step.id] !== undefined && a[step.id] !== null;
}

/** 目前要回答的那一步。`null` ＝全部答完（進入 `done` 狀態） */
export function activeStep<A extends FlowAnswers, C>(
  flow: FlowDef<A, C>,
  a: NoInfer<A>,
  ctx: NoInfer<C>,
): StepDef<A, C> | null {
  return (
    visibleSteps(flow, a, ctx).find((s) => !isStepAnswered(s, a, ctx)) ?? null
  );
}

export function isFlowDone<A extends FlowAnswers, C>(
  flow: FlowDef<A, C>,
  a: NoInfer<A>,
  ctx: NoInfer<C>,
): boolean {
  return activeStep(flow, a, ctx) === null;
}

export function isStepEditable<A extends FlowAnswers, C>(
  step: StepDef<A, C>,
  a: NoInfer<A>,
  ctx: NoInfer<C>,
): boolean {
  return step.editable ? step.editable(a, ctx) : true;
}

// ============================================================ 改答案

/** 只用 `===` 比；物件型的答案由步驟設定自己決定 clears／confirm 怎麼看 */
const sameValue = (x: unknown, y: unknown) => x === y;

/** `confirmForChange` 的「這一步現在不能改」訊號（不跳確認框，呼叫端顯示原因） */
export const CHANGE_BLOCKED = "blocked" as const;
export type ChangeCheck = ConfirmSpec | null | typeof CHANGE_BLOCKED;

/**
 * 改答案前要不要先確認。第一次回答、選回同一個答案都不必（回 null）。
 * 已答、值不同、而且這一步現在不能改（`editable` 為否）時回 `CHANGE_BLOCKED`：
 * 不跳確認框（確認了也改不了），由呼叫端顯示不能改的原因。其餘交給步驟的 `confirm`。
 */
export function confirmForChange<A extends FlowAnswers, C>(
  flow: FlowDef<A, C>,
  a: NoInfer<A>,
  ctx: NoInfer<C>,
  stepId: keyof A & string,
  nextValue: unknown,
): ChangeCheck {
  const step = findStep(flow, stepId);
  if (!isStepAnswered(step, a, ctx) || sameValue(a[stepId], nextValue)) {
    return null;
  }
  if (!isStepEditable(step, a, ctx)) return CHANGE_BLOCKED;
  return step.confirm ? step.confirm(a, nextValue, ctx) : null;
}

export interface ApplyResult<A extends FlowAnswers> {
  answers: A;
  /** 這次一併被清掉的步驟（呼叫端據此清掉對應的 state，例如情境文章） */
  cleared: (keyof A & string)[];
  /** 答案真的變了（不是選回同一個） */
  changed: boolean;
  /** 這一步現在不能改（`editable` 為否），答案原封不動 */
  blocked: boolean;
}

/**
 * 套用某一步的答案。之前已答、而且改成不同的值時，先看 `editable`（不能改就回
 * `blocked`），再套用步驟的 `clears`；第一次回答不檢查 `editable`、不清任何東西。確認框由呼叫端先用 `confirmForChange` 問過。
 */
export function applyAnswer<A extends FlowAnswers, C>(
  flow: FlowDef<A, C>,
  a: NoInfer<A>,
  ctx: NoInfer<C>,
  stepId: keyof A & string,
  value: unknown,
): ApplyResult<A> {
  const step = findStep(flow, stepId);
  const wasAnswered = isStepAnswered(step, a, ctx);
  const changed = !sameValue(a[stepId], value);
  // editable 只管「已答過、要改答案」；第一次回答一律放行（例如老師還沒答「題目怎麼來」
  // 就先在右欄打了題目，這時來源仍要能第一次選，不然流程會卡死）
  if (wasAnswered && changed && !isStepEditable(step, a, ctx)) {
    return { answers: a, cleared: [], changed: false, blocked: true };
  }
  const cleared =
    wasAnswered && changed && step.clears ? step.clears(a, value, ctx) : [];
  const next = clearAnswers({ ...a, [stepId]: value } as A, cleared);
  return { answers: next, cleared, changed, blocked: false };
}

/** 清掉指定步驟的答案（設成 undefined） */
export function clearAnswers<A extends FlowAnswers>(
  a: A,
  ids: readonly (keyof A & string)[],
): A {
  if (ids.length === 0) return a;
  const next = { ...a };
  for (const id of ids) delete next[id];
  return next;
}

// ============================================================ 已選項目列

export interface ChipState {
  stepId: string;
  label: TextRef;
  value: TextRef | string | null;
  popover: PopoverSpec;
  /** 選項型 Popover 要列的選項（同步驟的 `options`） */
  options?: readonly StepOption[];
}

/** 已選項目列目前要顯示的標籤（依步驟定義順序） */
export function chipsFor<A extends FlowAnswers, C>(
  flow: FlowDef<A, C>,
  a: NoInfer<A>,
  ctx: NoInfer<C>,
): ChipState[] {
  const shown = new Set(visibleSteps(flow, a, ctx).map((s) => s.id));
  const chips: ChipState[] = [];
  for (const step of flow.steps) {
    const chip = step.chip;
    if (!chip) continue;
    const visible = chip.visible
      ? chip.visible(a, ctx)
      : shown.has(step.id) && isStepAnswered(step, a, ctx);
    if (!visible) continue;
    chips.push({
      stepId: step.id,
      label: chip.label,
      value: chip.value ? chip.value(a, ctx) : null,
      popover: chip.popover,
      options: step.options,
    });
  }
  return chips;
}

// ============================================================ 底部對話框

export interface ComposerState {
  /** 目前這一步（`done` 時為 null） */
  stepId: string | null;
  phase: StepKind | "pending" | "done";
  /** 卡片未完成、產生中：停用，灰字說明原因 */
  disabled: boolean;
  placeholder: TextRef;
  /** 送出時要不要交給 AI 判斷意圖（選項步驟一律否：只回「請點選上面的選項」） */
  intent: boolean;
  async: AsyncState;
}

export function composerState<A extends FlowAnswers, C>(
  flow: FlowDef<A, C>,
  a: NoInfer<A>,
  ctx: NoInfer<C>,
): ComposerState {
  const step = activeStep(flow, a, ctx);
  if (!step) {
    const async = flow.done.asyncState ? flow.done.asyncState(ctx) : "idle";
    if (async === "pending") {
      return {
        stepId: null,
        phase: "pending",
        disabled: true,
        placeholder: flow.done.pendingPlaceholder ?? flow.pendingPlaceholder,
        intent: false,
        async,
      };
    }
    return {
      stepId: null,
      phase: "done",
      disabled: false,
      placeholder: flow.done.placeholder(a, ctx),
      intent: flow.done.intent,
      async,
    };
  }
  const async = step.asyncState ? step.asyncState(ctx) : "idle";
  if (async === "pending") {
    return {
      stepId: step.id,
      phase: "pending",
      disabled: true,
      placeholder: step.pendingPlaceholder ?? flow.pendingPlaceholder,
      intent: false,
      async,
    };
  }
  if (step.kind === "choice") {
    return {
      stepId: step.id,
      phase: "choice",
      disabled: false,
      placeholder: flow.choicePlaceholder,
      intent: false,
      async,
    };
  }
  if (step.kind === "card") {
    return {
      stepId: step.id,
      phase: "card",
      disabled: true,
      placeholder: flow.cardPlaceholder,
      intent: false,
      async,
    };
  }
  return {
    stepId: step.id,
    phase: "text",
    disabled: false,
    placeholder: step.placeholder
      ? step.placeholder(a, ctx)
      : flow.textPlaceholder,
    intent: !!step.intent,
    async,
  };
}

// ============================================================ 還原

/**
 * 由已存資料還原答案（編輯既有內容）。每一步的 `restore` 回 `undefined` ＝那一步沒答。
 * 步驟以外的旗標由呼叫端自己補。
 */
export function answersFromSaved<A extends FlowAnswers, C, S>(
  flow: FlowDef<A, C, S>,
  saved: S,
): A {
  const answers: FlowAnswers = {};
  for (const step of flow.steps) {
    if (!step.restore) continue;
    const value = step.restore(saved);
    if (value !== undefined) answers[step.id] = value;
  }
  return answers as A;
}

// ============================================================ 對話紀錄

export type LogRole = "bot" | "teacher" | "note";

export interface FlowLogEntry {
  /** 遞增序號，當 React key 用 */
  id: number;
  role: LogRole;
  /** 這句屬於哪一步（還原摘要、卡片變唯讀時用） */
  stepId?: string;
  /** 文字：i18n 參照，或老師打的原文 */
  text: TextRef | string;
}

export type FlowLog = readonly FlowLogEntry[];

const nextLogId = (log: FlowLog) =>
  log.length === 0 ? 1 : log[log.length - 1].id + 1;

/** 往對話紀錄最後加一句（不改動既有紀錄） */
export function appendLog(
  log: FlowLog,
  entry: Omit<FlowLogEntry, "id">,
): FlowLogEntry[] {
  return [...log, { ...entry, id: nextLogId(log) }];
}

export const CHANGED_LOG_KEY = "guidedChat.log.changed";

/**
 * 在已選項目列改了答案：前面的紀錄不動，只往下加一句「已把○○改成：…」。
 * `label` 是標籤文字（例如「情境」），`value` 是新的值（選項文字或老師打的字）。
 */
export function appendChange(
  log: FlowLog,
  stepId: string,
  label: TextRef,
  value: TextRef | string,
): FlowLogEntry[] {
  return appendLog(log, {
    role: "note",
    stepId,
    text: text(CHANGED_LOG_KEY, { label, value }),
  });
}

/**
 * 依答案拼出摘要紀錄（編輯既有內容時用）：每個出現且已答的步驟，一句問句＋一句回答。
 * `answerText` 回 null 的步驟只放問句（例如卡片步驟沒有可以摘要的回答）。
 */
export function summaryLog<A extends FlowAnswers, C>(
  flow: FlowDef<A, C>,
  a: NoInfer<A>,
  ctx: NoInfer<C>,
): FlowLogEntry[] {
  let log: FlowLogEntry[] = [];
  for (const step of visibleSteps(flow, a, ctx)) {
    if (!isStepAnswered(step, a, ctx)) break;
    log = appendLog(log, {
      role: "bot",
      stepId: step.id,
      text: step.question(a, ctx),
    });
    const answer = step.answerText ? step.answerText(a, ctx) : null;
    if (answer) {
      log = appendLog(log, { role: "teacher", stepId: step.id, text: answer });
    }
  }
  return log;
}
