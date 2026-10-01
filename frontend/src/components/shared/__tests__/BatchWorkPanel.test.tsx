/**
 * BatchWorkPanel 測試（issue #1061）：hideTextTab / showTranslate 兩個新 prop，
 * 以及預設行為不變（既有單字集／例句集呼叫端不受影響）。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { BatchWorkPanel } from "../BatchWorkPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      typeof opts?.defaultValue === "string" ? opts.defaultValue : key,
  }),
}));

const ttsProps = {
  autoTTS: false,
  onAutoTTSChange: vi.fn(),
  ttsSettings: { accent: "Random", gender: "Random", speed: "Normal x1" },
  onTTSSettingsChange: vi.fn(),
  onConfirm: vi.fn(),
  isBusy: false,
};

const translateProps = {
  autoTranslate: false,
  onAutoTranslateChange: vi.fn(),
  selectedLanguage: "zh-TW",
  onLanguageChange: vi.fn(),
  translationLanguages: [{ value: "zh-TW", label: "中文", code: "zh-TW" }],
};

describe("BatchWorkPanel", () => {
  it("預設：有 imageTab 時顯示兩個 tab、貼上框、翻譯卡、TTS 卡、確認鍵", () => {
    render(
      <BatchWorkPanel
        text=""
        onTextChange={vi.fn()}
        maxItems={10}
        {...translateProps}
        {...ttsProps}
        imageTab={<div data-testid="image-tab" />}
      />,
    );
    expect(screen.getByText("貼上文字")).toBeTruthy();
    expect(screen.getByText("圖片 / PDF")).toBeTruthy();
    expect(screen.queryByTestId("image-tab")).toBeNull(); // 預設在文字 tab
    expect(screen.getByText("contentEditor.buttons.confirmPaste")).toBeTruthy();
    expect(screen.getByText("contentEditor.labels.aiGenerateTTS")).toBeTruthy();
  });

  it("hideTextTab：沒有 tab 列與確認鍵，直接顯示 imageTab；showTranslate=false 不渲染翻譯卡", () => {
    render(
      <BatchWorkPanel
        hideTextTab
        showTranslate={false}
        {...ttsProps}
        imageTab={<div data-testid="image-tab" />}
      >
        <div data-testid="extra-child" />
      </BatchWorkPanel>,
    );
    expect(screen.queryByText("貼上文字")).toBeNull();
    expect(screen.queryByText("圖片 / PDF")).toBeNull();
    expect(screen.getByTestId("image-tab")).toBeTruthy();
    expect(screen.queryByText("contentEditor.buttons.confirmPaste")).toBeNull();
    expect(
      screen.queryByText("contentEditor.labels.aiGenerateTranslation"),
    ).toBeNull();
    // TTS 卡與 children 仍在
    expect(screen.getByText("contentEditor.labels.aiGenerateTTS")).toBeTruthy();
    expect(screen.getByTestId("extra-child")).toBeTruthy();
  });
});
