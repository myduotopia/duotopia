import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AudioPlaybackBar, PLAYBACK_RATES } from "../AudioPlaybackBar";

describe("AudioPlaybackBar", () => {
  it("renders the 0.75 / 1 / 1.5 rate options", () => {
    render(<AudioPlaybackBar playbackRate={1} onRateChange={() => {}} />);
    expect(screen.getByTestId("rate-0.75")).toBeInTheDocument();
    expect(screen.getByTestId("rate-1")).toBeInTheDocument();
    expect(screen.getByTestId("rate-1.5")).toBeInTheDocument();
    expect(PLAYBACK_RATES).toEqual([0.75, 1, 1.5]);
  });

  it("marks the current rate as active", () => {
    render(<AudioPlaybackBar playbackRate={1.5} onRateChange={() => {}} />);
    expect(screen.getByTestId("rate-1.5").getAttribute("data-active")).toBe(
      "true",
    );
    expect(screen.getByTestId("rate-1").getAttribute("data-active")).toBe(
      "false",
    );
  });

  it("fires onRateChange with the selected rate", () => {
    const onRateChange = vi.fn();
    render(<AudioPlaybackBar playbackRate={1} onRateChange={onRateChange} />);
    fireEvent.click(screen.getByTestId("rate-0.75"));
    expect(onRateChange).toHaveBeenCalledWith(0.75);
  });

  it("fires onPlayExample when the speaker is clicked", () => {
    const onPlay = vi.fn();
    render(
      <AudioPlaybackBar
        playbackRate={1}
        onRateChange={() => {}}
        onPlayExample={onPlay}
      />,
    );
    fireEvent.click(screen.getByTestId("play-example"));
    expect(onPlay).toHaveBeenCalled();
  });

  it("disables the speaker when there is no example audio", () => {
    render(
      <AudioPlaybackBar
        playbackRate={1}
        onRateChange={() => {}}
        hasExampleAudio={false}
      />,
    );
    expect(screen.getByTestId("play-example")).toBeDisabled();
  });
});
