/**
 * 題庫列表底部動作列（Issue #1061）。
 *
 * 列表有任何勾選時浮現：儲存（只送有改過的列）、刪除（刪所有勾選的列）、
 * 派發（先顯示，派發流程另開 issue 後接上）、取消選取。
 * 固定在畫面底部、寬度扣掉 sidebar（同編輯面板的 left: sidebarWidth）。
 */

import { useTranslation } from "react-i18next";
import { Loader2, Pencil, Save, Send, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSidebar } from "@/contexts/SidebarContext";

export interface QuestionBulkBarProps {
  selectedCount: number;
  /** 有修改尚未儲存的列數 */
  dirtyCount: number;
  onSave: () => void;
  onDelete: () => void;
  /** 未傳 = 派發尚未實作（顯示但 disabled） */
  onDispatch?: () => void;
  /** 勾選的題型全相同時可批次編輯；未傳 = 不可（顯示 disabled + 原因） */
  onEdit?: () => void;
  editDisabledReason?: string;
  onClear: () => void;
  busy?: boolean;
}

export default function QuestionBulkBar({
  selectedCount,
  dirtyCount,
  onSave,
  onDelete,
  onDispatch,
  onEdit,
  editDisabledReason,
  onClear,
  busy = false,
}: QuestionBulkBarProps) {
  const { t } = useTranslation();
  const { sidebarWidth } = useSidebar();
  if (selectedCount === 0) return null;

  return (
    <div
      className="fixed bottom-0 right-0 z-40 border-t border-gray-200 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.06)] animate-in slide-in-from-bottom duration-200"
      style={{ left: `${sidebarWidth}px` }}
      role="toolbar"
      data-testid="qb-bulk-bar"
    >
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <span className="text-sm font-medium text-gray-800">
          {t("questionBank.list.selected", { count: selectedCount })}
          {dirtyCount > 0 && (
            <span className="ml-2 text-xs text-amber-700">
              {t("questionBank.list.dirty", { count: dirtyCount })}
            </span>
          )}
        </span>
        <div className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={busy}
          className="gap-1"
          data-testid="qb-bulk-clear"
        >
          <X size={14} />
          {t("questionBank.list.clearSelection")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDelete}
          disabled={busy}
          className="gap-1 text-red-600 hover:text-red-700"
          data-testid="qb-bulk-delete"
        >
          <Trash2 size={14} />
          {t("questionBank.list.delete")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onEdit}
          disabled={busy || !onEdit}
          title={!onEdit ? editDisabledReason : undefined}
          className="gap-1"
          data-testid="qb-bulk-edit"
        >
          <Pencil size={14} />
          {t("questionBank.list.bulkEdit")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDispatch}
          disabled={busy || !onDispatch}
          title={!onDispatch ? t("questionBank.comingSoon") : undefined}
          className="gap-1"
          data-testid="qb-bulk-dispatch"
        >
          <Send size={14} />
          {t("questionBank.list.dispatch")}
          {!onDispatch && (
            <span className="text-xs text-gray-400">
              {t("questionBank.comingSoon")}
            </span>
          )}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={busy || dirtyCount === 0}
          className="gap-1"
          data-testid="qb-bulk-save"
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          {t("questionBank.list.save")}
        </Button>
      </div>
    </div>
  );
}
