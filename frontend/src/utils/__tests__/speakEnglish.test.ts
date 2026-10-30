import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  START_TIMEOUT_MS,
  primeSpeechSynthesis,
  speakEnglish,
  stopSpeaking,
} from "../speakEnglish";

// jsdom does not implement the Web Speech API — provide minimal mocks
class MockSpeechSynthesisUtterance {
  text: string;
  lang = "";
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

vi.stubGlobal("SpeechSynthesisUtterance", MockSpeechSynthesisUtterance);

type VoicesChangedHandler = () => void;

function makeSynthMock(voices: Partial<SpeechSynthesisVoice>[] = []) {
  const listeners = new Map<string, VoicesChangedHandler[]>();
  const mock = {
    cancel: vi.fn(),
    speak: vi.fn(),
    getVoices: vi.fn(() => voices as SpeechSynthesisVoice[]),
    addEventListener: vi.fn((event: string, handler: VoicesChangedHandler) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    }),
    removeEventListener: vi.fn(
      (event: string, handler: VoicesChangedHandler) => {
        const handlers = listeners.get(event) ?? [];
        const idx = handlers.indexOf(handler);
        if (idx !== -1) handlers.splice(idx, 1);
      },
    ),
    fireVoicesChanged: () => {
      (listeners.get("voiceschanged") ?? []).slice().forEach((h) => h());
    },
  };
  return mock;
}

