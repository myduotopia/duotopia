/**
 * VisibilitySelect — 公開設定下拉（共用元件）。
 *
 * 題庫只用兩個值（使用者定案）：
 * - scope="personal"（個人題庫）：private「私人」／ public「公開」
 * - scope="organization"（機構題庫）：private「僅機構」／ public「公開」
 *   機構題庫對該機構成員本來就一律可見（後端 visible_questions_query），所以「僅機構」
 *   不需要新值，就是機構題庫 + private。
 * 型別仍是 QuestionVisibility（含 organization_only / individual_only），後端照舊接受，
 * 只是這裡不再提供那兩個選項。
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

export type VisibilityScope = "personal" | "organization";

const OPTIONS: QuestionVisibility[] = ["private", "public"];

/** private 在機構題庫顯示成「僅機構」；列表 badge 也用這個對照 */
export function visibilityLabelKey(
  visibility: QuestionVisibility,
  scope: VisibilityScope,
): string {
  if (visibility === "private" && scope === "organization")
    return "questionBank.visibility.organizationPrivate";
  return `questionBank.visibility.${visibility}`;
}

export interface VisibilitySelectProps {
  value: QuestionVisibility | null;
  onChange: (next: QuestionVisibility) => void;
  scope?: VisibilityScope;
  disabled?: boolean;
  /** 未選時顯示紅框（必選） */
  required?: boolean;
  /** 一掛載就展開（列表「點格子才出現下拉」用） */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  "data-testid"?: string;
}

export function VisibilitySelect({
  value,
  onChange,
  scope = "personal",
  disabled = false,
  required = false,
  defaultOpen,
  onOpenChange,
  "data-testid": testId = "visibility-select",
}: VisibilitySelectProps) {
  const { t } = useTranslation();
  const invalid = required && value === null;
  return (
    <Select
      value={value ?? ""}
      onValueChange={(v) => onChange(v as QuestionVisibility)}
      disabled={disabled}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
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
        {OPTIONS.map((v) => (
          <SelectItem key={v} value={v} data-testid={`${testId}-option-${v}`}>
            {t(visibilityLabelKey(v, scope))}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
