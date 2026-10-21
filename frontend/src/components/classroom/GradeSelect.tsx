/**
 * GradeSelect — 班級表單用的年級下拉（1–12，#1097）
 *
 * 值為 null 時顯示「請選擇年級」佔位選項；必填檢查由呼叫端負責。
 * allowEmpty={false}（#1139 批次編輯）：不提供空白選項，已有年級的班不能清回「未設定」；
 * 只在值已是有效年級時生效，值為 null 時仍顯示佔位選項，避免下拉誤顯示成 1 年級。
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
  /** false＝不提供空白（請選擇年級）選項；預設 true */
  allowEmpty?: boolean;
}

export function GradeSelect({
  value,
  onChange,
  id,
  className,
  disabled,
  "aria-label": ariaLabel,
  allowEmpty = true,
}: GradeSelectProps) {
  const { t } = useTranslation();
  const showEmptyOption = allowEmpty || !isValidGrade(value);

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
      {showEmptyOption && (
        <option value="">{t("classroomGrade.selectPlaceholder")}</option>
      )}
      {GRADE_OPTIONS.map((grade) => (
        <option key={grade} value={String(grade)}>
          {formatGradeLabel(t, grade)}
        </option>
      ))}
    </select>
  );
}

export default GradeSelect;
