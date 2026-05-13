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
  /** Original time budget for this question (drives animation length). */
  total: number;
  className?: string;
}

const SIZE = 36;
const STROKE = 3;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function CountdownRing({
  seconds,
  total,
  className,
}: CountdownRingProps) {
  const danger = seconds <= 5;
  const warn = !danger && seconds <= 10;

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
      style={{ width: SIZE, height: SIZE }}
      aria-label={`${seconds} seconds remaining`}
      role="timer"
    >
      <svg
        width={SIZE}
        height={SIZE}
        className="-rotate-90"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          className="stroke-gray-200 fill-none"
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          className={cn("fill-none countdown-drain", stroke)}
          style={
            {
              "--countdown-circ": `${CIRCUMFERENCE}px`,
              animationDuration: `${total}s`,
            } as React.CSSProperties
          }
        />
      </svg>
      <span className={cn("absolute text-xs font-semibold tabular-nums", text)}>
        {seconds}
      </span>
    </div>
  );
}
