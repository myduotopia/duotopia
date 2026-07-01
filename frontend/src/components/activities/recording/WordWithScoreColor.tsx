/**
 * WordWithScoreColor — issue #892 In-Card 評測逐字染色。
 *
 * 把朗讀本體拆成單字，依 Azure word-level 分數染色：
 *   ≥80 綠 / 60–79 黃 / <60 紅。
 * 紅字可點 → popover 顯示該字、音素/IPA、分數與「播放老師示範」。
 *
 * 純受控、無 Radix（controlled openIndex），jsdom 可完整測試。
 * 設計依據：docs/design/recording-card-redesign.pen（C4 點字 Popover）。
 */
import { useState } from "react";
import { Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ScoredWord {
  index: number;
  word: string;
  score: number;
  phonemes?: Array<{ phoneme: string; accuracy_score: number }>;
}

export type ScoreBand = "pass" | "warn" | "fail";

export const scoreBand = (
  score: number,
  passThreshold = 80,
  warnThreshold = 60,
): ScoreBand =>
  score >= passThreshold ? "pass" : score >= warnThreshold ? "warn" : "fail";

const BAND_TEXT: Record<ScoreBand, string> = {
  pass: "text-recording-pass",
  warn: "text-recording-warn",
  fail: "text-recording-danger",
};

export interface WordWithScoreColorProps {
  words: ScoredWord[];
  /** 播放某字的老師示範；未提供則 popover 不顯示播放鈕 */
  onPlayWord?: (word: ScoredWord) => void;
  passThreshold?: number;
  warnThreshold?: number;
  className?: string;
}

export const WordWithScoreColor = ({
  words,
  onPlayWord,
  passThreshold = 80,
  warnThreshold = 60,
  className,
}: WordWithScoreColorProps) => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <span
      data-testid="word-with-score-color"
      className={cn("inline-flex flex-wrap items-end gap-x-2 gap-y-1", className)}
    >
      {words.map((w) => {
        const band = scoreBand(w.score, passThreshold, warnThreshold);
        // 非紅字：純染色文字
        if (band !== "fail") {
          return (
            <span
              key={w.index}
              data-testid={`word-${w.index}`}
              data-band={band}
              className={cn("font-bold", BAND_TEXT[band])}
            >
              {w.word}
            </span>
          );
        }

        // 紅字：可點，開 popover
        const open = openIndex === w.index;
        const ipa = w.phonemes?.map((p) => p.phoneme).join("") ?? "";
        return (
          <span key={w.index} className="relative inline-block">
            <button
              type="button"
              data-testid={`word-${w.index}`}
              data-band="fail"
              aria-expanded={open}
              onClick={() => setOpenIndex(open ? null : w.index)}
              className={cn(
                "rounded-lg border-2 border-recording-danger bg-recording-danger/10 px-2 font-bold text-recording-danger",
              )}
            >
              {w.word}
            </button>

            {open && (
              <div
                role="dialog"
                data-testid={`word-popover-${w.index}`}
                className="absolute bottom-full left-1/2 z-20 mb-3 w-56 -translate-x-1/2 rounded-2xl border border-recording-border bg-recording-card p-4 text-center shadow-[0_12px_32px_rgba(0,0,0,0.12)]"
              >
                <div className="text-2xl font-bold text-recording-text-primary">
                  {w.word}
                </div>
                {ipa && (
                  <div className="mt-1 text-recording-text-secondary">{ipa}</div>
                )}
                <div
                  data-testid={`word-score-${w.index}`}
                  className="mt-1 text-lg font-bold text-recording-danger"
                >
                  {Math.round(w.score)} 分
                </div>
                {onPlayWord && (
                  <button
                    type="button"
                    data-testid={`play-word-${w.index}`}
                    onClick={() => onPlayWord(w)}
                    className="mx-auto mt-3 flex items-center gap-1.5 rounded-full bg-recording-bg px-3 py-1.5 text-sm font-medium text-recording-text-primary hover:bg-recording-card-soft"
                  >
                    <Volume2 className="h-4 w-4" />
                    播放老師示範
                  </button>
                )}
              </div>
            )}
          </span>
        );
      })}
    </span>
  );
};

export default WordWithScoreColor;
