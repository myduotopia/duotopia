import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LabeledSwitch } from "../LabeledSwitch";

describe("LabeledSwitch", () => {
  it("renders a switch with its label inside the track and a full-sentence accessible name", () => {
    render(
      <LabeledSwitch
        checked
        onCheckedChange={vi.fn()}
        label="停用"
        ariaLabel="停用此班級"
      />,
    );
    const toggle = screen.getByRole("switch", { name: "停用此班級" });
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveTextContent("停用");
    // Width grows with the text instead of truncating it
    expect(toggle).toHaveClass("min-w-16", "whitespace-nowrap");
    expect(toggle).toHaveClass("motion-reduce:transition-none");
  });

  it("calls onCheckedChange with the opposite state", () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(
      <LabeledSwitch
        checked
        onCheckedChange={onCheckedChange}
        label="Disable"
        ariaLabel="Disable this classroom"
      />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);

    rerender(
      <LabeledSwitch
        checked={false}
        onCheckedChange={onCheckedChange}
        label="Enable"
        ariaLabel="Enable this classroom"
      />,
    );
    const toggle = screen.getByRole("switch", {
      name: "Enable this classroom",
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
  });

  it("does not toggle when disabled", () => {
    const onCheckedChange = vi.fn();
    render(
      <LabeledSwitch
        checked
        disabled
        onCheckedChange={onCheckedChange}
        label="停用"
        ariaLabel="停用此班級"
      />,
    );
    const toggle = screen.getByRole("switch");
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("uses brand colours by default", () => {
    const { rerender } = render(
      <LabeledSwitch
        checked
        onCheckedChange={vi.fn()}
        label="停用"
        ariaLabel="停用此班級"
      />,
    );
    expect(screen.getByRole("switch")).toHaveClass("bg-blue-600", "text-white");
    expect(screen.getByTestId("labeled-switch-knob")).toHaveClass("bg-white");

    rerender(
      <LabeledSwitch
        checked={false}
        onCheckedChange={vi.fn()}
        label="啟用"
        ariaLabel="啟用此班級"
      />,
    );
    expect(screen.getByRole("switch")).toHaveClass(
      "bg-gray-300",
      "text-gray-700",
    );
  });

  it("uses white-on-blue colours for the onDark tone", () => {
    const { rerender } = render(
      <LabeledSwitch
        tone="onDark"
        checked
        onCheckedChange={vi.fn()}
        label="停用"
        ariaLabel="停用選取的班級"
      />,
    );
    expect(screen.getByRole("switch")).toHaveClass("bg-white", "text-blue-700");
    expect(screen.getByTestId("labeled-switch-knob")).toHaveClass(
      "bg-blue-700",
    );

    rerender(
      <LabeledSwitch
        tone="onDark"
        checked={false}
        onCheckedChange={vi.fn()}
        label="啟用"
        ariaLabel="啟用選取的班級"
      />,
    );
    expect(screen.getByRole("switch")).toHaveClass("bg-white/30", "text-white");
    expect(screen.getByTestId("labeled-switch-knob")).toHaveClass("bg-white");
  });
});
