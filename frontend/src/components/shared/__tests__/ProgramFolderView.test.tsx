import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProgramFolderView from "../ProgramFolderView";
import type { Program } from "@/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: "zh-TW" },
  }),
}));

// jsdom 沒有 ResizeObserver，ProgramFolderView 用它算 grid 欄數
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Radix dropdown 在 jsdom 需要這些 pointer API
beforeEach(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const program = {
  id: 1,
  name: "Basic English",
  description: "Foundation course",
  level: "A1",
  visibility: "private",
  lessons: [{ id: 10, name: "Lesson A", contents: [] }],
  contents: [],
} as unknown as Program;

function renderView(
  overrides: Partial<React.ComponentProps<typeof ProgramFolderView>> = {},
) {
  return render(
    <ProgramFolderView
      programs={[program]}
      onEditProgram={vi.fn()}
      onDeleteProgram={vi.fn()}
      onEditLesson={vi.fn()}
      onDeleteLesson={vi.fn()}
      onCreateLesson={vi.fn()}
      onContentClick={vi.fn()}
      onDeleteContent={vi.fn()}
      onCopyContent={vi.fn()}
      onCreateContent={vi.fn()}
      {...overrides}
    />,
  );
}

describe("ProgramFolderView - 教材卡片公開設定 (Issue #627)", () => {
  it("resource 帳號：卡片顯示目前的公開狀態徽章", () => {
    renderView({ showVisibility: true, onVisibilityChange: vi.fn() });

    expect(screen.getByRole("button", { name: "不公開" })).toBeInTheDocument();
  });

  it("resource 帳號：選擇「全公開」會帶 program id 與新的 visibility 呼叫 callback", async () => {
    const user = userEvent.setup();
    const onVisibilityChange = vi.fn().mockResolvedValue(undefined);
    renderView({ showVisibility: true, onVisibilityChange });

    await user.click(screen.getByRole("button", { name: "不公開" }));
    await user.click(await screen.findByRole("menuitem", { name: /全公開/ }));

    await waitFor(() =>
      expect(onVisibilityChange).toHaveBeenCalledWith(1, "public"),
    );
  });

  it("點徽章不會誤觸卡片、把教材展開", async () => {
    const user = userEvent.setup();
    renderView({ showVisibility: true, onVisibilityChange: vi.fn() });

    await user.click(screen.getByRole("button", { name: "不公開" }));

    // 卡片若被選中會展開 lessons 區，Lesson A 就會出現
    expect(screen.queryByText("Lesson A")).not.toBeInTheDocument();
  });

  it("一般老師帳號（未傳 showVisibility）：卡片不顯示公開設定徽章", () => {
    renderView();

    expect(
      screen.queryByRole("button", { name: "不公開" }),
    ).not.toBeInTheDocument();
  });
});
