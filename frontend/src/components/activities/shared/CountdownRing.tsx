/**
 * CountdownRing - compact circular countdown for timed activities.
 *
 * The SVG stroke is drained via a CSS keyframe that runs for the full
 * `total` duration (smooth linear motion, independent of React's 1Hz
 * timer ticks). Colour shifts gray → yellow (≤10s) → red+pulse (≤5s).
 *
 * Caller is responsible for remounting (e.g. `key={questionIndex}`) so the
 * keyframe restarts on a new question.
 */

import { cn } from "@/lib/utils";

interface CountdownRingProps {
  /** Current seconds remaining (drives the centre label + colour). */
  seconds: number;
  /** Original time budget (drives animation length). */
  total: number;
  className?: string;
  /** Ring diameter in px (default 36 fits per-question; quiz uses 56). */
  size?: number;
  /**
   * When true, danger/warn thresholds switch to 60s/180s for whole-quiz
   * timers (default false → 5s/10s for per-question timers).
   */
  longForm?: boolean;
}

const STROKE = 3;

export default function CountdownRing({
  seconds,
  total,
  className,
  size = 36,
  longForm = false,
}: CountdownRingProps) {
  const radius = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const dangerLimit = longForm ? 60 : 5;
  const warnLimit = longForm ? 180 : 10;
  const danger = seconds <= dangerLimit;
  const warn = !danger && seconds <= warnLimit;
  const display =
    seconds >= 60
      ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
      : String(seconds);

  const stroke = danger
    ? "stroke-red-500"
    : warn
      ? "stroke-yellow-500"
      : "stroke-indigo-500";
  const text = danger
    ? "text-red-600"
    : warn
      ? "text-yellow-700"
      : "text-gray-700";

  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center",
        danger && "animate-pulse",
        className,
      )}
      style={{ width: size, height: size }}
      aria-label={`${display} remaining`}
      role="timer"
    >
      <svg
        width={size}
        height={size}
        className="-rotate-90"
        viewBox={`0 0 ${size} ${size}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={STROKE}
          className="stroke-gray-200 fill-none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={circumference}
          className={cn("fill-none countdown-drain", stroke)}
          style={
            {
              "--countdown-circ": `${circumference}px`,
              animationDuration: `${total}s`,
            } as React.CSSProperties
          }
        />
      </svg>
      <span
        className={cn(
          "absolute font-semibold tabular-nums",
          size >= 56 ? "text-sm" : "text-xs",
          text,
        )}
      >
        {display}
      </span>
    </div>
  );
}
