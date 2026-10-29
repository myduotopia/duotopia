/**
 * 情境對話步驟設定（Issue #1158 C 段 commit 2）：步驟展開、已選項目列的出現與消失、
 * 清除規則、從已存資料還原（舊資料與新欄位）。
 */
import { describe, expect, it } from "vitest";
import {
  activeStep,
  applyAnswer,
  chipsFor,
  composerState,
  confirmForChange,
  isFlowDone,
  summaryLog,
  visibleSteps,
  type TextRef,
} from "@/components/shared/guided-chat/flowEngine";
import zhTW from "@/i18n/locales/zh-TW/translation.json";
import en from "@/i18n/locales/en/translation.json";
import {
  EMPTY_SCENARIO_CONTEXT,
  MODE_CHANGE_CONFIRM,
  REWRITE_ARTICLE_CONFIRM,
  SCENARIO_FLOW,
  SOURCE_CHANGE_CONFIRM,
  scenarioAnswersFromSaved,
  type ScenarioAnswers,
  type ScenarioFlowContext,
  type ScenarioSaved,
} from "../scenarioSteps";

const ctx = (
  patch: Partial<ScenarioFlowContext> = {},
): ScenarioFlowContext => ({
  ...EMPTY_SCENARIO_CONTEXT,
  ...patch,
});
const ids = (a: ScenarioAnswers, c = ctx()) =>
  visibleSteps(SCENARIO_FLOW, a, c).map((s) => s.id);
const active = (a: ScenarioAnswers, c = ctx()) =>
  activeStep(SCENARIO_FLOW, a, c)?.id ?? null;
const chips = (a: ScenarioAnswers, c = ctx()) =>
  chipsFor(SCENARIO_FLOW, a, c).map((chip) => chip.stepId);

describe("步驟展開", () => {
  it("一開始只問「需要情境嗎？」，是選項步驟、打字不呼叫 AI", () => {
    expect(active({})).toBe("mode");
    expect(composerState(SCENARIO_FLOW, {}, ctx())).toMatchObject({
      phase: "choice",
      intent: false,
    });
  });

  it("AI 寫情境：訓練目標 → 情境卡 → 來源", () => {
    expect(ids({ mode: "ai" })).toEqual(["mode", "goal", "scenario", "source"]);
    expect(active({ mode: "ai" })).toBe("goal");
    expect(active({ mode: "ai", goal: "點餐" })).toBe("scenario");
    expect(active({ mode: "ai", goal: "點餐", scenario: true })).toBe("source");
  });

  it("寫情境中：對話框停用", () => {
    expect(
      composerState(SCENARIO_FLOW, { mode: "ai" }, ctx({ pending: "goal" })),
    ).toMatchObject({ phase: "pending", disabled: true });
  });

  it("情境卡還沒按「用這篇情境」：對話框停用", () => {
    expect(
      composerState(SCENARIO_FLOW, { mode: "existing" }, ctx()),
    ).toMatchObject({ phase: "card", disabled: true });
  });

  it("不需要情境＋AI 出題：方向 → 設定卡；產生後是「題目已產生」", () => {
    const a: ScenarioAnswers = { mode: "none", source: "ai" };
    expect(ids(a)).toEqual(["mode", "source", "direction", "settings"]);
    expect(active(a)).toBe("direction");
    expect(active({ ...a, direction: "週末" })).toBe("settings");
    const done = { ...a, direction: "週末", settings: true };
    expect(isFlowDone(SCENARIO_FLOW, done, ctx({ hasQuestions: true }))).toBe(
      true,
    );
    expect(
      composerState(SCENARIO_FLOW, done, ctx({ hasQuestions: true })),
    ).toMatchObject({ phase: "done", intent: true, disabled: false });
  });

  it("有情境＋AI 出題：不問方向", () => {
    expect(ids({ mode: "existing", scenario: true, source: "ai" })).toEqual([
      "mode",
      "scenario",
      "source",
      "settings",
    ]);
  });

  it("自己輸入：接著問「請直接把題目打在下面」，打字交給 AI 判斷意圖", () => {
    const a: ScenarioAnswers = { mode: "none", source: "manual" };
    expect(ids(a)).toEqual(["mode", "source", "manualInput"]);
    expect(composerState(SCENARIO_FLOW, a, ctx())).toMatchObject({
      phase: "text",
      intent: true,
      stepId: "manualInput",
    });
    expect(isFlowDone(SCENARIO_FLOW, { ...a, manualInput: true }, ctx())).toBe(
      true,
    );
  });

  it("產生題目後才把情境改成「不需要」：方向不會冒出來卡住對話", () => {
    const a: ScenarioAnswers = { mode: "none", source: "ai", settings: true };
    expect(isFlowDone(SCENARIO_FLOW, a, ctx({ hasQuestions: true }))).toBe(
      true,
    );
  });
});

