/**
 * VisibilitySelect — 公開設定下拉（共用元件）。
 *
 * 值域與 ProgramVisibility 相同：private / public / organization_only / individual_only。
 * `required` 時 value 可為 null（不預設），未選顯示 placeholder；由呼叫端擋儲存。
 */
import { useTranslation } from "react-i18next";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { QuestionVisibility } from "@/types/questionBank";

const VISIBILITIES: QuestionVisibility[] = [
  "private",
  "public",
  "organization_only",
  "individual_only",
];

export interface VisibilitySelectProps {
  value: QuestionVisibility | null;
  onChange: (next: QuestionVisibility) => void;
  disabled?: boolean;
  /** 未選時顯示紅框（必選） */
  required?: boolean;
  "data-testid"?: string;
}

export function VisibilitySelect({
  value,
  onChange,
  disabled = false,
  required = false,
  "data-testid": testId = "visibility-select",
}: VisibilitySelectProps) {
  const { t } = useTranslation();
  const invalid = required && value === null;
  return (
    <Select
      value={value ?? ""}
      onValueChange={(v) => onChange(v as QuestionVisibility)}
      disabled={disabled}
    >
      <SelectTrigger
        className={`h-9 ${invalid ? "border-red-300" : ""}`}
        data-testid={testId}
        aria-invalid={invalid || undefined}
      >
        <SelectValue
          placeholder={t("questionBank.form.visibilityPlaceholder")}
        />
      </SelectTrigger>
      <SelectContent>
        {VISIBILITIES.map((v) => (
          <SelectItem key={v} value={v}>
            {t(`questionBank.visibility.${v}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
