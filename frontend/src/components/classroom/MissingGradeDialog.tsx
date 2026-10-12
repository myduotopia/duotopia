/**
 * MissingGradeDialog — 逐班補填年級（#1097）
 *
 * 列出尚未設定年級的班級，每列一個年級下拉；只送出有選年級的列。
 * API 呼叫交給呼叫端的 onSave（個人端與機構端各自接自己的批次端點）：
 * onSave 回傳 true 代表成功並關閉視窗，false 代表失敗、保留視窗讓使用者重試。
 * 已選年級的列超過 BATCH_GRADE_MAX_ITEMS（後端上限）時停用儲存並提示分批。
 *
 * 狀態處理：每次打開時於 render 階段清空已選（不用 effect，避免先閃出上次的選擇）；
 * 關閉動畫期間沿用最後一次開啟時的班級清單，背景重新載入時列不會在關閉中消失。
 */
import { useState } from "react";
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
import { GradeSelect } from "./GradeSelect";
import {
  BATCH_GRADE_MAX_ITEMS,
  isValidGrade,
  type GradeUpdateItem,
} from "./classroomGrade";

export interface MissingGradeDialogProps<Id extends string | number> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 尚未設定年級的班級 */
  classrooms: readonly { id: Id; name: string }[];
  onSave: (items: GradeUpdateItem<Id>[]) => Promise<boolean>;
}

export function MissingGradeDialog<Id extends string | number>({
  open,
  onOpenChange,
  classrooms,
  onSave,
}: MissingGradeDialogProps<Id>) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<Record<string, number | null>>({});
  const [saving, setSaving] = useState(false);

  // 打開的那一次 render 就清空已選
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPicked({});
  }

  // 關閉期間顯示最後一次開啟時的清單
  const [lastOpenClassrooms, setLastOpenClassrooms] = useState(classrooms);
  if (open && lastOpenClassrooms !== classrooms) {
    setLastOpenClassrooms(classrooms);
  }
  const shownClassrooms = open ? classrooms : lastOpenClassrooms;

  const items: GradeUpdateItem<Id>[] = shownClassrooms.flatMap((c) => {
    const grade = picked[String(c.id)];
    return isValidGrade(grade) ? [{ id: c.id, grade }] : [];
  });
  const overLimit = items.length > BATCH_GRADE_MAX_ITEMS;

  const handleSave = async () => {
    if (items.length === 0 || overLimit || saving) return;
    setSaving(true);
    try {
      const ok = await onSave(items);
      if (ok) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="bg-white dark:bg-gray-800 max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("classroomGrade.missingDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("classroomGrade.missingDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto divide-y dark:divide-gray-700 border dark:border-gray-700 rounded-md">
          {shownClassrooms.map((c) => (
            <div
              key={String(c.id)}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {c.name}
              </span>
              <GradeSelect
                aria-label={t("classroomGrade.missingDialog.rowLabel", {
                  name: c.name,
                })}
                value={picked[String(c.id)] ?? null}
                onChange={(grade) =>
                  setPicked((prev) => ({ ...prev, [String(c.id)]: grade }))
                }
                className="w-36 flex-shrink-0 px-2 py-1.5 border dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md text-sm"
              />
            </div>
          ))}
        </div>

        {overLimit && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {t("classroomGrade.missing.limitExceeded", {
              max: BATCH_GRADE_MAX_ITEMS,
            })}
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
            onClick={handleSave}
            disabled={items.length === 0 || overLimit || saving}
            className="w-full sm:w-auto"
          >
            {t("classroomGrade.missingDialog.save", { count: items.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MissingGradeDialog;
