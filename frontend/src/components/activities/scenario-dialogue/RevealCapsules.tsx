/**
 * RevealCapsules — 情境對話題目氣泡的「先聽後看」小膠囊列（#1133）：`[🔊] [Aa 英] [中]`。
 *
 * - 🔊 只放圖示，播放（重播）題目。
 * - 英／翻譯是切換鈕：按下＝藍色實心（顯示中），再按＝白底灰框（收起）；
 *   `aria-pressed`，`aria-label` 寫完整「顯示／隱藏英文（中文）」。
 * - 字：≤ 480px 用短字「英」「中」，更寬用「看英文」「看中文」（字串取自頁面 i18n）。
 * - 翻譯鈕三個條件都成立才渲染（不是反灰，所以沒有停用說明）：
 *   老師開翻譯＋翻譯語言＝學生介面語言（showTranslation，由外層算好）＋本題英文已打開（enOn）。
 *   英文介面因此永遠沒有翻譯鈕。收起英文時翻譯由外層一起收。
 */

import { Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  enOn: boolean;
  zhOn: boolean;
  /** 本題可以看翻譯（老師開翻譯＋翻譯語言＝學生介面語言＋有翻譯文字） */
  showTranslation: boolean;
  onPlay: () => void;
  onToggleEn: () => void;
  onToggleZh: () => void;
}

export function RevealCapsules({
  enOn,
  zhOn,
  showTranslation,
  onPlay,
  onToggleEn,
  onToggleZh,
}: Props) {
  const { t } = useTranslation();
  const pill = "h-11 rounded-full px-3";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        className={cn(pill, "w-11 px-0")}
        onClick={onPlay}
        aria-label={t("scenarioDialogue.chat.playQuestion")}
      >
        <Volume2 className="h-5 w-5" />
      </Button>
      <Button
        type="button"
        variant={enOn ? "default" : "outline"}
        className={pill}
        onClick={onToggleEn}
        aria-pressed={enOn}
        aria-label={
          enOn
            ? t("scenarioDialogue.chat.hideEnglish")
            : t("scenarioDialogue.chat.showEnglishFull")
        }
      >
        <span className="mr-1 text-xs font-semibold" aria-hidden>
          Aa
        </span>
        <span className="max-[480px]:hidden">
          {t("scenarioDialogue.chat.showEnglish")}
        </span>
        <span className="hidden max-[480px]:inline">
          {t("scenarioDialogue.chat.englishShort")}
        </span>
      </Button>
      {showTranslation && enOn && (
        <Button
          type="button"
          variant={zhOn ? "default" : "outline"}
          className={pill}
          onClick={onToggleZh}
          aria-pressed={zhOn}
          aria-label={
            zhOn
              ? t("scenarioDialogue.chat.hideChinese")
              : t("scenarioDialogue.chat.showChineseFull")
          }
        >
          <span className="max-[480px]:hidden">
            {t("scenarioDialogue.chat.showChinese")}
          </span>
          <span className="hidden max-[480px]:inline">
            {t("scenarioDialogue.chat.chineseShort")}
          </span>
        </Button>
      )}
    </div>
  );
}
