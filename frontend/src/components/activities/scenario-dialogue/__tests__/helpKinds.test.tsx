/**
 * 求助不算作答次數（#1158）：AI 回 kind=phrase／model_answer 時，
 * - 不佔 maxAttempts（usedAttempts 排除），送去 AI 的 attemptIndex 也不含求助；
 * - 回來後直接回到作答（不停在「看建議」），重答中就留在重答；
 * - 「答過」只算正式回答。
 */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usedAttempts, useScenarioChat, TYPING_MS } from "../useScenarioChat";
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
