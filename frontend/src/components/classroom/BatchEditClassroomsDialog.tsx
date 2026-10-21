/**
 * BatchEditClassroomsDialog — 批次編輯班級名稱＋年級（#1139）
 *
 * 「我的班級」與機構後台班級管理共用（批次操作列的「批次編輯」）。
 * - 每個勾選的班一列：名稱輸入框（必填、maxLength 100）＋ GradeSelect；
 *   下方顯示「實際會看到的名稱」預覽（formatClassroomDisplayName，例：名稱「12」＋8 年級 →「8年12班」）。
 *   停用的班沿用停用標記（ClassroomStatusBadge）。
 * - 改過的列加標記（與打開視窗時的原值比較，名稱先去空白；改回原值標記消失）；
 *   AI 改過的格子用另一種標記（琥珀色），人工再改後換回人工標記（藍色）。
 * - 上方「全部年級設為 [▼]」：套到所有列（含原本未設定），只改年級，之後仍可逐列修改。
 * - 年級不能清回未設定（D9）：已有年級的列下拉不給空白選項；本來未設定的列可維持未設定，只改名也能存。
 * - 儲存只送有變動的列（buildBatchEditItems）；沒有變動、有名稱錯誤、或變動超過
 *   BATCH_GRADE_MAX_ITEMS（顯示 classroomGrade.limitExceeded）時，儲存鈕停用。
 * - API 呼叫交給呼叫端的 onSave：回傳 true 代表成功並關閉視窗；false 代表失敗，視窗不關、保留輸入。
 * - 有未儲存的修改時關閉（取消、Esc、點背景）先確認。
 *
 * 版面：預留右側面板插槽 renderSidePanel（第二階段 AI 助手）。有面板時視窗加寬，
 * 寬螢幕表格與面板左右並排；窄螢幕面板改在表格上方（D11）。面板經 context 讀表格、
 * 以 applyChanges(…, "ai") 填入、以 setRows 復原快照；寫入資料庫仍只能靠人按「儲存」。
 *
 * 狀態處理（同 AdjustGradeDialog）：每次打開於 render 階段以當下勾選的班級重建表格；
 * 開著時父層背景重新載入不會覆蓋輸入；關閉動畫期間沿用最後的表格。
 */
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  BATCH_GRADE_MAX_ITEMS,
  formatClassroomDisplayName,
} from "./classroomGrade";
import { GradeSelect } from "./GradeSelect";
import { ClassroomStatusBadge } from "./ClassroomTableRow";
import {
  CLASSROOM_NAME_MAX_LENGTH,
  applyBatchEditChanges,
  batchEditRowNameError,
  buildBatchEditItems,
  isBatchEditGradeChanged,
  isBatchEditNameChanged,
  isBatchEditRowAiChanged,
  isBatchEditRowChanged,
  makeBatchEditRows,
  setAllBatchEditGrades,
  type BatchEditCellSource,
  type BatchEditChange,
  type BatchEditClassroom,
  type BatchEditRow,
  type BatchEditUpdateItem,
} from "./batchEditClassrooms";

/** 右側面板（第二階段 AI 助手）可用的表格操作 */
export interface BatchEditSidePanelContext<Id> {
  rows: readonly BatchEditRow<Id>[];
  /** 整張表格換成指定快照（復原用） */
  setRows: (rows: BatchEditRow<Id>[]) => void;
  /** 把變更填進表格（只動表格裡的 id、只改名稱與年級） */
  applyChanges: (
    changes: readonly BatchEditChange<Id>[],
    source: BatchEditCellSource,
  ) => void;
  saving: boolean;
}

export interface BatchEditClassroomsDialogProps<Id extends string | number> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 勾選的班級 */
  classrooms: readonly BatchEditClassroom<Id>[];
  onSave: (items: BatchEditUpdateItem<Id>[]) => Promise<boolean>;
  /** 右側面板插槽（第二階段 AI 助手）；不給就不顯示 */
  renderSidePanel?: (ctx: BatchEditSidePanelContext<Id>) => ReactNode;
}

const SET_ALL_SELECT_ID = "batch-edit-set-all-grade";

const GRADE_SELECT_BASE =
  "w-full px-3 py-2 border dark:bg-gray-800 dark:text-gray-100 rounded-md text-sm";

// 改過的格子：人工＝藍框、AI＝琥珀框；沒改＝一般灰框
function changedBorder(
  changed: boolean,
  source: BatchEditCellSource,
): string | undefined {
  if (!changed) return undefined;
  return source === "ai"
    ? "border-amber-500 dark:border-amber-500"
    : "border-blue-500 dark:border-blue-500";
}

