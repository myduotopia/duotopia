import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GradeBulkBar } from "../GradeBulkBar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "classroomGrade.selection.selectedCount": "已選 {{count}} 個班級",
        "classroomGrade.selection.clear": "取消選取",
        "classroomGrade.adjust.button": "調整年級",
      };
      const template = translations[key];
      if (!template) return key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(opts?.[name] ?? ""),
      );
    },
    i18n: { language: "zh-TW" },
  }),
}));

vi.mock("@/contexts/SidebarContext", () => ({
  useSidebar: () => ({ sidebarWidth: 256 }),
}));

describe("GradeBulkBar", () => {
  it("renders nothing when nothing is selected", () => {
    const { container } = render(
      <GradeBulkBar selectedCount={0} onAdjust={vi.fn()} onClear={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the selected count and offsets by the sidebar width", () => {
    render(
      <GradeBulkBar selectedCount={12} onAdjust={vi.fn()} onClear={vi.fn()} />,
    );

    const toolbar = screen.getByRole("toolbar", { name: "已選 12 個班級" });
    expect(toolbar).toHaveTextContent("已選 12 個班級");
    // The count is emphasised separately
    expect(screen.getByText("12")).toHaveClass("tabular-nums");
    expect(toolbar.parentElement).toHaveStyle({ left: "256px" });
  });

  it("calls the handlers when the buttons are clicked", () => {
    const onAdjust = vi.fn();
    const onClear = vi.fn();
    render(
      <GradeBulkBar selectedCount={2} onAdjust={onAdjust} onClear={onClear} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "調整年級" }));
    expect(onAdjust).toHaveBeenCalledTimes(1);

    // The clear button keeps an accessible name even when its label is hidden
    fireEvent.click(screen.getByRole("button", { name: "取消選取" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons while busy", () => {
    const onAdjust = vi.fn();
    const onClear = vi.fn();
    render(
      <GradeBulkBar
        selectedCount={2}
        onAdjust={onAdjust}
        onClear={onClear}
        busy
      />,
    );

    const adjust = screen.getByRole("button", { name: "調整年級" });
    const clear = screen.getByRole("button", { name: "取消選取" });
    expect(adjust).toBeDisabled();
    expect(clear).toBeDisabled();
    fireEvent.click(adjust);
    fireEvent.click(clear);
    expect(onAdjust).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });
});
