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

  it("does NOT reset when teacher_passed=true (item passed)", () => {
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
    expect(result.current.attemptsUsed).toBe(3);
    expect(result.current.canRecord).toBe(false);
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
      existingRecordingUrl: "https://gcs.example.com/recordings/just-uploaded.mp3",
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
});
