import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecordingControls } from "../RecordingControls";

describe("RecordingControls — center state machine", () => {
  it("idle shows mic and fires onRecordStart", () => {
    const fn = vi.fn();
    render(<RecordingControls state="idle" onRecordStart={fn} />);
    fireEvent.click(screen.getByTestId("center-record"));
    expect(fn).toHaveBeenCalled();
  });

  it("recording shows stop and fires onRecordStop", () => {
    const fn = vi.fn();
    render(<RecordingControls state="recording" onRecordStop={fn} />);
    fireEvent.click(screen.getByTestId("center-stop"));
    expect(fn).toHaveBeenCalled();
  });

  it("recorded shows analyze (✨) and fires onAnalyze", () => {
    const fn = vi.fn();
    render(<RecordingControls state="recorded" onAnalyze={fn} />);
    fireEvent.click(screen.getByTestId("center-analyze"));
    expect(fn).toHaveBeenCalled();
  });

  it("recorded without AI analysis hides analyze and shows recorded state", () => {
    render(
      <RecordingControls
        state="recorded"
        canUseAiAnalysis={false}
        onAnalyze={() => {}}
      />,
    );
    expect(screen.queryByTestId("center-analyze")).toBeNull();
    expect(screen.getByTestId("center-recorded")).toBeInTheDocument();
  });

  it("assessed shows re-record (↻) and fires onReRecord", () => {
    const fn = vi.fn();
    render(<RecordingControls state="assessed" onReRecord={fn} />);
    fireEvent.click(screen.getByTestId("center-rerecord"));
    expect(fn).toHaveBeenCalled();
  });

  it("disabled locks the center button", () => {
    const fn = vi.fn();
    render(<RecordingControls state="idle" onRecordStart={fn} disabled />);
    fireEvent.click(screen.getByTestId("center-record"));
    expect(fn).not.toHaveBeenCalled();
  });

  it("shows the recording timer while recording", () => {
    render(<RecordingControls state="recording" recordingSeconds={65} />);
    expect(screen.getByTestId("recording-timer").textContent).toBe("1:05");
  });
});

describe("RecordingControls — side buttons", () => {
  it("disables playback when canPlayback is false", () => {
    render(
      <RecordingControls state="idle" canPlayback={false} onPlayback={() => {}} />,
    );
    expect(screen.getByTestId("playback-btn")).toBeDisabled();
  });

  it("fires onPlayback and onNext when enabled", () => {
    const p = vi.fn();
    const n = vi.fn();
    render(
      <RecordingControls
        state="assessed"
        canPlayback
        canNext
        onPlayback={p}
        onNext={n}
      />,
    );
    fireEvent.click(screen.getByTestId("playback-btn"));
    fireEvent.click(screen.getByTestId("next-btn"));
    expect(p).toHaveBeenCalled();
    expect(n).toHaveBeenCalled();
  });
});
