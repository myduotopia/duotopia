/**
 * AdjustLevelDialog — 批次調整班級等級（#1097）
 *
 * 選一個目標等級（Pre-A／A1…C2）→ 列出每班「A1 → B1」與已是該等級而略過的班級 → 套用。
 * 計算在 classroomLevel.computeLevelAdjust；API 呼叫交給呼叫端的 onConfirm：
 * 回傳 true 代表成功並關閉視窗，false 代表失敗、保留視窗。
 * 尚未選目標或沒有任何班級會變動時，套用按鈕停用；
 * 會變動的班級超過 BATCH_GRADE_MAX_ITEMS（後端上限）時停用套用並提示分批。
 *
 * 狀態處理（同 AdjustGradeDialog）：
 * - 每次打開時於 render 階段清空目標等級（不用 effect），重新打開不會先閃出上次的選擇。
 * - 關閉動畫期間沿用最後一次開啟時的班級清單，父層清空勾選或背景重新載入時不會閃出空清單。
 * - 儲存中不能關閉、不能換目標、不能重複送出。
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BATCH_GRADE_MAX_ITEMS } from "./classroomGrade";
import {
  CEFR_LEVELS,
  computeLevelAdjust,
  getLevelLabel,
  normalizeLevel,
  type ClassroomLevel,
  type LevelAdjustClassroom,
} from "./classroomLevel";

export interface LevelUpdateItem<Id> {
  id: Id;
  level: ClassroomLevel;
}

export interface AdjustLevelDialogProps<Id extends string | number> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 勾選的班級 */
  classrooms: readonly LevelAdjustClassroom<Id>[];
  onConfirm: (items: LevelUpdateItem<Id>[]) => Promise<boolean>;
}

export function AdjustLevelDialog<Id extends string | number>({
  open,
  onOpenChange,
  classrooms,
  onConfirm,
}: AdjustLevelDialogProps<Id>) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<ClassroomLevel | null>(null);
  const [saving, setSaving] = useState(false);

  // 打開的那一次 render 就清空目標
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTarget(null);
  }

  // 關閉期間顯示最後一次開啟時的清單
  const [lastOpenClassrooms, setLastOpenClassrooms] = useState(classrooms);
  if (open && lastOpenClassrooms !== classrooms) {
    setLastOpenClassrooms(classrooms);
  }
  const shownClassrooms = open ? classrooms : lastOpenClassrooms;

  const { changes, skipped } = useMemo(
    () => computeLevelAdjust(shownClassrooms, target),
    [shownClassrooms, target],
  );
  const overLimit = changes.length > BATCH_GRADE_MAX_ITEMS;
  const canApply = changes.length > 0 && !overLimit && !saving;

  const handleConfirm = async () => {
    if (!canApply) return;
    setSaving(true);
    try {
      const ok = await onConfirm(
        changes.map(({ id, to }) => ({ id, level: to })),
      );
      if (ok) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="bg-white dark:bg-gray-800 max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("classroomGrade.level.title")}</DialogTitle>
          <DialogDescription>
            {t("classroomGrade.level.description")}
          </DialogDescription>
        </DialogHeader>

        <div>
          <label
            htmlFor="adjust-level-target"
            className="text-sm font-medium block mb-1"
          >
            {t("classroomGrade.level.targetLabel")}
          </label>
          <select
            id="adjust-level-target"
            value={target ?? ""}
            disabled={saving}
            onChange={(e) => setTarget(normalizeLevel(e.target.value))}
            className="w-full px-3 py-2 border dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md text-sm"
          >
            <option value="">
              {t("classroomGrade.level.targetPlaceholder")}
            </option>
            {CEFR_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        {target && (
          <div className="flex-1 overflow-y-auto space-y-4">
            <section>
              <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                {t("classroomGrade.level.changesTitle", {
                  count: changes.length,
                })}
              </h4>
              {changes.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("classroomGrade.level.nothingToChange")}
                </p>
              ) : (
                <ul className="divide-y dark:divide-gray-700 border dark:border-gray-700 rounded-md">
                  {changes.map((c) => (
                    <li
                      key={String(c.id)}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <span className="truncate text-gray-900 dark:text-gray-100">
                        {c.name}
                      </span>
                      <span className="flex items-center gap-1 flex-shrink-0 text-gray-700 dark:text-gray-300">
                        {c.fromLabel}
                        <ArrowRight className="h-3 w-3" />
                        <span className="font-medium text-blue-700 dark:text-blue-300">
                          {getLevelLabel(c.to)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {skipped.length > 0 && (
              <section>
                <h4 className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-2">
                  {t("classroomGrade.level.skippedTitle", {
                    count: skipped.length,
                  })}
                </h4>
                <ul className="divide-y dark:divide-gray-700 border border-amber-200 dark:border-amber-800 rounded-md bg-amber-50/50 dark:bg-amber-900/10">
                  {skipped.map((s) => (
                    <li
                      key={String(s.id)}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <span className="truncate text-gray-900 dark:text-gray-100">
                        {s.name}
                      </span>
                      <span className="flex-shrink-0 text-amber-700 dark:text-amber-400">
                        {t("classroomGrade.level.alreadyAtTarget", {
                          level: getLevelLabel(target),
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {overLimit && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {t("classroomGrade.limitExceeded", { max: BATCH_GRADE_MAX_ITEMS })}
          </p>
        )}

        <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="w-full sm:w-auto"
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canApply}
            className="w-full sm:w-auto"
          >
            {t("classroomGrade.level.confirm", { count: changes.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AdjustLevelDialog;
