/**
 * BulkActionBar 測試（#1097 建立，#1116 搬到 shared 並擴充）。
 *
 * 驗證：未勾選不渲染、計數句子與放大數字、sidebar 偏移、動作順序與點擊、ghost 小螢幕文字、
 * 單一動作停用、busy 全停用、開關動作；#1116 擴充的計數附註、停用原因／小標、danger 樣式、
 * loading 轉圈、開關 testId 與取消選取 test id。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  BulkActionBar,
  type BulkAction,
  type BulkButtonAction,
  type BulkSwitchAction,
} from "../BulkActionBar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "common.selection.clear": "取消選取",
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

const adjustAction = (
  onClick = vi.fn(),
  extra: Partial<BulkButtonAction> = {},
): BulkAction => ({
  key: "adjust-grade",
  label: "調整年級",
  onClick,
  ...extra,
});

describe("BulkActionBar", () => {
  it("renders nothing when nothing is selected", () => {
    const { container } = render(
      <BulkActionBar
        selectedCount={0}
        countLabel="已選 0 個班級"
        actions={[adjustAction()]}
        onClear={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the selected count and offsets by the sidebar width", () => {
    render(
      <BulkActionBar
        selectedCount={12}
        countLabel="已選 12 個班級"
        actions={[adjustAction()]}
        onClear={vi.fn()}
      />,
    );

    const toolbar = screen.getByRole("toolbar", { name: "已選 12 個班級" });
    expect(toolbar).toHaveTextContent("已選 12 個班級");
    expect(toolbar).toHaveAttribute("data-testid", "bulk-action-bar");
    // The count is emphasised separately
    expect(screen.getByText("12")).toHaveClass("tabular-nums");
    expect(toolbar.parentElement).toHaveStyle({ left: "256px" });
  });

  it("renders every action in order and calls its handler", () => {
    const onAdjust = vi.fn();
    const onDeactivate = vi.fn();
    const onClear = vi.fn();
    render(
      <BulkActionBar
        selectedCount={2}
        countLabel="已選 2 個班級"
        actions={[
          adjustAction(onAdjust),
          {
            key: "deactivate",
            label: "停用",
            onClick: onDeactivate,
            variant: "ghost",
          },
        ]}
        onClear={onClear}
      />,
    );

    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual(["調整年級", "停用", "取消選取"]);

    fireEvent.click(screen.getByRole("button", { name: "調整年級" }));
    expect(onAdjust).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    expect(onDeactivate).toHaveBeenCalledTimes(1);

    // The clear button keeps an accessible name even when its label is hidden
    fireEvent.click(screen.getByRole("button", { name: "取消選取" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("keeps the full label as the accessible name of ghost actions and hides the text on small screens when an icon is given", () => {
    render(
      <BulkActionBar
        selectedCount={2}
        countLabel="已選 2 個班級"
        actions={[
          {
            key: "deactivate",
            label: "停用",
            onClick: vi.fn(),
            variant: "ghost",
            icon: <svg data-testid="off-icon" aria-hidden="true" />,
          },
          {
            key: "activate",
            label: "重新啟用班級",
            shortLabel: "啟用",
            onClick: vi.fn(),
            variant: "ghost",
          },
        ]}
        onClear={vi.fn()}
      />,
    );

    const deactivate = screen.getByRole("button", { name: "停用" });
    expect(deactivate).toHaveAttribute("title", "停用");
    expect(screen.getByTestId("off-icon")).toBeInTheDocument();
    // Text label is hidden at ≤480px; the icon stays
    expect(screen.getByText("停用")).toHaveClass("max-[480px]:hidden");

    // Without an icon the short label replaces the full one at ≤480px
    const activate = screen.getByRole("button", { name: "重新啟用班級" });
    expect(screen.getByText("重新啟用班級")).toHaveClass("max-[480px]:hidden");
    expect(screen.getByText("啟用")).toHaveClass("max-[480px]:inline");
    expect(activate).toContainElement(screen.getByText("啟用"));
  });

  it("disables a single action when it is marked disabled", () => {
    const onActivate = vi.fn();
    render(
      <BulkActionBar
        selectedCount={2}
        countLabel="已選 2 個班級"
        actions={[
          adjustAction(),
          {
            key: "activate",
            label: "啟用",
            onClick: onActivate,
            disabled: true,
          },
        ]}
        onClear={vi.fn()}
      />,
    );

    const activate = screen.getByRole("button", { name: "啟用" });
    expect(activate).toBeDisabled();
    fireEvent.click(activate);
    expect(onActivate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "調整年級" })).not.toBeDisabled();
  });

  it("disables every button while busy", () => {
    const onAdjust = vi.fn();
    const onClear = vi.fn();
    render(
      <BulkActionBar
        selectedCount={2}
        countLabel="已選 2 個班級"
        actions={[adjustAction(onAdjust)]}
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

  const statusSwitch = (
    extra: Partial<BulkSwitchAction> = {},
  ): BulkSwitchAction => ({
    key: "status",
    kind: "switch",
    checked: true,
    label: "停用",
    ariaLabel: "停用選取的班級",
    onToggle: vi.fn(),
    ...extra,
  });

  it("renders a switch action with its label inside the track and toggles to the opposite state", () => {
    const onToggle = vi.fn();
    render(
      <BulkActionBar
        selectedCount={2}
        countLabel="已選 2 個班級"
        actions={[adjustAction(), statusSwitch({ onToggle })]}
        onClear={vi.fn()}
      />,
    );

    const toggle = screen.getByRole("switch", { name: "停用選取的班級" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveTextContent("停用");
    // onDark tone: checked = white track with blue text
    expect(toggle).toHaveClass("bg-white", "text-blue-700");
    // Button actions keep rendering next to the switch
    expect(
      screen.getByRole("button", { name: "調整年級" }),
    ).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("renders an unchecked switch action on a translucent track", () => {
    const onToggle = vi.fn();
    render(
      <BulkActionBar
        selectedCount={2}
        countLabel="已選 2 個班級"
        actions={[
          statusSwitch({
            checked: false,
            label: "啟用",
            ariaLabel: "啟用選取的班級",
            onToggle,
          }),
        ]}
        onClear={vi.fn()}
      />,
    );

    const toggle = screen.getByRole("switch", { name: "啟用選取的班級" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveTextContent("啟用");
    expect(toggle).toHaveClass("bg-white/30", "text-white");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("disables the switch action while busy", () => {
    const onToggle = vi.fn();
    render(
      <BulkActionBar
        selectedCount={2}
        countLabel="已選 2 個班級"
        actions={[statusSwitch({ onToggle })]}
        onClear={vi.fn()}
        busy
      />,
    );

    const toggle = screen.getByRole("switch", { name: "停用選取的班級" });
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("shows the count note next to the count", () => {
    render(
      <BulkActionBar
        selectedCount={5}
        countLabel="已選 5 題"
        countNote="2 題有未儲存的修改"
        actions={[adjustAction()]}
        onClear={vi.fn()}
      />,
    );

    const toolbar = screen.getByRole("toolbar", { name: "已選 5 題" });
    expect(toolbar).toHaveTextContent("已選 5 題2 題有未儲存的修改");
    expect(screen.getByText("2 題有未儲存的修改")).toHaveClass(
      "text-amber-200",
    );
  });

  it("explains a disabled action with a tooltip and a badge, only while disabled", () => {
    const { rerender } = render(
      <BulkActionBar
        selectedCount={2}
        countLabel="已選 2 題"
        actions={[
          {
            key: "dispatch",
            label: "派發",
            onClick: vi.fn(),
            variant: "ghost",
            disabled: true,
            disabledReason: "即將推出",
            disabledBadge: "即將推出",
            testId: "dispatch",
          },
        ]}
        onClear={vi.fn()}
      />,
    );

    const dispatch = screen.getByTestId("dispatch");
    expect(dispatch).toBeDisabled();
    expect(dispatch).toHaveAttribute("title", "即將推出");
    expect(dispatch).toHaveTextContent("派發即將推出");

    rerender(
      <BulkActionBar
        selectedCount={2}
        countLabel="已選 2 題"
        actions={[
          {
            key: "dispatch",
            label: "派發",
            onClick: vi.fn(),
            variant: "ghost",
            disabledReason: "即將推出",
            disabledBadge: "即將推出",
            testId: "dispatch",
          },
        ]}
        onClear={vi.fn()}
      />,
    );
    const enabled = screen.getByTestId("dispatch");
    expect(enabled).not.toBeDisabled();
    expect(enabled).toHaveAttribute("title", "派發");
    expect(enabled).toHaveTextContent(/^派發$/);
  });

  it("renders the danger variant with a translucent red outline", () => {
    const onDelete = vi.fn();
    render(
      <BulkActionBar
        selectedCount={2}
        countLabel="已選 2 題"
        actions={[
          {
            key: "delete",
            label: "刪除",
            onClick: onDelete,
            variant: "danger",
            testId: "delete",
          },
        ]}
        onClear={vi.fn()}
      />,
    );

    const del = screen.getByTestId("delete");
    expect(del).toHaveClass("text-red-200", "ring-red-300/60");
    expect(del).not.toHaveClass("bg-white");
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("shows a spinner and blocks clicks while an action is loading", () => {
    const onSave = vi.fn();
    render(
      <BulkActionBar
        selectedCount={2}
        countLabel="已選 2 題"
        actions={[
          {
            key: "save",
            label: "儲存",
            onClick: onSave,
            icon: <svg data-testid="save-icon" aria-hidden="true" />,
            loading: true,
            testId: "save",
          },
        ]}
        onClear={vi.fn()}
      />,
    );

    const save = screen.getByTestId("save");
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("aria-busy", "true");
    expect(save.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByTestId("save-icon")).toBeNull();
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("puts the test id of a switch action on a wrapper", () => {
    render(
      <BulkActionBar
        selectedCount={2}
        countLabel="已選 2 個班級"
        actions={[statusSwitch({ testId: "status-switch" })]}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByTestId("status-switch")).toContainElement(
      screen.getByRole("switch", { name: "停用選取的班級" }),
    );
    expect(screen.getByTestId("bulk-action-bar-clear")).toBeInTheDocument();
  });
});