describe("已選項目列：出現與消失", () => {
  it("情境：答完「需要情境嗎」就出現，Popover 有三個方式＋編輯情境內容", () => {
    expect(chips({})).toEqual([]);
    const [chip] = chipsFor(SCENARIO_FLOW, { mode: "existing" }, ctx());
    expect(chip.stepId).toBe("mode");
    expect(chip.options).toHaveLength(3);
    expect(chip.popover).toMatchObject({
      type: "options",
      actions: [{ id: "editScenario" }],
    });
  });

  it("來源：答完就出現；右欄有題目時隱藏，題目刪光再出現", () => {
    const a: ScenarioAnswers = {
      mode: "existing",
      scenario: true,
      source: "ai",
    };
    expect(chips(a)).toContain("source");
    expect(chips(a, ctx({ hasQuestions: true }))).not.toContain("source");
    expect(chips(a, ctx({ hasQuestions: false }))).toContain("source");
  });

  it("方向：只在「不需要情境」且「AI 出題」時出現", () => {
    expect(chips({ mode: "none", source: "ai", direction: "週末" })).toContain(
      "direction",
    );
    expect(
      chips({ mode: "none", source: "manual", direction: "週末" }),
    ).not.toContain("direction");
    expect(
      chips({ mode: "existing", source: "ai", direction: "週末" }),
    ).not.toContain("direction");
  });

  it("設定：AI 出題第一次產生題目後出現；自己輸入答完來源就出現", () => {
    expect(chips({ mode: "none", source: "ai", direction: "x" })).not.toContain(
      "settings",
    );
    expect(
      chips({ mode: "none", source: "ai", direction: "x", settings: true }),
    ).toContain("settings");
    expect(chips({ mode: "none", source: "manual" })).toContain("settings");
  });

  it("標籤值用短文字；方向直接顯示老師打的字", () => {
    const list = chipsFor(
      SCENARIO_FLOW,
      { mode: "none", source: "ai", direction: "週末活動" },
      ctx(),
    );
    expect(list.find((c) => c.stepId === "mode")?.value).toEqual({
      key: "scenarioDialogue.setup.chipValues.mode.none",
    });
    expect(list.find((c) => c.stepId === "direction")?.value).toBe("週末活動");
  });
});

