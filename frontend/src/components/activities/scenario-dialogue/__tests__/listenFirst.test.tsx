/**
 * 先聽後看（#1158 E-2）：
 * - 瀏覽器能朗讀時題目文字預設隱藏；不能朗讀時照舊顯示；
 * - 按「開始對話」時在點擊當下解鎖朗讀（primeSpeech），第 1 題出現時自動唸題目。
 * - 朗讀實際出錯（error 事件，cancel／打斷不算）或沒有英文語音：該題英文自動打開（#1158 E2）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { scenarioChatSettings } from "../fromApi";
import { createPreviewScenarioAdapters } from "../studentAdapters";
import { ScenarioChatActivity } from "../ScenarioChatActivity";
import { createMockAdapters } from "@/pages/sample/scenarioDialogueSampleData";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

const original = Object.getOwnPropertyDescriptor(window, "speechSynthesis");

function installSpeech(voices: { lang: string }[] = [{ lang: "en-US" }]) {
  const synth = {
    speak: vi.fn(),
    cancel: vi.fn(),
    getVoices: vi.fn(() => voices),
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

  it("sample 頁 mock adapters 也有 primeSpeech", () => {
    expect(typeof createMockAdapters(648).primeSpeech).toBe("function");
  });
});

type Utt = {
  text: string;
  onerror?: (e: { error: string }) => void;
};

const QUESTION = "What did Amy eat?";

/** 開始對話，等第 1 題的朗讀送出，回傳那個 utterance */
async function startAndGetQuestionUtterance(
  synth: ReturnType<typeof installSpeech>,
) {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo =
    vi.fn() as unknown as typeof Element.prototype.scrollTo;
  render(
    <ScenarioChatActivity
      context={{ title: "t", images: [] }}
      items={[{ id: 1, text: QUESTION, keywords: [], images: [] }]}
      settings={scenarioChatSettings({
        showTranslation: false,
        isPreviewMode: false,
      })}
      adapters={createPreviewScenarioAdapters("preview")}
      onSubmit={() => {}}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "scenarioDialogue.chat.start" }),
  );
  let utt: Utt | undefined;
  await waitFor(() => {
    utt = synth.speak.mock.calls
      .map((c) => c[0] as Utt)
      .find((u) => u.text === QUESTION);
    expect(utt).toBeDefined();
  });
  return utt!;
}

describe("朗讀失敗時自動打開英文（#1158 E2）", () => {
  it("朗讀出錯（not-allowed 等）→ 該題英文自動顯示", async () => {
    const synth = installSpeech();
    const utt = await startAndGetQuestionUtterance(synth);
    expect(screen.queryByText(QUESTION)).toBeNull();
    act(() => utt.onerror?.({ error: "not-allowed" }));
    expect(await screen.findByText(QUESTION)).toBeInTheDocument();
  });

  it("被 cancel／打斷（interrupted、canceled）不算失敗，文字維持隱藏", async () => {
    const synth = installSpeech();
    const utt = await startAndGetQuestionUtterance(synth);
    act(() => utt.onerror?.({ error: "interrupted" }));
    act(() => utt.onerror?.({ error: "canceled" }));
    expect(screen.queryByText(QUESTION)).toBeNull();
  });

  it("沒有英文語音 → 該題英文自動顯示", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const synth = installSpeech([{ lang: "zh-TW" }]);
    await startAndGetQuestionUtterance(synth);
    expect(await screen.findByText(QUESTION)).toBeInTheDocument();
  });
});
