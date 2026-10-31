/**
 * 即刻練習對話框的模式清單（#1158 E-4）：
 * - 情境對話內容只有「情境對話」一種模式（受情境對話派發開關控制）；
 * - 開關關閉時沒有可用模式：「開始練習」停用並寫明原因；
 * - 例句集／單字集的清單維持原本的捷徑，不會混進情境對話。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

const post = vi.fn();
vi.mock("@/lib/api", () => ({
  apiClient: { post: (...a: unknown[]) => post(...a) },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

async function load(dispatchOn: boolean) {
  vi.resetModules();
  vi.doMock("@/config/featureFlags", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/config/featureFlags")>()),
    ENABLE_SCENARIO_DIALOGUE_DISPATCH: dispatchOn,
  }));
  return import("../InstantPracticeDialog");
}

beforeEach(() => {
  post.mockReset();
});
afterEach(() => {
  vi.doUnmock("@/config/featureFlags");
});

describe("instantPracticeDialogModes", () => {
  it("情境對話內容：開關開＝只有情境對話；開關關＝沒有", async () => {
    const on = await load(true);
    expect(
      on.instantPracticeDialogModes("SCENARIO_DIALOGUE").map((m) => m.value),
    ).toEqual(["scenario_dialogue"]);
    const off = await load(false);
    expect(off.instantPracticeDialogModes("SCENARIO_DIALOGUE")).toEqual([]);
  });

  it("例句集／單字集維持原本的捷徑，不混進情境對話", async () => {
    const { instantPracticeDialogModes } = await load(true);
    expect(
      instantPracticeDialogModes("EXAMPLE_SENTENCES").map((m) => m.value),
    ).toEqual(["reading", "rearrangement"]);
    expect(
      instantPracticeDialogModes("VOCABULARY_SET").map((m) => m.value),
    ).toEqual(["word_reading", "word_selection", "tug_of_war"]);
    expect(
      instantPracticeDialogModes(undefined).map((m) => m.value),
    ).not.toContain("scenario_dialogue");
  });
});

describe("InstantPracticeDialog", () => {
  const baseProps = {
    open: true,
    onClose: vi.fn(),
    contentId: 7,
    contentTitle: "週末去夜市",
    contentType: "SCENARIO_DIALOGUE",
    onStartPractice: vi.fn(),
  };

  it("情境對話：以情境對話模式建立即刻練習", async () => {
    const { InstantPracticeDialog } = await load(true);
    post.mockResolvedValue({ success: true, assignment_id: 99 });
    const onStartPractice = vi.fn();
    render(
      <InstantPracticeDialog
        {...baseProps}
        onStartPractice={onStartPractice}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: /practiceMode.scenario_dialogue.label/,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(
      screen.getByRole("button", { name: /instantPractice.start/ }),
    );
    await waitFor(() => expect(onStartPractice).toHaveBeenCalledWith(99));
    expect(post).toHaveBeenCalledWith("/api/teachers/instant-practice/create", {
      content_id: 7,
      practice_mode: "scenario_dialogue",
    });
  });

  it("沒有可用模式：開始練習停用並說明原因", async () => {
    const { InstantPracticeDialog } = await load(false);
    render(<InstantPracticeDialog {...baseProps} />);
    const start = screen.getByRole("button", { name: /instantPractice.start/ });
    expect(start).toBeDisabled();
    expect(start).toHaveAttribute("title", "instantPractice.noModes");
    expect(screen.getByRole("note").textContent).toBe(
      "instantPractice.noModes",
    );
    fireEvent.click(start);
    expect(post).not.toHaveBeenCalled();
  });
});
