/**
 * 題庫 sheet 的標題列（#1082；自 QuestionSheet.tsx 拆出）。
 *
 * - 左：標題＋（新增單題模式）批次提示「可一次新增 N／上限 題」
 * - 右：預覽（`SheetPreviewButton`；busy 時停用）、刪除（`canDelete` 時）、儲存（非只讀時；
 *   有驗證訊息／busy／沒有單元時停用）、關閉（busy 時停用）
 * - 標題列下方：儲存鈕停用的原因（`validationMessage`），醒目色、不用 hover 也看得到
 *
 * 純展示元件：何時可刪／可存、訊息內容都由 QuestionSheet 決定後傳入。testid 與拆檔前相同
 * （qb-delete／qb-save／qb-close／qb-validation）。
 */

import { useTranslation } from "react-i18next";
import { Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import SheetPreviewButton from "./SheetPreviewButton";
import { MAX_QUESTIONS_PER_BATCH, type UnitDraft } from "./questionDraft";

interface QuestionSheetHeaderProps {
  title: string;
  /** 顯示批次提示（新增單題、非只讀） */
  showBatchHint: boolean;
  units: UnitDraft[];
  busy: boolean;
  saving: boolean;
  /** 只讀時不顯示儲存鈕 */
  readOnly: boolean;
  canDelete: boolean;
  validationMessage: string | null;
  onDelete: () => void;
  onSave: () => void;
  onClose: () => void;
}

export default function QuestionSheetHeader({
  title,
  showBatchHint,
  units,
  busy,
  saving,
  readOnly,
  canDelete,
  validationMessage,
  onDelete,
  onSave,
  onClose,
}: QuestionSheetHeaderProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200 shrink-0">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          {showBatchHint && (
            <p className="text-xs text-gray-500">
              {t("questionBank.form.batchHint", {
                count: units.length,
                max: MAX_QUESTIONS_PER_BATCH,
              })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <SheetPreviewButton units={units} disabled={busy} />
          {canDelete && (
            <Button
              type="button"
              variant="ghost"
              className="text-red-600 hover:text-red-700 gap-1"
              onClick={onDelete}
              disabled={busy}
              data-testid="qb-delete"
            >
              <Trash2 size={16} />
              {t("common.delete", "刪除")}
            </Button>
          )}
          {!readOnly && (
            <Button
              type="button"
              onClick={onSave}
              disabled={!!validationMessage || busy || units.length === 0}
              title={validationMessage ?? undefined}
              data-testid="qb-save"
            >
              {saving
                ? t("common.saving", "儲存中...")
                : t("common.save", "儲存")}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={busy}
            aria-label={t("common.close", "關閉")}
            data-testid="qb-close"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>
      {/* 儲存鈕 disabled 的原因：緊接在標題列下方、醒目色，老師不用 hover 也看得到 */}
      {validationMessage && (
        <p
          className="px-6 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 border-b border-amber-100 shrink-0"
          role="status"
          data-testid="qb-validation"
        >
          {validationMessage}
        </p>
      )}
    </>
  );
}
