/**
 * 通用流程引擎（Issue #1158 C 段 commit 2）—— 用一個小型假流程測引擎本身，
 * 不依賴情境對話的設定。
 */
import { describe, expect, it } from "vitest";
import {
  CHANGED_LOG_KEY,
  activeStep,
  answersFromSaved,
  appendChange,
  appendLog,
  applyAnswer,
  chipsFor,
  composerState,
  CHANGE_BLOCKED,
  confirmForChange,
  isFlowDone,
  resolveText,
  summaryLog,
  text,
  visibleSteps,
  type FlowDef,
} from "../flowEngine";

type Answers = {
  topic?: string;
  count?: number;
  kind?: "a" | "b";
  card?: boolean;
};
interface Ctx {
  locked: boolean;
  pending: string | null;
}
interface Saved {
  topic: string;
  kind: string;
}

const CONFIRM = {
  title: text("x.confirmTitle"),
  description: text("x.confirmDesc"),
  confirmLabel: text("x.ok"),
};

const flow: FlowDef<Answers, Ctx, Saved> = {
  choicePlaceholder: text("x.choose"),
  textPlaceholder: text("x.type"),
  cardPlaceholder: text("x.card"),
  pendingPlaceholder: text("x.pending"),
  done: {
    placeholder: () => text("x.done"),
    intent: true,
    asyncState: (ctx) => (ctx.pending === "done" ? "pending" : "idle"),
  },
  steps: [
    {
      id: "kind",
      kind: "choice",
      question: () => text("x.q.kind"),
      options: [
        { value: "a", label: text("x.a") },
        { value: "b", label: text("x.b") },
      ],
      editable: (_a, ctx) => !ctx.locked,
      clears: () => ["topic", "card"],
      confirm: (a) => (a.topic ? CONFIRM : null),
      answerText: (a) => (a.kind ? text(`x.${a.kind}`) : null),
      chip: {
        label: text("x.chip.kind"),
        value: (a) => (a.kind ? text(`x.${a.kind}`) : null),
        popover: { type: "options" },
      },
      restore: (s) => (s.kind === "a" || s.kind === "b" ? s.kind : undefined),
    },
    {
      id: "topic",
      kind: "text",
      question: () => text("x.q.topic"),
      when: (a) => a.kind === "a",
      placeholder: () => text("x.topicHint"),
      intent: true,
      asyncState: (ctx) => (ctx.pending === "topic" ? "pending" : "idle"),
      answerText: (a) => a.topic ?? null,
      chip: {
        visible: (a, ctx) => !!a.topic && !ctx.locked,
        label: text("x.chip.topic"),
        value: (a) => a.topic ?? null,
        popover: { type: "text" },
      },
      restore: (s) => s.topic || undefined,
    },
    {
      id: "card",
      kind: "card",
      question: () => text("x.q.card"),
      isAnswered: (a) => a.card === true,
    },
  ],
};

const idle: Ctx = { locked: false, pending: null };

describe("步驟展開與已答", () => {
  it("出現條件決定步驟序列", () => {
    expect(visibleSteps(flow, {}, idle).map((s) => s.id)).toEqual([
      "kind",
      "card",
    ]);
    expect(visibleSteps(flow, { kind: "a" }, idle).map((s) => s.id)).toEqual([
      "kind",
      "topic",
      "card",
    ]);
  });

  it("目前這一步＝第一個沒答的步驟；全答完是 done", () => {
    expect(activeStep(flow, {}, idle)?.id).toBe("kind");
    expect(activeStep(flow, { kind: "a" }, idle)?.id).toBe("topic");
    expect(activeStep(flow, { kind: "b" }, idle)?.id).toBe("card");
    expect(isFlowDone(flow, { kind: "b", card: true }, idle)).toBe(true);
  });

  it("預設已答判斷：undefined／null 才算沒答，空字串算已答", () => {
    expect(activeStep(flow, { kind: "a", topic: "" }, idle)?.id).toBe("card");
  });

  it("terminal 步驟永遠不算已答", () => {
    const f: FlowDef<Answers, Ctx> = {
      ...flow,
      steps: [{ ...flow.steps[2], isAnswered: undefined, terminal: true }],
    } as FlowDef<Answers, Ctx>;
    expect(activeStep(f, { card: true }, idle)?.id).toBe("card");
  });
});

