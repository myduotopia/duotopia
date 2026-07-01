import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecordingCard } from "../RecordingCard";

const baseProps = {
  variant: "sentence" as const,
  text: "The sunflowers are beautiful",
  translation: "向日葵很美麗",
  playbackRate: 1,
  onRateChange: () => {},
};

describe("RecordingCard — state → controls", () => {
  it("idle shows the record button", () => {
    render(<RecordingCard {...baseProps} state="idle" />);
    expect(screen.getByTestId("center-record")).toBeInTheDocument();
  });

  it("recording shows stop + timer", () => {
    render(
      <RecordingCard {...baseProps} state="recording" recordingSeconds={12} />,
    );
    expect(screen.getByTestId("center-stop")).toBeInTheDocument();
    expect(screen.getByTestId("recording-timer").textContent).toBe("0:12");
  });

  it("recorded shows mic in center + analyze-btn enabled", () => {
    render(
      <RecordingCard
        {...baseProps}
        state="recorded"
        canUseAiAnalysis
        onAnalyze={() => {}}
      />,
    );
    // 中央鈕拿掉「分析上傳」狀態，改回 mic（可重新錄音）
    expect(screen.getByTestId("center-record")).toBeInTheDocument();
    expect(screen.queryByTestId("center-analyze")).toBeNull();
    // 上傳分析改成獨立小鈕，此時應可按
    expect(screen.getByTestId("analyze-btn")).not.toBeDisabled();
  });

  it("assessed shows re-record and dims the translation", () => {
    render(<RecordingCard {...baseProps} state="assessed" />);
    expect(screen.getByTestId("center-rerecord")).toBeInTheDocument();
    expect(
      screen.getByTestId("card-translation").getAttribute("data-dimmed"),
    ).toBe("true");
  });
});

describe("RecordingCard — correction mode", () => {
  it("shows the teacher feedback bar only when correction + feedback", () => {
    const { rerender } = render(
      <RecordingCard
        {...baseProps}
        state="assessed"
        isCorrection
        teacherPassed={false}
        teacherFeedback="尾音吃掉了"
      />,
    );
    expect(screen.getByTestId("teacher-feedback-bar")).toBeInTheDocument();
    expect(screen.getByText("尾音吃掉了")).toBeInTheDocument();

    // not correction → no bar
    rerender(
      <RecordingCard
        {...baseProps}
        state="assessed"
        isCorrection={false}
        teacherFeedback="尾音吃掉了"
      />,
    );
    expect(screen.queryByTestId("teacher-feedback-bar")).toBeNull();
  });

  it("no feedback bar in correction mode without feedback text", () => {
    render(<RecordingCard {...baseProps} state="idle" isCorrection />);
    expect(screen.queryByTestId("teacher-feedback-bar")).toBeNull();
  });
});

describe("RecordingCard — wiring", () => {
  it("renders the example audio bar with the given rate", () => {
    render(<RecordingCard {...baseProps} state="idle" playbackRate={1.5} />);
    expect(screen.getByTestId("rate-1.5").getAttribute("data-active")).toBe(
      "true",
    );
  });

  it("injects colored text and score badge slots", () => {
    render(
      <RecordingCard
        {...baseProps}
        state="assessed"
        coloredText={<span data-testid="colored">C</span>}
        scoreBadge={<span data-testid="badge">87</span>}
      />,
    );
    expect(screen.getByTestId("colored")).toBeInTheDocument();
    expect(screen.getByTestId("badge")).toBeInTheDocument();
  });

  it("locks controls when recordingDisabled", () => {
    const onRecordStart = vi.fn();
    render(
      <RecordingCard
        {...baseProps}
        state="idle"
        recordingDisabled
        onRecordStart={onRecordStart}
      />,
    );
    fireEvent.click(screen.getByTestId("center-record"));
    expect(onRecordStart).not.toHaveBeenCalled();
  });
});