export function BatchEditClassroomsDialog<Id extends string | number>({
  open,
  onOpenChange,
  classrooms,
  onSave,
  renderSidePanel,
}: BatchEditClassroomsDialogProps<Id>) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<BatchEditRow<Id>[]>(() =>
    makeBatchEditRows(classrooms),
  );
  const [saving, setSaving] = useState(false);

  // 打開的那一次 render 就以當下勾選的班級重建表格
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setRows(makeBatchEditRows(classrooms));
  }

  const items = useMemo(() => buildBatchEditItems(rows), [rows]);
  const changedCount = items.length;
  const hasNameError = rows.some((row) => batchEditRowNameError(row) !== null);
  const overLimit = changedCount > BATCH_GRADE_MAX_ITEMS;
  const canSave = changedCount > 0 && !hasNameError && !overLimit && !saving;

  const applyChanges = (
    changes: readonly BatchEditChange<Id>[],
    source: BatchEditCellSource,
  ) => setRows((prev) => applyBatchEditChanges(prev, changes, source));

  const requestClose = () => {
    if (saving) return;
    if (
      changedCount > 0 &&
      !window.confirm(t("classroomGrade.inline.unsavedConfirm"))
    ) {
      return;
    }
    onOpenChange(false);
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const ok = await onSave(items);
      if (ok) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const nameErrorText = (row: BatchEditRow<Id>) => {
    const error = batchEditRowNameError(row);
    if (error === "required") return t("classroomGrade.batchEdit.nameRequired");
    if (error === "tooLong")
      return t("classroomGrade.batchEdit.nameTooLong", {
        max: CLASSROOM_NAME_MAX_LENGTH,
      });
    return null;
  };

  const sidePanel = renderSidePanel?.({
    rows,
    setRows,
    applyChanges,
    saving,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <DialogContent
        className={cn(
          "bg-white dark:bg-gray-800 max-h-[90vh] flex flex-col sm:max-w-3xl",
          sidePanel ? "lg:max-w-6xl" : undefined,
        )}
      >
        <DialogHeader>
          <DialogTitle>{t("classroomGrade.batchEdit.title")}</DialogTitle>
          <DialogDescription>
            {t("classroomGrade.batchEdit.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4">
          <div className="flex-1 min-h-0 min-w-0 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor={SET_ALL_SELECT_ID}
                className="text-sm font-medium text-gray-900 dark:text-gray-100"
              >
                {t("classroomGrade.batchEdit.setAllLabel")}
              </label>
              <GradeSelect
                id={SET_ALL_SELECT_ID}
                value={null}
                disabled={saving}
                onChange={(grade) => {
                  if (grade !== null) {
                    setRows((prev) => setAllBatchEditGrades(prev, grade));
                  }
                }}
                className={cn(GRADE_SELECT_BASE, "w-auto dark:border-gray-600")}
              />
            </div>

            <ul className="flex-1 min-h-0 overflow-y-auto divide-y dark:divide-gray-700 border dark:border-gray-700 rounded-md">
              {rows.map((row) => {
                const rowChanged = isBatchEditRowChanged(row);
                const aiChanged = isBatchEditRowAiChanged(row);
                const nameChanged = isBatchEditNameChanged(row);
                const gradeChanged = isBatchEditGradeChanged(row);
                const errorText = nameErrorText(row);
                const errorId = `batch-edit-name-error-${String(row.id)}`;
                return (
                  <li
                    key={String(row.id)}
                    data-testid={`batch-edit-row-${String(row.id)}`}
                    className={cn(
                      "px-3 py-2 space-y-1.5 border-l-4",
                      rowChanged
                        ? aiChanged
                          ? "border-l-amber-400"
                          : "border-l-blue-400"
                        : "border-l-transparent",
                    )}
                  >
                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <span className="truncate">{row.originalName}</span>
                      {row.inactive && <ClassroomStatusBadge active={false} />}
                      {rowChanged && (
                        <span
                          className={cn(
                            "ml-auto flex-shrink-0 rounded-full px-2 py-0.5 font-medium",
                            aiChanged
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                              : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
                          )}
                        >
                          {aiChanged
                            ? t("classroomGrade.batchEdit.aiChanged")
                            : t("classroomGrade.batchEdit.changed")}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input
                        value={row.name}
                        maxLength={CLASSROOM_NAME_MAX_LENGTH}
                        disabled={saving}
                        aria-label={t("classroomGrade.batchEdit.nameLabel", {
                          name: row.originalName,
                        })}
                        aria-invalid={errorText ? true : undefined}
                        aria-describedby={errorText ? errorId : undefined}
                        onChange={(e) =>
                          applyChanges(
                            [{ id: row.id, name: e.target.value }],
                            "manual",
                          )
                        }
                        className={cn(
                          "flex-1",
                          errorText
                            ? "border-red-500 dark:border-red-500"
                            : changedBorder(nameChanged, row.nameSource),
                        )}
                      />
                      <GradeSelect
                        value={row.grade}
                        allowEmpty={row.originalGrade === null}
                        disabled={saving}
                        aria-label={t("classroomGrade.batchEdit.gradeLabel", {
                          name: row.originalName,
                        })}
                        onChange={(grade) => {
                          if (grade !== null) {
                            applyChanges([{ id: row.id, grade }], "manual");
                          }
                        }}
                        className={cn(
                          GRADE_SELECT_BASE,
                          "sm:w-40",
                          changedBorder(gradeChanged, row.gradeSource) ??
                            "dark:border-gray-600",
                        )}
                      />
                    </div>
                    {errorText ? (
                      <p
                        id={errorId}
                        className="text-xs text-red-600 dark:text-red-400"
                      >
                        {errorText}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t("classroomGrade.batchEdit.preview", {
                          name: formatClassroomDisplayName(t, {
                            name: row.name.trim(),
                            grade: row.grade,
                          }),
                        })}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {sidePanel && (
            <aside className="order-first lg:order-last lg:w-80 flex-shrink-0 min-h-0">
              {sidePanel}
            </aside>
          )}
        </div>

        {overLimit && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {t("classroomGrade.limitExceeded", { max: BATCH_GRADE_MAX_ITEMS })}
          </p>
        )}

        <DialogFooter className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-0">
          <span className="text-sm text-gray-600 dark:text-gray-400 sm:mr-auto">
            {t("classroomGrade.batchEdit.changedCount", {
              count: changedCount,
            })}
          </span>
          <Button
            variant="outline"
            onClick={requestClose}
            disabled={saving}
            className="w-full sm:w-auto"
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full sm:w-auto"
          >
            {t("classroomGrade.batchEdit.save", { count: changedCount })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BatchEditClassroomsDialog;
