/**
 * 引導式對話的流程（Issue #1146）—— 純函式，沒有 UI。
 *
 * 對話取代舊的 Step 1 設定頁。**固定流程**：程式帶流程、選項是按鈕，老師打的字只當作
 * 「當下那一步」的答案，不做整句意圖解析。
 *
 * 步驟（依回答動態展開）：
 *
 * | 步驟 | 什麼時候出現 | 已答的判斷 |
 * |---|---|---|
 * | `mode` 需要情境嗎？ | 一定 | `scenarioMode != null` |
 * | `goal` 訓練目標＋文章難度 | mode = ai | `goalDone`（AI 已寫出情境） |
 * | `scenario` 情境框＋情境圖 | mode = existing / ai | `scenarioDone` |
 * | `source` 題目怎麼來？ | 一定 | `questionSource != null` |
 * | `direction` 想問的方向 | mode = none 且 source = ai | `directionDone` |
 * | `settings` 出題設定卡 | source = ai | 永遠是最後一步，不會「已答」 |
 *
 * source = manual 時答完 `source` 就沒有下一步（直接進題目清單）。
 *
 * 「回頭改」：重開某一步會清掉**它與它之後**的回答（`reopenStep`）。後面有已答步驟時，
 * 面板要先跳確認「後面的設定會清空，已產生的題目保留」（`needsReopenConfirm`）。
 * 「需要情境嗎？」改選不同答案會清掉已填的情境，另外確認（`modeChangeClearsScenario`）。
 */

export type ScenarioMode = "none" | "existing" | "ai";
export type QuestionSource = "manual" | "ai";
export type SetupStep =
  | "mode"
  | "goal"
  | "scenario"
  | "source"
  | "direction"
  | "settings";

export interface SetupAnswers {
  scenarioMode: ScenarioMode | null;
  goalDone: boolean;
  scenarioDone: boolean;
  questionSource: QuestionSource | null;
  directionDone: boolean;
}

export const EMPTY_ANSWERS: SetupAnswers = {
  scenarioMode: null,
  goalDone: false,
  scenarioDone: false,
  questionSource: null,
  directionDone: false,
};

export const SCENARIO_MODES: readonly ScenarioMode[] = [
  "none",
  "existing",
  "ai",
];
export const QUESTION_SOURCES: readonly QuestionSource[] = ["manual", "ai"];

/** 依目前回答展開出來的步驟序列 */
export function stepsFor(a: SetupAnswers): SetupStep[] {
  const steps: SetupStep[] = ["mode"];
  if (a.scenarioMode === "ai") steps.push("goal");
  if (a.scenarioMode === "ai" || a.scenarioMode === "existing") {
    steps.push("scenario");
  }
  steps.push("source");
  if (a.questionSource === "ai" && a.scenarioMode === "none") {
    steps.push("direction");
  }
  if (a.questionSource === "ai") steps.push("settings");
  return steps;
}

export function isAnswered(step: SetupStep, a: SetupAnswers): boolean {
  switch (step) {
    case "mode":
      return a.scenarioMode != null;
    case "goal":
      return a.goalDone;
    case "scenario":
      return a.scenarioDone;
    case "source":
      return a.questionSource != null;
    case "direction":
      return a.directionDone;
    case "settings":
      return false;
  }
}

/**
 * 目前要回答的那一步。`null` = 全部答完且沒有下一步（自己出題 → 進題目清單）。
 * 前面某一步還沒答時（理論上不會），一律停在那一步。
 */
export function activeStep(a: SetupAnswers): SetupStep | null {
  return stepsFor(a).find((s) => !isAnswered(s, a)) ?? null;
}

/** 重開 `step`：清掉它與它之後的回答 */
export function reopenStep(step: SetupStep, a: SetupAnswers): SetupAnswers {
  switch (step) {
    case "mode":
      return { ...EMPTY_ANSWERS };
    case "goal":
      return { ...EMPTY_ANSWERS, scenarioMode: a.scenarioMode };
    case "scenario":
      return {
        ...EMPTY_ANSWERS,
        scenarioMode: a.scenarioMode,
        goalDone: a.goalDone,
      };
    case "source":
      return { ...a, questionSource: null, directionDone: false };
    case "direction":
      return { ...a, directionDone: false };
    case "settings":
      return a;
  }
}

/** 重開這一步會不會清掉其他已答的步驟（＝要不要先跳確認） */
export function needsReopenConfirm(step: SetupStep, a: SetupAnswers): boolean {
  const steps = stepsFor(a);
  const index = steps.indexOf(step);
  return steps.slice(index + 1).some((s) => isAnswered(s, a));
}

/**
 * 「需要情境嗎？」改選成不同的答案時，已填的情境（情境框文字、情境圖）會被清空。
 * `needsReopenConfirm` 只看後面有沒有已答步驟 —— 老師停在情境那一步、文字打好了但還沒
 * 按下一步時，後面沒有已答步驟，改選就會無聲清掉他打的東西（review 2）。所以選項按下去
 * 的當下再檢查一次：會清掉東西就先確認。
 *
 * `lastMode` 為 null（第一次選）或選回同一個（保留已填情境）都不會清。
 */
export function modeChangeClearsScenario(
  lastMode: ScenarioMode | null,
  nextMode: ScenarioMode,
  hasScenarioMaterial: boolean,
): boolean {
  return lastMode !== null && lastMode !== nextMode && hasScenarioMaterial;
}

/**
 * 「回上一步」：目前這一步的前一個步驟。沒有前一步回 `null`。
 * 目前這一步還沒答，所以重開前一步不會清掉任何「後面已答」的東西 —— 不必確認。
 */
export function previousStep(a: SetupAnswers): SetupStep | null {
  const steps = stepsFor(a);
  const current = activeStep(a);
  const index = current ? steps.indexOf(current) : steps.length;
  return index > 0 ? steps[index - 1] : null;
}

/**
 * 由已存資料還原已答步驟（編輯既有內容 → 按「上一步」回到對話）。
 *
 * 新資料存了 `scenario_mode` / `question_source`；舊資料（#1146 以前）沒有，就由情境
 * 文章與情境圖推斷：有情境 → 「我有現成的」，沒有 → 「不需要」；題目一律視為「自己
 * 輸入」（舊流程沒有對話紀錄，無從得知當初是不是 AI 出的；選自己輸入至少不會讓
 * 老師以為還要再產一次題）。
 */
export function answersFromSaved(saved: {
  scenarioMode: string;
  questionSource: string;
  hasScenario: boolean;
}): SetupAnswers {
  const mode: ScenarioMode = (SCENARIO_MODES as readonly string[]).includes(
    saved.scenarioMode,
  )
    ? (saved.scenarioMode as ScenarioMode)
    : saved.hasScenario
      ? "existing"
      : "none";
  const source: QuestionSource = (
    QUESTION_SOURCES as readonly string[]
  ).includes(saved.questionSource)
    ? (saved.questionSource as QuestionSource)
    : "manual";
  return {
    scenarioMode: mode,
    goalDone: mode === "ai",
    scenarioDone: mode !== "none",
    questionSource: source,
    directionDone: source === "ai" && mode === "none",
  };
}
