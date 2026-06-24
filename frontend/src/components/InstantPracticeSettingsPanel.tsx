/**
 * InstantPracticeSettingsPanel — 即刻練習「練習畫面」上的進階設定（#854）
 *
 * 只在即刻練習(is_instant_practice)的預覽/練習畫面顯示，放在頂部 sticky header 列右側
 * (返回鈕同一列)。點觸發鈕後**向下下拉浮層**(蓋在練習內容上、不推開題目卡片)，讓老師
 * 練習途中即時切換模式與進階設定；套用後整份練習從頭重新開始(由呼叫端重載+重掛畫面)。
 *
 * 重用既有單一真相源，不自寫設定邏輯：
 * - 模式 chip：`instantPracticeModesForContentType`(與 InstantPracticeDialog 啟動清單一致)。
 * - 進階設定本體：`<PracticeModeSettingsPanel>`(registry 驅動)。
 * - 變更耦合：`applySettingChange` 純函式；切模式套 `applyModeDefaults`。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SlidersHorizontal, ChevronDown, Loader2 } from "lucide-react";
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
  const [open, setOpen] = useState(false);
  const [draftMode, setDraftMode] = useState<PracticeMode>(mode);
  const [draftSettings, setDraftSettings] =
    useState<PracticeModeSettings>(initialSettings);

  const modes = instantPracticeModesForContentType(contentType);

  const handleOpen = () => {
    // 每次展開都以目前實際設定為初值，避免沿用上次未套用的草稿
    setDraftMode(mode);
    setDraftSettings(initialSettings);
    setOpen(true);
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

  return (
    <div className="relative">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => (open ? setOpen(false) : handleOpen())}
        className="px-2 sm:px-3 border-amber-300 text-amber-700 hover:bg-amber-50"
      >
        <SlidersHorizontal className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-1" />
        <span className="hidden sm:inline">
          {t("instantPractice.advancedSettings")}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 ml-1 transition-transform",
            open && "rotate-180",
          )}
        />
      </Button>

      {open && (
        <>
          {/* 點外面收起的背板（透明，蓋住整頁但不變暗） */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          {/* 向下下拉浮層：蓋在練習內容上，不推開題目 */}
          <div className="absolute right-0 top-full z-50 mt-2 flex max-h-[70vh] w-[min(92vw,360px)] flex-col overflow-hidden rounded-lg border border-amber-200 bg-white shadow-xl dark:bg-gray-900">
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
                onClick={() => setOpen(false)}
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
                  t("instantPractice.applyAndRestart")
                )}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
