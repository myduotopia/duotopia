/**
 * 即刻練習「進階設定」（#1158 E-4）：這種內容只有一種模式（情境對話）時不顯示模式切換列，
 * 只留進階設定；有多種模式（例句集）照常顯示。
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { PracticeModeSettings } from "@/components/assignment/practiceModeSettings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));
vi.mock("@/components/assignment/PracticeModeSettingsPanel", () => ({
  default: ({ mode }: { mode: string }) => (
    <div data-testid="mode-settings">{mode}</div>
  ),
}));

beforeAll(() => {
  // jsdom 沒有 ResizeObserver／scrollIntoView
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
});

async function load() {
  vi.resetModules();
  vi.doMock("@/config/featureFlags", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/config/featureFlags")>()),
    ENABLE_SCENARIO_DIALOGUE_DISPATCH: true,
  }));
  return (await import("../InstantPracticeSettingsPanel")).default;
}

afterEach(() => {
  vi.doUnmock("@/config/featureFlags");
});

const SETTINGS = {} as PracticeModeSettings;

describe("InstantPracticeSettingsPanel", () => {
  it("情境對話：沒有模式切換列，進階設定照留", async () => {
    const Panel = await load();
    render(
      <Panel
        mode="scenario_dialogue"
        contentType="SCENARIO_DIALOGUE"
        initialSettings={SETTINGS}
        applying={false}
        onApply={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /instantPractice.advancedSettings/ }),
    );
    expect(screen.queryByTestId("instant-practice-mode-row")).toBeNull();
    expect(screen.getByTestId("mode-settings").textContent).toBe(
      "scenario_dialogue",
    );
  });

  it("例句集：有多種模式，顯示切換列", async () => {
    const Panel = await load();
    render(
      <Panel
        mode="reading"
        contentType="EXAMPLE_SENTENCES"
        initialSettings={SETTINGS}
        applying={false}
        onApply={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /instantPractice.advancedSettings/ }),
    );
    expect(screen.getByTestId("instant-practice-mode-row")).toBeTruthy();
  });
});