describe("清除規則", () => {
  const generated: ScenarioAnswers = {
    mode: "ai",
    goal: "點餐",
    scenario: true,
    source: "ai",
    settings: true,
  };

  it("改情境方式：只清情境那幾步，來源與設定保留；有情境內容先確認", () => {
    const c = ctx({ hasQuestions: true, hasScenarioMaterial: true });
    expect(
      confirmForChange(SCENARIO_FLOW, generated, c, "mode", "existing"),
    ).toBe(MODE_CHANGE_CONFIRM);
    const r = applyAnswer(SCENARIO_FLOW, generated, c, "mode", "existing");
    expect(r.cleared).toEqual(["goal", "scenario"]);
    expect(r.answers).toEqual({
      mode: "existing",
      source: "ai",
      settings: true,
    });
    // 只重做情境：下一步是情境卡
    expect(active(r.answers, c)).toBe("scenario");
  });

  it("改情境方式但情境是空的、也沒有訓練目標：不必確認", () => {
    expect(
      confirmForChange(
        SCENARIO_FLOW,
        { mode: "existing", scenario: true },
        ctx(),
        "mode",
        "none",
      ),
    ).toBeNull();
  });

  it("改情境方式時保留方向", () => {
    const a: ScenarioAnswers = {
      mode: "none",
      source: "ai",
      direction: "週末",
      settings: true,
    };
    const r = applyAnswer(SCENARIO_FLOW, a, ctx(), "mode", "ai");
    expect(r.answers.direction).toBe("週末");
  });

  it("改來源：有題目時不能改", () => {
    const r = applyAnswer(
      SCENARIO_FLOW,
      generated,
      ctx({ hasQuestions: true }),
      "source",
      "manual",
    );
    expect(r.blocked).toBe(true);
    expect(r.answers.source).toBe("ai");
  });

  it("改來源：沒題目時清掉方向和設定，要先確認", () => {
    const a: ScenarioAnswers = {
      mode: "none",
      source: "ai",
      direction: "週末",
      settings: true,
    };
    expect(confirmForChange(SCENARIO_FLOW, a, ctx(), "source", "manual")).toBe(
      SOURCE_CHANGE_CONFIRM,
    );
    const r = applyAnswer(SCENARIO_FLOW, a, ctx(), "source", "manual");
    expect(r.answers).toEqual({ mode: "none", source: "manual" });
    expect(active(r.answers)).toBe("manualInput");
  });

  it("改來源但後面還沒答：不必確認", () => {
    expect(
      confirmForChange(
        SCENARIO_FLOW,
        { mode: "none", source: "ai" },
        ctx(),
        "source",
        "manual",
      ),
    ).toBeNull();
  });

  it("改方向、改設定：不清除、不確認", () => {
    const a: ScenarioAnswers = {
      mode: "none",
      source: "ai",
      direction: "週末",
      settings: true,
    };
    const c = ctx({ hasQuestions: true });
    expect(
      confirmForChange(SCENARIO_FLOW, a, c, "direction", "學校"),
    ).toBeNull();
    const r = applyAnswer(SCENARIO_FLOW, a, c, "direction", "學校");
    expect(r.cleared).toEqual([]);
    expect(r.answers).toEqual({ ...a, direction: "學校" });
  });

  it("重寫情境文章有自己的確認框", () => {
    expect(REWRITE_ARTICLE_CONFIRM.description.key).toBe(
      "scenarioDialogue.setup.rewriteConfirmDescription",
    );
  });
});

