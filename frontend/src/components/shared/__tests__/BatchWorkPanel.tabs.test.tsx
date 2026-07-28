import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BatchWorkPanel } from "../BatchWorkPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
    i18n: { language: "zh-TW" },
  }),
}));

const baseProps = {
  text: "",
  onTextChange: vi.fn(),
  maxItems: 30,
  autoTranslate: false,
  onAutoTranslateChange: vi.fn(),
  selectedLanguage: "",
  onLanguageChange: vi.fn(),
  translationLanguages: [],
  autoTTS: false,
  onAutoTTSChange: vi.fn(),
  ttsSettings: { accent: "Random", gender: "Random", speed: "Normal" },
  onTTSSettingsChange: vi.fn(),
  onConfirm: vi.fn(),
  isBusy: false,
};

describe("BatchWorkPanel tabs (issue #891)", () => {
  it("hides tabs and shows confirm button when no imageTab", () => {
    render(<BatchWorkPanel {...baseProps} />);
    expect(screen.queryByText(/圖片 \/ PDF/)).not.toBeInTheDocument();
    expect(
      screen.getByText("contentEditor.buttons.confirmPaste"),
    ).toBeInTheDocument();
  });

  it("shows tabs when imageTab provided; switching hides the confirm button", () => {
    render(
      <BatchWorkPanel
        {...baseProps}
        imageTab={<div data-testid="image-tab-content">image</div>}
      />,
    );
    // 預設在文字 tab：確認按鈕在、圖片內容不在
    expect(screen.getByText(/貼上文字/)).toBeInTheDocument();
    expect(screen.getByText(/圖片 \/ PDF/)).toBeInTheDocument();
    expect(
      screen.getByText("contentEditor.buttons.confirmPaste"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("image-tab-content")).not.toBeInTheDocument();

    // 切到圖片 tab：圖片內容出現、確認按鈕消失
    fireEvent.click(screen.getByText(/圖片 \/ PDF/));
    expect(screen.getByTestId("image-tab-content")).toBeInTheDocument();
    expect(
      screen.queryByText("contentEditor.buttons.confirmPaste"),
    ).not.toBeInTheDocument();

    // 切回文字 tab：確認按鈕回來
    fireEvent.click(screen.getByText(/貼上文字/));
    expect(
      screen.getByText("contentEditor.buttons.confirmPaste"),
    ).toBeInTheDocument();
  });
});
