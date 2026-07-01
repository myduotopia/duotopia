import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCardRecorder } from "../useCardRecorder";

/* eslint-disable @typescript-eslint/no-explicit-any */

class MockMediaRecorder {
  state = "inactive";
  ondataavailable: ((e: any) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: any) {}
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["x"]) });
    this.onstop?.();
  }
}

const tracks = [{ stop: vi.fn() }];

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", MockMediaRecorder as any);
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => tracks }),
    },
    configurable: true,
  });
  global.URL.createObjectURL = vi.fn(() => "blob:mock");
  global.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useCardRecorder", () => {
  it("starts recording and completes with blob + url on stop (within limit)", async () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() =>
      useCardRecorder({ timeLimit: 0, onComplete }),
    );

    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(true);

    act(() => {
      result.current.stopRecording();
    });
    expect(onComplete).toHaveBeenCalledWith(expect.any(Blob), "blob:mock");
    expect(result.current.isRecording).toBe(false);
  });

  it("increments the recording timer each second", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useCardRecorder({ timeLimit: 0, onComplete: vi.fn() }),
    );
    await act(async () => {
      await result.current.startRecording();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.recordingTime).toBe(3);
  });

  it("auto-stops at the time limit and accepts the recording", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const onComplete = vi.fn();
    const onOverLimit = vi.fn();
    const { result } = renderHook(() =>
      useCardRecorder({ timeLimit: 5, onComplete, onOverLimit }),
    );
    await act(async () => {
      await result.current.startRecording();
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onComplete).toHaveBeenCalled();
    expect(onOverLimit).not.toHaveBeenCalled();
  });

  it("discards a recording that exceeds the limit (+0.5s tolerance)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const onComplete = vi.fn();
    const onOverLimit = vi.fn();
    const { result } = renderHook(() =>
      useCardRecorder({ timeLimit: 10, onComplete, onOverLimit }),
    );
    await act(async () => {
      await result.current.startRecording();
    });
    // manual stop after 11s (over 10 + 0.5)
    vi.setSystemTime(1_011_000);
    act(() => {
      result.current.stopRecording();
    });
    expect(onOverLimit).toHaveBeenCalledWith(11, 10);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("reports an error when the mic cannot start", async () => {
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValueOnce(
      new Error("denied"),
    );
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useCardRecorder({ timeLimit: 0, onComplete: vi.fn(), onError }),
    );
    await act(async () => {
      await result.current.startRecording();
    });
    expect(onError).toHaveBeenCalled();
    expect(result.current.isRecording).toBe(false);
  });
});