describe("speakEnglish", () => {
  let synthMock: ReturnType<typeof makeSynthMock>;

  beforeEach(() => {
    synthMock = makeSynthMock();
    Object.defineProperty(window, "speechSynthesis", {
      value: synthMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("speaks immediately when voices are already loaded", () => {
    synthMock = makeSynthMock([{ lang: "en-US", name: "Google US English" }]);
    Object.defineProperty(window, "speechSynthesis", {
      value: synthMock,
      writable: true,
      configurable: true,
    });

    speakEnglish("hello");

    expect(synthMock.cancel).toHaveBeenCalledOnce();
    expect(synthMock.speak).toHaveBeenCalledOnce();
    const utterance = synthMock.speak.mock
      .calls[0][0] as MockSpeechSynthesisUtterance;
    expect(utterance.lang).toBe("en-US");
  });

  it("waits for voiceschanged when voices are not yet loaded", () => {
    speakEnglish("hello");

    expect(synthMock.speak).not.toHaveBeenCalled();
    expect(synthMock.addEventListener).toHaveBeenCalledWith(
      "voiceschanged",
      expect.any(Function),
    );

    synthMock.fireVoicesChanged();

    expect(synthMock.speak).toHaveBeenCalledOnce();
  });

  it("prefers en-US voice over other en-* voices", () => {
    const enGB = { lang: "en-GB", name: "British English" };
    const enUS = { lang: "en-US", name: "US English" };
    synthMock = makeSynthMock([enGB, enUS]);
    Object.defineProperty(window, "speechSynthesis", {
      value: synthMock,
      writable: true,
      configurable: true,
    });

    speakEnglish("hello");

    const utterance = synthMock.speak.mock
      .calls[0][0] as MockSpeechSynthesisUtterance;
    expect((utterance.voice as Partial<SpeechSynthesisVoice>)?.lang).toBe(
      "en-US",
    );
  });

  it("falls back to any en-* voice when en-US is unavailable", () => {
    synthMock = makeSynthMock([{ lang: "en-AU", name: "Australian English" }]);
    Object.defineProperty(window, "speechSynthesis", {
      value: synthMock,
      writable: true,
      configurable: true,
    });

    speakEnglish("hello");

    const utterance = synthMock.speak.mock
      .calls[0][0] as MockSpeechSynthesisUtterance;
    expect((utterance.voice as Partial<SpeechSynthesisVoice>)?.lang).toBe(
      "en-AU",
    );
  });

  it("warns but does not throw when no English voice is found", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    synthMock = makeSynthMock([{ lang: "zh-TW", name: "Chinese TW" }]);
    Object.defineProperty(window, "speechSynthesis", {
      value: synthMock,
      writable: true,
      configurable: true,
    });

    expect(() => speakEnglish("hello")).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("No English voice available"),
    );
    expect(synthMock.speak).toHaveBeenCalledOnce();
  });

  it("onError: fires on a real speech error but not on canceled/interrupted", () => {
    synthMock = makeSynthMock([{ lang: "en-US", name: "US English" }]);
    Object.defineProperty(window, "speechSynthesis", {
      value: synthMock,
      writable: true,
      configurable: true,
    });
    const onError = vi.fn();

    speakEnglish("hello", { onError });

    const utterance = synthMock.speak.mock.calls[0][0] as {
      onerror?: (e: { error: string }) => void;
    };
    utterance.onerror?.({ error: "interrupted" });
    utterance.onerror?.({ error: "canceled" });
    expect(onError).not.toHaveBeenCalled();
    utterance.onerror?.({ error: "synthesis-failed" });
    expect(onError).toHaveBeenCalledOnce();
  });

  it("onError: fires when no English voice is found (still speaks)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    synthMock = makeSynthMock([{ lang: "zh-TW", name: "Chinese TW" }]);
    Object.defineProperty(window, "speechSynthesis", {
      value: synthMock,
      writable: true,
      configurable: true,
    });
    const onError = vi.fn();

    speakEnglish("hello", { onError });

    expect(onError).toHaveBeenCalledOnce();
    expect(synthMock.speak).toHaveBeenCalledOnce();
  });

  it("onEnd: fires on end and on any error (including interrupted)", () => {
    synthMock = makeSynthMock([{ lang: "en-US", name: "US English" }]);
    Object.defineProperty(window, "speechSynthesis", {
      value: synthMock,
      writable: true,
      configurable: true,
    });
    const onEnd = vi.fn();

    speakEnglish("a", { onEnd });
    speakEnglish("b", { onEnd });

    const [a, b] = synthMock.speak.mock.calls.map(
      (c) =>
        c[0] as {
          onend?: () => void;
          onerror?: (e: { error: string }) => void;
        },
    );
    a.onerror?.({ error: "interrupted" });
    b.onend?.();
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it("primeSpeechSynthesis speaks a silent empty utterance", () => {
    primeSpeechSynthesis();

    expect(synthMock.getVoices).toHaveBeenCalled();
    const utterance = synthMock.speak.mock
      .calls[0][0] as MockSpeechSynthesisUtterance;
    expect(utterance.text).toBe("");
    expect(utterance.volume).toBe(0);
  });

  it("cleanup function removes voiceschanged listener and cancels", () => {
    const cleanup = speakEnglish("hello");

    expect(typeof cleanup).toBe("function");
    expect(synthMock.removeEventListener).not.toHaveBeenCalled();

    (cleanup as () => void)();

    expect(synthMock.removeEventListener).toHaveBeenCalledWith(
      "voiceschanged",
      expect.any(Function),
    );
    expect(synthMock.cancel).toHaveBeenCalledTimes(2); // once on entry, once on cleanup
  });

  it("does not speak after cleanup is called", () => {
    const cleanup = speakEnglish("hello");
    (cleanup as () => void)();

    synthMock.fireVoicesChanged();

    expect(synthMock.speak).not.toHaveBeenCalled();
  });

  it("returns void (not a function) when voices are immediately available", () => {
    synthMock = makeSynthMock([{ lang: "en-US", name: "US English" }]);
    Object.defineProperty(window, "speechSynthesis", {
      value: synthMock,
      writable: true,
      configurable: true,
    });

    const result = speakEnglish("hello");
    expect(result).toBeUndefined();
  });

  it("does nothing when speechSynthesis is not in window (SSR guard)", () => {
    // Remove the property so `"speechSynthesis" in window` is false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).speechSynthesis;

    expect(() => speakEnglish("hello")).not.toThrow();

    // Restore for subsequent tests
    Object.defineProperty(window, "speechSynthesis", {
      value: synthMock,
      writable: true,
      configurable: true,
    });
  });
  describe("逾時保底（#1158 E2b）：遲遲沒開始唸就當作出錯", () => {
    type U = {
      onstart?: () => void;
      onend?: () => void;
      onerror?: (e: { error: string }) => void;
    };
    const useEnglishVoice = () => {
      synthMock = makeSynthMock([{ lang: "en-US", name: "US English" }]);
      Object.defineProperty(window, "speechSynthesis", {
        value: synthMock,
        writable: true,
        configurable: true,
      });
    };
    const utteranceAt = (i: number) => synthMock.speak.mock.calls[i][0] as U;

    beforeEach(() => {
      vi.useFakeTimers();
      useEnglishVoice();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("calls onError when onstart never comes", () => {
      const onError = vi.fn();
      speakEnglish("hello", { onError });
      vi.advanceTimersByTime(START_TIMEOUT_MS - 1);
      expect(onError).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onError).toHaveBeenCalledOnce();
    });

    it("does not fire once speech has started", () => {
      const onError = vi.fn();
      speakEnglish("hello", { onError });
      utteranceAt(0).onstart?.();
      vi.advanceTimersByTime(START_TIMEOUT_MS * 2);
      expect(onError).not.toHaveBeenCalled();
    });

    it("also covers voices that never load", () => {
      synthMock = makeSynthMock([]);
      Object.defineProperty(window, "speechSynthesis", {
        value: synthMock,
        writable: true,
        configurable: true,
      });
      const onError = vi.fn();
      speakEnglish("hello", { onError });
      vi.advanceTimersByTime(START_TIMEOUT_MS);
      expect(onError).toHaveBeenCalledOnce();
    });

    it("a newer call cancels the older call's timeout", () => {
      const first = vi.fn();
      const second = vi.fn();
      speakEnglish("a", { onError: first });
      speakEnglish("b", { onError: second });
      // 舊句子被打斷的事件晚到，不能把新句子的保底取消掉
      utteranceAt(0).onerror?.({ error: "interrupted" });
      vi.advanceTimersByTime(START_TIMEOUT_MS);
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledOnce();
    });

    it("onError fires at most once (error event then timeout)", () => {
      const onError = vi.fn();
      speakEnglish("hello", { onError });
      utteranceAt(0).onerror?.({ error: "synthesis-failed" });
      vi.advanceTimersByTime(START_TIMEOUT_MS);
      expect(onError).toHaveBeenCalledOnce();
    });

    it("stopSpeaking cancels speech and the pending timeout", () => {
      const onError = vi.fn();
      speakEnglish("hello", { onError });
      stopSpeaking();
      vi.advanceTimersByTime(START_TIMEOUT_MS);
      expect(onError).not.toHaveBeenCalled();
      expect(synthMock.cancel).toHaveBeenCalledTimes(2);
    });

    it("no timer at all without onError", () => {
      speakEnglish("hello");
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
