import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecordingAttemptsIndicator } from "../RecordingAttemptsIndicator";
import {
  incrementRecordingAttemptForItem,
  storageKey,
  MAX_RECORDING_ATTEMPTS,
} from "@/hooks/useRecordingAttempts";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { n: number }) => (opts ? `${key}:${opts.n}` : key),
  }),
}));

describe("RecordingAttemptsIndicator", () => {
  it("renders 3 filled hearts when no attempts used", () => {
    render(<RecordingAttemptsIndicator attemptsUsed={0} />);
    expect(screen.getAllByTestId("heart-filled")).toHaveLength(3);
    expect(screen.queryAllByTestId("heart-empty")).toHaveLength(0);
  });

  it("renders 2 filled + 1 empty when 1 attempt used", () => {
    render(<RecordingAttemptsIndicator attemptsUsed={1} />);
    expect(screen.getAllByTestId("heart-filled")).toHaveLength(2);
    expect(screen.getAllByTestId("heart-empty")).toHaveLength(1);
  });

  it("renders 1 filled + 2 empty when 2 attempts used", () => {
    render(<RecordingAttemptsIndicator attemptsUsed={2} />);
    expect(screen.getAllByTestId("heart-filled")).toHaveLength(1);
    expect(screen.getAllByTestId("heart-empty")).toHaveLength(2);
  });

  it("renders 0 filled + 3 empty when fully exhausted", () => {
    render(<RecordingAttemptsIndicator attemptsUsed={3} />);
    expect(screen.queryAllByTestId("heart-filled")).toHaveLength(0);
    expect(screen.getAllByTestId("heart-empty")).toHaveLength(3);
  });

  it("clamps when attemptsUsed exceeds max (defensive)", () => {
    render(<RecordingAttemptsIndicator attemptsUsed={10} />);
    expect(screen.queryAllByTestId("heart-filled")).toHaveLength(0);
    expect(screen.getAllByTestId("heart-empty")).toHaveLength(3);
  });

  it("respects custom max", () => {
    render(<RecordingAttemptsIndicator attemptsUsed={1} max={5} />);
    expect(screen.getAllByTestId("heart-filled")).toHaveLength(4);
    expect(screen.getAllByTestId("heart-empty")).toHaveLength(1);
  });

  it("uses locked tooltip when fully exhausted", () => {
    render(<RecordingAttemptsIndicator attemptsUsed={3} />);
    const indicator = screen.getByTestId("recording-attempts-indicator");
    expect(indicator.getAttribute("title")).toBe(
      "recordingAttempts.lockedTooltip",
    );
  });

  it("uses remaining tooltip when attempts remain", () => {
    render(<RecordingAttemptsIndicator attemptsUsed={1} />);
    const indicator = screen.getByTestId("recording-attempts-indicator");
    expect(indicator.getAttribute("title")).toBe(
      "recordingAttempts.remaining:2",
    );
  });
});

describe("incrementRecordingAttemptForItem", () => {
  beforeEach(() => localStorage.clear());

  it("increments count from 0 to 1 when no entry exists", () => {
    incrementRecordingAttemptForItem(100, 7);
    const raw = localStorage.getItem(storageKey(100, 7));
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw!);
    expect(stored.count).toBe(1);
  });

  it("increments existing count", () => {
    localStorage.setItem(
      storageKey(100, 7),
      JSON.stringify({ count: 1, lastReviewMarker: "x" }),
    );
    incrementRecordingAttemptForItem(100, 7);
    const stored = JSON.parse(localStorage.getItem(storageKey(100, 7))!);
    expect(stored.count).toBe(2);
    expect(stored.lastReviewMarker).toBe("x");
  });

  it("does not exceed MAX_RECORDING_ATTEMPTS", () => {
    localStorage.setItem(
      storageKey(100, 7),
      JSON.stringify({
        count: MAX_RECORDING_ATTEMPTS,
        lastReviewMarker: null,
      }),
    );
    incrementRecordingAttemptForItem(100, 7);
    const stored = JSON.parse(localStorage.getItem(storageKey(100, 7))!);
    expect(stored.count).toBe(MAX_RECORDING_ATTEMPTS);
  });
});
