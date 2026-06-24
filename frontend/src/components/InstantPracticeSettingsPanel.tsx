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
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SlidersHorizontal, ChevronDown, Loader2, Brain } from "lucide-react";
import {
  applyModeDefaults,
  getModeConfig,
  instantPracticeModesForContentType,
  type PracticeMode,
} from "@/lib/practiceMode";
import PracticeModeSettingsPanel from "@/components/assignment/PracticeModeSettingsPanel";
import type { PracticeModeSettings } from "@/components/assignment/practiceModeSettings";

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
  const activeChipRef = useRef<HTMLButtonElement>(null);

  // 展開時把目前選中的模式 chip 捲到可見位置（單行橫向捲動，避免它落在捲動區外看不到）
  useEffect(() => {
    if (open) {
      activeChipRef.current?.scrollIntoView({
        inline: "center",
        block: "nearest",
      });
    }
  }, [open, draftMode]);

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
        onClick={() => (open ? setOpen(false) : handleOpen())}
        className="btn-amber-shine px-2 sm:px-3 bg-amber-500 text-white hover:bg-amber-600"
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
                <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                  {modes.map((m) => {
                    const cfg = getModeConfig(m);
                    if (!cfg) return null;
                    const ModeIcon = cfg.icon;
                    const active = m === draftMode;
                    return (
                      <button
                        type="button"
                        key={m}
                        ref={active ? activeChipRef : undefined}
                        onClick={() => pickMode(m)}
                        className={cn(
                          "shrink-0 flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-all",
                          active
                            ? cn(cfg.chipSelectedClass, "shadow-sm font-semibold")
                            : "border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50",
                        )}
                      >
                        <ModeIcon className="h-4 w-4 shrink-0" />
                        <span>{t(cfg.chipTitleKey ?? cfg.labelKey)}</span>
                        {cfg.isMemoryBased && (
                          <Brain
                            className="h-3.5 w-3.5 shrink-0 opacity-70"
                            aria-label="採用艾賓浩斯記憶曲線"
                          />
                        )}
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
