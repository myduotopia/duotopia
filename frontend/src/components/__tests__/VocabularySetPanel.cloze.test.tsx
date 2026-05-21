import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClozeAnswerEditor } from "../VocabularySetPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

describe("ClozeAnswerEditor", () => {
  beforeEach(() => {
    toastError.mockClear();
  });

  it("renders each word in the sentence as a clickable token", () => {
    render(
      <ClozeAnswerEditor
        sentence="I have two cups."
        value=""
        onChange={vi.fn()}
      />,
    );
    const words = screen.getAllByTestId("cloze-word").map((b) => b.textContent);
    expect(words).toEqual(["I", "have", "two", "cups"]);
  });

  it("calls onChange with the clicked word", () => {
    const onChange = vi.fn();
    render(
      <ClozeAnswerEditor
        sentence="I have two cups."
        value=""
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen
        .getAllByTestId("cloze-word")
        .find((b) => b.textContent === "cups")!,
    );
    expect(onChange).toHaveBeenCalledWith("cups");
  });

  it("shows an empty hint when no answer is set", () => {
    render(
      <ClozeAnswerEditor
        sentence="A simple sentence."
        value=""
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("cloze-empty-hint")).toBeTruthy();
    expect(screen.queryByTestId("cloze-current")).toBeNull();
  });

  it("highlights the current answer word", () => {
    render(
      <ClozeAnswerEditor
        sentence="I have two cups."
        value="cups"
        onChange={vi.fn()}
      />,
    );
    const current = screen.getByTestId("cloze-current");
    expect(current.textContent).toContain("cups");
    const cupsBtn = screen
      .getAllByTestId("cloze-word")
      .find((b) => b.textContent === "cups")!;
    expect(cupsBtn.className).toContain("bg-purple-300");
  });

  it("clears the answer when the clear button is clicked", () => {
    const onChange = vi.fn();
    render(
      <ClozeAnswerEditor
        sentence="I have two cups."
        value="cups"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("cloze-clear"));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("accepts a selected phrase that appears in the sentence", () => {
    const onChange = vi.fn();
    render(
      <ClozeAnswerEditor
        sentence="I ate two pieces of cake."
        value=""
        onChange={onChange}
      />,
    );
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "two pieces of cake",
    } as unknown as Selection);
    fireEvent.click(screen.getByTestId("cloze-use-selection"));
    expect(onChange).toHaveBeenCalledWith("two pieces of cake");
  });

  it("rejects a selection that is not part of the sentence", () => {
    const onChange = vi.fn();
    render(
      <ClozeAnswerEditor sentence="I ate cake." value="" onChange={onChange} />,
    );
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "something else",
    } as unknown as Selection);
    fireEvent.click(screen.getByTestId("cloze-use-selection"));
    expect(onChange).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it("renders read-only (no controls) when disabled", () => {
    render(
      <ClozeAnswerEditor
        sentence="I have two cups."
        value="cups"
        onChange={vi.fn()}
        disabled
      />,
    );
    expect(screen.queryByTestId("cloze-use-selection")).toBeNull();
    expect(screen.queryByTestId("cloze-clear")).toBeNull();
    // words still render but are disabled
    const cupsBtn = screen
      .getAllByTestId("cloze-word")
      .find((b) => b.textContent === "cups")! as HTMLButtonElement;
    expect(cupsBtn.disabled).toBe(true);
  });

  it("preserves original casing when matching a lowercased selection", () => {
    const onChange = vi.fn();
    render(
      <ClozeAnswerEditor
        sentence="Cups are useful."
        value=""
        onChange={onChange}
      />,
    );
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "cups",
    } as unknown as Selection);
    fireEvent.click(screen.getByTestId("cloze-use-selection"));
    expect(onChange).toHaveBeenCalledWith("Cups");
  });
});
