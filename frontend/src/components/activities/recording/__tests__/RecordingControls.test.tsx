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

  it("recorded shows mic (not sparkles) and fires onRecordStart to re-record", () => {
    const fn = vi.fn();
    render(<RecordingControls state="recorded" onRecordStart={fn} />);
    // 中央鈕在 recorded 狀態應顯示 mic，跟 idle 一樣：按下等同重新錄音
    expect(screen.getByTestId("center-record")).toBeInTheDocument();
    expect(screen.queryByTestId("center-analyze")).toBeNull();
    expect(screen.queryByTestId("center-recorded")).toBeNull();
    fireEvent.click(screen.getByTestId("center-record"));
    expect(fn).toHaveBeenCalled();
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

describe("RecordingControls — analyze button (independent ✨)", () => {
  it("is disabled when state is idle (no recording yet)", () => {
    render(
      <RecordingControls state="idle" onAnalyze={() => {}} canUseAiAnalysis />,
    );
    expect(screen.getByTestId("analyze-btn")).toBeDisabled();
  });

  it("is disabled while recording", () => {
    render(
      <RecordingControls
        state="recording"
        onAnalyze={() => {}}
        canUseAiAnalysis
      />,
    );
    expect(screen.getByTestId("analyze-btn")).toBeDisabled();
  });

  it("is enabled in recorded state with AI analysis available", () => {
    const fn = vi.fn();
    render(
      <RecordingControls state="recorded" onAnalyze={fn} canUseAiAnalysis />,
    );
    const btn = screen.getByTestId("analyze-btn");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(fn).toHaveBeenCalled();
  });

  it("is disabled in recorded state when canUseAiAnalysis is false", () => {
    render(
      <RecordingControls
        state="recorded"
        onAnalyze={() => {}}
        canUseAiAnalysis={false}
      />,
    );
    expect(screen.getByTestId("analyze-btn")).toBeDisabled();
  });

  it("is enabled in assessed state with AI analysis available", () => {
    const fn = vi.fn();
    render(
      <RecordingControls state="assessed" onAnalyze={fn} canUseAiAnalysis />,
    );
    const btn = screen.getByTestId("analyze-btn");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(fn).toHaveBeenCalled();
  });

  it("is disabled when recordingDisabled is true even if state is recorded", () => {
    render(
      <RecordingControls
        state="recorded"
        onAnalyze={() => {}}
        canUseAiAnalysis
        disabled
      />,
    );
    expect(screen.getByTestId("analyze-btn")).toBeDisabled();
  });

  it("is not rendered when showAnalyzeButton is false", () => {
    render(
      <RecordingControls
        state="recorded"
        onAnalyze={() => {}}
        canUseAiAnalysis
        showAnalyzeButton={false}
      />,
    );
    expect(screen.queryByTestId("analyze-btn")).toBeNull();
  });
});

describe("RecordingControls — side buttons", () => {
  it("disables playback when canPlayback is false", () => {
    render(
      <RecordingControls
        state="idle"
        canPlayback={false}
        onPlayback={() => {}}
      />,
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
