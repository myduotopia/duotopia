import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useRecordingAttempts,
  MAX_RECORDING_ATTEMPTS,
  storageKey,
} from "../useRecordingAttempts";

const baseProps: {
  studentAssignmentId: number;
  itemId: number;
  assignmentStatus: string;
  returnedAt: string | null;
  teacherPassed: boolean | null;
  teacherReviewedAt: string | null;
  existingRecordingUrl: string | null;
} = {
  studentAssignmentId: 100,
  itemId: 7,
  assignmentStatus: "IN_PROGRESS",
  returnedAt: null,
  teacherPassed: null,
  teacherReviewedAt: null,
  existingRecordingUrl: null,
};

describe("useRecordingAttempts", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("starts at 0 attempts and canRecord=true when no localStorage entry", () => {
    const { result } = renderHook(() => useRecordingAttempts(baseProps));
    expect(result.current.attemptsUsed).toBe(0);
    expect(result.current.canRecord).toBe(true);
  });

  it("locks after MAX_RECORDING_ATTEMPTS calls", () => {
    const { result } = renderHook(() => useRecordingAttempts(baseProps));
    act(() => result.current.recordAttempt());
    act(() => result.current.recordAttempt());
    act(() => result.current.recordAttempt());
    expect(result.current.attemptsUsed).toBe(MAX_RECORDING_ATTEMPTS);
    expect(result.current.canRecord).toBe(false);
  });

  it("recordAttempt past the cap is idempotent (does not exceed MAX)", () => {
    const { result } = renderHook(() => useRecordingAttempts(baseProps));
    act(() => result.current.recordAttempt());
    act(() => result.current.recordAttempt());
    act(() => result.current.recordAttempt());
    act(() => result.current.recordAttempt());
    act(() => result.current.recordAttempt());
    expect(result.current.attemptsUsed).toBe(MAX_RECORDING_ATTEMPTS);
  });

  it("resets to 0 when assignment is RETURNED with teacher_passed=false and a new teacher_reviewed_at", () => {
    localStorage.setItem(
      storageKey(100, 7),
      JSON.stringify({ count: 3, lastReviewMarker: "2026-04-01T00:00:00Z" }),
    );
    const { result } = renderHook(() =>
      useRecordingAttempts({
        ...baseProps,
        assignmentStatus: "RETURNED",
        teacherPassed: false,
        teacherReviewedAt: "2026-04-26T10:00:00Z",
        returnedAt: "2026-04-26T10:00:00Z",
      }),
    );
    expect(result.current.attemptsUsed).toBe(0);
    expect(result.current.canRecord).toBe(true);
  });

  it("ALSO resets when teacher_passed=true (passed item still gets fresh hearts on RETURNED)", () => {
    // 規則更新：學生在訂正模式下可重錄任何一題，包含已過關的，是否需要訂正
    // 由「方框顏色 / 老師回饋」呈現，不在前端閘門限制。
    localStorage.setItem(
      storageKey(100, 7),
      JSON.stringify({ count: 3, lastReviewMarker: "2026-04-01T00:00:00Z" }),
    );
    const { result } = renderHook(() =>
      useRecordingAttempts({
        ...baseProps,
        assignmentStatus: "RETURNED",
        teacherPassed: true,
        teacherReviewedAt: "2026-04-26T10:00:00Z",
      }),
    );
    expect(result.current.attemptsUsed).toBe(0);
    expect(result.current.canRecord).toBe(true);
  });

  it("resets on RETURNED even when item has no teacher_reviewed_at (falls back to returned_at marker)", () => {
    // 老師退回但只逐一審了部分題目；其餘題目沒有 teacher_reviewed_at，
    // 透過 assignment-level returned_at 作為 fallback marker 完成 reset。
    localStorage.setItem(
      storageKey(100, 7),
      JSON.stringify({ count: 3, lastReviewMarker: null }),
    );
    const { result } = renderHook(() =>
      useRecordingAttempts({
        ...baseProps,
        assignmentStatus: "RETURNED",
        teacherPassed: null,
        teacherReviewedAt: null,
        returnedAt: "2026-04-26T10:00:00Z",
      }),
    );
    expect(result.current.attemptsUsed).toBe(0);
    expect(result.current.canRecord).toBe(true);
  });

  it("does NOT reset when marker matches stored (no infinite loop)", () => {
    localStorage.setItem(
      storageKey(100, 7),
      JSON.stringify({ count: 3, lastReviewMarker: "2026-04-26T10:00:00Z" }),
    );
    const { result } = renderHook(() =>
      useRecordingAttempts({
        ...baseProps,
        assignmentStatus: "RETURNED",
        teacherPassed: false,
        teacherReviewedAt: "2026-04-26T10:00:00Z",
      }),
    );
    expect(result.current.attemptsUsed).toBe(3);
    expect(result.current.canRecord).toBe(false);
  });

  it("seeds count=1 when item already has a recording but no localStorage entry (backwards compat)", () => {
    const { result } = renderHook(() =>
      useRecordingAttempts({
        ...baseProps,
        existingRecordingUrl: "https://gcs.example.com/recordings/7.mp3",
      }),
    );
    expect(result.current.attemptsUsed).toBe(1);
    expect(result.current.canRecord).toBe(true);
  });

  it("does NOT seed when the existing URL is a fresh blob URL from this session", () => {
    const { result } = renderHook(() =>
      useRecordingAttempts({
        ...baseProps,
        existingRecordingUrl: "blob:https://duotopia.co/abc-123",
      }),
    );
    expect(result.current.attemptsUsed).toBe(0);
    expect(result.current.canRecord).toBe(true);
  });

  it("regression: fresh student records → URL flips null → blob → GCS without ever seeding (no phantom heart loss before pressing Analyze)", () => {
    // Simulates a student opening a brand-new task (no recording, no
    // localStorage), then recording (URL becomes blob), then upload completes
    // (URL becomes GCS). Throughout, attemptsUsed must stay at 0 because they
    // haven't pressed Analyze yet.
    const props: typeof baseProps = {
      ...baseProps,
      existingRecordingUrl: null,
    };
    const { result, rerender } = renderHook(
      (p: typeof baseProps) => useRecordingAttempts(p),
      { initialProps: props },
    );
    expect(result.current.attemptsUsed).toBe(0);

    // Student records → URL becomes blob
    rerender({
      ...baseProps,
      existingRecordingUrl: "blob:https://duotopia.co/recording-xyz",
    });
    expect(result.current.attemptsUsed).toBe(0);

    // Background upload finishes → URL becomes GCS
    rerender({
      ...baseProps,
      existingRecordingUrl:
        "https://gcs.example.com/recordings/just-uploaded.mp3",
    });
    expect(result.current.attemptsUsed).toBe(0);

    // Now student presses Analyze → +1
    act(() => result.current.recordAttempt());
    expect(result.current.attemptsUsed).toBe(1);
  });

  it("recovers gracefully from corrupted JSON in localStorage", () => {
    localStorage.setItem(storageKey(100, 7), "{not-valid-json");
    const { result } = renderHook(() => useRecordingAttempts(baseProps));
    expect(result.current.attemptsUsed).toBe(0);
    expect(result.current.canRecord).toBe(true);
  });

  it("keeps independent counts per itemId under the same assignment", () => {
    const { result: r1 } = renderHook(() => useRecordingAttempts(baseProps));
    const { result: r2 } = renderHook(() =>
      useRecordingAttempts({ ...baseProps, itemId: 8 }),
    );
    act(() => r1.current.recordAttempt());
    act(() => r1.current.recordAttempt());
    expect(r1.current.attemptsUsed).toBe(2);
    expect(r2.current.attemptsUsed).toBe(0);
  });

  it("falls back to allowing recording if localStorage.setItem throws (e.g., quota / private mode)", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    const { result } = renderHook(() => useRecordingAttempts(baseProps));
    // recordAttempt should not throw, even if persistence fails
    expect(() => act(() => result.current.recordAttempt())).not.toThrow();
    expect(result.current.canRecord).toBe(true);
    setItemSpy.mockRestore();
  });

  it("uses returnedAt as fallback when teacherReviewedAt is null but assignment is RETURNED with teacher_passed=false", () => {
    localStorage.setItem(
      storageKey(100, 7),
      JSON.stringify({ count: 3, lastReviewMarker: null }),
    );
    const { result } = renderHook(() =>
      useRecordingAttempts({
        ...baseProps,
        assignmentStatus: "RETURNED",
        teacherPassed: false,
        teacherReviewedAt: null,
        returnedAt: "2026-04-26T10:00:00Z",
      }),
    );
    expect(result.current.attemptsUsed).toBe(0);
  });

  // Issue #676 Phase 2 — syncServerCount reconciliation.
  describe("syncServerCount", () => {
    it("raises local count up to the server count when server is higher", () => {
      const { result } = renderHook(() => useRecordingAttempts(baseProps));
      act(() => result.current.recordAttempt()); // local=1
      act(() => result.current.syncServerCount(2));
      expect(result.current.attemptsUsed).toBe(2);
    });

    it("never lowers the count when server reports a smaller value", () => {
      const { result } = renderHook(() => useRecordingAttempts(baseProps));
      act(() => result.current.recordAttempt());
      act(() => result.current.recordAttempt());
      act(() => result.current.recordAttempt()); // local=3
      act(() => result.current.syncServerCount(1));
      expect(result.current.attemptsUsed).toBe(MAX_RECORDING_ATTEMPTS);
      expect(result.current.canRecord).toBe(false);
    });

    it("clamps server-reported overflow to MAX_RECORDING_ATTEMPTS", () => {
      const { result } = renderHook(() => useRecordingAttempts(baseProps));
      act(() => result.current.syncServerCount(99));
      expect(result.current.attemptsUsed).toBe(MAX_RECORDING_ATTEMPTS);
    });

    it("ignores undefined / null / NaN payloads as no-op", () => {
      const { result } = renderHook(() => useRecordingAttempts(baseProps));
      act(() => result.current.recordAttempt()); // local=1
      act(() => result.current.syncServerCount(undefined));
      act(() => result.current.syncServerCount(null));
      act(() => result.current.syncServerCount(Number.NaN));
      expect(result.current.attemptsUsed).toBe(1);
    });

    it("floors fractional server counts (defensive against bad payloads)", () => {
      const { result } = renderHook(() => useRecordingAttempts(baseProps));
      act(() => result.current.syncServerCount(2.7));
      expect(result.current.attemptsUsed).toBe(2);
    });

    it("persists the synced count to localStorage", () => {
      const { result } = renderHook(() => useRecordingAttempts(baseProps));
      act(() => result.current.syncServerCount(2));
      const raw = localStorage.getItem(storageKey(100, 7));
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(parsed.count).toBe(2);
    });
  });
});
