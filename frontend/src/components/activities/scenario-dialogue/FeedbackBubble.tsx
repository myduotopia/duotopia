/**
 * FeedbackBubble — 情境對話中 AI 對每次回答的建議氣泡（#1133；#1158 E-2 改成 A 方案單層）。
 *
 * 單層氣泡：沒有外框線、沒有內框，只有淺底色（需改進 amber-50、很棒 green-50）。
 * - 評語一行：「可以更好・」（amber 字）／「很棒・」（green 字）接評語。
 * - 建議說法（有的話）：放大加粗單獨一行，旁邊一顆 🔊 小圓圖示鈕（aria-label「聽建議說法」）。
 * 分數不在這裡顯示 —— 學生作答時只看建議。
 *
 * 每題「最後一則」建議氣泡下方保留操作（`actions`，規則不變），按鈕是小膠囊、整列靠右：
 * - `current`：目前這題剛看完建議 →「下一題 →」（次要，左）＋「↺ 再試一次」（主色，最右）
 * - `retry`：其他已出現的題目（或全部結束後）→ 只有「↺ 再試一次」（次要），回頭重答
 * - `autoNext`：目前這題已答滿 → 小字「已達 N 次，即將進入下一題」，由狀態機自動進下一題
 * - `reached`：已答滿的題目 → 小字「已達 N 次」（按鈕位置改顯示這行，不是直接消失）
 * - `none`：這題正在作答／等建議中，不放操作
 * 另一題重答正在等 AI 建議時，「再試一次」暫時停用（retryDisabled，處理中不另說明）。
 * 回頭重答這一題時，舊的建議變淡（faded，#1158 E-2 重答流程）。
 */

import { ArrowRight, RotateCcw, Volume2 } from "lucide-react";
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
  /** 這一題正在回頭重答：舊建議變淡 */
  faded?: boolean;
  onRetry: () => void;
  onNext: () => void;
}

const PILL = "h-9 rounded-full px-3 text-sm";

export function FeedbackBubble({
  feedback,
  onSpeak,
  actions,
  maxAttempts,
  retryDisabled = false,
  faded = false,
  onRetry,
  onNext,
}: Props) {
  const { t } = useTranslation();
  const great = feedback.verdict === "great";

  const retryButton = (primary: boolean) => (
    <Button
      type="button"
      variant={primary ? "default" : "outline"}
      className={PILL}
      disabled={retryDisabled}
      onClick={onRetry}
    >
      <RotateCcw className="mr-1 h-4 w-4" aria-hidden />
      {t("scenarioDialogue.chat.retry")}
    </Button>
  );

  return (
    <AiRow>
      <div
        className={cn(
          "max-w-[min(100%,36rem)] space-y-2 rounded-2xl rounded-tl-sm px-3 py-2.5 transition-opacity",
          great ? "bg-green-50" : "bg-amber-50",
          faded && "opacity-60",
        )}
        data-testid="scenario-feedback"
      >
        <p className="text-sm leading-relaxed text-gray-800">
          <b className={great ? "text-green-700" : "text-amber-700"}>
            {great
              ? t("scenarioDialogue.chat.verdictGreat")
              : t("scenarioDialogue.chat.verdictImprove")}
            {t("scenarioDialogue.chat.verdictSeparator")}
          </b>
          {feedback.comment}
        </p>

        {feedback.suggestion && (
          <div className="flex items-center gap-2">
            <p className="min-w-0 text-base font-bold text-gray-900">
              <span className="sr-only">
                {t("scenarioDialogue.chat.suggestion")}：
              </span>
              {feedback.suggestion}
            </p>
            <button
              type="button"
              onClick={() => onSpeak(feedback.suggestion!)}
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
                great
                  ? "bg-green-200 text-green-800 hover:bg-green-300"
                  : "bg-amber-200 text-amber-800 hover:bg-amber-300",
              )}
              aria-label={t("scenarioDialogue.chat.listenSuggestion")}
              title={t("scenarioDialogue.chat.listenSuggestion")}
            >
              <Volume2 className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}

        {actions === "current" && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className={PILL}
              onClick={onNext}
            >
              {t("scenarioDialogue.chat.next")}
              <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
            </Button>
            {retryButton(true)}
          </div>
        )}
        {actions === "retry" && (
          <div className="flex justify-end">{retryButton(false)}</div>
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