describe("改答案：清除、確認、不能改", () => {
  it("第一次回答不清任何東西", () => {
    const r = applyAnswer(flow, { topic: "food" }, idle, "kind", "a");
    expect(r.answers).toEqual({ topic: "food", kind: "a" });
    expect(r.cleared).toEqual([]);
    expect(r.changed).toBe(true);
  });

  it("改成不同答案才套用清除規則", () => {
    const a: Answers = { kind: "a", topic: "food", card: true };
    const r = applyAnswer(flow, a, idle, "kind", "b");
    expect(r.answers).toEqual({ kind: "b" });
    expect(r.cleared).toEqual(["topic", "card"]);
  });

  it("選回同一個答案不清除", () => {
    const a: Answers = { kind: "a", topic: "food" };
    const r = applyAnswer(flow, a, idle, "kind", "a");
    expect(r.answers).toEqual(a);
    expect(r.changed).toBe(false);
    expect(r.cleared).toEqual([]);
  });

  it("editable 為否時答案不動、回 blocked", () => {
    const a: Answers = { kind: "a" };
    const r = applyAnswer(flow, a, { ...idle, locked: true }, "kind", "b");
    expect(r.blocked).toBe(true);
    expect(r.answers).toBe(a);
  });

  it("editable 只管改答案：第一次回答即使 editable 為否也放行", () => {
    const r = applyAnswer(flow, {}, { ...idle, locked: true }, "kind", "a");
    expect(r.blocked).toBe(false);
    expect(r.answers).toEqual({ kind: "a" });
  });

  it("editable 為否時選回同一個答案不算被擋", () => {
    const a: Answers = { kind: "a" };
    const r = applyAnswer(flow, a, { ...idle, locked: true }, "kind", "a");
    expect(r.blocked).toBe(false);
    expect(r.changed).toBe(false);
  });

  it("特殊確認：第一次、選回同一個都不問；改答案且會清東西才問", () => {
    expect(confirmForChange(flow, {}, idle, "kind", "a")).toBeNull();
    expect(
      confirmForChange(flow, { kind: "a", topic: "x" }, idle, "kind", "a"),
    ).toBeNull();
    expect(
      confirmForChange(flow, { kind: "a", topic: "x" }, idle, "kind", "b"),
    ).toBe(CONFIRM);
    expect(confirmForChange(flow, { kind: "a" }, idle, "kind", "b")).toBeNull();
  });

  it("已答、值不同但不能改：不跳確認框，回 blocked（呼叫端顯示原因）", () => {
    const locked = { ...idle, locked: true };
    expect(
      confirmForChange(flow, { kind: "a", topic: "x" }, locked, "kind", "b"),
    ).toBe(CHANGE_BLOCKED);
    // 選回同一個、第一次回答都不算被擋
    expect(
      confirmForChange(flow, { kind: "a", topic: "x" }, locked, "kind", "a"),
    ).toBeNull();
    expect(confirmForChange(flow, {}, locked, "kind", "a")).toBeNull();
  });
});

describe("已選項目列", () => {
  it("預設：步驟出現且已答才顯示；自訂 visible 優先", () => {
    expect(chipsFor(flow, {}, idle)).toEqual([]);
    const chips = chipsFor(flow, { kind: "a", topic: "food" }, idle);
    expect(chips.map((c) => c.stepId)).toEqual(["kind", "topic"]);
    expect(chips[0].options).toHaveLength(2);
    expect(chips[1].value).toBe("food");
    expect(
      chipsFor(flow, { kind: "a", topic: "food" }, { ...idle, locked: true }),
    ).toHaveLength(1);
  });
});

