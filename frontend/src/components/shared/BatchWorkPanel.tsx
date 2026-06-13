/**
 * BatchWorkPanel — 桌面版左側批次工作區（共用元件）
 *
 * 組合 BatchPasteArea + BatchTranslateSettings + BatchTTSSettings，
 * 並提供確認/暫停按鈕與進度條。
 *
 * 各 panel 透過 props 傳入自己的解析邏輯（onConfirm）和額外 slot（children）。
 *
 * pasteLabel：覆寫貼上區標題文字（往下傳給 BatchPasteArea 的 label）。
 *   未傳則沿用 BatchPasteArea 預設（單字用字串）；例句集/朗讀應傳入句子相關文案。
 */
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { BatchPasteArea } from "./BatchPasteArea";
import { BatchTTSSettings, type TTSSettingsState } from "./BatchTTSSettings";
import {
  BatchTranslateSettings,
  type TranslationLanguageOption,
} from "./BatchTranslateSettings";

export interface BatchProgress {
  completedItems: number;
  totalItems: number;
  completedSteps: number;
  totalSteps: number;
}

export interface BatchWorkPanelProps {
  // --- Paste area ---
  text: string;
  onTextChange: (text: string) => void;
  maxItems: number;
  placeholder?: string;
  /** 貼上區標題文字（往下傳給 BatchPasteArea 的 label）；未傳則用其預設 */
  pasteLabel?: string;

  // --- Translate settings ---
  autoTranslate: boolean;
  onAutoTranslateChange: (enabled: boolean) => void;
  selectedLanguage: string;
  onLanguageChange: (language: string) => void;
  translationLanguages: TranslationLanguageOption[];
  customLanguage?: string;
  onCustomLanguageChange?: (value: string) => void;

  // --- TTS settings ---
  autoTTS: boolean;
  onAutoTTSChange: (enabled: boolean) => void;
  ttsSettings: TTSSettingsState;
  onTTSSettingsChange: (settings: TTSSettingsState) => void;

  // --- Actions ---
  onConfirm: () => void;
  onPause?: () => void;
  isBusy: boolean;
  progress?: BatchProgress | null;

  // --- Extra slot (e.g. AI Generate Examples card for VocabSet) ---
  children?: React.ReactNode;
}

export function BatchWorkPanel({
  text,
  onTextChange,
  maxItems,
  placeholder,
  pasteLabel,
  autoTranslate,
  onAutoTranslateChange,
  selectedLanguage,
  onLanguageChange,
  translationLanguages,
  customLanguage,
  onCustomLanguageChange,
  autoTTS,
  onAutoTTSChange,
  ttsSettings,
  onTTSSettingsChange,
  onConfirm,
  onPause,
  isBusy,
  progress,
  children,
}: BatchWorkPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="hidden md:flex md:w-[35%] flex-col border rounded-lg bg-gray-50 p-4 sticky top-0 self-start">
      <div className="space-y-3 flex-1 flex flex-col">
        {/* Batch Paste Area */}
        <BatchPasteArea
          text={text}
          onChange={onTextChange}
          maxItems={maxItems}
          label={pasteLabel}
          placeholder={placeholder}
          variant="inline"
        />

        {/* AI Generate Translation */}
        <BatchTranslateSettings
          enabled={autoTranslate}
          onEnabledChange={onAutoTranslateChange}
          selectedLanguage={selectedLanguage}
          onLanguageChange={onLanguageChange}
          languages={translationLanguages}
          customLanguage={customLanguage}
          onCustomLanguageChange={onCustomLanguageChange}
          variant="card"
        />

        {/* AI Generate TTS */}
        <BatchTTSSettings
          settings={ttsSettings}
          onChange={onTTSSettingsChange}
          enabled={autoTTS}
          onEnabledChange={onAutoTTSChange}
          variant="card"
        />

        {/* Extra content (e.g. AI Generate Examples) */}
        {children}

        {/* Confirm + Pause Button */}
        <div className="flex gap-2">
          <Button
            onClick={onConfirm}
            disabled={isBusy}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
          >
            {t("contentEditor.buttons.confirmPaste")}
          </Button>
          {isBusy && onPause && (
            <Button
              onClick={onPause}
              className="bg-red-500 hover:bg-red-600 text-white px-4"
            >
              {t("contentEditor.buttons.pause")}
            </Button>
          )}
        </div>

        {/* Progress Bar */}
        {isBusy && progress && (
          <div className="space-y-1">
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                style={{
                  width: `${progress.totalSteps > 0 ? (progress.completedSteps / progress.totalSteps) * 100 : 0}%`,
                }}
              />
            </div>
            <p className="text-xs text-gray-500 text-center">
              {Math.round(
                progress.totalSteps > 0
                  ? (progress.completedSteps / progress.totalSteps) * 100
                  : 0,
              )}
              % ({progress.completedItems}/{progress.totalItems})
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
