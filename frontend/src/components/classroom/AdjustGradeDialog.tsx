/**
 * AdjustGradeDialog — 批次調整年級：升一級／降一級／設為指定年級（#1097、#1139）
 *
 * 選模式 → 列出每班「3 年級 → 4 年級」與略過的班級（含原因）→ 套用。
 * - 升一級／降一級：計算在 classroomGrade.computeGradeAdjust；未設定年級、已達上下限的班略過。
 * - 設為 N 年級（#1139）：計算在 classroomGrade.computeGradeSet；所有勾選的班（含未設定）
 *   都列在「將調整」，已經是 N 年級的列在略過（不變）。N 沒有預設、必選，沒選時套用停用。
 *   說明文字隨模式切換：「所選班級的年級都會改成 N 年級；班級名稱不會變更」。
 * API 呼叫交給呼叫端的 onConfirm：回傳 true 代表成功並關閉視窗，false 代表失敗、保留視窗。
 * 沒有任何班級會變動時，套用按鈕停用。班級名稱不會被更改。
 * 會變動的班級超過 BATCH_GRADE_MAX_ITEMS（後端上限）時停用套用並提示分批。
 *
 * 狀態處理：
 * - 每次打開時於 render 階段重設模式（升一級）與目標年級（不用 effect），重新打開不會先閃出上次的選擇。
 * - 關閉動畫期間沿用最後一次開啟時的班級清單，父層清空勾選或背景重新載入
 *   時不會閃出「0 個班級」。
 */
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowRight, ArrowUp, Target } from "lucide-react";
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
  BATCH_GRADE_MAX_ITEMS,
  GRADE_MAX,
  GRADE_MIN,
  computeGradeAdjust,
  computeGradeSet,
  formatGradeLabel,
  type GradeAdjustClassroom,
  type GradeAdjustMode,
  type GradeSkipReason,
  type GradeUpdateItem,
} from "./classroomGrade";
import { GradeSelect } from "./GradeSelect";

export interface AdjustGradeDialogProps<Id extends string | number> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 勾選的班級 */
  classrooms: readonly GradeAdjustClassroom<Id>[];
  onConfirm: (items: GradeUpdateItem<Id>[]) => Promise<boolean>;
}

const TARGET_SELECT_ID = "adjust-grade-target";

export function AdjustGradeDialog<Id extends string | number>({
  open,
  onOpenChange,
  classrooms,
  onConfirm,
}: AdjustGradeDialogProps<Id>) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<GradeAdjustMode>("up");
  const [target, setTarget] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // 打開的那一次 render 就重設模式與目標年級
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMode("up");
      setTarget(null);
    }
  }

  // 關閉期間顯示最後一次開啟時的清單
  const [lastOpenClassrooms, setLastOpenClassrooms] = useState(classrooms);
  if (open && lastOpenClassrooms !== classrooms) {
    setLastOpenClassrooms(classrooms);
  }
  const shownClassrooms = open ? classrooms : lastOpenClassrooms;

  const { changes, skipped } = useMemo(
    () =>
      mode === "set"
        ? computeGradeSet(shownClassrooms, target)
        : computeGradeAdjust(shownClassrooms, mode),
    [shownClassrooms, mode, target],
  );
  const overLimit = changes.length > BATCH_GRADE_MAX_ITEMS;
  // 設為 N 年級：尚未選 N 時不列清單
  const showLists = mode !== "set" || target !== null;

  const handleConfirm = async () => {
    if (changes.length === 0 || overLimit || saving) return;
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

  const reasonText = (reason: GradeSkipReason) => {
    if (reason === "max")
      return t("classroomGrade.adjust.reason.max", { grade: GRADE_MAX });
    if (reason === "min")
      return t("classroomGrade.adjust.reason.min", { grade: GRADE_MIN });
    if (reason === "same")
      return t("classroomGrade.adjust.reason.same", { grade: target });
    return t("classroomGrade.adjust.reason.unset");
  };

  const description =
    mode !== "set"
      ? t("classroomGrade.adjust.description")
      : target === null
        ? t("classroomGrade.adjust.descriptionSetPending")
        : t("classroomGrade.adjust.descriptionSet", { grade: target });

  const modeButton = (
    value: GradeAdjustMode,
    icon: ReactNode,
    label: string,
  ) => (
    <Button
      type="button"
      variant={mode === value ? "default" : "outline"}
      aria-pressed={mode === value}
      onClick={() => setMode(value)}
      disabled={saving}
      className="flex-1 min-w-[7rem]"
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
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {modeButton(
            "up",
            <ArrowUp className="h-4 w-4 mr-2" />,
            t("classroomGrade.adjust.up"),
          )}
          {modeButton(
            "down",
            <ArrowDown className="h-4 w-4 mr-2" />,
            t("classroomGrade.adjust.down"),
          )}
          {modeButton(
            "set",
            <Target className="h-4 w-4 mr-2" />,
            t("classroomGrade.adjust.set"),
          )}
        </div>

        {mode === "set" && (
          <div>
            <label
              htmlFor={TARGET_SELECT_ID}
              className="text-sm font-medium block mb-1"
            >
              {t("classroomGrade.adjust.targetLabel")}
            </label>
            <GradeSelect
              id={TARGET_SELECT_ID}
              value={target}
              onChange={setTarget}
              disabled={saving}
            />
          </div>
        )}

        {showLists && (
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
            disabled={changes.length === 0 || overLimit || saving}
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
