/**
 * SpeakableWords（#1158 E2）：每個字可點、只唸那個字；標點不唸、撇號保留；播放中標示。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SpeakableWords, wordToSpeak } from "../SpeakableWords";
import { speakEnglish } from "@/utils/speakEnglish";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/utils/speakEnglish", () => ({ speakEnglish: vi.fn() }));

const speak = vi.mocked(speakEnglish);
const LABEL = "groupedQuestionsTemplate.labels.clickToPronounciate";

beforeEach(() => speak.mockClear());

describe("wordToSpeak", () => {
  it("去掉字首字尾標點，保留字中間的撇號與連字號、大小寫不動", () => {
    expect(wordToSpeak("food.")).toBe("food");
    expect(wordToSpeak("“Hello,")).toBe("Hello");
    expect(wordToSpeak("I'm")).toBe("I'm");
    expect(wordToSpeak("don't?")).toBe("don't");
    expect(wordToSpeak("well-known!")).toBe("well-known");
    expect(wordToSpeak("—")).toBe("");
  });
});

describe("SpeakableWords", () => {
  it("每個字一顆按鈕，畫面照原樣（含標點），點了只唸那個字", () => {
    render(<SpeakableWords text="I'm eating rice — don't stop." />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "I'm",
      "eating",
      "rice",
      "don't",
      "stop.",
    ]);
    // 只有標點的片段不能點，但照樣顯示
    expect(screen.getByText("—").tagName).toBe("SPAN");
    fireEvent.click(screen.getByRole("button", { name: `${LABEL}: stop` }));
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][0]).toBe("stop");
    fireEvent.click(screen.getByRole("button", { name: `${LABEL}: I'm` }));
    expect(speak.mock.calls[1][0]).toBe("I'm");
  });

  it("播放中標示：點的字變藍，唸完清掉；被下一個字打斷不會清掉新點的字", () => {
    render(<SpeakableWords text="one two" />);
    const one = screen.getByRole("button", { name: `${LABEL}: one` });
    const two = screen.getByRole("button", { name: `${LABEL}: two` });
    fireEvent.click(one);
    expect(one).toHaveAttribute("data-playing", "true");
    expect(one.className).toContain("text-blue-600");
    const endOne = speak.mock.calls[0][1]!.onEnd!;
    fireEvent.click(two);
    // one 被打斷：它的 onEnd 晚到，不影響 two
    act(() => endOne());
    expect(two).toHaveAttribute("data-playing", "true");
    expect(one).not.toHaveAttribute("data-playing");
    act(() => speak.mock.calls[1][1]!.onEnd!());
    expect(two).not.toHaveAttribute("data-playing");
  });
});
