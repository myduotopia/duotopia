/**
 * InstantPracticeSettingsPanel — 即刻練習「練習畫面」上的可收合進階設定面板（#854）
 *
 * 只在即刻練習（is_instant_practice）的預覽/練習畫面顯示。讓老師在練習途中即時切換
 * 練習模式與進階設定，套用後整份練習從頭重新開始（由呼叫端重載資料 + 重掛畫面）。
 *
 * 重用既有單一真相源，不自寫設定邏輯：
 * - 模式 chip：`instantPracticeModesForContentType`（與 InstantPracticeDialog 啟動清單一致）。
 * - 進階設定本體：`<PracticeModeSettingsPanel>`（registry 驅動）。
 * - 變更耦合：`applySettingChange` 純函式（互斥 / segmented patch）；切模式套 `applyModeDefaults`。
 *
 * 收合行為：預設收起（不擋練習），點 ⚡ 進階設定展開；套用或關閉後收起。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SlidersHorizontal, ChevronDown, X, Loader2, Zap } from "lucide-react";
import {
  applyModeDefaults,
  instantPracticeModesForContentType,
  type PracticeMode,
} from "@/lib/practiceMode";
import PracticeModeSettingsPanel from "@/components/assignment/PracticeModeSettingsPanel";
import type { PracticeModeSettings } from "@/components/assignment/practiceModeSettings";

/** 模式 chip 顯示文字（沿用 InstantPracticeDialog 既有 i18n key，保持與啟動清單一致）。 */
const MODE_LABEL_KEY: Record<string, string> = {
  reading: "instantPractice.modes.reading.label",
  rearrangement: "instantPractice.modes.rearrangement.label",
  word_reading: "instantPractice.modes.wordReading.label",
  word_selection: "instantPractice.modes.wordSelection.label",
  tug_of_war: "instantPractice.modes.tugOfWar.label",
};

interface InstantPracticeSettingsPanelProps {
  mode: PracticeMode;
  contentType: string;
  initialSettings: PracticeModeSettings;
  applying: boolean;
  onApply: (mode: PracticeMode, settings: PracticeModeSettings) => void;
}

export default function InstantPracticeSettingsPanel({
  mode,
  contentType,
  initialSettings,
  applying,
  onApply,
}: InstantPracticeSettingsPanelProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [draftMode, setDraftMode] = useState<PracticeMode>(mode);
  const [draftSettings, setDraftSettings] =
    useState<PracticeModeSettings>(initialSettings);

  const modes = instantPracticeModesForContentType(contentType);

  const open = () => {
    // 每次展開都以目前實際設定為初值，避免沿用上次未套用的草稿
    setDraftMode(mode);
    setDraftSettings(initialSettings);
    setExpanded(true);
  };

  const pickMode = (m: PracticeMode) => {
    if (m === draftMode) return;
    // 套用該模式的預設值（時間、顯示等），與派發 chip 行為一致
    const { practice_mode, ...defaults } = applyModeDefaults(m);
    setDraftMode(practice_mode);
    setDraftSettings((s) => ({
      ...s,
      ...(defaults as Partial<PracticeModeSettings>),
    }));
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={open}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-amber-600"
      >
        <SlidersHorizontal className="h-4 w-4" />
        {t("instantPractice.advancedSettings")}
      </button>
    );
  }

  return (
    <Card className="fixed bottom-4 right-4 z-50 flex max-h-[80vh] w-[min(92vw,360px)] flex-col overflow-hidden border-amber-200 p-0 shadow-xl">
      <div className="flex items-center justify-between border-b border-gray-100 bg-amber-50 px-4 py-3 dark:bg-amber-950/20">
        <span className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
          <Zap className="h-4 w-4 text-amber-500" />
          {t("instantPractice.advancedSettings")}
        </span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="rounded p-1 text-gray-400 hover:text-gray-600"
          aria-label={t("common.close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <div className="space-y-1.5">
          <span className="text-xs text-gray-600">
            {t("instantPractice.modeLabel")}
          </span>
          <div className="flex flex-wrap gap-2">
            {modes.map((m) => {
              const active = m === draftMode;
              return (
                <button
                  type="button"
                  key={m}
                  onClick={() => pickMode(m)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs",
                    active
                      ? "border-amber-500 bg-amber-100 text-amber-800 dark:bg-amber-900/30"
                      : "border-gray-200 text-gray-600 hover:border-gray-300",
                  )}
                >
                  {t(MODE_LABEL_KEY[m] ?? m)}
                </button>
              );
            })}
          </div>
        </div>

        <PracticeModeSettingsPanel
          mode={draftMode}
          value={draftSettings}
          onChange={setDraftSettings}
        />
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-4 py-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setExpanded(false)}
          disabled={applying}
        >
          {t("common.cancel")}
        </Button>
        <Button
          size="sm"
          onClick={() => onApply(draftMode, draftSettings)}
          disabled={applying}
          className="bg-amber-500 text-white hover:bg-amber-600"
        >
          {applying ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("instantPractice.applying")}
            </>
          ) : (
            <>
              <ChevronDown className="mr-2 h-4 w-4" />
              {t("instantPractice.applyAndRestart")}
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}
