/**
 * QuestionNumberNav — 題號方格導覽（共用元件，#1112 C4）。
 *
 * 一格一題、格子裡是題號（或呼叫端給的短字，例如原卷題號「41」、批改頁的 ✓／✗），
 * 依每題狀態上色；點一格回呼 `onSelect`。只標色、不移動題目。
 *
 * 第一個使用者是上傳題本的核對畫面（琥珀＝缺答案、紅＝處理失敗、灰虛線＝處理中、藍＝題庫已有）。
 * 設計時對過各作答頁自己寫的 7 處方格（學生作答／老師預覽／Demo、單字朗讀、三種單字小考、
 * 批改頁總評、sample 頁），props 都接得上，之後另開 issue 逐處換成本元件：
 * - `tone`：每格狀態色（default 白底灰框／success 綠／error 紅／warning 琥珀／info 藍／
 *   neutral 灰底／pending 灰虛線）
 * - `fill`：soft（淡底深字＋框，預設）／solid（實心底白字，批改頁總評用）
 * - `current`：目前這題的樣子。outline（粗框＋淡底，預設）／solid（整格填 accent 色，小考與
 *   sample 頁用）；`accent` 選 blue（預設）／amber／emerald／pink（各作業類型的代表色）
 * - `marker`：格子左邊一條短豎線（需注意的題）
 * - `size`：md＝44px 觸控目標（預設）／sm＝32px（h-8，作答頁現有大小）
 * - `layout`：grid（換行方格，`columns` 欄）／row（一列、超出水平捲動）
 * - `readOnly` 或單格 `disabled`：不能點（只顯示狀態）
 * - `children`：接在方格後面同一列的內容（例如作答頁的提交鈕，顯示規則由呼叫端決定）
 * 每格都是 `<button>`，`aria-label`／`title` 由呼叫端傳（本元件不綁 i18n 命名空間）；
 * 目前這格帶 `aria-current="step"`。
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type QuestionNumberTone =
  | "default"
  | "success"
  | "error"
  | "warning"
  | "info"
  | "neutral"
  | "pending";

export type QuestionNumberAccent = "blue" | "amber" | "emerald" | "pink";

export interface QuestionNumberNavItem {
  key: string;
  /** 格子裡的字：題號、原卷題號或短符號 */
  label: string;
  tone?: QuestionNumberTone;
  /** 左側短豎線（需注意的題） */
  marker?: boolean;
  /** 滑鼠移上去的說明 */
  title?: string;
  /** 報讀用的完整說明（例如「第 12 題，缺答案」）；沒給用 title，再沒有用 label */
  ariaLabel?: string;
  disabled?: boolean;
}

export interface QuestionNumberNavProps {
  items: QuestionNumberNavItem[];
  currentKey?: string | null;
  onSelect?: (key: string, index: number) => void;
  size?: "md" | "sm";
  layout?: "grid" | "row";
  /** grid 每列幾格（預設 5） */
  columns?: number;
  fill?: "soft" | "solid";
  current?: "outline" | "solid";
  accent?: QuestionNumberAccent;
  readOnly?: boolean;
  /** 整個導覽區的名稱（`<nav aria-label>`） */
  ariaLabel: string;
  className?: string;
  children?: ReactNode;
  testId?: string;
}

const SOFT: Record<QuestionNumberTone, string> = {
  default: "bg-white text-gray-600 border-gray-300",
  success: "bg-green-100 text-green-800 border-green-400",
  error: "bg-red-100 text-red-800 border-red-400",
  warning: "bg-amber-100 text-amber-800 border-amber-400",
  info: "bg-blue-100 text-blue-800 border-blue-400",
  neutral: "bg-gray-200 text-gray-600 border-gray-200",
  pending: "bg-white text-gray-400 border-dashed border-gray-300",
};

const SOLID: Record<QuestionNumberTone, string> = {
  default: "bg-gray-100 text-gray-600 border-gray-100",
  success: "bg-green-500 text-white border-green-500 shadow-sm",
  error: "bg-red-500 text-white border-red-500 shadow-sm",
  warning: "bg-amber-500 text-white border-amber-500 shadow-sm",
  info: "bg-blue-500 text-white border-blue-500 shadow-sm",
  neutral: "bg-gray-200 text-gray-600 border-gray-200",
  pending: "bg-gray-100 text-gray-400 border-dashed border-gray-300",
};

