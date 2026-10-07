/**
 * useClassroomListActions — 「我的班級」列表的行內編輯與停用／啟用、批次更新邏輯（#1097）
 *
 * 從 TeacherClassrooms 抽出，頁面只接線。兩個 hook 都不直接改列表，
 * 成功後呼叫 onPatched(patches) 讓頁面就地更新，再由頁面背景重新載入。
 *
 * useClassroomInlineEdit：
 * - 一次只編輯一列：editingId＋draft；isDirty = 草稿與原值不同（isClassroomDraftDirty）。
 * - startEdit：換列前若 dirty → window.confirm(classroomGrade.inline.unsavedConfirm)，取消則留在原列。
 * - guardEdit(fn)：包住搜尋／篩選／排序的變更處理；編輯中先走同一個確認，取消則不執行 fn。
 * - resetKey 改變（外部切換工作區）時直接結束編輯，無法確認。
 * - 編輯中的班級從列表消失，或被背景重新載入／其他動作改了值（與開始編輯時的快照 baseline 不同）
 *   → 直接結束編輯，避免舊草稿儲存時蓋掉新值。
 * - saveEdit：名稱、年級必填（沿用頁面的 alert）；PUT 成功 → toast、結束編輯；失敗 → toast，保留編輯。
 *
 * useClassroomStatusActions：
 * - toggleActive：單列 Switch，PUT is_active。
 * - runBatchUpdate：POST batch-update（等級／停用／啟用共用），超過 BATCH_GRADE_MAX_ITEMS 直接擋下。
 * - bulkSetActive：只送狀態會改變的班級。
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiClient, type BatchClassroomUpdateItem } from "@/lib/api";
import { BATCH_GRADE_MAX_ITEMS } from "./classroomGrade";
import {
  isClassroomDraftDirty,
  isClassroomInactive,
  makeClassroomDraft,
  type ClassroomDraft,
  type ClassroomRowData,
} from "./ClassroomTableRow";

export type ClassroomPatches = Map<number, Partial<ClassroomRowData>>;

export function useClassroomInlineEdit<C extends ClassroomRowData>({
  classrooms,
  onPatched,
  resetKey,
}: {
  classrooms: readonly C[];
  onPatched: (patches: ClassroomPatches) => void;
  /** 值改變時（例如外部切換工作區，無法攔下確認）直接結束編輯 */
  resetKey?: string;
}) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ClassroomDraft | null>(null);
  const [saving, setSaving] = useState(false);
  // 開始編輯時的班級值快照
  const [baseline, setBaseline] = useState<ClassroomDraft | null>(null);

  const exitEdit = useCallback(() => {
    setEditingId(null);
    setDraft(null);
    setBaseline(null);
  }, []);

  // render 階段重設（不用 effect），避免先以舊的編輯狀態畫一次
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    exitEdit();
  }

  const editing =
    editingId === null ? undefined : classrooms.find((c) => c.id === editingId);
  // 編輯中的班級不見了，或值已被改動（與 baseline 不同）→ 結束編輯
  if (
    editingId !== null &&
    !saving &&
    (!editing ||
      (baseline !== null && isClassroomDraftDirty(baseline, editing)))
  ) {
    exitEdit();
  }
  const isDirty =
    !!editing && draft !== null && isClassroomDraftDirty(draft, editing);

  // 有未儲存的修改時先確認；確認（或沒有修改）就結束編輯並回傳 true
  const confirmLeaveEdit = (): boolean => {
    if (isDirty && !window.confirm(t("classroomGrade.inline.unsavedConfirm"))) {
      return false;
    }
    exitEdit();
    return true;
  };

  const guardEdit =
    <Args extends unknown[]>(fn: (...args: Args) => void) =>
    (...args: Args) => {
      if (editingId !== null && !confirmLeaveEdit()) return;
      fn(...args);
    };

  const startEdit = (classroom: C) => {
    if (editingId === classroom.id || saving) return;
    if (!confirmLeaveEdit()) return;
    setEditingId(classroom.id);
    setDraft(makeClassroomDraft(classroom));
    setBaseline(makeClassroomDraft(classroom));
  };

  const saveEdit = async () => {
    if (!editing || !draft || saving) return;
    const name = draft.name.trim();
    if (!name) {
      alert(t("teacherClassrooms.messages.nameRequired"));
      return;
    }
    // 年級必填：尚未設定年級的班級編輯時也要補選
    const { grade, description, level } = draft;
    if (grade === null) {
      alert(t("classroomGrade.required"));
      return;
    }

    setSaving(true);
    try {
      await apiClient.updateClassroom(editing.id, {
        name,
        description,
        level,
        grade,
      });
      onPatched(new Map([[editing.id, { name, description, level, grade }]]));
      toast.success(t("classroomGrade.inline.saveSuccess", { name }));
      exitEdit();
    } catch (err) {
      console.error("Failed to update classroom:", err);
      toast.error(t("teacherClassrooms.messages.updateFailed"));
    } finally {
      setSaving(false);
    }
  };

  return {
    editingId,
    draft,
    setDraft,
    saving,
    isDirty,
    startEdit,
    saveEdit,
    exitEdit,
    guardEdit,
  };
}

