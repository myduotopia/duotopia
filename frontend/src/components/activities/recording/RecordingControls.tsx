/**
 * RecordingControls — issue #892 底部 3 顆按鈕 + 中央狀態機。
 *
 * 左 🔊 我的錄音回放 / 中央（狀態變色）/ 右 ➡️ 下一題。
 *
 * 中央按鈕依 state 變色 / 換 icon：
 * - idle      橘 🎙️  → onRecordStart
 * - recording 紅 ⏹  （脈動 + 計時）→ onRecordStop
 * - recorded  紫 ✨  → onAnalyze（無 AI 額度時改顯示「已錄音完成」，不觸發分析）
 * - assessed  藍 ↻  → onReRecord
 * disabled（recordingDisabled）鎖定整組。扣次數語義由呼叫端在「分析成功」時處理。
 */
import {
  Mic,
  Square,
  Sparkles,
  RotateCcw,
  Volume2,
  ArrowRight,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type RecordingState = "idle" | "recording" | "recorded" | "assessed";

export interface RecordingControlsProps {
  state: RecordingState;
  onRecordStart?: () => void;
  onRecordStop?: () => void;
  onAnalyze?: () => void;
  onReRecord?: () => void;
  onPlayback?: () => void;
  onNext?: () => void;
  canPlayback?: boolean;
  canNext?: boolean;
  /** recordingDisabled：3/3 用完或訂正鎖定時，整組停用 */
  disabled?: boolean;
  /** 教師/機構是否有 AI 分析額度；false 時 recorded 不出 ✨ */
  canUseAiAnalysis?: boolean;
  /** 錄音中計時（秒），顯示於中央鈕下方 */
  recordingSeconds?: number;
  /** 是否顯示右側「下一題」；容器自帶導覽時設 false */
  showNext?: boolean;
  /** 是否顯示左側「我的錄音回放」 */
  showPlayback?: boolean;
  className?: string;
}

const formatTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

interface CenterConfig {
  testid: string;
  Icon: typeof Mic;
  bg: string;
  shadow: string;
  onClick?: () => void;
  pulse: boolean;
  forceDisabled?: boolean;
}

export const RecordingControls = ({
  state,
  onRecordStart,
  onRecordStop,
  onAnalyze,
  onReRecord,
  onPlayback,
  onNext,
  canPlayback = false,
  canNext = false,
  disabled = false,
  canUseAiAnalysis = true,
  recordingSeconds = 0,
  showNext = true,
  showPlayback = true,
  className,
}: RecordingControlsProps) => {
  const center: CenterConfig = (() => {
    switch (state) {
      case "recording":
        return {
          testid: "center-stop",
          Icon: Square,
          bg: "bg-recording-danger",
          shadow: "shadow-[0_8px_24px_rgba(239,68,68,0.4)]",
          onClick: onRecordStop,
          pulse: true,
        };
      case "recorded":
        return canUseAiAnalysis === false
          ? {
              testid: "center-recorded",
              Icon: Check,
              bg: "bg-gray-400",
              shadow: "",
              onClick: undefined,
              pulse: false,
              forceDisabled: true,
            }
          : {
              testid: "center-analyze",
              Icon: Sparkles,
              bg: "bg-recording-upload",
              shadow: "shadow-[0_8px_24px_rgba(139,92,246,0.4)]",
              onClick: onAnalyze,
              pulse: true,
            };
      case "assessed":
        return {
          testid: "center-rerecord",
          Icon: RotateCcw,
          bg: "bg-recording-rerecord",
          shadow: "shadow-[0_8px_24px_rgba(37,99,235,0.4)]",
          onClick: onReRecord,
          pulse: false,
        };
      case "idle":
      default:
        return {
          testid: "center-record",
          Icon: Mic,
          bg: "bg-recording-accent",
          shadow: "shadow-[0_8px_24px_rgba(249,115,22,0.4)]",
          onClick: onRecordStart,
          pulse: false,
        };
    }
  })();

  const centerDisabled = disabled || center.forceDisabled;
  const CenterIcon = center.Icon;

  return (
    <div
      data-testid="recording-controls"
      className={cn(
        "flex items-center justify-center gap-6 sm:gap-8",
        className,
      )}
    >
      {/* 左：我的錄音回放 */}
      {showPlayback && (
      <button
        type="button"
        data-testid="playback-btn"
        onClick={onPlayback}
        disabled={!canPlayback}
        title="播放我的錄音"
        className={cn(
          "flex h-14 w-14 items-center justify-center rounded-full bg-recording-card text-recording-text-primary shadow transition-all sm:h-[72px] sm:w-[72px]",
          !canPlayback && "opacity-40",
        )}
      >
        <Volume2 className="h-6 w-6 sm:h-7 sm:w-7" />
      </button>
      )}

      {/* 中央：狀態機 */}
      <div className="relative flex flex-col items-center">
        <button
          type="button"
          data-testid={center.testid}
          onClick={center.onClick}
          disabled={centerDisabled}
          className={cn(
            "flex h-[88px] w-[88px] items-center justify-center rounded-full text-white transition-all sm:h-[120px] sm:w-[120px]",
            center.bg,
            center.shadow,
            centerDisabled && "opacity-60",
          )}
          style={
            center.pulse && !centerDisabled
              ? { animation: "pulse-scale 1.5s ease-in-out infinite" }
              : undefined
          }
        >
          <CenterIcon className="h-10 w-10 sm:h-14 sm:w-14" />
        </button>

        {state === "recording" && (
          <span
            data-testid="recording-timer"
            className="mt-2 text-lg font-bold text-recording-danger"
          >
            {formatTime(recordingSeconds)}
          </span>
        )}
      </div>

      {/* 右：下一題（容器自帶導覽時可隱藏） */}
      {showNext && (
        <button
          type="button"
          data-testid="next-btn"
          onClick={onNext}
          disabled={!canNext}
          title="下一題"
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-full bg-recording-card text-recording-text-primary shadow transition-all sm:h-[72px] sm:w-[72px]",
            !canNext && "opacity-40",
          )}
        >
          <ArrowRight className="h-6 w-6 sm:h-7 sm:w-7" />
        </button>
      )}
    </div>
  );
};

export default RecordingControls;
