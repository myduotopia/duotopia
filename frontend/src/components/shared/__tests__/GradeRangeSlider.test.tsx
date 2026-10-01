/**
 * GradeRangeSlider 測試：兩點互相夾住、不限清除、標籤文字。
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GradeRangeSlider } from "../GradeRangeSlider";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "questionBank.form.gradeAny": "any",
        "questionBank.gradeSingle": `g${opts?.grade}`,
        "questionBank.gradeRange": `g${opts?.min}-${opts?.max}`,
      };
      return map[key] ?? key;
    },
  }),
}));

describe("GradeRangeSlider", () => {
  it("min 拖過 max 會被夾到 max；max 拖過 min 會被夾到 min", () => {
    const onChange = vi.fn();
    render(<GradeRangeSlider value={[3, 5]} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("grade-range-slider-min"), {
      target: { value: "9" },
    });
    expect(onChange).toHaveBeenLastCalledWith([5, 5]);
    fireEvent.change(screen.getByTestId("grade-range-slider-max"), {
      target: { value: "1" },
    });
    expect(onChange).toHaveBeenLastCalledWith([3, 3]);
  });

  it("標籤：不限／單一年段／範圍；清除鍵送 [null, null]", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <GradeRangeSlider value={[null, null]} onChange={onChange} />,
    );
    expect(screen.getByTestId("grade-range-slider-label").textContent).toBe(
      "any",
    );
    expect(screen.queryByTestId("grade-range-slider-clear")).toBeNull();

    rerender(<GradeRangeSlider value={[4, 4]} onChange={onChange} />);
    expect(screen.getByTestId("grade-range-slider-label").textContent).toBe(
      "g4",
    );
    rerender(<GradeRangeSlider value={[2, 6]} onChange={onChange} />);
    expect(screen.getByTestId("grade-range-slider-label").textContent).toBe(
      "g2-6",
    );
    await user.click(screen.getByTestId("grade-range-slider-clear"));
    expect(onChange).toHaveBeenLastCalledWith([null, null]);
  });

  it("只設一端時另一端用全範圍畫", () => {
    render(<GradeRangeSlider value={[7, null]} onChange={vi.fn()} />);
    expect(
      (screen.getByTestId("grade-range-slider-max") as HTMLInputElement).value,
    ).toBe("12");
    expect(screen.getByTestId("grade-range-slider-label").textContent).toBe(
      "g7-12",
    );
  });
});
