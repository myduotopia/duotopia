/**
 * #1158 E-4：接著上次進度。
 * - 上次答過（submittedAudioUrl）的題目：按「開始對話」後以紀錄出現，從第一題沒答的開始問（只唸那一題）。
 * - 次數以伺服器為準（priorAttempts／priorHelp）：剩餘次數、送去 AI 的 attemptIndex、求助上限都算進去。
 * - 上次答過、還有次數的可「再試一次」；用完的顯示「已達 N 次」。
 * - 主流程走到上次答過的題目時直接以紀錄出現、不再問。
 * - 全部答過 → 直接到「提交作業」。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { useScenarioChat, TYPING_MS } from "../useScenarioChat";
import { ScenarioChatActivity } from "../ScenarioChatActivity";
import type {
  ScenarioChatAdapters,
  ScenarioChatItem,
  ScenarioFeedback,
} from "../types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

const VOICE = { kind: "voice" as const, audioUrl: "blob:x", durationSec: 2 };
const FEEDBACK: ScenarioFeedback = {
  kind: "feedback",
  verdict: "improve",
  comment: "再完整一點",
};
const HELP: ScenarioFeedback = {
  kind: "phrase",
  verdict: "improve",
  comment: "試著用它回答看看",
  suggestion: "park",
};

const item = (
  id: number,
  extra: Partial<ScenarioChatItem> = {},
): ScenarioChatItem => ({
  id,
  text: `Q${id}?`,
  keywords: [],
  images: [],
  ...extra,
});

const done = (prior: number, help = 0): Partial<ScenarioChatItem> => ({
  submittedAudioUrl: "https://example.com/rec.webm",
  priorAttempts: prior,
  priorHelp: help,
});

function setup(items: ScenarioChatItem[], queue: ScenarioFeedback[] = []) {
  const getFeedback = vi.fn(() => Promise.resolve(queue.shift() ?? FEEDBACK));
  const speak = vi.fn();
  const adapters: ScenarioChatAdapters = { getFeedback, speak };
  const hook = renderHook(() =>
    useScenarioChat({
      items,
      adapters,
      maxAttempts: 3,
      textDefaultHidden: true,
      translatable: items.map(() => false),
    }),
  );
  return { ...hook, getFeedback, speak };
}

beforeEach(() => {
  vi.useFakeTimers();
  URL.revokeObjectURL = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo =
    vi.fn() as unknown as typeof Element.prototype.scrollTo;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useScenarioChat — 接著上次進度", () => {
  it("從第一題沒答的開始問，前面答過的以紀錄出現，只唸新題", () => {
    const items = [item(1, done(1)), item(2, done(3)), item(3), item(4)];
    const { result, speak } = setup(items);
    expect(result.current.answered).toEqual([true, true, false, false]);

    act(() => result.current.start());
    // 前兩題已出現（紀錄），第 3 題「輸入中…」
    expect(result.current.revealedCount).toBe(2);
    expect(result.current.phase).toBe("aiTyping");
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    expect(result.current.phase).toBe("awaitingAnswer");
    expect(result.current.current).toBe(2);
    expect(result.current.revealedCount).toBe(3);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][0]).toBe("Q3?");

    // 次數以伺服器為準：第 1 題用 1 次還能重答；第 2 題用滿
    expect(result.current.usedFor(0)).toBe(1);
    expect(result.current.canRetry(0)).toBe(true);
    expect(result.current.canRetry(1)).toBe(false);
  });

  it("重答上次答過的題目：attemptIndex 含上次次數，用完後不能再答", async () => {
    const items = [item(1, done(2)), item(2)];
    const { result, getFeedback } = setup(items);
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    act(() => result.current.retryItem(0));
    expect(result.current.retry).toEqual({ index: 0, status: "answering" });
    await act(async () => {
      result.current.submitAnswer(VOICE);
    });
    expect(getFeedback.mock.calls[0]).toEqual([items[0], VOICE, 2]);
    expect(result.current.usedFor(0)).toBe(3);
    expect(result.current.retry).toBeNull();
    expect(result.current.canRetry(0)).toBe(false);
  });

  it("求助上限算上次的：上次已求助 3 次，這次回求助也當正式作答", async () => {
    const items = [item(1, done(0, 3)), item(2)];
    const { result } = setup(items, [HELP]);
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    act(() => result.current.retryItem(0));
    await act(async () => {
      result.current.submitAnswer(VOICE);
    });
    expect(result.current.attempts[0][0].feedback?.kind).toBe("feedback");
    expect(result.current.usedFor(0)).toBe(1);
  });

  it("主流程走到上次答過的題目：直接以紀錄出現、跳到下一題沒答的", async () => {
    const items = [item(1), item(2, done(1)), item(3)];
    const { result, speak } = setup(items);
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    expect(result.current.current).toBe(0);
    await act(async () => {
      result.current.submitAnswer(VOICE);
    });
    expect(result.current.phase).toBe("feedbackShown");
    act(() => result.current.goNext());
    expect(result.current.revealedCount).toBe(2);
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    expect(result.current.current).toBe(2);
    expect(result.current.revealedCount).toBe(3);
    expect(speak.mock.calls.map((c) => c[0])).toEqual(["Q1?", "Q3?"]);
  });

  it("最後幾題上次都答過：答完前面就結束，全部以紀錄出現", async () => {
    const items = [item(1), item(2, done(1))];
    const { result } = setup(items);
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    await act(async () => {
      result.current.submitAnswer(VOICE);
    });
    act(() => result.current.goNext());
    expect(result.current.revealedCount).toBe(2);
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    expect(result.current.phase).toBe("finished");
  });

  it("全部都答過：按開始直接到提交狀態，不唸題目", () => {
    const items = [item(1, done(1)), item(2, done(3))];
    const { result, speak } = setup(items);
    act(() => result.current.start());
    expect(result.current.phase).toBe("finished");
    expect(result.current.revealedCount).toBe(2);
    expect(result.current.closingShown).toBe(true);
    expect(speak).not.toHaveBeenCalled();
    // 還有次數的仍可再試一次
    expect(result.current.canRetry(0)).toBe(true);
    expect(result.current.canRetry(1)).toBe(false);
  });
});

describe("ScenarioChatActivity — 上次答過的紀錄", () => {
  const SETTINGS = {
    replyMode: "voice" as const,
    textDefaultHidden: true,
    showTranslation: false,
    isPreviewMode: false,
    maxAttempts: 3,
  };

  it("紀錄標「上次的回答」；還有次數＝再試一次，用完＝已達 N 次；回報答過", () => {
    const onProgressChange = vi.fn();
    const items = [item(1, done(1)), item(2, done(3)), item(3)];
    render(
      <ScenarioChatActivity
        context={{ title: "t", images: [] }}
        items={items}
        settings={SETTINGS}
        adapters={{ getFeedback: vi.fn(), speak: vi.fn() }}
        onSubmit={() => {}}
        onProgressChange={onProgressChange}
      />,
    );
    expect(onProgressChange).toHaveBeenLastCalledWith([true, true, false]);
    // 開始前不列紀錄
    expect(screen.queryByTestId("scenario-previous-answer")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /scenarioDialogue.chat.start/ }),
    );
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    const records = screen.getAllByTestId("scenario-previous-answer");
    expect(records).toHaveLength(2);
    expect(records[0].textContent).toContain(
      "scenarioDialogue.chat.previousAnswer",
    );
    expect(records[0].textContent).toContain("scenarioDialogue.chat.retry");
    expect(records[1].textContent).toContain(
      "scenarioDialogue.chat.attemptsReached",
    );
    expect(records[1].textContent).not.toContain("scenarioDialogue.chat.retry");
  });
});
