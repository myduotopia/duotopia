/**
 * 求助不算作答次數（#1158）：AI 回 kind=phrase／model_answer 時，
 * - 不佔 maxAttempts（usedAttempts 排除），送去 AI 的 attemptIndex 也不含求助；
 * - 回來後直接回到作答（不停在「看建議」），重答中就留在重答；
 * - 「答過」只算正式回答。
 * - 每題求助最多 3 次；第 4 次起回求助也當正式作答（#1158 E2b，與後端一致）。
 * - 重答中求助回來，最後一筆求助（回答＋片語）不變淡（#1158 E2b）。
 */
import { describe, it, expect, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import {
  capHelpFeedback,
  helpCount,
  MAX_HELP_PER_ITEM,
  usedAttempts,
  useScenarioChat,
  TYPING_MS,
} from "../useScenarioChat";
import type {
  ScenarioAttempt,
  ScenarioChatAdapters,
  ScenarioFeedback,
} from "../types";

const VOICE = { kind: "voice" as const, audioUrl: "blob:x", durationSec: 2 };
const ITEMS = [
  { id: 1, text: "Q1?", keywords: [], images: [] },
  { id: 2, text: "Q2?", keywords: [], images: [] },
];

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

const HELP: ScenarioFeedback = {
  kind: "phrase",
  verdict: "improve",
  comment: "試著用它回答看看",
  suggestion: "park",
};
const ANSWER: ScenarioFeedback = {
  kind: "feedback",
  verdict: "improve",
  comment: "再完整一點",
  suggestion: "I went to the park.",
};

describe("usedAttempts", () => {
  it("求助不算，還在等建議的先算", () => {
    const list: ScenarioAttempt[] = [
      { answer: VOICE, feedback: HELP },
      { answer: VOICE, feedback: { ...HELP, kind: "model_answer" } },
      { answer: VOICE, feedback: ANSWER },
      { answer: VOICE, feedback: { verdict: "great", comment: "很棒" } },
      { answer: VOICE },
    ];
    expect(usedAttempts(list)).toBe(3);
    expect(usedAttempts(undefined)).toBe(0);
  });
});

describe("useScenarioChat — 求助不算次數", () => {
  it("三次求助後仍可正式作答三次；attemptIndex 不含求助", async () => {
    vi.useFakeTimers();
    URL.revokeObjectURL = vi.fn();
    const queue: ScenarioFeedback[] = [HELP, HELP, HELP, ANSWER, ANSWER];
    const getFeedback = vi.fn(() => Promise.resolve(queue.shift()!));
    const adapters: ScenarioChatAdapters = { getFeedback, speak: vi.fn() };
    const { result } = renderHook(() =>
      useScenarioChat({
        items: ITEMS,
        adapters,
        maxAttempts: 3,
        textDefaultHidden: false,
        translatable: [false, false],
      }),
    );
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    expect(result.current.phase).toBe("awaitingAnswer");

    for (let k = 0; k < 3; k++) {
      await act(async () => {
        result.current.submitAnswer(VOICE);
      });
      // 求助回來直接回到作答，不停在「看建議」
      expect(result.current.phase).toBe("awaitingAnswer");
    }
    expect(result.current.attempts[0]).toHaveLength(3);
    expect(usedAttempts(result.current.attempts[0])).toBe(0);
    expect(result.current.exhausted).toBe(false);

    await act(async () => {
      result.current.submitAnswer(VOICE);
    });
    expect(result.current.phase).toBe("feedbackShown");
    // 第 4 筆紀錄、但是第 1 次正式作答
    expect(getFeedback.mock.calls[3]).toEqual([ITEMS[0], VOICE, 0]);
    expect(usedAttempts(result.current.attempts[0])).toBe(1);
    vi.useRealTimers();
  });

  it("重答中求助：留在重答（answering），不結束重答", async () => {
    vi.useFakeTimers();
    URL.revokeObjectURL = vi.fn();
    const queue: ScenarioFeedback[] = [ANSWER, HELP];
    const adapters: ScenarioChatAdapters = {
      getFeedback: vi.fn(() => Promise.resolve(queue.shift()!)),
      speak: vi.fn(),
    };
    const { result } = renderHook(() =>
      useScenarioChat({
        items: ITEMS,
        adapters,
        maxAttempts: 3,
        textDefaultHidden: false,
        translatable: [false, false],
      }),
    );
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    await act(async () => {
      result.current.submitAnswer(VOICE);
    });
    // 進下一題，再回頭重答第 1 題
    act(() => result.current.goNext());
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    act(() => result.current.retryItem(0));
    expect(result.current.retry).toEqual({ index: 0, status: "answering" });
    const tick = result.current.retryReturn.tick;
    await act(async () => {
      result.current.submitAnswer(VOICE);
    });
    expect(result.current.retry).toEqual({ index: 0, status: "answering" });
    expect(result.current.retryReturn.tick).toBe(tick);
    vi.useRealTimers();
  });
});

describe("求助上限（#1158 E2b）", () => {
  it("MAX_HELP_PER_ITEM＝3；用完後求助當正式作答，verdict 補 improve", () => {
    expect(MAX_HELP_PER_ITEM).toBe(3);
    const help = { ...HELP, verdict: undefined } as unknown as ScenarioFeedback;
    expect(capHelpFeedback(help, 2)).toBe(help);
    expect(capHelpFeedback(help, 3)).toEqual({
      ...help,
      kind: "feedback",
      verdict: "improve",
    });
    expect(capHelpFeedback(ANSWER, 5)).toBe(ANSWER);
    expect(
      helpCount([
        { answer: VOICE, feedback: HELP },
        { answer: VOICE, feedback: ANSWER },
        { answer: VOICE },
      ]),
    ).toBe(1);
  });

  it("第 4 次求助算一次正式作答、停在看建議", async () => {
    vi.useFakeTimers();
    URL.revokeObjectURL = vi.fn();
    const getFeedback = vi.fn(() => Promise.resolve(HELP));
    const adapters: ScenarioChatAdapters = { getFeedback, speak: vi.fn() };
    const { result } = renderHook(() =>
      useScenarioChat({
        items: ITEMS,
        adapters,
        maxAttempts: 3,
        textDefaultHidden: false,
        translatable: [false, false],
      }),
    );
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    for (let k = 0; k < 3; k++) {
      await act(async () => {
        result.current.submitAnswer(VOICE);
      });
    }
    expect(usedAttempts(result.current.attempts[0])).toBe(0);

    await act(async () => {
      result.current.submitAnswer(VOICE);
    });
    const list = result.current.attempts[0];
    expect(list[3].feedback?.kind).toBe("feedback");
    expect(usedAttempts(list)).toBe(1);
    expect(helpCount(list)).toBe(3);
    expect(result.current.phase).toBe("feedbackShown");
    vi.useRealTimers();
  });
});

describe("重答中求助回來：最後一筆求助不變淡（#1158 E2b）", () => {
  it("舊的回答／建議變淡，求助那一筆（回答＋片語）不淡", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const { ChatTranscript } = await import("../ChatTranscript");
    const old = {
      answer: { kind: "text" as const, text: "She eat food." },
      feedback: ANSWER,
    };
    const help = {
      answer: { kind: "text" as const, text: "公園英文怎麼說" },
      feedback: HELP,
    };
    const chat = {
      phase: "awaitingAnswer",
      current: 1,
      attempts: [[old, help], []],
      revealedCount: 2,
      visible: [
        { en: true, zh: false },
        { en: true, zh: false },
      ],
      skipped: [false, false],
      retry: { index: 0, status: "answering" },
      retryBusy: false,
      closingShown: false,
      canRetry: () => false,
      averageFor: () => null,
      toggleText: () => {},
      goNext: () => {},
    };
    render(
      <ChatTranscript
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chat={chat as any}
        items={ITEMS}
        settings={{
          replyMode: "text",
          textDefaultHidden: false,
          showTranslation: false,
          isPreviewMode: false,
          maxAttempts: 3,
        }}
        adapters={{ getFeedback: vi.fn(), speak: vi.fn() }}
        translatable={[false, false]}
        registerBlock={() => {}}
        onRetry={() => {}}
      />,
    );
    const bubbles = screen.getAllByTestId("scenario-feedback");
    expect(bubbles[0].className).toContain("opacity-60");
    expect(bubbles[1].className).not.toContain("opacity-60");
    const fadeOf = (text: string) =>
      screen.getByText(text).closest(".transition-opacity")!.className;
    expect(fadeOf("She eat food.")).toContain("opacity-50");
    expect(fadeOf("公園英文怎麼說")).not.toContain("opacity-50");
  });
});
