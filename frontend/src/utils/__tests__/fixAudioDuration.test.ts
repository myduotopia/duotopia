import { describe, it, expect, vi } from "vitest";
import { fixAudioDuration } from "../fixAudioDuration";

// ---------------------------------------------------------------------------
// Helper: create a minimal HTMLAudioElement mock
// ---------------------------------------------------------------------------

type MockAudio = {
  el: HTMLAudioElement;
  listeners: Record<string, EventListenerOrEventListenerObject[]>;
  triggerEvent: (name: string) => void;
  setDuration: (d: number) => void;
  setReadyState: (s: number) => void;
};

function makeMockAudio(initialDuration: number): MockAudio {
  const listeners: Record<string, EventListenerOrEventListenerObject[]> = {};
  let _duration = initialDuration;
  let _currentTime = 0;
  let _readyState = 0;

  const el = {
    get duration() {
      return _duration;
    },
    get readyState() {
      return _readyState;
    },
    get currentTime() {
      return _currentTime;
    },
    set currentTime(v: number) {
      _currentTime = v;
    },
    addEventListener: vi.fn((event: string, cb: EventListenerOrEventListenerObject) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    }),
    removeEventListener: vi.fn((event: string, cb: EventListenerOrEventListenerObject) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((l) => l !== cb);
      }
    }),
  } as unknown as HTMLAudioElement;

  function setDuration(d: number) {
    _duration = d;
  }

  function setReadyState(s: number) {
    _readyState = s;
  }

  function triggerEvent(name: string) {
    (listeners[name] || []).forEach((l) => {
      if (typeof l === "function") l({} as Event);
      else l.handleEvent({} as Event);
    });
  }

  return { el, listeners, triggerEvent, setDuration, setReadyState };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fixAudioDuration", () => {
  it("is a no-op when duration is already finite and positive", () => {
    const { el, setReadyState } = makeMockAudio(42);
    setReadyState(1);

    fixAudioDuration(el);

    expect(el.addEventListener).not.toHaveBeenCalled();
    expect(el.currentTime).toBe(0);
  });

  it("does nothing when called with null", () => {
    expect(() => fixAudioDuration(null)).not.toThrow();
  });

  it("seeks to 1e101 when duration is Infinity (iOS Safari fMP4)", () => {
    const { el, triggerEvent } = makeMockAudio(Infinity);

    fixAudioDuration(el);

    // Simulate loadedmetadata event firing
    triggerEvent("loadedmetadata");

    expect(el.currentTime).toBe(1e101);
  });

  it("resets currentTime to 0 after duration becomes finite via durationchange", () => {
    const { el, triggerEvent, setDuration } = makeMockAudio(Infinity);

    fixAudioDuration(el);

    // First: metadata loaded → seeks to 1e101
    triggerEvent("loadedmetadata");
    expect(el.currentTime).toBe(1e101);

    // Second: browser fills in real duration after seek
    setDuration(12.5);
    triggerEvent("durationchange");

    expect(el.currentTime).toBe(0);
  });

  it("removes listeners once duration is resolved", () => {
    const { el, triggerEvent, setDuration } = makeMockAudio(Infinity);

    fixAudioDuration(el);
    triggerEvent("loadedmetadata");
    setDuration(5);
    triggerEvent("durationchange");

    // Both listeners should have been removed
    expect(el.removeEventListener).toHaveBeenCalledTimes(2);
  });

  it("applies fix immediately if readyState >= 1 and duration is Infinity", () => {
    const { el, setReadyState } = makeMockAudio(Infinity);
    setReadyState(1);

    fixAudioDuration(el);

    // Should have seeked immediately without waiting for an event
    expect(el.currentTime).toBe(1e101);
  });

  it("does not double-seek when called twice on the same element", () => {
    const { el, triggerEvent } = makeMockAudio(Infinity);

    fixAudioDuration(el);
    fixAudioDuration(el); // second call — idempotent

    triggerEvent("loadedmetadata");

    // currentTime should still be 1e101 (the seek happened once)
    expect(el.currentTime).toBe(1e101);
  });
});
