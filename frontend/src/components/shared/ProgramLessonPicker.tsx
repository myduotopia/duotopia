/**
 * ProgramLessonPicker — 「關聯教材下拉｜關聯單元下拉」一列（共用元件）。
 *
 * 批次設定與單題進階設定共用。value 為單一關聯（教材必選、單元選填）或 null。
 * 單元下拉依所選教材帶入 lessons；換教材時單元清空。
 */
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Program } from "@/types";

export interface ProgramLessonLink {
  program_id: number;
  lesson_id: number | null;
}

export interface ProgramLessonPickerProps {
  programs: Program[];
  value: ProgramLessonLink | null;
  onChange: (next: ProgramLessonLink | null) => void;
  disabled?: boolean;
  compact?: boolean;
  "data-testid"?: string;
}

export function ProgramLessonPicker({
  programs,
  value,
  onChange,
  disabled = false,
  compact = false,
  "data-testid": testId = "program-lesson-picker",
}: ProgramLessonPickerProps) {
  const { t } = useTranslation();
  const selectedProgram = value
    ? programs.find((p) => p.id === value.program_id)
    : undefined;
  const lessons = selectedProgram?.lessons ?? [];
  const h = compact ? "h-8 text-xs" : "h-9";

  return (
    <div className="flex items-center gap-2" data-testid={testId}>
      <Select
        value={value ? String(value.program_id) : ""}
        onValueChange={(v) =>
          onChange({ program_id: Number(v), lesson_id: null })
        }
        disabled={disabled}
      >
        <SelectTrigger
          className={`${h} flex-1 min-w-0`}
          data-testid={`${testId}-program`}
        >
          <SelectValue placeholder={t("questionBank.form.pickProgram")} />
        </SelectTrigger>
        <SelectContent>
          {programs.map((p) => (
            <SelectItem key={p.id} value={String(p.id)}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={value?.lesson_id ? String(value.lesson_id) : ""}
        onValueChange={(v) =>
          value && onChange({ ...value, lesson_id: v ? Number(v) : null })
        }
        disabled={disabled || !value || lessons.length === 0}
      >
        <SelectTrigger
          className={`${h} flex-1 min-w-0`}
          data-testid={`${testId}-lesson`}
        >
          <SelectValue
            placeholder={t("questionBank.form.pickLessonOptional")}
          />
        </SelectTrigger>
        <SelectContent>
          {lessons.map((l) => (
            <SelectItem key={l.id} value={String(l.id)}>
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value && !disabled && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-gray-400 hover:text-gray-700 shrink-0"
          aria-label={t("questionBank.form.removeLink")}
          data-testid={`${testId}-clear`}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
