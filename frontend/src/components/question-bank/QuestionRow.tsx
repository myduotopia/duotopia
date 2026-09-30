/**
 * 題庫列表的單題列（#1082 自 QuestionBankTab 拆出）。
 *
 * 勾選、題目（點開編輯面板）、題型、年級，以及三個可快速編輯的欄位：
 * 考點／考題來源／公開（點整格才出選單、選完關閉）。編輯狀態由父層持有。
 */

import { useTranslation } from "react-i18next";

import { Checkbox } from "@/components/ui/checkbox";
import type { ComboboxItem } from "@/components/shared/CreatableCombobox";
import { CreatableCombobox } from "@/components/shared/CreatableCombobox";
import ExamPointPicker from "@/components/shared/ExamPointPicker";
import {
  examPointLabel,
  type ExamPoint,
  type Question,
  type QuestionType,
  type QuestionVisibility,
} from "@/types/questionBank";
import {
  ChipCell,
  formatGrade,
  InlineVisibility,
  OptionGrid,
} from "./listCells";
import { searchSources } from "./sourcesCombobox";

/** 列表可快速編輯的三個欄位 */
export interface RowEdit {
  exam_points: ExamPoint[];
  sources: ComboboxItem[];
  visibility: QuestionVisibility;
}

export interface QuestionRowProps {
  q: Question;
  edit: RowEdit;
  dirty: boolean;
  editable: boolean;
  checked: boolean;
  busy: boolean;
  typeLabel: (type: QuestionType) => string;
  createSource: (name: string) => Promise<ComboboxItem>;
  onToggle: (on: boolean) => void;
  onPatch: (patch: Partial<RowEdit>) => void;
  onSelect?: (question: Question) => void;
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

export default function QuestionRow({
  q,
  edit: e,
  dirty,
  editable,
  checked,
  busy,
  typeLabel,
  createSource,
  onToggle,
  onPatch,
  onSelect,
}: QuestionRowProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  return (
    <tr
      className={`border-t border-gray-100 align-top ${
        dirty ? "bg-yellow-50" : ""
      }`}
      data-testid={`question-row-${q.id}`}
      data-dirty={dirty || undefined}
    >
      <td className="px-3 py-2.5">
        <Checkbox
          checked={checked}
          onCheckedChange={(c) => onToggle(c === true)}
          aria-label={t("questionBank.list.selectRow")}
          data-testid={`qb-check-${q.id}`}
        />
      </td>
      <td className="px-4 py-2.5 text-gray-900">
        <button
          type="button"
          onClick={() => onSelect?.(q)}
          className={`text-left w-full ${
            onSelect ? "hover:underline" : "cursor-default"
          }`}
          data-testid={`qb-stem-${q.id}`}
        >
          <div className="line-clamp-2 break-words">
            {q.stem || (q.image_url ? "🖼" : "")}
          </div>
          {q.question_type === "multiple_choice" && q.options.length > 0 && (
            <OptionGrid options={q.options} />
          )}
        </button>
        {!q.is_owner && (
          <span className="text-xs text-gray-400">
            {q.is_platform
              ? t("questionBank.owner.platform")
              : t("questionBank.owner.other")}
          </span>
        )}
      </td>
      <td className="px-2 py-2.5 text-gray-600 hidden sm:table-cell truncate">
        {typeLabel(q.question_type)}
      </td>
      <td className="px-2 py-2.5 text-gray-600 hidden lg:table-cell tabular-nums">
        {formatGrade(q.grade_min, q.grade_max)}
      </td>
      <td className="px-4 py-2 hidden xl:table-cell" onClick={stop}>
        <ExamPointPicker
          value={e.exam_points}
          onChange={(exam_points) => onPatch({ exam_points })}
          disabled={!editable || busy}
          compact
          closeOnSelect
          renderTrigger={() => (
            <ChipCell
              labels={e.exam_points.map((ep) => examPointLabel(ep, lang))}
            />
          )}
          data-testid={`qb-row-${q.id}-exam-points`}
        />
      </td>
      <td className="px-4 py-2 hidden md:table-cell" onClick={stop}>
        <CreatableCombobox
          value={e.sources}
          onChange={(sources) => onPatch({ sources })}
          onSearch={searchSources}
          onCreate={createSource}
          disabled={!editable || busy}
          triggerLabel={t("questionBank.form.batch.pickSources")}
          searchPlaceholder={t(
            "questionBank.form.batch.sourceSearchPlaceholder",
          )}
          emptyText={t("questionBank.form.batch.noSources")}
          createLabel={(name) =>
            t("questionBank.form.batch.createSource", { name })
          }
          closeOnSelect
          renderTrigger={() => (
            <ChipCell labels={e.sources.map((x) => x.label)} />
          )}
          data-testid={`qb-row-${q.id}-sources`}
        />
      </td>
      <td className="px-4 py-2 hidden lg:table-cell" onClick={stop}>
        <InlineVisibility
          value={e.visibility}
          onChange={(visibility) => onPatch({ visibility })}
          scope={q.organization_id ? "organization" : "personal"}
          disabled={!editable || busy}
          testId={`qb-row-${q.id}-visibility`}
        />
      </td>
    </tr>
  );
}
