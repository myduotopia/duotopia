/**
 * BatchSettingCard — 左側批次工作區的卡片殼（共用元件）。
 *
 * 樣式對齊 BatchTTSSettings / BatchTranslateSettings 的 card variant（淡底、邊框、
 * 標題列 icon + 粗體標題），讓題庫／未來題型的「考點、年段、教材關聯、來源、公開設定」
 * 等批次卡片與單字集左欄長得一致，不必每種題型各畫一次。
 *
 * headerRight：標題列右側 slot（例如「套用到全部」按鈕）。
 */
import type { ReactNode } from "react";

export type BatchSettingTone =
  | "yellow"
  | "blue"
  | "purple"
  | "green"
  | "orange"
  | "gray";

const TONE_CLASS: Record<BatchSettingTone, string> = {
  yellow: "bg-yellow-50/60 border-yellow-200",
  blue: "bg-blue-50/60 border-blue-200",
  purple: "bg-purple-50/60 border-purple-200",
  green: "bg-emerald-50/60 border-emerald-200",
  orange: "bg-orange-50/60 border-orange-200",
  gray: "bg-gray-50 border-gray-200",
};

export interface BatchSettingCardProps {
  icon?: ReactNode;
  title: string;
  /** 標題下方一行小字說明 */
  hint?: string;
  tone?: BatchSettingTone;
  headerRight?: ReactNode;
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function BatchSettingCard({
  icon,
  title,
  hint,
  tone = "gray",
  headerRight,
  children,
  className = "",
  "data-testid": testId,
}: BatchSettingCardProps) {
  return (
    <div
      className={`rounded-lg border ${TONE_CLASS[tone]} ${className}`}
      data-testid={testId}
    >
      <div className="flex items-center gap-2 p-2.5">
        {icon && <span className="shrink-0 flex items-center">{icon}</span>}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-800">{title}</div>
          {hint && <div className="text-xs text-gray-500">{hint}</div>}
        </div>
        {headerRight}
      </div>
      {children !== undefined && children !== null && (
        <div className="px-2.5 pb-2.5">{children}</div>
      )}
    </div>
  );
}
