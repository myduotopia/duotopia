/**
 * RevealCapsules — 情境對話題目氣泡的「先聽後看」小膠囊列（#1133）：`[🔊] [Aa 英] [中]`。
 *
 * - 🔊 只放圖示，播放（重播）題目。
 * - 膠囊沒有外框（#1158 E-2 A 方案）：關＝白底灰字（`TOGGLE_OFF_CLASS`），開＝淺藍底藍字
 *   （`TOGGLE_ON_CLASS`）。不用藍底主按鈕 —— 它不是這個畫面的「下一步」（#1158 E4，
 *   REVIEW.md 按鈕層級 1）；情境卡的「作答要求／情境」切換鈕也套同一樣式；
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

/**
 * 切換鈕樣式（疊在 Button variant="ghost" 上，沒有外框）：開＝淺藍底藍字、關＝白底灰字。
 * 情境對話裡的切換鈕（🔊／英／中、作答要求／情境）共用這一份（#1158 E4、E-2 A 方案）。
 */
export const TOGGLE_ON_CLASS =
  "bg-blue-100 text-blue-700 hover:bg-blue-100 hover:text-blue-800";
export const TOGGLE_OFF_CLASS =
  "bg-white text-gray-700 hover:bg-gray-50 hover:text-gray-900";

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
        variant="ghost"
        className={cn(pill, "w-11 px-0", TOGGLE_OFF_CLASS)}
        onClick={onPlay}
        aria-label={t("scenarioDialogue.chat.playQuestion")}
      >
        <Volume2 className="h-5 w-5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        className={cn(pill, enOn ? TOGGLE_ON_CLASS : TOGGLE_OFF_CLASS)}
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
          variant="ghost"
          className={cn(pill, zhOn ? TOGGLE_ON_CLASS : TOGGLE_OFF_CLASS)}
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
