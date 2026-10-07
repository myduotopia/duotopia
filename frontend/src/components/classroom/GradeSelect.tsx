/**
 * GradeSelect — 班級表單用的年級下拉（1–12，#1097）
 *
 * 值為 null 時顯示「請選擇年級」佔位選項；必填檢查由呼叫端負責。
 */
import { useTranslation } from "react-i18next";
import {
  GRADE_OPTIONS,
  formatGradeLabel,
  isValidGrade,
} from "./classroomGrade";

export interface GradeSelectProps {
  value: number | null | undefined;
  onChange: (grade: number | null) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

export function GradeSelect({
  value,
  onChange,
  id,
  className,
  disabled,
  "aria-label": ariaLabel,
}: GradeSelectProps) {
  const { t } = useTranslation();

  return (
    <select
      id={id}
      aria-label={ariaLabel}
      disabled={disabled}
      value={isValidGrade(value) ? String(value) : ""}
      onChange={(e) =>
        onChange(e.target.value === "" ? null : Number(e.target.value))
      }
      className={
        className ??
        "w-full px-3 py-2 border dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md text-sm"
      }
    >
      <option value="">{t("classroomGrade.selectPlaceholder")}</option>
      {GRADE_OPTIONS.map((grade) => (
        <option key={grade} value={String(grade)}>
          {formatGradeLabel(t, grade)}
        </option>
      ))}
    </select>
  );
}

export default GradeSelect;