describe("從已存資料還原", () => {
  const saved = (patch: Partial<ScenarioSaved>): ScenarioSaved => ({
    scenarioMode: "",
    questionSource: "",
    goal: "",
    direction: "",
    hasScenario: false,
    hasQuestions: true,
    ...patch,
  });

  it("新資料：AI 寫情境＋AI 出題 → 全部已答（題目已產生）", () => {
    const a = scenarioAnswersFromSaved(
      saved({
        scenarioMode: "ai",
        questionSource: "ai",
        goal: "點餐",
        hasScenario: true,
      }),
    );
    expect(a).toEqual({
      mode: "ai",
      goal: "點餐",
      scenario: true,
      source: "ai",
      settings: true,
    });
    expect(isFlowDone(SCENARIO_FLOW, a, ctx({ hasQuestions: true }))).toBe(
      true,
    );
  });

  it("新資料：不需要情境＋AI 出題 → 還原方向", () => {
    expect(
      scenarioAnswersFromSaved(
        saved({
          scenarioMode: "none",
          questionSource: "ai",
          direction: "週末",
        }),
      ),
    ).toEqual({
      mode: "none",
      source: "ai",
      direction: "週末",
      settings: true,
    });
  });

  it("新資料：自己輸入 → 自己打題目已答", () => {
    expect(
      scenarioAnswersFromSaved(
        saved({
          scenarioMode: "existing",
          questionSource: "manual",
          hasScenario: true,
        }),
      ),
    ).toEqual({
      mode: "existing",
      scenario: true,
      source: "manual",
      manualInput: true,
    });
  });

  it("舊資料：有情境 → 既有教材；沒有 → 不需要；題目一律當自己輸入", () => {
    expect(scenarioAnswersFromSaved(saved({ hasScenario: true }))).toEqual({
      mode: "existing",
      scenario: true,
      source: "manual",
      manualInput: true,
    });
    expect(scenarioAnswersFromSaved(saved({})).mode).toBe("none");
  });

  it("AI 寫情境但訓練目標沒存：仍算已答，不會卡在訓練目標", () => {
    const a = scenarioAnswersFromSaved(
      saved({
        scenarioMode: "ai",
        questionSource: "manual",
        hasScenario: true,
      }),
    );
    expect(a.goal).toBe("");
    expect(isFlowDone(SCENARIO_FLOW, a, ctx({ hasQuestions: true }))).toBe(
      true,
    );
  });

  it("還原後拼出摘要紀錄", () => {
    const a = scenarioAnswersFromSaved(
      saved({ scenarioMode: "none", questionSource: "ai", direction: "週末" }),
    );
    const log = summaryLog(SCENARIO_FLOW, a, ctx({ hasQuestions: true }));
    expect(log.map((e) => e.role)).toEqual([
      "bot",
      "teacher",
      "bot",
      "teacher",
      "bot",
      "teacher",
      "bot",
    ]);
    expect(log[5].text).toBe("週末");
  });
});

describe("i18n：步驟設定用到的文字中英文都有", () => {
  const collect = (): string[] => {
    const keys: string[] = [];
    const push = (ref: TextRef | string | null | undefined) => {
      if (ref && typeof ref === "object") keys.push(ref.key);
    };
    push(SCENARIO_FLOW.choicePlaceholder);
    push(SCENARIO_FLOW.cardPlaceholder);
    push(SCENARIO_FLOW.pendingPlaceholder);
    push(SCENARIO_FLOW.done.placeholder({}, ctx()));
    for (const c of [
      MODE_CHANGE_CONFIRM,
      SOURCE_CHANGE_CONFIRM,
      REWRITE_ARTICLE_CONFIRM,
    ]) {
      push(c.title);
      push(c.description);
      push(c.confirmLabel);
    }
    const samples: ScenarioAnswers[] = [
      { mode: "none", source: "ai", direction: "x" },
      { mode: "existing", source: "manual" },
      { mode: "ai", goal: "g", source: "ai" },
    ];
    for (const step of SCENARIO_FLOW.steps) {
      push(step.reask);
      step.options?.forEach((o) => {
        push(o.label);
        push(o.hint);
      });
      if (step.chip) {
        push(step.chip.label);
        if (step.chip.popover.type === "options") {
          step.chip.popover.actions?.forEach((act) => push(act.label));
        }
        if (step.chip.popover.type === "text")
          push(step.chip.popover.placeholder);
      }
      for (const a of samples) {
        push(step.question(a, ctx()));
        push(step.placeholder?.(a, ctx()));
        push(step.answerText?.(a, ctx()));
        push(step.chip?.value?.(a, ctx()));
      }
    }
    return [...new Set(keys)];
  };
  const lookup = (dict: unknown, key: string) =>
    key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === "object"
            ? (node as Record<string, unknown>)[part]
            : undefined,
        dict,
      );

  it.each([
    ["zh-TW", zhTW],
    ["en", en],
  ])("%s", (_name, dict) => {
    const missing = collect().filter(
      (k) => typeof lookup(dict, k) !== "string",
    );
    expect(missing).toEqual([]);
  });
});
