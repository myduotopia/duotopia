/**
 * WordSelectionOptionButton — 單字選擇題選項按鈕（艾賓浩斯版 & 小考版共用）
 *
 * 設計：
 * - 4 色循環（OPTION_COLORS）：藍 / 紫 / 琥珀 / 青，由呼叫端傳 colorIndex
 * - 圖片模式 (showAsImage=true 且有 imageUrl)：上圖下標籤
 * - 字級自適應：button 內層 div 套 [container-type:size]，文字用 cqh + cqw min() 隨選項框縮放
 * - 揭示態（quiz 模式不傳 showCorrect/showIncorrect）：
 *   - showCorrect → 綠底/邊/字 + 左上角 ✓
 *   - showIncorrect → 紅底/邊/字 + 左上角 ✗
 *   - 兩者皆無 + 答題已揭示但這顆不是正解也不是學生選的 → opacity-50 淡化
 * - 選中態（!showResult）：ring-2 ring-indigo-400 + scale-95
 */

import { CheckCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

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

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={text}
      className={cn(
        "h-full min-h-[5rem] py-3 px-3 sm:py-4 sm:px-4 font-medium",
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
        isSelected && !showResult && "ring-2 ring-indigo-400 scale-95",
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
      {/* 內層 div = container query root，cqh/cqw 依此 div 大小算（button 對 container-type 有 quirk） */}
      <div className="w-full h-full flex flex-col items-center justify-center gap-2 [container-type:size]">
        {renderAsImage ? (
          <>
            <img
              src={imageUrl as string}
              alt={text}
              className="flex-1 min-h-0 w-full object-contain rounded-md"
            />
            <span className="shrink-0 leading-tight break-words line-clamp-2 text-[clamp(1rem,min(13cqh,10cqw),2.75rem)]">
              {text}
            </span>
          </>
        ) : (
          <span className="leading-tight break-words line-clamp-4 text-[clamp(1rem,min(20cqh,14cqw),5rem)]">
            {text}
          </span>
        )}
      </div>
    </button>
  );
}
