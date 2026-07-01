/**
 * RecordingAttemptsIndicator — issue #689 Phase 1（#892 愛心 → 閃電改版）。
 *
 * Renders a fixed row of `max` zap (⚡) slots. Filled (orange, solid) zaps represent
 * remaining AI-analysis attempts; the rest are hollow gray placeholders that stay
 * in place so the UI doesn't shift width as attempts are consumed.
 */
import { Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface RecordingAttemptsIndicatorProps {
  attemptsUsed: number;
  max?: number;
  className?: string;
}

export const RecordingAttemptsIndicator = ({
  attemptsUsed,
  max = 3,
  className,
}: RecordingAttemptsIndicatorProps) => {
  const { t } = useTranslation();
  const remaining = Math.max(0, max - attemptsUsed);

  return (
    <div
      className={cn("flex items-center justify-center gap-1", className)}
      title={
        remaining > 0
          ? t("recordingAttempts.remaining", { n: remaining })
          : t("recordingAttempts.lockedTooltip")
      }
      aria-label={
        remaining > 0
          ? t("recordingAttempts.remaining", { n: remaining })
          : t("recordingAttempts.lockedTooltip")
      }
      data-testid="recording-attempts-indicator"
    >
      {Array.from({ length: max }).map((_, i) => {
        const filled = i < remaining;
        return (
          <Zap
            key={i}
            className={cn(
              "h-4 w-4 transition-all duration-300 ease-out",
              filled ? "text-recording-accent" : "text-gray-300",
            )}
            fill="currentColor"
            style={{ fillOpacity: filled ? 1 : 0 }}
            data-testid={filled ? "zap-filled" : "zap-empty"}
          />
        );
      })}
    </div>
  );
};

export default RecordingAttemptsIndicator;