export function useClassroomStatusActions({
  onPatched,
}: {
  onPatched: (patches: ClassroomPatches) => void;
}) {
  const { t } = useTranslation();
  const [statusBusyId, setStatusBusyId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const toggleActive = async (classroom: ClassroomRowData, active: boolean) => {
    if (statusBusyId !== null) return;
    setStatusBusyId(classroom.id);
    try {
      await apiClient.updateClassroom(classroom.id, { is_active: active });
      onPatched(new Map([[classroom.id, { is_active: active }]]));
      toast.success(
        t(
          active
            ? "classroomGrade.status.activated"
            : "classroomGrade.status.deactivated",
          { name: classroom.name },
        ),
      );
    } catch (err) {
      console.error("Failed to update classroom status:", err);
      toast.error(t("classroomGrade.status.updateFailed"));
    } finally {
      setStatusBusyId(null);
    }
  };

  // 成功回傳 true，並以回傳結果就地更新列表
  const runBatchUpdate = async (
    items: BatchClassroomUpdateItem[],
    successKey: string,
    failureKey: string,
  ): Promise<boolean> => {
    if (items.length > BATCH_GRADE_MAX_ITEMS) {
      toast.error(
        t("classroomGrade.limitExceeded", { max: BATCH_GRADE_MAX_ITEMS }),
      );
      return false;
    }
    try {
      const res = await apiClient.batchUpdateClassrooms(items);
      onPatched(
        new Map(
          (res.updated ?? []).map((u) => [
            u.id,
            {
              grade: u.grade,
              level: u.level ?? undefined,
              is_active: u.is_active,
            },
          ]),
        ),
      );
      toast.success(t(successKey, { count: res.count }));
      return true;
    } catch (err) {
      console.error("Failed to batch update classrooms:", err);
      toast.error(t(failureKey));
      return false;
    }
  };

  const bulkSetActive = async (
    selected: readonly ClassroomRowData[],
    active: boolean,
  ): Promise<boolean> => {
    const items = selected
      .filter((c) => isClassroomInactive(c) === active)
      .map((c) => ({ classroom_id: c.id, is_active: active }));
    if (items.length === 0 || bulkBusy) return false;
    setBulkBusy(true);
    try {
      return await runBatchUpdate(
        items,
        active
          ? "classroomGrade.bulk.activated"
          : "classroomGrade.bulk.deactivated",
        "classroomGrade.status.updateFailed",
      );
    } finally {
      setBulkBusy(false);
    }
  };

  return {
    statusBusyId,
    bulkBusy,
    toggleActive,
    runBatchUpdate,
    bulkSetActive,
  };
}
