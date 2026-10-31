/**
 * #1158 修正 E4（E-4 Review 低項）：
 * (1) 老師已通過（teacher_passed）的題目：重新進入後以紀錄出現、標「老師已通過」，不再問、不能再試。
 * (2) 老師預覽的結尾語改「全部答完了！（預覽不會送出）」；學生端照舊叫人點綠色按鈕。
 * (3) 「答過」＝至少一次正式作答（priorAttempts > 0）：只求助、或取建議失敗（有錄音但不佔次數）
 *     的題目重新進入後仍會被問，也不列「上次的回答」。
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
import { scenarioChatFromStudentActivity } from "../fromApi";
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
const AUDIO = "https://example.com/rec.webm";

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

function setup(items: ScenarioChatItem[]) {
  const getFeedback = vi.fn(
    (..._args: Parameters<ScenarioChatAdapters["getFeedback"]>) =>
      Promise.resolve(FEEDBACK),
  );
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

const SETTINGS = {
  replyMode: "voice" as const,
  textDefaultHidden: true,
  showTranslation: false,
  isPreviewMode: false,
  maxAttempts: 3,
};

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

describe("(3) 答過＝至少一次正式作答", () => {
  it("只求助過（有錄音、priorAttempts 0）：不算答過，按開始從這題問起並朗讀", () => {
    const items = [
      item(1, { submittedAudioUrl: AUDIO, priorAttempts: 0, priorHelp: 2 }),
      item(2),
    ];
    const { result, speak } = setup(items);
    expect(result.current.answered).toEqual([false, false]);
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    expect(result.current.current).toBe(0);
    expect(result.current.phase).toBe("awaitingAnswer");
    expect(speak.mock.calls[0][0]).toBe("Q1?");
  });

  it("有正式作答（priorAttempts 1）照舊算答過，從下一題開始", () => {
    const items = [
      item(1, { submittedAudioUrl: AUDIO, priorAttempts: 1 }),
      item(2),
    ];
    const { result } = setup(items);
    expect(result.current.answered).toEqual([true, false]);
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    expect(result.current.current).toBe(1);
  });

  it("畫面：只求助過的題目不列「上次的回答」", () => {
    render(
      <ScenarioChatActivity
        context={{ title: "t", images: [] }}
        items={[
          item(1, { submittedAudioUrl: AUDIO, priorAttempts: 0, priorHelp: 1 }),
        ]}
        settings={SETTINGS}
        adapters={{ getFeedback: vi.fn(), speak: vi.fn() }}
        onSubmit={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /scenarioDialogue.chat.start/ }),
    );
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    expect(screen.queryByTestId("scenario-previous-answer")).toBeNull();
  });
});

describe("(1) 老師已通過的題目", () => {
  it("不再問、不能再試、也不能作答；其他還有次數的題目照舊可再試", async () => {
    const items = [
      item(1, {
        submittedAudioUrl: AUDIO,
        priorAttempts: 1,
        teacherPassed: true,
      }),
      item(2, { submittedAudioUrl: AUDIO, priorAttempts: 1 }),
      item(3),
    ];
    const { result, getFeedback } = setup(items);
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    expect(result.current.current).toBe(2);
    expect(result.current.canRetry(0)).toBe(false);
    expect(result.current.canRetry(1)).toBe(true);
    // retryItem 對已通過的題目無效
    act(() => result.current.retryItem(0));
    expect(result.current.retry).toBeNull();
    await act(async () => {
      result.current.submitAnswer(VOICE);
    });
    // 送出的是第 3 題，不是已通過的第 1 題
    expect(getFeedback.mock.calls[0][0]).toBe(items[2]);
  });

  it("老師已通過但次數還沒用完、也沒答過：照樣不問（視同答滿）", () => {
    const items = [item(1, { teacherPassed: true }), item(2)];
    const { result } = setup(items);
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    expect(result.current.current).toBe(1);
  });

  it("畫面：紀錄下方標「老師已通過」，沒有再試一次", () => {
    render(
      <ScenarioChatActivity
        context={{ title: "t", images: [] }}
        items={[
          item(1, {
            submittedAudioUrl: AUDIO,
            priorAttempts: 1,
            teacherPassed: true,
          }),
          item(2, { submittedAudioUrl: AUDIO, priorAttempts: 1 }),
        ]}
        settings={SETTINGS}
        adapters={{ getFeedback: vi.fn(), speak: vi.fn() }}
        onSubmit={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /scenarioDialogue.chat.start/ }),
    );
    const records = screen.getAllByTestId("scenario-previous-answer");
    expect(records).toHaveLength(2);
    expect(records[0].textContent).toContain(
      "scenarioDialogue.chat.teacherPassed",
    );
    expect(records[0].textContent).not.toContain("scenarioDialogue.chat.retry");
    expect(records[1].textContent).toContain("scenarioDialogue.chat.retry");
  });

  it("fromApi：teacher_passed 只認 true", () => {
    const { items } = scenarioChatFromStudentActivity({
      title: "t",
      items: [
        { id: 1, text: "a", teacher_passed: true },
        { id: 2, text: "b", teacher_passed: false },
        { id: 3, text: "c", teacher_passed: null },
        { id: 4, text: "d" },
      ],
    });
    expect(items.map((i) => i.teacherPassed)).toEqual([
      true,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("(2) 結尾語", () => {
  const allDone = [item(1, { submittedAudioUrl: AUDIO, priorAttempts: 1 })];

  it("老師預覽：全部答完了！（預覽不會送出），不叫人點綠色按鈕", () => {
    const { container } = render(
      <ScenarioChatActivity
        context={{ title: "t", images: [] }}
        items={allDone}
        settings={{ ...SETTINGS, isPreviewMode: true }}
        adapters={{ getFeedback: vi.fn(), speak: vi.fn() }}
        onSubmit={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /scenarioDialogue.chat.start/ }),
    );
    expect(container.textContent).toContain(
      "scenarioDialogue.chat.closingPreview",
    );
    expect(container.textContent).not.toMatch(
      /scenarioDialogue\.chat\.closing(?!Preview)/,
    );
  });

  it("學生：照舊是請點綠色按鈕提交", () => {
    const { container } = render(
      <ScenarioChatActivity
        context={{ title: "t", images: [] }}
        items={allDone}
        settings={SETTINGS}
        adapters={{ getFeedback: vi.fn(), speak: vi.fn() }}
        onSubmit={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /scenarioDialogue.chat.start/ }),
    );
    expect(container.textContent).toContain("scenarioDialogue.chat.closing");
    expect(container.textContent).not.toContain(
      "scenarioDialogue.chat.closingPreview",
    );
  });
});
