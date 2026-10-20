/**
 * RevealCapsules — 情境對話 AI 訊息上的「先聽後看」小膠囊列（#1133）：`[🔊] [Aa 英] [中]`。
 *
 * - 🔊 只放圖示，播放（重播）這則訊息。
 * - 英／中是切換鈕：按下＝藍色實心（顯示中），再按＝白底灰框（收起）；
 *   `aria-pressed`，`aria-label` 寫完整「顯示／隱藏英文（中文）」。
 * - 字：≤ 480px 用短字「英」「中」，更寬用「看英文」「看中文」。
 * - 收起英文時中文由外層一起收；「中」只在英文打開後可按。手機沒有 hover，
 *   所以「中」不用 disabled 屬性，點了跳一行小提示說明原因。
 * - showZh＝老師有開翻譯才顯示「中」。
 * 題目氣泡（QuestionBubble）與 AI 開場複述（OpeningBubble）共用。
 */

import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  enOn: boolean;
  zhOn: boolean;
  showZh: boolean;
  /** 🔊 的 aria-label；預設「播放題目」 */
  playLabel?: string;
  onPlay: () => void;
  onToggleEn: () => void;
  onToggleZh: () => void;
}

const HINT_MS = 2500;

export function RevealCapsules({
  enOn,
  zhOn,
  showZh,
  playLabel,
  onPlay,
  onToggleEn,
  onToggleZh,
}: Props) {
  const { t } = useTranslation();
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(false), HINT_MS);
    return () => clearTimeout(id);
  }, [hint]);

  const pill = "h-11 rounded-full px-3";
  const zhLocked = !enOn;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className={cn(pill, "w-11 px-0")}
          onClick={onPlay}
          aria-label={playLabel ?? t("scenarioDialogue.chat.playQuestion")}
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
        {showZh && (
          <Button
            type="button"
            variant={zhOn ? "default" : "outline"}
            className={cn(pill, zhLocked && "opacity-50")}
            onClick={() => (zhLocked ? setHint(true) : onToggleZh())}
            aria-pressed={zhOn}
            aria-disabled={zhLocked}
            aria-label={
              zhLocked
                ? t("scenarioDialogue.chat.chineseNeedsEnglish")
                : zhOn
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
      {hint && (
        <p className="text-xs text-gray-500" role="status">
          {t("scenarioDialogue.chat.chineseNeedsEnglish")}
        </p>
      )}
    </div>
  );
}
