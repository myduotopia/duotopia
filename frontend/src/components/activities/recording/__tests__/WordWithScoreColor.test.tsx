import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WordWithScoreColor, scoreBand } from "../WordWithScoreColor";

const words = [
  { index: 0, word: "The", score: 95 },
  { index: 1, word: "sunflowers", score: 72 },
  {
    index: 2,
    word: "really",
    score: 52,
    phonemes: [
      { phoneme: "r", accuracy_score: 40 },
      { phoneme: "ˈɪ", accuracy_score: 60 },
    ],
  },
];

describe("scoreBand", () => {
  it("maps scores to pass/warn/fail bands", () => {
    expect(scoreBand(80)).toBe("pass");
    expect(scoreBand(79)).toBe("warn");
    expect(scoreBand(60)).toBe("warn");
    expect(scoreBand(59)).toBe("fail");
  });
});

describe("WordWithScoreColor", () => {
  it("colors each word by its band", () => {
    render(<WordWithScoreColor words={words} />);
    expect(screen.getByTestId("word-0").getAttribute("data-band")).toBe("pass");
    expect(screen.getByTestId("word-1").getAttribute("data-band")).toBe("warn");
    expect(screen.getByTestId("word-2").getAttribute("data-band")).toBe("fail");
  });

  it("renders non-red words as plain spans (not buttons)", () => {
    render(<WordWithScoreColor words={words} />);
    expect(screen.getByTestId("word-0").tagName).toBe("SPAN");
    expect(screen.getByTestId("word-2").tagName).toBe("BUTTON");
  });

  it("opens a popover with score + ipa when a red word is clicked", () => {
    render(<WordWithScoreColor words={words} />);
    expect(screen.queryByTestId("word-popover-2")).toBeNull();
    fireEvent.click(screen.getByTestId("word-2"));
    expect(screen.getByTestId("word-popover-2")).toBeInTheDocument();
    expect(screen.getByTestId("word-score-2").textContent).toBe("52 分");
    // ipa joined from phonemes
    expect(screen.getByText("rˈɪ")).toBeInTheDocument();
  });

  it("toggles the popover closed on second click", () => {
    render(<WordWithScoreColor words={words} />);
    fireEvent.click(screen.getByTestId("word-2"));
    fireEvent.click(screen.getByTestId("word-2"));
    expect(screen.queryByTestId("word-popover-2")).toBeNull();
  });

  it("fires onPlayWord from the popover play button", () => {
    const onPlayWord = vi.fn();
    render(<WordWithScoreColor words={words} onPlayWord={onPlayWord} />);
    fireEvent.click(screen.getByTestId("word-2"));
    fireEvent.click(screen.getByTestId("play-word-2"));
    expect(onPlayWord).toHaveBeenCalledWith(words[2]);
  });

  it("hides the play button when onPlayWord is not provided", () => {
    render(<WordWithScoreColor words={words} />);
    fireEvent.click(screen.getByTestId("word-2"));
    expect(screen.queryByTestId("play-word-2")).toBeNull();
  });
});
