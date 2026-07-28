/**
 * BatchTranslateSettings — 翻譯語言設定（共用元件）
 *
 * 支援兩種 variant：
 * - "card"：帶 checkbox 開關 + 摺疊面板（用於左側面板）
 * - "section"：純設定區塊（用於 dialog）
 */
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";

export interface TranslationLanguageOption {
  value: string;
  label: string;
  code: string;
}

export interface BatchTranslateSettingsProps {
  /** Whether auto-translate is enabled */
  enabled: boolean;
  /** Callback when enabled state toggles */
  onEnabledChange: (enabled: boolean) => void;
  /** Currently selected language value */
  selectedLanguage: string;
  /** Callback when language changes */
  onLanguageChange: (language: string) => void;
  /** Available language options */
  languages: TranslationLanguageOption[];
  /** Custom language input value (when "other" is selected) */
  customLanguage?: string;
  /** Callback when custom language changes */
  onCustomLanguageChange?: (value: string) => void;
  /** Whether to show custom language input for "other" */
  supportsCustomLanguage?: boolean;
  /** "card" = collapsible card with checkbox, "section" = flat inline */
  variant?: "card" | "section";
}

export function BatchTranslateSettings({
  enabled,
  onEnabledChange,
  selectedLanguage,
  onLanguageChange,
  languages,
  customLanguage = "",
  onCustomLanguageChange,
  supportsCustomLanguage = true,
  variant = "card",
}: BatchTranslateSettingsProps) {
  const { t } = useTranslation();

  const languageSelector = (
    <>
      <label className="text-xs text-gray-600 mb-1 block">
        {t("contentEditor.labels.translationLanguage")}
      </label>
      <select
        value={selectedLanguage}
        onChange={(e) => onLanguageChange(e.target.value)}
        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      >
        <option value="">{t("contentEditor.labels.selectLanguage")}</option>
        {languages.map((lang) => (
          <option key={lang.value} value={lang.value}>
            {lang.value === "other"
              ? t("contentEditor.labels.otherLanguage")
              : lang.label}
          </option>
        ))}
      </select>
      {supportsCustomLanguage && selectedLanguage === "other" && (
        <input
          type="text"
          value={customLanguage}
          onChange={(e) => onCustomLanguageChange?.(e.target.value)}
          placeholder={t("contentEditor.labels.enterLanguage")}
          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 mt-2"
        />
      )}
    </>
  );

  if (variant === "section") {
    return <div className="space-y-2">{languageSelector}</div>;
  }

  // card variant（緊湊：啟用時語言下拉內嵌標題行右側、收窄；停用只留一行）
  const showCustomBelow =
    enabled && supportsCustomLanguage && selectedLanguage === "other";
  return (
    <div className="bg-green-50/60 rounded-lg border border-green-200">
      <div className="flex items-center gap-2 p-2.5">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <Globe className="h-4 w-4 shrink-0" />
        <span className="text-sm font-semibold text-gray-800 whitespace-nowrap">
          {t("contentEditor.labels.aiGenerateTranslation")}
        </span>
        {enabled && (
          <select
            value={selectedLanguage}
            onChange={(e) => onLanguageChange(e.target.value)}
            className="ml-auto max-w-[140px] px-2 py-1 border border-gray-300 rounded text-sm bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="">{t("contentEditor.labels.selectLanguage")}</option>
            {languages.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.value === "other"
                  ? t("contentEditor.labels.otherLanguage")
                  : lang.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {showCustomBelow && (
        <div className="px-2.5 pb-2.5">
          <input
            type="text"
            value={customLanguage}
            onChange={(e) => onCustomLanguageChange?.(e.target.value)}
            placeholder={t("contentEditor.labels.enterLanguage")}
            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}
    </div>
  );
}
