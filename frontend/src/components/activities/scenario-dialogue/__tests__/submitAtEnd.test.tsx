/**
 * #1158 E-4 提交按鈕：最後一題拿到建議就直接收尾到可提交。
 * - 不再停在「看建議」等「下一題」；熊熊結尾語＋底部「✓ 提交作業」。
 * - 最後一題的建議氣泡沒有「下一題」，只有「再試一次」；重答完回到可提交。
 * - 最後一題答滿：提示「即將結束對話」後自動收尾。
 * - 老師預覽：提交停用並寫明原因。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { AUTO_NEXT_MS, TYPING_MS, useScenarioChat } from "../useScenarioChat";
import { ScenarioChatActivity } from "../ScenarioChatActivity";
import { ReplyComposer } from "../ReplyComposer";
import type { ScenarioChatItem, ScenarioFeedback } from "../types";

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
const item = (id: number): ScenarioChatItem => ({
  id,
  text: `Q${id}?`,
  keywords: [],
  images: [],
});

function setup(items: ScenarioChatItem[], maxAttempts = 3) {
  const adapters = {
    getFeedback: vi.fn(() => Promise.resolve(FEEDBACK)),
    speak: vi.fn(),
  };
  return renderHook(() =>
    useScenarioChat({
      items,
      adapters,
      maxAttempts,
      textDefaultHidden: false,
      translatable: items.map(() => false),
    }),
  );
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

describe("useScenarioChat — 最後一題直接收尾", () => {
  it("非最後一題照舊停在看建議；最後一題拿到建議直接到 finished", async () => {
    const { result } = setup([item(1), item(2)]);
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    expect(result.current.atLastStep).toBe(false);
    await act(async () => {
      result.current.submitAnswer(VOICE);
    });
    expect(result.current.phase).toBe("feedbackShown");
    act(() => result.current.goNext());
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    expect(result.current.current).toBe(1);
    expect(result.current.atLastStep).toBe(true);

    await act(async () => {
      result.current.submitAnswer(VOICE);
    });
    expect(result.current.phase).toBe("aiTyping");
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    expect(result.current.phase).toBe("finished");
    expect(result.current.closingShown).toBe(true);
  });

  it("收尾後最後一題還能再試一次，答完回到可提交", async () => {
    const { result } = setup([item(1)]);
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    await act(async () => {
      result.current.submitAnswer(VOICE);
    });
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    expect(result.current.phase).toBe("finished");
    expect(result.current.canRetry(0)).toBe(true);
    act(() => result.current.retryItem(0));
    expect(result.current.retry).toEqual({ index: 0, status: "answering" });
    await act(async () => {
      result.current.submitAnswer(VOICE);
    });
    expect(result.current.retry).toBeNull();
    expect(result.current.phase).toBe("finished");
    expect(result.current.attempts[0]).toHaveLength(2);
  });

  it("最後一題答滿：先停在看建議（即將結束對話），再自動收尾", async () => {
    const { result } = setup([item(1)], 1);
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    await act(async () => {
      result.current.submitAnswer(VOICE);
    });
    expect(result.current.phase).toBe("feedbackShown");
    expect(result.current.exhausted).toBe(true);
    expect(result.current.atLastStep).toBe(true);
    act(() => {
      vi.advanceTimersByTime(AUTO_NEXT_MS + TYPING_MS);
    });
    expect(result.current.phase).toBe("finished");
  });
});

describe("畫面", () => {
  const SETTINGS = {
    replyMode: "voice" as const,
    textDefaultHidden: false,
    showTranslation: false,
    isPreviewMode: false,
    maxAttempts: 3,
  };

  it("最後一題沒有「下一題」，只有再試一次；底部出現提交作業並可送出", async () => {
    const onSubmit = vi.fn();
    // 用 ChatTranscript 的狀態直接驗：送出答案後收尾
    const adapters = {
      getFeedback: vi.fn(() => Promise.resolve(FEEDBACK)),
      speak: vi.fn(),
    };
    const { container } = render(
      <ScenarioChatActivity
        context={{ title: "t", images: [] }}
        // 「答過」＝至少一次正式作答（#1158 修正 E4）
        items={[
          {
            ...item(1),
            submittedAudioUrl: "https://e.com/a.webm",
            priorAttempts: 1,
          },
        ]}
        settings={SETTINGS}
        adapters={adapters}
        onSubmit={onSubmit}
      />,
    );
    // 上次已答過、按開始直接到可提交（與接著上次進度一致）
    fireEvent.click(
      screen.getByRole("button", { name: /scenarioDialogue.chat.start/ }),
    );
    expect(screen.getByTestId("scenario-submit-dock")).toBeTruthy();
    expect(container.textContent).toContain("scenarioDialogue.chat.closing");
    expect(container.textContent).not.toContain("scenarioDialogue.chat.next");
    expect(container.textContent).toContain("scenarioDialogue.chat.retry");
    fireEvent.click(
      screen.getByRole("button", {
        name: /scenarioDialogue.chat.submitAssignment/,
      }),
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("ReplyComposer — 語音作答的提交", () => {
  const base = {
    replyMode: "voice" as const,
    waitingHint: "",
    retryNo: null,
    canCancelRetry: false,
    onStart: () => {},
    onSubmitAnswer: () => {},
    onCancelRetry: () => {},
  };

  it("綠色圓鈕＋上傳圖示（沒有文字），名稱「提交作業」，底色條沒有小字", () => {
    const onSubmitAssignment = vi.fn();
    render(
      <ReplyComposer
        {...base}
        state="finished"
        onSubmitAssignment={onSubmitAssignment}
      />,
    );
    const btn = screen.getByRole("button", {
      name: /scenarioDialogue.chat.submitAssignment/,
    });
    expect(btn.className).toContain("rounded-full");
    expect(btn.className).toContain("bg-green-600");
    expect(btn.textContent).toBe("");
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(btn);
    expect(onSubmitAssignment).toHaveBeenCalled();
  });

  it("老師預覽：灰色停用並寫明原因（名稱與 title 也帶原因）", () => {
    render(
      <ReplyComposer
        {...base}
        state="finished"
        onSubmitAssignment={() => {}}
        submitDisabledReason="預覽不會送出"
      />,
    );
    const btn = screen.getByRole("button", {
      name: /scenarioDialogue.chat.submitAssignment/,
    });
    expect(btn).toBeDisabled();
    expect(btn.className).toContain("disabled:bg-gray-300");
    expect(btn).toHaveAttribute("title", "預覽不會送出");
    expect(btn.getAttribute("aria-label")).toContain("預覽不會送出");
    expect(screen.getByRole("status").textContent).toBe("預覽不會送出");
  });
});
