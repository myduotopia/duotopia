/**
 * AdjustGradeDialog — 批次升／降一級（#1097）
 *
 * 選方向 → 列出每班「3 年級 → 4 年級」與略過的班級（含原因）→ 套用。
 * 計算在 classroomGrade.computeGradeAdjust；API 呼叫交給呼叫端的 onConfirm：
 * 回傳 true 代表成功並關閉視窗，false 代表失敗、保留視窗。
 * 沒有任何班級會變動時，套用按鈕停用。班級名稱不會被更改。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  GRADE_MAX,
  GRADE_MIN,
  computeGradeAdjust,
  formatGradeLabel,
  type GradeAdjustClassroom,
  type GradeAdjustDirection,
  type GradeUpdateItem,
} from "./classroomGrade";

export interface AdjustGradeDialogProps<Id extends string | number> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 勾選的班級 */
  classrooms: readonly GradeAdjustClassroom<Id>[];
  onConfirm: (items: GradeUpdateItem<Id>[]) => Promise<boolean>;
}

export function AdjustGradeDialog<Id extends string | number>({
  open,
  onOpenChange,
  classrooms,
  onConfirm,
}: AdjustGradeDialogProps<Id>) {
  const { t } = useTranslation();
  const [direction, setDirection] = useState<GradeAdjustDirection>("up");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDirection("up");
  }, [open]);

  const { changes, skipped } = useMemo(
    () => computeGradeAdjust(classrooms, direction),
    [classrooms, direction],
  );

  const handleConfirm = async () => {
    if (changes.length === 0 || saving) return;
    setSaving(true);
    try {
      const ok = await onConfirm(
        changes.map(({ id, to }) => ({ id, grade: to })),
      );
      if (ok) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const reasonText = (reason: "max" | "min" | "unset") => {
    if (reason === "max")
      return t("classroomGrade.adjust.reason.max", { grade: GRADE_MAX });
    if (reason === "min")
      return t("classroomGrade.adjust.reason.min", { grade: GRADE_MIN });
    return t("classroomGrade.adjust.reason.unset");
  };

  const directionButton = (
    value: GradeAdjustDirection,
    icon: ReactNode,
    label: string,
  ) => (
    <Button
      type="button"
      variant={direction === value ? "default" : "outline"}
      aria-pressed={direction === value}
      onClick={() => setDirection(value)}
      className="flex-1"
    >
      {icon}
      {label}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="bg-white dark:bg-gray-800 max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("classroomGrade.adjust.title")}</DialogTitle>
          <DialogDescription>
            {t("classroomGrade.adjust.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          {directionButton(
            "up",
            <ArrowUp className="h-4 w-4 mr-2" />,
            t("classroomGrade.adjust.up"),
          )}
          {directionButton(
            "down",
            <ArrowDown className="h-4 w-4 mr-2" />,
            t("classroomGrade.adjust.down"),
          )}
        </div>

        <div className="flex-1 overflow-y-auto space-y-4">
          <section>
            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
              {t("classroomGrade.adjust.changesTitle", {
                count: changes.length,
              })}
            </h4>
            {changes.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("classroomGrade.adjust.nothingToChange")}
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
                      {formatGradeLabel(t, c.from)}
                      <ArrowRight className="h-3 w-3" />
                      <span className="font-medium text-blue-700 dark:text-blue-300">
                        {formatGradeLabel(t, c.to)}
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
                {t("classroomGrade.adjust.skippedTitle", {
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
                      {reasonText(s.reason)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

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
            disabled={changes.length === 0 || saving}
            className="w-full sm:w-auto"
          >
            {t("classroomGrade.adjust.confirm", { count: changes.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AdjustGradeDialog;