describe("底部對話框", () => {
  it("選項步驟：可打字但不呼叫 AI，灰字請點選選項", () => {
    const s = composerState(flow, {}, idle);
    expect(s).toMatchObject({
      phase: "choice",
      disabled: false,
      intent: false,
      placeholder: text("x.choose"),
    });
  });

  it("打字步驟用自己的灰字與 intent；產生中停用", () => {
    expect(composerState(flow, { kind: "a" }, idle)).toMatchObject({
      phase: "text",
      intent: true,
      placeholder: text("x.topicHint"),
    });
    expect(
      composerState(flow, { kind: "a" }, { ...idle, pending: "topic" }),
    ).toMatchObject({
      phase: "pending",
      disabled: true,
      async: "pending",
      placeholder: text("x.pending"),
    });
  });

  it("卡片步驟停用；全答完是 done", () => {
    expect(composerState(flow, { kind: "b" }, idle)).toMatchObject({
      phase: "card",
      disabled: true,
    });
    expect(composerState(flow, { kind: "b", card: true }, idle)).toMatchObject({
      phase: "done",
      intent: true,
      stepId: null,
      placeholder: text("x.done"),
    });
  });

  it("done 狀態也能是產生中：對話框停用", () => {
    expect(
      composerState(
        flow,
        { kind: "b", card: true },
        { ...idle, pending: "done" },
      ),
    ).toMatchObject({
      phase: "pending",
      stepId: null,
      disabled: true,
      intent: false,
      async: "pending",
      placeholder: text("x.pending"),
    });
  });

  it("打字步驟沒設灰字：用通用打字灰字，不是「請點選選項」", () => {
    const f = {
      ...flow,
      steps: [{ ...flow.steps[1], when: undefined, placeholder: undefined }],
    } as FlowDef<Answers, Ctx>;
    expect(composerState(f, {}, idle)).toMatchObject({
      phase: "text",
      placeholder: text("x.type"),
    });
  });
});

describe("從已存資料還原", () => {
  it("每一步依 restore 還原，undefined 的不寫入", () => {
    expect(answersFromSaved(flow, { topic: "food", kind: "a" })).toEqual({
      kind: "a",
      topic: "food",
    });
    expect(answersFromSaved(flow, { topic: "", kind: "?" })).toEqual({});
  });
});

describe("對話紀錄", () => {
  it("appendLog 只往後加，id 遞增，不改原陣列", () => {
    const log1 = appendLog([], { role: "bot", text: text("x.q.kind") });
    const log2 = appendLog(log1, { role: "teacher", text: "hello" });
    expect(log1).toHaveLength(1);
    expect(log2.map((e) => e.id)).toEqual([1, 2]);
  });

  it("appendChange 加一句「已把○○改成：…」", () => {
    const log = appendChange([], "kind", text("x.chip.kind"), text("x.b"));
    expect(log[0]).toMatchObject({
      role: "note",
      stepId: "kind",
      text: {
        key: CHANGED_LOG_KEY,
        values: { label: text("x.chip.kind"), value: text("x.b") },
      },
    });
  });

  it("summaryLog 依答案拼出問句＋回答，停在第一個沒答的步驟", () => {
    const log = summaryLog(flow, { kind: "a", topic: "food" }, idle);
    expect(log.map((e) => [e.role, e.text])).toEqual([
      ["bot", text("x.q.kind")],
      ["teacher", text("x.a")],
      ["bot", text("x.q.topic")],
      ["teacher", "food"],
    ]);
  });

  it("resolveText 會先翻譯巢狀參數", () => {
    const t = (key: string, values?: Record<string, unknown>) =>
      values ? `${key}(${JSON.stringify(values)})` : `T:${key}`;
    expect(
      resolveText(
        text(CHANGED_LOG_KEY, { label: text("x.chip.kind"), value: "b" }),
        t,
      ),
    ).toBe(`${CHANGED_LOG_KEY}({"label":"T:x.chip.kind","value":"b"})`);
  });
});
