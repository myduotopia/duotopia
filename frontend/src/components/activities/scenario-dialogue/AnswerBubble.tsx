/**
 * AnswerBubble — 情境對話聊天流中學生的回答氣泡（#1133）。
 *
 * 靠右、主色藍底白字。語音回答用標準 AudioPlayer（compact＋tone="onPrimary"，
 * 藍底上的淺色按鈕與白色進度條）；播放前讀不到時長時，用錄音當下記下的秒數（durationSec）
 * 顯示（AudioPlayer fallbackDuration），不顯示 `--:--`。打字回答顯示文字。
 * 重答往下流動：舊的回答變淡（faded）但仍可播放；有多次時標「第 N 次」。
 * 老師預覽時旁邊顯示 mock AI 分數徽章（學生畫面一律不顯示分數）。
 */

import { useTranslation } from "react-i18next";
import AudioPlayer from "@/components/shared/AudioPlayer";
import { cn } from "@/lib/utils";
import type { ScenarioAnswer } from "./types";

interface Props {
  answer: ScenarioAnswer;
  attemptNo: number;
  showAttemptNo: boolean;
  faded: boolean;
  /** 只有老師預覽會傳 */
  score?: number;
}

export function AnswerBubble({
  answer,
  attemptNo,
  showAttemptNo,
  faded,
  score,
}: Props) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex flex-col items-end gap-1 transition-opacity",
        faded && "opacity-50",
      )}
    >
      <div className="flex items-center gap-2 text-xs text-gray-500">
        {showAttemptNo && (
          <span>{t("scenarioDialogue.chat.attemptNo", { no: attemptNo })}</span>
        )}
        {typeof score === "number" && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">
            {t("scenarioDialogue.chat.aiScore", { score })}
          </span>
        )}
      </div>
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-primary-foreground">
        {answer.kind === "voice" && answer.audioUrl ? (
          <AudioPlayer
            audioUrl={answer.audioUrl}
            variant="compact"
            tone="onPrimary"
            showTitle={false}
            readOnly
            fallbackDuration={answer.durationSec}
            className="min-w-[12rem]"
          />
        ) : (
          <p className="whitespace-pre-wrap break-words text-base">
            {answer.text}
          </p>
        )}
      </div>
    </div>
  );
}
