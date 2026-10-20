/**
 * AnswerBubble — 情境對話聊天流中學生的回答氣泡（#1133）。
 *
 * 靠右、主色藍底白字。語音回答顯示播放鈕＋秒數（聊天訊息型態，AudioPlayer 的綠色
 * 按鈕放在藍底上不協調，所以這裡只用一顆 <audio> 播放）；打字回答顯示文字。
 * 重答往下流動：舊的回答變淡（faded）但仍可播放；有多次時標「第 N 次」。
 * 老師預覽時旁邊顯示 mock AI 分數徽章（學生畫面一律不顯示分數）。
 */

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
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

function formatSec(sec?: number) {
  if (!sec || !isFinite(sec)) return "0:00";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function VoiceClip({
  url,
  durationSec,
}: {
  url: string;
  durationSec?: number;
}) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const audio = new Audio(url);
    audioRef.current = audio;
    const onEnd = () => setPlaying(false);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("pause", onEnd);
    return () => {
      audio.pause();
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("pause", onEnd);
    };
  }, [url]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.currentTime = 0;
      audio
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex min-h-11 items-center gap-2"
      aria-label={
        playing
          ? t("scenarioDialogue.chat.pauseAnswer")
          : t("scenarioDialogue.chat.playAnswer")
      }
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20">
        {playing ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="ml-0.5 h-4 w-4" />
        )}
      </span>
      <span className="flex items-center gap-0.5" aria-hidden>
        {[40, 70, 55, 90, 60, 75, 45, 65].map((h, i) => (
          <span
            key={i}
            className={cn(
              "w-1 rounded-full bg-white/70",
              playing && "animate-pulse",
            )}
            style={{ height: `${h * 0.2}px`, animationDelay: `${i * 100}ms` }}
          />
        ))}
      </span>
      <span className="text-sm tabular-nums">{formatSec(durationSec)}</span>
    </button>
  );
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
          <VoiceClip url={answer.audioUrl} durationSec={answer.durationSec} />
        ) : (
          <p className="whitespace-pre-wrap break-words text-base">
            {answer.text}
          </p>
        )}
      </div>
    </div>
  );
}
