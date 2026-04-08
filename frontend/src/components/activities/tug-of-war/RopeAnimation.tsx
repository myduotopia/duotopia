/**
 * RopeAnimation - 拔河繩子動畫
 *
 * 像素風繩子 + 左右角色，繩子位置由 ropePosition 控制。
 */

import { PixelCharacters } from "./PixelCharacters";
import type { Team } from "./types";

interface RopeAnimationProps {
  ropePosition: number; // negative = A leading, positive = B leading
  maxPosition: number; // total questions (max possible offset)
  lastCorrectTeam: Team | null;
  isPaused: boolean;
}

export function RopeAnimation({
  ropePosition,
  maxPosition,
  lastCorrectTeam,
  isPaused,
}: RopeAnimationProps) {
  // Clamp the visual position to a reasonable range
  const clampedMax = Math.max(maxPosition, 1);
  const percentage = (ropePosition / clampedMax) * 50; // -50% to +50%
  const clampedPercentage = Math.max(-45, Math.min(45, percentage));

  return (
    <div className="relative flex items-center justify-center w-full py-4 select-none">
      {/* Team A characters (left) */}
      <div className="flex-shrink-0">
        <PixelCharacters
          team="a"
          isPulling={!isPaused && lastCorrectTeam === "a"}
        />
      </div>

      {/* Rope area */}
      <div className="relative flex-1 mx-2 h-12 flex items-center">
        {/* Rope background track */}
        <div
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-3 rounded-sm"
          style={{
            background:
              "repeating-linear-gradient(90deg, #92400E 0px, #92400E 4px, #B45309 4px, #B45309 8px)",
            imageRendering: "pixelated",
          }}
        />

        {/* Center marker (starting position) */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-8 bg-gray-400 opacity-40" />

        {/* Moving flag/marker */}
        <div
          className="absolute top-1/2 -translate-y-1/2 transition-all duration-500 ease-out"
          style={{
            left: `calc(50% + ${clampedPercentage}%)`,
            transform: "translate(-50%, -50%)",
          }}
        >
          {/* Flag */}
          <div className="relative">
            <div className="w-1 h-10 bg-gray-700 mx-auto" />
            <div
              className="absolute -top-1 left-1/2 w-5 h-4"
              style={{
                background:
                  ropePosition < 0
                    ? "#3B82F6"
                    : ropePosition > 0
                      ? "#EF4444"
                      : "#F59E0B",
                clipPath: "polygon(0 0, 100% 50%, 0 100%)",
                transform: "translateX(-2px)",
              }}
            />
          </div>
        </div>
      </div>

      {/* Team B characters (right) */}
      <div className="flex-shrink-0">
        <PixelCharacters
          team="b"
          isPulling={!isPaused && lastCorrectTeam === "b"}
        />
      </div>
    </div>
  );
}
