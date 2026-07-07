/**
 * TeamOptions - 單邊選項區
 *
 * 顯示 4 個選項按鈕，支援鍵盤快捷鍵和冷卻狀態。
 * 選項文字用 useShrinkToFit 量測按鈕框自適應字級（#920）：短字放大、長字（如英英
 * 釋義）自動縮到剛好塞滿、完整顯示絕不截斷。長選項改單欄（一行一選項）給足寬度。
 */

import { useEffect, useState, useRef } from "react";
import { CheckCircle, XCircle } from "lucide-react";
import type { Team, VocabItem } from "./types";
import { TEAM_A_KEYS, TEAM_B_KEYS, OPTION_LABELS } from "./types";
import { useShrinkToFit } from "../shared/useShrinkToFit";

interface OptionButtonProps {
  team: Team;
  option: string;
  keyLabel: string;
  disabled: boolean;
  isCooldown: boolean;
  onSelect: (team: Team, answer: string) => void;
  showImages: boolean;
  imageUrl?: string;
  useHandwriteFont: boolean;
  /** 該題正解文字（用於答對揭示）。 */
  correctAnswer: string;
  /** 該側已答對 → 揭示正解（綠標其餘淡化）。 */
  reveal: boolean;
}

function OptionButton({
  team,
  option,
  keyLabel,
  disabled,
  isCooldown,
  onSelect,
  showImages,
  imageUrl,
  useHandwriteFont,
  correctAnswer,
  reveal,
}: OptionButtonProps) {
  const teamColor = team === "a" ? "red" : "blue";
  const textRef = useRef<HTMLSpanElement>(null);
  const isCorrect = option === correctAnswer;
  // 選錯即時回饋：點到非正解 → 短暫紅標（隨後冷卻覆蓋層接手）
  const [wrongFlash, setWrongFlash] = useState(false);
  const wrongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (wrongTimer.current) clearTimeout(wrongTimer.current);
  }, []);

  // 手寫字型較細長 → 上限給大一點；量測框把長字縮到塞得下、完整不截斷
  const { fontSize, ready } = useShrinkToFit(textRef, {
    maxFontSize: useHandwriteFont ? 34 : 28,
    minFontSize: 14,
    hardMinFontSize: 9,
    deps: [option, useHandwriteFont, showImages],
  });

  const showCorrect = reveal && isCorrect;
  const showWrong = wrongFlash && !isCorrect;

  // 狀態優先序：揭示正解 > 選錯紅閃 > 揭示時其餘淡化 > 冷卻/已答灰 > 隊色
  const stateClass = showCorrect
    ? "border-green-500 bg-green-100 text-green-800 shadow-[0_4px_0_#16a34a] scale-[1.02]"
    : showWrong
      ? "border-red-500 bg-red-100 text-red-800 shadow-[0_4px_0_#dc2626]"
      : reveal
        ? "opacity-50 border-gray-300 bg-gray-100 dark:bg-gray-800 dark:border-gray-600"
        : disabled || isCooldown
          ? "opacity-50 cursor-not-allowed border-gray-300 bg-gray-100 dark:bg-gray-800 dark:border-gray-600"
          : teamColor === "blue"
            ? "bg-white border-[#4d9be6] shadow-[0_4px_0_#4d65b4] hover:bg-blue-50 active:bg-blue-100 dark:bg-gray-900"
            : "bg-white border-[#e83b3b] shadow-[0_4px_0_#ae2334] hover:bg-red-50 active:bg-red-100 dark:bg-gray-900";

  const handleClick = () => {
    if (disabled || isCooldown) return;
    if (!isCorrect) {
      setWrongFlash(true);
      if (wrongTimer.current) clearTimeout(wrongTimer.current);
      wrongTimer.current = setTimeout(() => setWrongFlash(false), 500);
    }
    onSelect(team, option);
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled || isCooldown}
      className={`
        relative grid ${showImages ? "grid-rows-[auto_1fr_auto]" : "grid-rows-[1fr]"} min-h-0 gap-1 px-2 py-1 sm:px-3 sm:py-2 rounded-lg border-[3px] text-center overflow-hidden
        transition-all duration-150 active:translate-y-[2px]
        ${stateClass}
      `}
    >
      {/* Key hint */}
      <span
        className={`
          pointer-events-none absolute left-1 top-1 z-[1] w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold pixel-font
          ${
            teamColor === "blue"
              ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
              : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
          }
        `}
      >
        {keyLabel}
      </span>
      {/* 揭示 icon：正解打勾、選錯打叉 */}
      {(showCorrect || showWrong) && (
        <span className="pointer-events-none absolute right-1 top-1 z-[1] animate-in zoom-in-50 fade-in duration-300">
          {showCorrect ? (
            <CheckCircle className="h-5 w-5 text-green-600" />
          ) : (
            <XCircle className="h-5 w-5 text-red-600" />
          )}
        </span>
      )}
      {showImages && imageUrl && (
        <img
          src={imageUrl}
          alt=""
          className="row-start-2 min-h-0 w-full rounded object-contain"
        />
      )}
      {/* 量測文字：block、max-h/max-w-full + overflow-hidden 讓 hook 量得到 overflow */}
      <span
        ref={textRef}
        style={{ fontSize: `${fontSize}px` }}
        className={`flex items-center justify-center min-h-0 min-w-0 max-h-full max-w-full overflow-hidden break-words leading-tight font-medium ${
          useHandwriteFont ? "handwrite-font" : ""
        } ${ready ? "" : "opacity-0"}`}
      >
        {option}
      </span>
    </button>
  );
}

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
  correctAnswer: string;
  /** 該側已答對 → 揭示正解（綠標其餘淡化）。 */
  reveal?: boolean;
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
  correctAnswer,
  reveal = false,
}: TeamOptionsProps) {
  const keys = team === "a" ? TEAM_A_KEYS : TEAM_B_KEYS;
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

  // 只有極短選項（≤3 字元）維持 2×2；其餘一行一選項，每格拿滿半邊寬度、縮字更輕
  const maxLen = Math.max(...options.map((o) => o.length));
  const useVertical = !showImages && maxLen > 3;

  return (
    <div className="flex flex-col gap-2 relative w-full h-full min-h-0">
      {/* Options grid — 2x2 default, 1-col when text is long；填滿帶高 */}
      <div
        className={`grid ${useVertical ? "grid-cols-1" : "grid-cols-2"} gap-2 flex-1 min-h-0 auto-rows-fr`}
      >
        {options.map((option, index) => {
          const item = showImages
            ? vocabItems.find(
                (v) => v.text === option || v.translation === option,
              )
            : undefined;
          return (
            <OptionButton
              key={`${option}-${index}`}
              team={team}
              option={option}
              keyLabel={OPTION_LABELS[index]}
              disabled={disabled}
              isCooldown={isCooldown}
              onSelect={onSelect}
              showImages={showImages}
              imageUrl={item?.image_url}
              useHandwriteFont={useHandwriteFont}
              correctAnswer={correctAnswer}
              reveal={reveal}
            />
          );
        })}
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
