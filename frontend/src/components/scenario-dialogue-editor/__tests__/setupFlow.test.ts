/**
 * 引導式對話流程（Issue #1146）—— 純函式。
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_ANSWERS,
  activeStep,
  answersFromSaved,
  modeChangeClearsScenario,
  needsReopenConfirm,
  previousStep,
  reopenStep,
  stepsFor,
  type SetupAnswers,
} from "../setupFlow";

const a = (patch: Partial<SetupAnswers>): SetupAnswers => ({
  ...EMPTY_ANSWERS,
  ...patch,
});

describe("stepsFor / activeStep", () => {
  it("一開始只問「需要情境嗎？」", () => {
    expect(activeStep(EMPTY_ANSWERS)).toBe("mode");
  });

  it("請 AI 寫：訓練目標 → 情境框 → 題目怎麼來", () => {
    expect(stepsFor(a({ scenarioMode: "ai" }))).toEqual([
      "mode",
      "goal",
      "scenario",
      "source",
    ]);
    expect(activeStep(a({ scenarioMode: "ai" }))).toBe("goal");
    expect(activeStep(a({ scenarioMode: "ai", goalDone: true }))).toBe(
      "scenario",
    );
  });

  it("不需要情境＋AI 出題：要問出題方向，最後是設定卡", () => {
    const answers = a({ scenarioMode: "none", questionSource: "ai" });
    expect(stepsFor(answers)).toEqual([
      "mode",
      "source",
      "direction",
      "settings",
    ]);
    expect(activeStep(answers)).toBe("direction");
    expect(activeStep({ ...answers, directionDone: true })).toBe("settings");
  });

  it("有情境＋AI 出題：不問方向", () => {
    expect(
      stepsFor(
        a({
          scenarioMode: "existing",
          scenarioDone: true,
          questionSource: "ai",
        }),
      ),
    ).toEqual(["mode", "scenario", "source", "settings"]);
  });

  it("自己出題答完就沒有下一步", () => {
    expect(
      activeStep(a({ scenarioMode: "none", questionSource: "manual" })),
    ).toBeNull();
  });
});

describe("reopenStep / needsReopenConfirm / previousStep", () => {
  const full = a({
    scenarioMode: "ai",
    goalDone: true,
    scenarioDone: true,
    questionSource: "ai",
  });

  it("重開前面的步驟會清掉它與之後的回答", () => {
    expect(reopenStep("goal", full)).toEqual(a({ scenarioMode: "ai" }));
    expect(reopenStep("mode", full)).toEqual(EMPTY_ANSWERS);
    expect(reopenStep("source", full)).toEqual({
      ...full,
      questionSource: null,
    });
  });

  it("後面還有已答步驟才需要確認", () => {
    expect(needsReopenConfirm("mode", full)).toBe(true);
    expect(needsReopenConfirm("source", full)).toBe(false);
  });

  it("回上一步＝目前這一步的前一步", () => {
    expect(previousStep(EMPTY_ANSWERS)).toBeNull();
    expect(previousStep(a({ scenarioMode: "existing" }))).toBe("mode");
    expect(previousStep(full)).toBe("source");
  });
});

describe("answersFromSaved", () => {
  it("新資料照存下來的回答還原", () => {
    expect(
      answersFromSaved({
        scenarioMode: "none",
        questionSource: "ai",
        hasScenario: false,
      }),
    ).toEqual(
      a({ scenarioMode: "none", questionSource: "ai", directionDone: true }),
    );
  });

  it("舊資料：有情境 → 我有現成的；沒有 → 不需要；題目一律當自己輸入", () => {
    expect(
      answersFromSaved({
        scenarioMode: "",
        questionSource: "",
        hasScenario: true,
      }),
    ).toEqual(
      a({
        scenarioMode: "existing",
        scenarioDone: true,
        questionSource: "manual",
      }),
    );
    expect(
      answersFromSaved({
        scenarioMode: "",
        questionSource: "",
        hasScenario: false,
      }).scenarioMode,
    ).toBe("none");
  });
});

describe("modeChangeClearsScenario（review 2）", () => {
  it("第一次選、選回同一個都不會清", () => {
    expect(modeChangeClearsScenario(null, "existing", true)).toBe(false);
    expect(modeChangeClearsScenario("existing", "existing", true)).toBe(false);
  });

  it("改選不同答案且情境框有東西 → 要確認", () => {
    expect(modeChangeClearsScenario("existing", "none", true)).toBe(true);
    expect(modeChangeClearsScenario("ai", "existing", true)).toBe(true);
  });

  it("情境框是空的就不必確認", () => {
    expect(modeChangeClearsScenario("existing", "none", false)).toBe(false);
  });

  it("停在情境那一步、後面沒有已答步驟時，改選的確認擋不到 —— 所以需要這一道", () => {
    const answers = a({ scenarioMode: "existing" });
    expect(needsReopenConfirm("mode", answers)).toBe(false);
    expect(modeChangeClearsScenario("existing", "ai", true)).toBe(true);
  });
});
