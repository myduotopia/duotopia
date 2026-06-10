/**
 * RequestRevisionModal — 班級作業列表「批次要求訂正」彈窗（#830）
 *
 * 老師對單一作業,一次勾選多位已派發學生退回訂正:
 *   - 只列已派發學生 + 分數 + 狀態（沿用 /progress 資料、TrafficLightDot、分數格式）。
 *   - 可退回對象 = 已提交 / 已批改 / 已訂正重交;未開始 / 進行中不可勾。
 *   - 全選（分數 < 100）、分數區間快速勾選（預設 0~80）。
 *   - 點學生姓名 → 新分頁開該生個別批改頁,看真實答題後再決定。
 *   - 確認退回 → POST batch-return-for-revision。
 *
 * 註:呈現層(學生分數列)與 StudentStatusPanel 有重複,待 #843 一併收斂。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TrafficLightDot,
  useStatusLabel,
  type StudentProgress,
} from "@/components/StudentStatusPanel";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId: number;
  classroomId: string | number;
  /** 退回成功後通知父層 refetch 作業 / 進度 */
  onDone?: () => void;
}

// 可被退回訂正的狀態（有作答可訂正）
const RETURNABLE = new Set(["SUBMITTED", "GRADED", "RESUBMITTED"]);

export function RequestRevisionModal({
  open,
  onOpenChange,
  assignmentId,
  classroomId,
  onDone,
}: Props) {
  const { t } = useTranslation();
  const statusLabel = useStatusLabel();

  const [students, setStudents] = useState<StudentProgress[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [rangeMin, setRangeMin] = useState("0");
  const [rangeMax, setRangeMax] = useState("80");

  useEffect(() => {
    if (!open || !assignmentId) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setSelectedIds(new Set());
      try {
        const resp = (await apiClient.get(
          `/api/teachers/assignments/${assignmentId}/progress`,
        )) as
          | StudentProgress[]
          | { students_progress?: StudentProgress[]; data?: StudentProgress[] };
        const arr = Array.isArray(resp)
          ? resp
          : resp.students_progress || resp.data || [];
        if (!cancelled) {
          setStudents(
            arr.filter(
              (s) => s.is_assigned !== false && s.status !== "unassigned",
            ),
          );
        }
      } catch {
        if (!cancelled) {
          toast.error(t("requestRevision.loadFailed") || "載入學生名單失敗");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [open, assignmentId, t]);

  const isReturnable = useCallback(
    (s: StudentProgress) => RETURNABLE.has(String(s.status)),
    [],
  );

  const returnableCount = useMemo(
    () => students.filter(isReturnable).length,
    [students, isReturnable],
  );

  const toggle = useCallback(
    (id: number) =>
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  const selectBy = useCallback(
    (pred: (s: StudentProgress) => boolean) => {
      setSelectedIds(
        new Set(
          students
            .filter((s) => isReturnable(s) && pred(s))
            .map((s) => s.student_id),
        ),
      );
    },
    [students, isReturnable],
  );

  // 全選：分數 < 100 的可退回學生
  const selectAllUnder100 = useCallback(
    () => selectBy((s) => (s.score ?? 0) < 100),
    [selectBy],
  );

  // 分數區間快速勾選（預設 0~80）
  const applyRange = useCallback(() => {
    const lo = parseFloat(rangeMin);
    const hi = parseFloat(rangeMax);
    const min = Number.isNaN(lo) ? 0 : lo;
    const max = Number.isNaN(hi) ? 100 : hi;
    selectBy((s) => {
      const sc = s.score ?? 0;
      return sc >= min && sc <= max;
    });
  }, [rangeMin, rangeMax, selectBy]);

  const openGrading = useCallback(
    (studentId: number) => {
      window.open(
        `/teacher/classroom/${classroomId}/assignment/${assignmentId}/grading?studentId=${studentId}`,
        "_blank",
        "noopener,noreferrer",
      );
    },
    [classroomId, assignmentId],
  );

  const handleSubmit = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setSubmitting(true);
    try {
      await apiClient.post(
        `/api/teachers/assignments/${assignmentId}/batch-return-for-revision`,
        { student_ids: ids },
      );
      toast.success(
        t("requestRevision.success", { count: ids.length }) ||
          `已退回 ${ids.length} 位學生訂正`,
      );
      onOpenChange(false);
      onDone?.();
    } catch {
      toast.error(t("requestRevision.submitFailed") || "退回失敗");
    } finally {
      setSubmitting(false);
    }
  }, [selectedIds, assignmentId, t, onOpenChange, onDone]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("requestRevision.title") || "要求訂正"}</DialogTitle>
        </DialogHeader>

        {/* 工具列：全選 + 分數區間 */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={selectAllUnder100}
            disabled={loading || returnableCount === 0}
          >
            {t("requestRevision.selectUnder100") || "全選未達 100 分"}
          </Button>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              value={rangeMin}
              onChange={(e) => setRangeMin(e.target.value)}
              className="w-16 h-8 text-center"
              aria-label="min"
            />
            <span className="text-gray-400">~</span>
            <Input
              type="number"
              value={rangeMax}
              onChange={(e) => setRangeMax(e.target.value)}
              className="w-16 h-8 text-center"
              aria-label="max"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={applyRange}
              disabled={loading || returnableCount === 0}
            >
              {t("requestRevision.applyRange") || "套用區間"}
            </Button>
          </div>
          <span className="ml-auto text-gray-500">
            {t("requestRevision.selectedCount", { count: selectedIds.size }) ||
              `已選 ${selectedIds.size} 位`}
          </span>
        </div>

        {/* 學生名單（只列已派發） */}
        <div className="flex-1 min-h-0 overflow-y-auto border rounded-md divide-y">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : students.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-500">
              {t("requestRevision.empty") || "沒有已派發的學生"}
            </div>
          ) : (
            students.map((s) => {
              const returnable = isReturnable(s);
              const selected = selectedIds.has(s.student_id);
              const score = s.score ?? 0;
              return (
                <div
                  key={s.student_id}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2",
                    selected && "bg-orange-50",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={!returnable}
                    onChange={() => toggle(s.student_id)}
                    className="h-4 w-4 accent-orange-600 disabled:opacity-40"
                  />
                  <span className="w-8 shrink-0 text-xs text-gray-400 text-right">
                    {s.student_number}
                  </span>
                  <button
                    type="button"
                    onClick={() => openGrading(s.student_id)}
                    className="flex-1 min-w-0 truncate text-left text-sm font-medium text-blue-600 hover:underline"
                    title={
                      t("requestRevision.openGrading") || "查看作答 / 批改"
                    }
                  >
                    {s.student_name}
                  </button>
                  <span className="flex items-center gap-1 shrink-0 text-xs text-gray-500">
                    <TrafficLightDot status={String(s.status)} size={12} />
                    {statusLabel(String(s.status))}
                  </span>
                  <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums text-gray-700">
                    {returnable
                      ? `${s.is_interim_score ? "~" : ""}${Number(score).toFixed(1)}`
                      : "-"}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t("common.cancel") || "取消"}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || selectedIds.size === 0}
            className="bg-orange-600 hover:bg-orange-700 text-white"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <X className="h-4 w-4 mr-2" />
            )}
            {t("requestRevision.confirm", { count: selectedIds.size }) ||
              `確認退回（${selectedIds.size} 位）`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
