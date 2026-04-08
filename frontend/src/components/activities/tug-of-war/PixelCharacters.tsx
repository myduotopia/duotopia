/**
 * PixelCharacters - 像素風拔河角色
 *
 * 用 CSS 繪製的 8-bit 風格小人，支援拉動動畫。
 */

import type { Team } from "./types";

interface PixelCharactersProps {
  team: Team;
  isPulling: boolean;
  count?: number;
}

function PixelPerson({
  team,
  index,
  isPulling,
}: {
  team: Team;
  index: number;
  isPulling: boolean;
}) {
  const isTeamA = team === "a";
  const baseColor = isTeamA ? "#3B82F6" : "#EF4444"; // blue vs red
  const skinColor = "#FBBF24";
  const delay = index * 0.1;

  return (
    <svg
      width="32"
      height="40"
      viewBox="0 0 16 20"
      className={isPulling ? "animate-pixel-pull" : ""}
      style={{
        animationDelay: `${delay}s`,
        imageRendering: "pixelated",
        transform: isTeamA ? "scaleX(1)" : "scaleX(-1)",
      }}
    >
      {/* Head */}
      <rect x="5" y="0" width="6" height="6" fill={skinColor} />
      {/* Eyes */}
      <rect x="7" y="2" width="2" height="2" fill="#1F2937" />
      {/* Body */}
      <rect x="4" y="6" width="8" height="6" fill={baseColor} />
      {/* Arms (reaching forward for rope) */}
      <rect
        x={isTeamA ? "12" : "0"}
        y="7"
        width="4"
        height="2"
        fill={skinColor}
      />
      {/* Legs */}
      <rect x="4" y="12" width="3" height="6" fill="#4B5563" />
      <rect x="9" y="12" width="3" height="6" fill="#4B5563" />
      {/* Shoes */}
      <rect x="3" y="18" width="4" height="2" fill="#78350F" />
      <rect x="9" y="18" width="4" height="2" fill="#78350F" />
    </svg>
  );
}

export function PixelCharacters({
  team,
  isPulling,
  count = 3,
}: PixelCharactersProps) {
  const isTeamA = team === "a";

  return (
    <div
      className={`flex items-end gap-0.5 ${isTeamA ? "flex-row-reverse" : "flex-row"}`}
    >
      {Array.from({ length: count }, (_, i) => (
        <PixelPerson key={i} team={team} index={i} isPulling={isPulling} />
      ))}
    </div>
  );
}
