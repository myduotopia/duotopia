/**
 * 題庫列表的題組列（#1082）：點標題開題組編輯面板；不勾選、不快速編輯（整組操作在面板內）。
 */

import { useTranslation } from "react-i18next";

import { Checkbox } from "@/components/ui/checkbox";
import type { QuestionGroupListRow, QuestionType } from "@/types/questionBank";
import { ChipCell, formatGrade } from "./listCells";

export interface GroupRowProps {
  row: QuestionGroupListRow;
  typeLabel: (type: QuestionType) => string;
  onSelect?: (row: QuestionGroupListRow) => void;
}

export default function GroupRow({ row, typeLabel, onSelect }: GroupRowProps) {
  const { t } = useTranslation();
  return (
    <tr
      className="border-t border-gray-100 align-top"
      data-testid={`question-group-row-${row.id}`}
    >
      <td className="px-3 py-2.5">
        <Checkbox
          checked={false}
          disabled
          aria-label={t("questionBank.list.selectRow")}
        />
      </td>
      <td className="px-4 py-2.5 text-gray-900">
        <button
          type="button"
          onClick={() => onSelect?.(row)}
          className={`text-left w-full ${onSelect ? "hover:underline" : "cursor-default"}`}
          data-testid={`qb-group-title-${row.id}`}
        >
          <div className="line-clamp-2 break-words">
            {row.title || row.preview || typeLabel(row.question_type)}
          </div>
        </button>
        <span className="text-xs text-gray-500">
          {t("questionBank.list.groupQuestionCount", {
            count: row.question_count,
          })}
        </span>
        {!row.is_owner && (
          <span className="ml-2 text-xs text-gray-400">
            {row.is_platform
              ? t("questionBank.owner.platform")
              : t("questionBank.owner.other")}
          </span>
        )}
      </td>
      <td className="px-2 py-2.5 text-gray-600 hidden sm:table-cell truncate">
        {typeLabel(row.question_type)}
      </td>
      <td className="px-2 py-2.5 text-gray-600 hidden lg:table-cell tabular-nums">
        {formatGrade(row.grade_min, row.grade_max)}
      </td>
      <td className="px-4 py-2 hidden xl:table-cell" />
      <td className="px-4 py-2 hidden md:table-cell">
        <ChipCell labels={row.sources.map((x) => x.name)} />
      </td>
      <td className="px-4 py-2 hidden lg:table-cell text-gray-600">
        {t(`questionBank.visibility.${row.visibility}`)}
      </td>
    </tr>
  );
}
