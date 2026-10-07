/**
 * LevelSelect — 班級表單用的 CEFR 等級下拉（Pre-A／A1…C2，#1097）
 *
 * 選項來自 classroomLevel.CEFR_LEVELS；value 為標準等級（"preA"、"A1"…）。
 * 新增班級視窗、「我的班級」行內編輯共用。
 */
import {
  CEFR_LEVELS,
  DEFAULT_LEVEL,
  normalizeLevel,
  type ClassroomLevel,
} from "./classroomLevel";

export interface LevelSelectProps {
  value: string | null | undefined;
  onChange: (level: ClassroomLevel) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

export function LevelSelect({
  value,
  onChange,
  id,
  className,
  disabled,
  "aria-label": ariaLabel,
}: LevelSelectProps) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      disabled={disabled}
      value={normalizeLevel(value) ?? DEFAULT_LEVEL}
      onChange={(e) =>
        onChange(normalizeLevel(e.target.value) ?? DEFAULT_LEVEL)
      }
      className={
        className ??
        "w-full px-3 py-2 border dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md text-sm"
      }
    >
      {CEFR_LEVELS.map((l) => (
        <option key={l.value} value={l.value}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

export default LevelSelect;
