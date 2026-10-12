/**
 * GradeFilterSelect — 班級清單的年級篩選（全部／1–12／未設定，#1097）
 *
 * 值為 GRADE_FILTER_ALL、GRADE_FILTER_UNSET 或 "1"–"12"；
 * 搭配 classroomGrade.matchesGradeFilter 使用。
 */
import { useTranslation } from "react-i18next";
import {
  GRADE_FILTER_ALL,
  GRADE_FILTER_UNSET,
  GRADE_OPTIONS,
  formatGradeLabel,
} from "./classroomGrade";

export interface GradeFilterSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function GradeFilterSelect({
  value,
  onChange,
  className,
}: GradeFilterSelectProps) {
  const { t } = useTranslation();

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={t("classroomGrade.filter.label")}
      className={
        className ??
        "px-3 py-2 border dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md text-sm"
      }
    >
      <option value={GRADE_FILTER_ALL}>{t("classroomGrade.filter.all")}</option>
      {GRADE_OPTIONS.map((grade) => (
        <option key={grade} value={String(grade)}>
          {formatGradeLabel(t, grade)}
        </option>
      ))}
      <option value={GRADE_FILTER_UNSET}>
        {t("classroomGrade.filter.unset")}
      </option>
    </select>
  );
}

export default GradeFilterSelect;
