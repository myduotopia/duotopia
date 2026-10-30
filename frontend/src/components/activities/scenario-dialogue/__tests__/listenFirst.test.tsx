/**
 * 先聽後看（#1158 E-2）：
 * - 瀏覽器能朗讀時題目文字預設隱藏；不能朗讀時照舊顯示；
 * - 按「開始對話」時在點擊當下解鎖朗讀（primeSpeech），第 1 題出現時自動唸題目。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { scenarioChatSettings } from "../fromApi";
import { createPreviewScenarioAdapters } from "../studentAdapters";
import { ScenarioChatActivity } from "../ScenarioChatActivity";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

const original = Object.getOwnPropertyDescriptor(window, "speechSynthesis");

function installSpeech() {
  const synth = {
    speak: vi.fn(),
    cancel: vi.fn(),
    getVoices: vi.fn(() => [{ lang: "en-US" }]),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, "speechSynthesis", {
    value: synth,
    configurable: true,
  });
  (
    globalThis as unknown as { SpeechSynthesisUtterance: unknown }
  ).SpeechSynthesisUtterance = class {
    text: string;
    volume = 1;
    lang = "";
    rate = 1;
    pitch = 1;
    voice: unknown = null;
    constructor(text: string) {
      this.text = text;
    }
  };
  return synth;
}

afterEach(() => {
  if (original) Object.defineProperty(window, "speechSynthesis", original);
  else
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
});

describe("先聽後看", () => {
  it("沒有 speechSynthesis：文字照舊顯示", () => {
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    expect(
      scenarioChatSettings({ showTranslation: true, isPreviewMode: false })
        .textDefaultHidden,
    ).toBe(false);
  });

  it("能朗讀：文字預設隱藏", () => {
    installSpeech();
    expect(
      scenarioChatSettings({ showTranslation: true, isPreviewMode: false })
        .textDefaultHidden,
    ).toBe(true);
  });

  it("按「開始對話」當下解鎖朗讀，第 1 題出現時自動唸、文字先藏", async () => {
    const synth = installSpeech();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.scrollTo =
      vi.fn() as unknown as typeof Element.prototype.scrollTo;
    const adapters = createPreviewScenarioAdapters("preview");
    render(
      <ScenarioChatActivity
        context={{ title: "t", images: [] }}
        items={[{ id: 1, text: "What did Amy eat?", keywords: [], images: [] }]}
        settings={scenarioChatSettings({
          showTranslation: false,
          isPreviewMode: false,
        })}
        adapters={adapters}
        onSubmit={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "scenarioDialogue.chat.start" }),
    );
    // 點擊當下就先 speak 一次（空字串、音量 0）
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(synth.speak.mock.calls[0][0]).toMatchObject({ text: "", volume: 0 });
    // 「輸入中…」之後第 1 題出現並自動唸題目
    await waitFor(() =>
      expect(
        synth.speak.mock.calls.some(
          (c) => (c[0] as { text: string }).text === "What did Amy eat?",
        ),
      ).toBe(true),
    );
    // 文字先藏起來
    expect(screen.queryByText("What did Amy eat?")).toBeNull();
  });
});
