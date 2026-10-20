/**
 * FeedbackBubble — 情境對話中 AI 對每次回答的建議氣泡（#1133）。
 *
 * 配色用標準色：需改進 amber、很棒 green。內容＝評語＋（有的話）建議說法文字與
 * 「聽建議說法」朗讀鈕。分數不在這裡顯示 —— 學生作答時只看建議。
 *
 * 每題「最後一則」建議氣泡下方一直保留操作（`actions`）：
 * - `current`：目前這題剛看完建議 →「再試一次」（主按鈕）＋「下一題」（次要）
 * - `retry`：其他已出現的題目（或全部結束後）→ 只有「再試一次」（次要），回頭重答
 * - `autoNext`：目前這題已答滿 → 小字「已達 N 次，即將進入下一題」，由狀態機自動進下一題
 * - `reached`：已答滿的題目 → 小字「已達 N 次」（按鈕位置改顯示這行，不是直接消失）
 * - `none`：這題正在作答／等建議中，不放操作
 * 另一題重答正在等 AI 建議時，「再試一次」暫時停用（retryDisabled，處理中不另說明）。
 */

import { CheckCircle2, Sparkles, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AiRow } from "./TypingIndicator";
import type { ScenarioFeedback } from "./types";

export type FeedbackActions =
  | "current"
  | "retry"
  | "autoNext"
  | "reached"
  | "none";

interface Props {
  feedback: ScenarioFeedback;
  onSpeak: (text: string) => void;
  actions: FeedbackActions;
  maxAttempts: number;
  /** 處理中（另一題重答在等 AI 建議）暫時停用 */
  retryDisabled?: boolean;
  onRetry: () => void;
  onNext: () => void;
}

export function FeedbackBubble({
  feedback,
  onSpeak,
  actions,
  maxAttempts,
  retryDisabled = false,
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

        {actions === "current" && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              className="h-11"
              disabled={retryDisabled}
              onClick={onRetry}
            >
              {t("scenarioDialogue.chat.retry")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={onNext}
            >
              {t("scenarioDialogue.chat.next")}
            </Button>
          </div>
        )}
        {actions === "retry" && (
          <div className="pt-1">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={retryDisabled}
              onClick={onRetry}
            >
              {t("scenarioDialogue.chat.retry")}
            </Button>
          </div>
        )}
        {actions === "autoNext" && (
          <p className="text-xs text-gray-500">
            {t("scenarioDialogue.chat.attemptsUsedUp", { max: maxAttempts })}
          </p>
        )}
        {actions === "reached" && (
          <p className="text-xs text-gray-500">
            {t("scenarioDialogue.chat.attemptsReached", { max: maxAttempts })}
          </p>
        )}
      </div>
    </AiRow>
  );
}
