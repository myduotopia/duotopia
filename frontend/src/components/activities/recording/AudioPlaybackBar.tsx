/**
 * AudioPlaybackBar — issue #892 句子上方音檔列。
 *
 * 喇叭（聽老師示範）+ 速度切換。示範音速度 0.75 / 1 / 1.5（issue 決定；
 * 學生自己錄音回放固定 1x，不走此列）。
 */
import { Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** 示範音倍速選項（issue #892 決定：0.75 / 1 / 1.5）。 */
export const PLAYBACK_RATES = [0.75, 1, 1.5] as const;

export interface AudioPlaybackBarProps {
  onPlayExample?: () => void;
  /** 有無參考音檔；無則喇叭停用 */
  hasExampleAudio?: boolean;
  /** 目前是否正在播放示範音（用於高亮喇叭） */
  isPlaying?: boolean;
  /** 目前選定倍速 */
  playbackRate: number;
  onRateChange: (rate: number) => void;
  rates?: readonly number[];
  className?: string;
}

export const AudioPlaybackBar = ({
  onPlayExample,
  hasExampleAudio = true,
  isPlaying = false,
  playbackRate,
  onRateChange,
  rates = PLAYBACK_RATES,
  className,
}: AudioPlaybackBarProps) => {
  return (
    <div
      data-testid="audio-playback-bar"
      className={cn("flex items-center gap-3", className)}
    >
      <button
        type="button"
        data-testid="play-example"
        onClick={onPlayExample}
        disabled={!hasExampleAudio}
        aria-pressed={isPlaying}
        title={hasExampleAudio ? "聽老師示範" : "無參考音檔"}
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-full transition-colors",
          hasExampleAudio
            ? "bg-recording-card text-recording-text-primary shadow hover:bg-recording-card-soft"
            : "cursor-not-allowed bg-gray-100 text-gray-300",
          isPlaying && "ring-2 ring-recording-accent",
        )}
      >
        <Volume2 className="h-5 w-5" />
      </button>

      <div
        data-testid="rate-switch"
        className="flex items-center gap-1 rounded-full bg-recording-card p-1 shadow-sm"
      >
        {rates.map((r) => {
          const active = r === playbackRate;
          return (
            <button
              key={r}
              type="button"
              data-testid={`rate-${r}`}
              data-active={active}
              onClick={() => onRateChange(r)}
              className={cn(
                "rounded-full px-3 py-1 text-sm font-semibold transition-colors",
                active
                  ? "bg-recording-accent text-white"
                  : "text-recording-text-secondary hover:text-recording-text-primary",
              )}
            >
              {r}x
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default AudioPlaybackBar;
