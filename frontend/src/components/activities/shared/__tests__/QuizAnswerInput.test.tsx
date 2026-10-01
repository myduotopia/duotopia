/**
 * QuizAnswerInput 格子定位（Issue #1092）
 * - 填在第幾格就是第幾格：第 1 格空白時 value 以空白開頭，不再把後面的字往前擠
 * - 只去尾端空白；prior_answer（可能以空白開頭）能還原到原格子
 * - 虛擬鍵盤 appendChar / backspace 作用在目前 focus 的格子
 * - 空格按 Backspace 跳回前一格
 */
import { createRef, useState, type Ref } from "react";
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import QuizAnswerInput, {
  type QuizAnswerInputHandle,
} from "../QuizAnswerInput";

function Harness({
  initial = "",
  expected = "look forward to",
  onValue,
  inputRef,
}: {
  initial?: string;
  expected?: string;
  onValue?: (v: string) => void;
  inputRef?: Ref<QuizAnswerInputHandle>;
}) {
  const [value, setValue] = useState(initial);
  return (
    <QuizAnswerInput
      ref={inputRef}
      value={value}
      expectedAnswer={expected}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
    />
  );
}

const last = (arr: string[]) => arr[arr.length - 1];

const slots = () => screen.getAllByRole("textbox") as HTMLInputElement[];

describe("QuizAnswerInput slot positions (#1092)", () => {
  it("typing in slot 2 with slot 1 empty keeps the word in slot 2", () => {
    const values: string[] = [];
    render(<Harness onValue={(v) => values.push(v)} />);
    fireEvent.change(slots()[1], { target: { value: "forward" } });
    expect(last(values)).toBe(" forward");
    expect(slots().map((s) => s.value)).toEqual(["", "forward", ""]);
    fireEvent.change(slots()[2], { target: { value: "to" } });
    expect(last(values)).toBe(" forward to");
    expect(slots().map((s) => s.value)).toEqual(["", "forward", "to"]);
  });

  it("restores a prior answer that starts with a blank slot", () => {
    render(<Harness initial=" forward to" />);
    expect(slots().map((s) => s.value)).toEqual(["", "forward", "to"]);
  });

  it("restores a middle blank slot", () => {
    render(<Harness initial="look  to" />);
    expect(slots().map((s) => s.value)).toEqual(["look", "", "to"]);
  });

  it("only trims trailing blanks", () => {
    const values: string[] = [];
    render(
      <Harness initial="look forward to" onValue={(v) => values.push(v)} />,
    );
    fireEvent.change(slots()[2], { target: { value: "" } });
    expect(last(values)).toBe("look forward");
    fireEvent.change(slots()[0], { target: { value: "" } });
    expect(last(values)).toBe(" forward");
  });

  it("virtual keyboard appendChar / backspace act on the focused slot", () => {
    const ref = createRef<QuizAnswerInputHandle>();
    const values: string[] = [];
    render(<Harness inputRef={ref} onValue={(v) => values.push(v)} />);
    fireEvent.focus(slots()[2]);
    act(() => ref.current?.appendChar("t"));
    act(() => ref.current?.appendChar("o"));
    expect(last(values)).toBe("  to");
    expect(slots().map((s) => s.value)).toEqual(["", "", "to"]);
    act(() => ref.current?.backspace());
    expect(slots().map((s) => s.value)).toEqual(["", "", "t"]);
  });

  it("Backspace on an empty slot moves focus to the previous slot", () => {
    render(<Harness initial="look" />);
    slots()[1].focus();
    fireEvent.keyDown(slots()[1], { key: "Backspace" });
    expect(document.activeElement).toBe(slots()[0]);
  });

  it("single-word answers behave as before", () => {
    const values: string[] = [];
    render(<Harness expected="apple" onValue={(v) => values.push(v)} />);
    expect(slots()).toHaveLength(1);
    fireEvent.change(slots()[0], { target: { value: "apple" } });
    expect(last(values)).toBe("apple");
  });
});
