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

  it("renders the sentence as plain selectable text (no per-word buttons)", () => {
    render(
      <ClozeAnswerEditor
        sentence="I have two cups."
        value=""
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryAllByTestId("cloze-word")).toHaveLength(0);
    expect(screen.getByTestId("cloze-sentence").textContent).toBe(
      "I have two cups.",
    );
  });

  it("sets the double-clicked word as the answer", () => {
    const onChange = vi.fn();
    render(
      <ClozeAnswerEditor
        sentence="I have two cups."
        value=""
        onChange={onChange}
      />,
    );
    // Browser auto-selects the word on double-click; emulate that selection.
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "cups",
    } as unknown as Selection);
    fireEvent.doubleClick(screen.getByTestId("cloze-sentence"));
    expect(onChange).toHaveBeenCalledWith("cups");
  });

  it("does not toast on a double-click with no selection", () => {
    const onChange = vi.fn();
    render(
      <ClozeAnswerEditor
        sentence="I have two cups."
        value=""
        onChange={onChange}
      />,
    );
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "",
    } as unknown as Selection);
    fireEvent.doubleClick(screen.getByTestId("cloze-sentence"));
    expect(onChange).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
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

  it("highlights the current answer in the sentence", () => {
    render(
      <ClozeAnswerEditor
        sentence="I have two cups."
        value="cups"
        onChange={vi.fn()}
      />,
    );
    const current = screen.getByTestId("cloze-current");
    expect(current.textContent).toContain("cups");
    const highlight = screen.getByTestId("cloze-highlight");
    expect(highlight.textContent).toBe("cups");
    expect(highlight.className).toContain("bg-purple-300");
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
    const onChange = vi.fn();
    render(
      <ClozeAnswerEditor
        sentence="I have two cups."
        value="cups"
        onChange={onChange}
        disabled
      />,
    );
    expect(screen.queryByTestId("cloze-use-selection")).toBeNull();
    expect(screen.queryByTestId("cloze-clear")).toBeNull();
    // sentence still shows with the answer highlighted, but double-click is inert
    expect(screen.getByTestId("cloze-highlight").textContent).toBe("cups");
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "have",
    } as unknown as Selection);
    fireEvent.doubleClick(screen.getByTestId("cloze-sentence"));
    expect(onChange).not.toHaveBeenCalled();
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
