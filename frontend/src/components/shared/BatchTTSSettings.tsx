/**
 * BatchTTSSettings — TTS 語音設定（accent / gender / speed）
 *
 * 可獨立使用，也可嵌入 BatchWorkPanel。
 * 支援兩種 variant：
 * - "card"：帶 checkbox 開關 + 摺疊面板（用於左側面板）
 * - "section"：純設定區塊，不帶開關（用於 dialog 內已有外部 checkbox 的場景）
 */
import { useTranslation } from "react-i18next";
import { Volume2 } from "lucide-react";
import { TTS_ACCENTS, TTS_GENDERS, TTS_SPEEDS } from "@/utils/ttsVoiceResolver";

export interface TTSSettingsState {
  accent: string;
  gender: string;
  speed: string;
}

export interface BatchTTSSettingsProps {
  /** Current TTS settings */
  settings: TTSSettingsState;
  /** Callback when any setting changes */
  onChange: (settings: TTSSettingsState) => void;
  /** Whether TTS is enabled (controls checkbox state in card variant) */
  enabled?: boolean;
  /** Callback when enabled state toggles */
  onEnabledChange?: (enabled: boolean) => void;
  /** "card" = collapsible card with checkbox, "section" = flat settings grid */
  variant?: "card" | "section";
}

export function BatchTTSSettings({
  settings,
  onChange,
  enabled = true,
  onEnabledChange,
  variant = "card",
}: BatchTTSSettingsProps) {
  const { t } = useTranslation();

  const accents = TTS_ACCENTS as readonly string[];
  const genders = TTS_GENDERS as readonly string[];
  const speeds = TTS_SPEEDS as readonly string[];

  const settingsGrid = (
    <div
      className={
        variant === "card" ? "grid grid-cols-1 gap-2" : "grid grid-cols-3 gap-4"
      }
    >
      <div>
        <label className="text-xs font-medium text-gray-600 mb-1 block">
          {t("contentEditor.ttsSettings.accent")}
        </label>
        <select
          value={settings.accent}
          onChange={(e) => onChange({ ...settings, accent: e.target.value })}
          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        >
          {accents.map((accent) => (
            <option key={accent} value={accent}>
              {accent}
            </option>
          ))}
        </select>
      </div>
      <div className={variant === "card" ? "grid grid-cols-2 gap-2" : ""}>
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">
            {t("contentEditor.ttsSettings.gender")}
          </label>
          <select
            value={settings.gender}
            onChange={(e) => onChange({ ...settings, gender: e.target.value })}
            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {genders.map((gender) => (
              <option key={gender} value={gender}>
                {gender}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">
            {t("contentEditor.ttsSettings.speed")}
          </label>
          <select
            value={settings.speed}
            onChange={(e) => onChange({ ...settings, speed: e.target.value })}
            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {speeds.map((speed) => (
              <option key={speed} value={speed}>
                {speed}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );

  if (variant === "section") {
    return (
      <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
        <label className="text-sm font-semibold text-gray-800 mb-3 block">
          {t("contentEditor.ttsSettings.title")}
        </label>
        {settingsGrid}
      </div>
    );
  }

  // card variant（緊湊：啟用時口音/性別/語速 3 欄窄選單一行；停用只留一行）
  const compactSelect =
    "w-full px-1.5 py-1 border border-gray-300 rounded text-xs bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500";
  const compactLabel = "text-[11px] text-gray-500 mb-0.5 block";
  return (
    <div className="bg-yellow-50/60 rounded-lg border border-yellow-200">
      <div className="flex items-center gap-2 p-2.5">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange?.(e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <Volume2 className="h-4 w-4 shrink-0" />
        <span className="text-sm font-semibold text-gray-800">
          {t("contentEditor.labels.aiGenerateTTS")}
        </span>
      </div>
      {enabled && (
        <div className="grid grid-cols-3 gap-1.5 px-2.5 pb-2.5">
          <div>
            <label className={compactLabel}>
              {t("contentEditor.ttsSettings.accent")}
            </label>
            <select
              value={settings.accent}
              onChange={(e) =>
                onChange({ ...settings, accent: e.target.value })
              }
              className={compactSelect}
            >
              {accents.map((accent) => (
                <option key={accent} value={accent}>
                  {accent}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={compactLabel}>
              {t("contentEditor.ttsSettings.gender")}
            </label>
            <select
              value={settings.gender}
              onChange={(e) =>
                onChange({ ...settings, gender: e.target.value })
              }
              className={compactSelect}
            >
              {genders.map((gender) => (
                <option key={gender} value={gender}>
                  {gender}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={compactLabel}>
              {t("contentEditor.ttsSettings.speed")}
            </label>
            <select
              value={settings.speed}
              onChange={(e) => onChange({ ...settings, speed: e.target.value })}
              className={compactSelect}
            >
              {speeds.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
