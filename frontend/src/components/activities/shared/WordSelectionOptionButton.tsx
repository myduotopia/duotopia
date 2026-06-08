/**
 * WordSelectionOptionButton — 單字選擇題選項按鈕（艾賓浩斯版 & 小考版共用）
 *
 * 設計：
 * - 4 色循環（OPTION_COLORS）：藍 / 紫 / 琥珀 / 青，由呼叫端傳 colorIndex
 * - 圖片模式 (showAsImage=true 且有 imageUrl)：上圖下標籤
 * - 字級自適應：button 內層 div 套 [container-type:size]，文字 max 字級用 cqh + cqw min() 隨選項框縮放
 *   （#842：改為 content-aware shrink-to-fit — useShrinkToFit hook 量測 overflow 後動態縮字，
 *    取代純 clamp()，確保長文字完整顯示而非 ... 截斷。min: 純文字 10px、圖片模式 8px）
 * - 揭示態（quiz 模式不傳 showCorrect/showIncorrect）：
 *   - showCorrect → 綠底/邊/字 + 左上角 ✓
 *   - showIncorrect → 紅底/邊/字 + 左上角 ✗
 *   - 兩者皆無 + 答題已揭示但這顆不是正解也不是學生選的 → opacity-50 淡化
 * - 選中態（!showResult）：ring-2 ring-indigo-400 + scale-95
 */

import { useRef } from "react";
import { CheckCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShrinkToFit } from "./useShrinkToFit";

export const OPTION_COLORS = [
  "bg-blue-50 border-blue-200 hover:bg-blue-100 hover:border-blue-400",
  "bg-purple-50 border-purple-200 hover:bg-purple-100 hover:border-purple-400",
  "bg-amber-50 border-amber-200 hover:bg-amber-100 hover:border-amber-400",
  "bg-teal-50 border-teal-200 hover:bg-teal-100 hover:border-teal-400",
] as const;

interface Props {
  text: string;
  imageUrl?: string | null;
  showAsImage: boolean;
  colorIndex: number;
  isSelected: boolean;
  disabled?: boolean;
  onClick: () => void;
  // 揭示態（小考模式答題中永遠不傳；艾賓浩斯答完一題會傳）
  showResult?: boolean;
  showCorrect?: boolean;
  showIncorrect?: boolean;
  animateReveal?: boolean;
}

export default function WordSelectionOptionButton({
  text,
  imageUrl,
  showAsImage,
  colorIndex,
  isSelected,
  disabled,
  onClick,
  showResult,
  showCorrect,
  showIncorrect,
  animateReveal,
}: Props) {
  const renderAsImage = showAsImage && !!imageUrl;
  const dimmed = showResult && !showCorrect && !showIncorrect;

  // #842 content-aware shrink：max 比例對齊原 cqh/cqw，min 守住可讀下限
  // ready=false 時 span 以 opacity-0 隱藏，避免閃過 fallback 字型 / 過大字
  const textSpanRef = useRef<HTMLSpanElement>(null);
  const { fontSize, ready } = useShrinkToFit(textSpanRef, {
    maxRatio: renderAsImage ? { h: 0.1, w: 0.08 } : { h: 0.16, w: 0.11 },
    minFontSize: renderAsImage ? 7 : 8,
    deps: [text, renderAsImage],
  });

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={text}
      className={cn(
        "h-full min-h-[5rem] py-1 px-3 sm:py-1 sm:px-4 font-medium",
        "grid overflow-hidden",
        "rounded-2xl border-2 shadow-md select-none relative",
        "transition-all duration-200",
        "whitespace-normal text-center break-words",
        !showResult &&
          !disabled &&
          "hover:shadow-lg hover:-translate-y-0.5 active:scale-95",
        !showResult && OPTION_COLORS[colorIndex % OPTION_COLORS.length],
        showCorrect &&
          "bg-green-100 border-green-500 text-green-800 shadow-green-200",
        showIncorrect &&
          "bg-red-100 border-red-500 text-red-800 shadow-red-200",
        isSelected && !showResult && "ring-[6px] ring-indigo-500 scale-95",
        dimmed && "opacity-50",
      )}
    >
      {(showCorrect || showIncorrect) && (
        <span
          className={cn(
            "absolute top-2 left-2 z-10",
            animateReveal && "animate-in zoom-in-50 fade-in duration-500",
          )}
        >
          {showCorrect ? (
            <CheckCircle className="h-5 w-5 text-green-600" />
          ) : (
            <XCircle className="h-5 w-5 text-red-600" />
          )}
        </span>
      )}
      {/* 字級用 useShrinkToFit 量測 overflow 後動態縮放（取代純 clamp） */}
      <div className="w-full h-full flex flex-col items-center justify-center gap-2">
        {renderAsImage ? (
          <>
            <img
              src={imageUrl as string}
              alt={text}
              className="flex-1 min-h-0 w-full object-contain rounded-md"
            />
            <span
              ref={textSpanRef}
              className={cn(
                "shrink-0 inline-block leading-tight break-words w-full max-w-full overflow-hidden transition-opacity duration-150 px-2 py-1.5",
                ready ? "opacity-100" : "opacity-0",
              )}
              style={{ fontSize: `${fontSize}px` }}
            >
              {text}
            </span>
          </>
        ) : (
          <span
            ref={textSpanRef}
            className={cn(
              "inline-block leading-tight break-words w-full max-w-full max-h-full overflow-hidden transition-opacity duration-150 px-2 py-3 sm:py-4",
              ready ? "opacity-100" : "opacity-0",
            )}
            style={{ fontSize: `${fontSize}px` }}
          >
            {text}
          </span>
        )}
      </div>
    </button>
  );
}
