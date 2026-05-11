/**
 * CountdownRing - circular countdown indicator for timed activities.
 *
 * Compact 48px ring: SVG stroke shrinks as time elapses, colour shifts
 * gray → yellow (≤10s) → red (≤5s), and the ring pulses in the red zone.
 */

import { cn } from "@/lib/utils";

interface CountdownRingProps {
  /** Current seconds remaining. 0 displays "0". */
  seconds: number;
  /** Original time budget for this question (controls progress). */
  total: number;
  className?: string;
}

const SIZE = 48;
const STROKE = 4;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function CountdownRing({
  seconds,
  total,
  className,
}: CountdownRingProps) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, seconds / total)) : 0;
  const dashOffset = CIRCUMFERENCE * (1 - ratio);

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
          className={cn("fill-none transition-all duration-500", stroke)}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <span
        className={cn(
          "absolute text-sm font-semibold tabular-nums",
          text,
        )}
      >
        {seconds}
      </span>
    </div>
  );
}
