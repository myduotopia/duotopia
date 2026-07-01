/**
 * ScoreBadge — issue #892 卡片右上角總分徽章。
 *
 * 顯示 Azure pronunciation_score，依分數染色（≥80 綠 / 60–79 黃 / <60 紅）。
 * 點徽章 → popover 展開詳細分數（由呼叫端透過 children 傳入：word_reading 放
 * 既有 PronunciationScoreChart 雷達+音素；決定「兩者都嵌」故也可含 4 卡概覽）。
 *
 * 純受控、無 Radix，jsdom 可完整測試。
 */
import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { scoreBand } from "./WordWithScoreColor";

export interface ScoreBadgeProps {
  score: number;
  /** popover 詳細內容（PronunciationScoreChart / AIScoreDisplay 等） */
  children?: React.ReactNode;
  passThreshold?: number;
  warnThreshold?: number;
  className?: string;
}

const BAND_BG = {
  pass: "bg-recording-pass",
  warn: "bg-recording-warn",
  fail: "bg-recording-danger",
} as const;

export const ScoreBadge = ({
  score,
  children,
  passThreshold = 80,
  warnThreshold = 60,
  className,
}: ScoreBadgeProps) => {
  const [open, setOpen] = useState(false);
  const band = scoreBand(score, passThreshold, warnThreshold);

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="score-badge"
        data-band={band}
        aria-expanded={open}
        disabled={!children}
        onClick={() => children && setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 rounded-full px-5 py-3 font-bold text-white shadow-lg",
          BAND_BG[band],
          className,
        )}
      >
        {band === "pass" && <Check className="h-5 w-5" strokeWidth={3} />}
        <span className="text-2xl">{Math.round(score)}</span>
      </button>

      {open && children && (
        <div
          role="dialog"
          data-testid="score-badge-popover"
          className="absolute right-0 top-full z-30 mt-3 w-[min(92vw,420px)] rounded-2xl border border-recording-border bg-recording-card p-4 shadow-[0_16px_40px_rgba(0,0,0,0.16)]"
        >
          {children}
        </div>
      )}
    </div>
  );
};

export default ScoreBadge;
