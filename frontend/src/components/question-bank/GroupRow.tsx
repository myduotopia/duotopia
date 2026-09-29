/**
 * 題庫列表的題組列（#1082）。
 *
 * 與單題列同欄位：☑ | 標題＋文章預覽（點開題組編輯面板）| 題型「閱讀題組」| 年級 |
 * 考點（小題聯集，唯讀）| 來源（小題聯集，唯讀）| 公開（可快速編輯）。
 * 可勾選進批次刪除／儲存；列尾「刪除題組」用 Dialog 確認（整組含小題）。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  examPointLabel,
  type QuestionGroupListRow,
  type QuestionType,
  type QuestionVisibility,
} from "@/types/questionBank";
import { ChipCell, formatGrade, InlineVisibility } from "./listCells";

const PREVIEW_CHARS = 120;

export interface GroupRowProps {
  row: QuestionGroupListRow;
  /** 題組類題型的顯示名稱（「閱讀題組」） */
  typeLabel: (type: QuestionType) => string;
  checked: boolean;
  /** 公開設定被快速編輯後的值（未改為 undefined） */
  editedVisibility?: QuestionVisibility;
  busy: boolean;
  onToggle: (on: boolean) => void;
  onChangeVisibility: (v: QuestionVisibility) => void;
  onSelect?: (row: QuestionGroupListRow) => void;
  onDelete?: (row: QuestionGroupListRow) => Promise<void> | void;
}

export default function GroupRow({
  row,
  typeLabel,
  checked,
  editedVisibility,
  busy,
  onToggle,
  onChangeVisibility,
  onSelect,
  onDelete,
}: GroupRowProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dirty = editedVisibility !== undefined;
  const visibility = editedVisibility ?? row.visibility;
  const preview = row.preview.slice(0, PREVIEW_CHARS);

  const confirmDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete(row);
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <tr
      className={`border-t border-gray-100 align-top ${
        dirty ? "bg-yellow-50" : ""
      }`}
      data-testid={`question-group-row-${row.id}`}
      data-dirty={dirty || undefined}
    >
      <td className="px-3 py-2.5">
        <Checkbox
          checked={checked}
          onCheckedChange={(c) => onToggle(c === true)}
          aria-label={t("questionBank.list.selectRow")}
          data-testid={`qb-check-g-${row.id}`}
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
            {row.title || preview || typeLabel(row.question_type)}
          </div>
          {row.title && preview && (
            <div className="mt-0.5 line-clamp-2 break-words text-xs text-gray-500">
              {preview}
            </div>
          )}
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
        {onDelete && row.can_edit && (
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-2 h-6 px-1.5 text-xs text-gray-400 hover:text-red-600"
              disabled={busy}
              onClick={() => setConfirmOpen(true)}
              data-testid={`qb-group-delete-${row.id}`}
            >
              <Trash2 size={12} />
              {t("questionBank.list.deleteGroup")}
            </Button>
            <DialogContent
              className="max-w-sm"
              data-testid={`qb-group-delete-dialog-${row.id}`}
            >
              <DialogHeader>
                <DialogTitle>{t("questionBank.list.deleteGroup")}</DialogTitle>
                <DialogDescription>
                  {t("questionBank.group.confirmDelete")}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={deleting}
                  onClick={() => setConfirmOpen(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={deleting}
                  onClick={confirmDelete}
                  data-testid={`qb-group-delete-confirm-${row.id}`}
                >
                  {t("questionBank.list.delete")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </td>
      <td className="px-2 py-2.5 text-gray-600 hidden sm:table-cell truncate">
        {typeLabel(row.question_type)}
      </td>
      <td className="px-2 py-2.5 text-gray-600 hidden lg:table-cell tabular-nums">
        {formatGrade(row.grade_min, row.grade_max)}
      </td>
      <td className="px-4 py-2 hidden xl:table-cell">
        <ChipCell
          labels={(row.exam_points ?? []).map((ep) => examPointLabel(ep, lang))}
        />
      </td>
      <td className="px-4 py-2 hidden md:table-cell">
        <ChipCell labels={row.sources.map((x) => x.name)} />
      </td>
      <td className="px-4 py-2 hidden lg:table-cell">
        <InlineVisibility
          value={visibility}
          onChange={onChangeVisibility}
          scope={row.organization_id ? "organization" : "personal"}
          disabled={!row.can_edit || busy}
          testId={`qb-group-${row.id}-visibility`}
        />
      </td>
    </tr>
  );
}
