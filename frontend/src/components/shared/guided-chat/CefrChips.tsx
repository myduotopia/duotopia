/**
 * CEFR 程度單選小方塊（A1～C2）（Issue #1158 C 段 commit 3）。
 *
 * 原本情境對話的「文章難度」（`ScenarioSetupChat`）與「題目難度」（`QuestionSettingsCard`）
 * 各寫了一份一模一樣的按鈕列，合成這一份。選中的是藍底白字，其餘灰底；以 `aria-pressed`
 * 標示目前選的。
 *
 * 用法：
 * ```tsx
 * <CefrChips value={level} onChange={setLevel} />
 * ```
 */
import { cn } from "@/lib/utils";

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export interface CefrChipsProps {
  value: string;
  onChange: (level: string) => void;
  /** 整列的無障礙名稱（旁邊沒有可見標題時給） */
  ariaLabel?: string;
  className?: string;
}

export function CefrChips({
  value,
  onChange,
  ariaLabel,
  className,
}: CefrChipsProps) {
  return (
    <div
      className={cn("flex flex-wrap gap-1", className)}
      role={ariaLabel ? "group" : undefined}
      aria-label={ariaLabel}
    >
      {CEFR_LEVELS.map((lv) => (
        <button
          key={lv}
          type="button"
          aria-pressed={value === lv}
          onClick={() => onChange(lv)}
          className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
            value === lv
              ? "bg-blue-600 text-white shadow-sm"
              : "bg-gray-200 text-gray-700 hover:bg-gray-300"
          }`}
        >
          {lv}
        </button>
      ))}
    </div>
  );
}
