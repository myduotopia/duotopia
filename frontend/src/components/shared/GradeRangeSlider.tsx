/**
 * GradeRangeSlider — K12 年段兩點拉桿（共用元件，批次設定與單題設定共用）。
 *
 * 專案沒裝 radix slider，沿用既有做法用原生 <input type="range">，兩支疊在同一軌道上：
 * 下層 min、上層 max；拖曳時互相夾住（min ≤ max）。刻度 1…12，目前值顯示在軌道上方。
 * value 為 [min|null, max|null]；「不限」鍵清成 [null, null]（顯示成整段淡色）。
 */
import { useTranslation } from "react-i18next";

export type GradeRange = [number | null, number | null];

export const GRADE_MIN = 1;
export const GRADE_MAX = 12;

export interface GradeRangeSliderProps {
  value: GradeRange;
  onChange: (next: GradeRange) => void;
  disabled?: boolean;
  /** 單題卡片用的緊湊版（刻度字更小） */
  compact?: boolean;
  "data-testid"?: string;
}

const TICKS = Array.from(
  { length: GRADE_MAX - GRADE_MIN + 1 },
  (_, i) => GRADE_MIN + i,
);

export function GradeRangeSlider({
  value,
  onChange,
  disabled = false,
  compact = false,
  "data-testid": testId = "grade-range-slider",
}: GradeRangeSliderProps) {
  const { t } = useTranslation();
  const [minV, maxV] = value;
  const unlimited = minV === null && maxV === null;
  // 拉桿本身永遠要有數字：沒設定時用全範圍畫
  const lo = minV ?? GRADE_MIN;
  const hi = maxV ?? GRADE_MAX;
  const pct = (n: number) => ((n - GRADE_MIN) / (GRADE_MAX - GRADE_MIN)) * 100;

  const setMin = (n: number) => onChange([Math.min(n, hi), hi]);
  const setMax = (n: number) => onChange([lo, Math.max(n, lo)]);

  const label = unlimited
    ? t("questionBank.form.gradeAny")
    : lo === hi
      ? t("questionBank.gradeSingle", { grade: lo })
      : t("questionBank.gradeRange", { min: lo, max: hi });

  return (
    <div className="space-y-1" data-testid={testId}>
      <div className="flex items-center justify-between">
        <span
          className={`${compact ? "text-xs" : "text-sm"} font-medium ${
            unlimited ? "text-gray-400" : "text-gray-800"
          }`}
          data-testid={`${testId}-label`}
        >
          {label}
        </span>
        {!disabled && !unlimited && (
          <button
            type="button"
            onClick={() => onChange([null, null])}
            className="text-xs text-gray-500 hover:text-gray-800 underline-offset-2 hover:underline"
            data-testid={`${testId}-clear`}
          >
            {t("questionBank.form.gradeAny")}
          </button>
        )}
      </div>

      {/* 軌道 + 兩支 range 疊合 */}
      <div className="relative h-6">
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-gray-200" />
        <div
          className={`absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full ${
            unlimited ? "bg-gray-300" : "bg-blue-500"
          }`}
          style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
        />
        <input
          type="range"
          min={GRADE_MIN}
          max={GRADE_MAX}
          step={1}
          value={lo}
          disabled={disabled}
          onChange={(e) => setMin(Number(e.target.value))}
          className="grade-range-thumb absolute inset-0 w-full appearance-none bg-transparent pointer-events-none"
          aria-label={t("questionBank.form.gradeMinLabel")}
          data-testid={`${testId}-min`}
        />
        <input
          type="range"
          min={GRADE_MIN}
          max={GRADE_MAX}
          step={1}
          value={hi}
          disabled={disabled}
          onChange={(e) => setMax(Number(e.target.value))}
          className="grade-range-thumb absolute inset-0 w-full appearance-none bg-transparent pointer-events-none"
          aria-label={t("questionBank.form.gradeMaxLabel")}
          data-testid={`${testId}-max`}
        />
      </div>

      {/* 刻度 */}
      <div
        className={`flex justify-between ${compact ? "text-[10px]" : "text-xs"} text-gray-400 select-none`}
      >
        {TICKS.map((n) => (
          <span
            key={n}
            className={
              !unlimited && n >= lo && n <= hi
                ? "text-blue-600 font-medium"
                : ""
            }
          >
            {n}
          </span>
        ))}
      </div>
    </div>
  );
}
