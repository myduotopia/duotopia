/**
 * FeedbackBubble — 情境對話中 AI 對每次回答的建議氣泡（#1133）。
 *
 * 配色用標準色：需改進 amber、很棒 green。內容＝評語＋（有的話）建議說法文字與
 * 「聽建議說法」朗讀鈕。只有目前作答題的最新一則建議會帶操作列：
 * 「再試一次」（主按鈕）＋「下一題」（次要）；次數用完時兩顆都不出現，改小字提示，
 * 由狀態機停一下自動進下一題（避免使用者同時按下造成連跳兩題）。
 * 分數不在這裡顯示 —— 學生作答時只看建議。
 */

import { CheckCircle2, Sparkles, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AiRow } from "./TypingIndicator";
import type { ScenarioFeedback } from "./types";

interface Props {
  feedback: ScenarioFeedback;
  onSpeak: (text: string) => void;
  showActions: boolean;
  exhausted: boolean;
  maxAttempts: number;
  /** 補答模式時「下一題」改成「完成補答」 */
  nextLabel: string;
  onRetry: () => void;
  onNext: () => void;
}

export function FeedbackBubble({
  feedback,
  onSpeak,
  showActions,
  exhausted,
  maxAttempts,
  nextLabel,
  onRetry,
  onNext,
}: Props) {
  const { t } = useTranslation();
  const great = feedback.verdict === "great";
  const Icon = great ? CheckCircle2 : Sparkles;

  return (
    <AiRow>
      <div
        className={cn(
          "max-w-[min(100%,36rem)] space-y-2 rounded-2xl rounded-tl-sm border p-3",
          great
            ? "border-green-200 bg-green-50"
            : "border-amber-200 bg-amber-50",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-1.5 text-sm font-semibold",
            great ? "text-green-700" : "text-amber-800",
          )}
        >
          <Icon className="h-4 w-4" />
          {great
            ? t("scenarioDialogue.chat.verdictGreat")
            : t("scenarioDialogue.chat.verdictImprove")}
        </div>
        <p className="text-sm text-gray-800">{feedback.comment}</p>

        {feedback.suggestion && (
          <div className="space-y-1 rounded-lg bg-white/70 p-2">
            <p className="text-xs text-gray-500">
              {t("scenarioDialogue.chat.suggestion")}
            </p>
            <p className="text-base text-gray-900">{feedback.suggestion}</p>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => onSpeak(feedback.suggestion!)}
            >
              <Volume2 className="mr-1 h-4 w-4" />
              {t("scenarioDialogue.chat.listenSuggestion")}
            </Button>
          </div>
        )}

        {showActions && !exhausted && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" className="h-11" onClick={onRetry}>
              {t("scenarioDialogue.chat.retry")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={onNext}
            >
              {nextLabel}
            </Button>
          </div>
        )}
        {showActions && exhausted && (
          <p className="text-xs text-gray-500">
            {t("scenarioDialogue.chat.attemptsUsedUp", { max: maxAttempts })}
          </p>
        )}
      </div>
    </AiRow>
  );
}