const MARKER: Record<QuestionNumberTone, string> = {
  default: "bg-gray-400",
  success: "bg-green-500",
  error: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
  neutral: "bg-gray-400",
  pending: "bg-gray-300",
};

/** 可點的白格 hover 時框線變 accent 色 */
const HOVER: Record<QuestionNumberAccent, string> = {
  blue: "hover:border-blue-400",
  amber: "hover:border-amber-400",
  emerald: "hover:border-emerald-400",
  pink: "hover:border-pink-400",
};

/** 目前這題：粗框（＋白格時淡底） */
const CURRENT_OUTLINE: Record<QuestionNumberAccent, string> = {
  blue: "border-2 border-blue-600",
  amber: "border-2 border-amber-600",
  emerald: "border-2 border-emerald-600",
  pink: "border-2 border-pink-600",
};
const CURRENT_TINT: Record<QuestionNumberAccent, string> = {
  blue: "bg-blue-50",
  amber: "bg-amber-50",
  emerald: "bg-emerald-50",
  pink: "bg-pink-50",
};
const CURRENT_SOLID: Record<QuestionNumberAccent, string> = {
  blue: "bg-blue-500 text-white border-blue-500",
  amber: "bg-amber-500 text-white border-amber-500",
  emerald: "bg-emerald-500 text-white border-emerald-500",
  pink: "bg-pink-500 text-white border-pink-500",
};

export function questionNumberCellClass(
  item: QuestionNumberNavItem,
  opts: {
    isCurrent: boolean;
    fill: "soft" | "solid";
    current: "outline" | "solid";
    accent: QuestionNumberAccent;
    clickable: boolean;
  },
): string {
  const tone = item.tone ?? "default";
  if (opts.isCurrent && opts.current === "solid")
    return CURRENT_SOLID[opts.accent];
  const base = (opts.fill === "solid" ? SOLID : SOFT)[tone];
  return cn(
    base,
    opts.clickable &&
      tone === "default" &&
      opts.fill === "soft" &&
      HOVER[opts.accent],
    opts.isCurrent && CURRENT_OUTLINE[opts.accent],
    opts.isCurrent && tone === "default" && CURRENT_TINT[opts.accent],
  );
}

export function QuestionNumberNav({
  items,
  currentKey = null,
  onSelect,
  size = "md",
  layout = "grid",
  columns = 5,
  fill = "soft",
  current = "outline",
  accent = "blue",
  readOnly = false,
  ariaLabel,
  className,
  children,
  testId = "question-number-nav",
}: QuestionNumberNavProps) {
  const sizeClass =
    size === "md" ? "h-11 min-w-11 px-1 text-sm" : "h-8 min-w-8 px-0.5 text-xs";
  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        layout === "row"
          ? "flex min-w-0 items-center gap-1 overflow-x-auto py-1"
          : "grid gap-1.5",
        className,
      )}
      style={
        layout === "grid"
          ? {
              gridTemplateColumns: `repeat(${columns}, minmax(0, max-content))`,
            }
          : undefined
      }
      data-testid={testId}
    >
      {items.map((item, index) => {
        const isCurrent = item.key === currentKey;
        const clickable = !readOnly && !item.disabled && !!onSelect;
        return (
          <button
            key={item.key}
            type="button"
            onClick={clickable ? () => onSelect?.(item.key, index) : undefined}
            disabled={item.disabled}
            aria-disabled={readOnly || undefined}
            aria-current={isCurrent ? "step" : undefined}
            aria-label={item.ariaLabel ?? item.title ?? item.label}
            title={item.title}
            className={cn(
              "relative inline-flex shrink-0 items-center justify-center rounded border font-medium transition-colors",
              sizeClass,
              questionNumberCellClass(item, {
                isCurrent,
                fill,
                current,
                accent,
                clickable,
              }),
              clickable ? "cursor-pointer" : "cursor-default",
              item.disabled && "opacity-60",
            )}
            data-testid={`${testId}-cell-${item.key}`}
            data-tone={item.tone ?? "default"}
          >
            {item.marker && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute -left-1 top-1/2 h-4 w-1 -translate-y-1/2 rounded-full",
                  MARKER[item.tone ?? "default"],
                )}
                data-testid={`${testId}-marker-${item.key}`}
              />
            )}
            {item.label}
          </button>
        );
      })}
      {children}
    </nav>
  );
}

export default QuestionNumberNav;
