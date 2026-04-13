/**
 * TeamOptions - 單邊選項區
 *
 * 顯示 4 個選項按鈕，支援鍵盤快捷鍵和冷卻狀態。
 */

import { useEffect, useState, useRef } from "react";
import type { Team, VocabItem } from "./types";
import { TEAM_A_KEYS, TEAM_B_KEYS, OPTION_LABELS } from "./types";

interface TeamOptionsProps {
  team: Team;
  options: string[];
  onSelect: (team: Team, answer: string) => void;
  disabled: boolean; // Question already answered
  isCooldown: boolean;
  cooldownMs: number;
  teamLabel: string;
  showImages?: boolean;
  vocabItems?: VocabItem[];
  useHandwriteFont?: boolean;
}

export function TeamOptions({
  team,
  options,
  onSelect,
  disabled,
  isCooldown,
  cooldownMs,
  teamLabel: _teamLabel,
  showImages = false,
  vocabItems = [],
  useHandwriteFont = false,
}: TeamOptionsProps) {
  const keys = team === "a" ? TEAM_A_KEYS : TEAM_B_KEYS;
  const teamColor = team === "a" ? "red" : "blue";
  const [cooldownProgress, setCooldownProgress] = useState(0);
  const cooldownStart = useRef<number | null>(null);
  const animFrame = useRef<number | null>(null);

  // Keyboard handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (disabled || isCooldown) return;
      const keyIndex = keys.indexOf(e.key);
      if (keyIndex >= 0 && keyIndex < options.length) {
        e.preventDefault();
        onSelect(team, options[keyIndex]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [team, keys, options, onSelect, disabled, isCooldown]);

  // Cooldown animation
  useEffect(() => {
    if (isCooldown) {
      cooldownStart.current = Date.now();
      const animate = () => {
        if (!cooldownStart.current) return;
        const elapsed = Date.now() - cooldownStart.current;
        const progress = Math.min(elapsed / cooldownMs, 1);
        setCooldownProgress(progress);
        if (progress < 1) {
          animFrame.current = requestAnimationFrame(animate);
        }
      };
      animFrame.current = requestAnimationFrame(animate);
    } else {
      setCooldownProgress(0);
      cooldownStart.current = null;
      if (animFrame.current) cancelAnimationFrame(animFrame.current);
    }
    return () => {
      if (animFrame.current) cancelAnimationFrame(animFrame.current);
    };
  }, [isCooldown, cooldownMs]);

  const remainingSeconds = isCooldown
    ? Math.max(0, (cooldownMs * (1 - cooldownProgress)) / 1000).toFixed(1)
    : null;

  const maxLen = Math.max(...options.map((o) => o.length));
  const useVertical = !showImages && maxLen > 7;

  return (
    <div className="flex flex-col gap-2 relative w-full">
      {/* Options grid — 2x2 default, 1x4 when text is long */}
      <div
        className={`grid ${useVertical ? "grid-cols-1" : "grid-cols-2"} gap-2`}
      >
        {options.map((option, index) => (
          <button
            key={`${option}-${index}`}
            onClick={() => !disabled && !isCooldown && onSelect(team, option)}
            disabled={disabled || isCooldown}
            className={`
              relative flex ${showImages ? "flex-col items-center" : "items-start"} gap-2 px-3 py-2 rounded-lg border-2 text-left
              transition-all duration-150
              ${
                disabled || isCooldown
                  ? "opacity-50 cursor-not-allowed border-gray-300 bg-gray-100 dark:bg-gray-800 dark:border-gray-600"
                  : teamColor === "blue"
                    ? "bg-white border-blue-300 hover:border-blue-500 hover:bg-blue-50 active:bg-blue-100 dark:bg-gray-900 dark:border-blue-700 dark:hover:border-blue-500 dark:hover:bg-blue-950"
                    : "bg-white border-red-300 hover:border-red-500 hover:bg-red-50 active:bg-red-100 dark:bg-gray-900 dark:border-red-700 dark:hover:border-red-500 dark:hover:bg-red-950"
              }
            `}
          >
            {/* Key hint */}
            <span
              className={`
                w-6 h-6 rounded flex items-center justify-center text-xs font-bold flex-shrink-0 pixel-font
                ${
                  teamColor === "blue"
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                    : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                }
              `}
            >
              {OPTION_LABELS[index]}
            </span>
            {showImages &&
              (() => {
                const item = vocabItems.find(
                  (v) => v.text === option || v.translation === option,
                );
                return item?.image_url ? (
                  <img
                    src={item.image_url}
                    alt=""
                    className="w-full rounded object-cover"
                  />
                ) : null;
              })()}
            <span
              className={`text-xl sm:text-2xl font-medium break-words whitespace-normal min-w-0 ${useHandwriteFont ? "handwrite-font text-2xl sm:text-3xl" : ""}`}
            >
              {option}
            </span>
          </button>
        ))}
      </div>

      {/* Cooldown overlay */}
      {isCooldown && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/30 rounded-lg backdrop-blur-[1px]">
          <div className="text-center">
            <div className="pixel-font text-2xl font-bold text-white drop-shadow-lg">
              {remainingSeconds}s
            </div>
            <div className="text-xs text-white/80 mt-1">COOLDOWN</div>
          </div>
        </div>
      )}
    </div>
  );
}
