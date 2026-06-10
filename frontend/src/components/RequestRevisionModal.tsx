/**
 * RequestRevisionModal — 班級作業列表「批改 hub」（#830）
 *
 * 薄殼:內嵌 progress & grade 的 StudentStatusPanel（mode="revision"）顯示每位學生分數,
 * 老師勾選學生後可批次「退回訂正」或「完成批改」。依作業類型顯示不同分數欄:
 *   - 小考:答對題數 / 總題數
 *   - 朗讀:發音 / 準確度 / 流暢度 / 總分（modal 加寬）
 *   - 其他:單一分數
 *
 * 退回訂正 → batch-return-for-revision（小考會建訂正 session、凍結分數）。
 * 完成批改 → finalize-batch-grade（勾選學生設 GRADED;不覆寫分數）。
 *
 * title 顯示作業名稱 + 上一份/下一份箭頭。學生名單在 modal 內捲動。
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import {
  Loader2,
  RotateCcw,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import StudentStatusPanel, {
  type StudentProgress,
} from "@/components/StudentStatusPanel";

interface HubAssignment {
  id: number;
  title: string;
  practice_mode: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 可操作的作業清單（未封存），支援上一份/下一份切換 */
  assignments: HubAssignment[];
  /** 被點開的作業在 assignments 中的索引 */
  initialIndex: number;
  classroomId: string | number;
  /** 退回/完成成功後通知父層 refetch */
  onDone?: () => void;
}

const noop = () => {};

export function RequestRevisionModal({
  open,
  onOpenChange,
  assignments,
  initialIndex,
  classroomId,
  onDone,
}: Props) {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(initialIndex);
  const [students, setStudents] = useState<StudentProgress[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  // 單列動作後重新載入名單（不關 modal）的觸發器
  const [reloadKey, setReloadKey] = useState(0);

  // 開啟時對齊到被點的作業
  useEffect(() => {
    if (open) setIdx(initialIndex);
  }, [open, initialIndex]);

  const current = assignments[idx];

  useEffect(() => {
    if (!open || !current) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setSelected([]);
      try {
        const resp = (await apiClient.get(
          `/api/teachers/assignments/${current.id}/progress`,
        )) as
          | StudentProgress[]
          | { students_progress?: StudentProgress[]; data?: StudentProgress[] };
        const arr = Array.isArray(resp)
          ? resp
          : resp.students_progress || resp.data || [];
        if (!cancelled) setStudents(arr);
      } catch {
        if (!cancelled) {
          toast.error(t("requestRevision.loadFailed", "載入學生名單失敗"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [open, current, t, reloadKey]);

  // 退回訂正：batch-return-for-revision（小考建訂正 session、凍結分數）
  const handleReturn = useCallback(async () => {
    if (!current || selected.length === 0) return;
    setSubmitting(true);
    try {
      await apiClient.post(
        `/api/teachers/assignments/${current.id}/batch-return-for-revision`,
        { student_ids: selected },
      );
      toast.success(
        t("requestRevision.success", "已退回 {{count}} 位學生訂正", {
          count: selected.length,
        }),
      );
      onOpenChange(false);
      onDone?.();
    } catch {
      toast.error(t("requestRevision.submitFailed", "退回失敗"));
    } finally {
      setSubmitting(false);
    }
  }, [current, selected, t, onOpenChange, onDone]);

  // 完成批改：finalize-batch-grade，勾選學生設 GRADED（不覆寫分數）
  const handleComplete = useCallback(async () => {
    if (!current || selected.length === 0) return;
    setSubmitting(true);
    try {
      const teacher_decisions: Record<string, "GRADED"> = {};
      selected.forEach((id) => {
        teacher_decisions[String(id)] = "GRADED";
      });
      await apiClient.post(
        `/api/teachers/assignments/${current.id}/finalize-batch-grade`,
        { classroom_id: Number(classroomId), teacher_decisions },
      );
      toast.success(
        t("gradingHub.completeSuccess", "已完成 {{count}} 位學生批改", {
          count: selected.length,
        }),
      );
      onOpenChange(false);
      onDone?.();
    } catch {
      toast.error(t("gradingHub.completeFailed", "完成批改失敗"));
    } finally {
      setSubmitting(false);
    }
  }, [current, selected, classroomId, t, onOpenChange, onDone]);

  // 單一學生：退回訂正（不關 modal，做完重載名單）
  const handleReturnOne = useCallback(
    async (studentId: number) => {
      if (!current) return;
      try {
        await apiClient.post(
          `/api/teachers/assignments/${current.id}/batch-return-for-revision`,
          { student_ids: [studentId] },
        );
        toast.success(t("gradingHub.rowReturnSuccess", "已退回該學生訂正"));
        setReloadKey((k) => k + 1);
        onDone?.();
      } catch {
        toast.error(t("requestRevision.submitFailed", "退回失敗"));
      }
    },
    [current, t, onDone],
  );

  // 單一學生：完成批改（設 GRADED，不關 modal，做完重載名單）
  const handleGradeOne = useCallback(
    async (studentId: number) => {
      if (!current) return;
      try {
        await apiClient.post(
          `/api/teachers/assignments/${current.id}/finalize-batch-grade`,
          {
            classroom_id: Number(classroomId),
            teacher_decisions: { [String(studentId)]: "GRADED" },
          },
        );
        toast.success(t("gradingHub.rowGradeSuccess", "已標記該學生完成批改"));
        setReloadKey((k) => k + 1);
        onDone?.();
      } catch {
        toast.error(t("gradingHub.completeFailed", "完成批改失敗"));
      }
    },
    [current, classroomId, t, onDone],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          {/* title = 作業名稱 + 上一份/下一份箭頭 */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              disabled={idx <= 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <DialogTitle className="flex-1 min-w-0 flex items-center justify-center gap-1">
              <span className="truncate">
                {current?.title ?? t("gradingHub.title", "批改")}
              </span>
              {assignments.length > 1 && (
                <span className="shrink-0 text-gray-400 font-normal">
                  ({idx + 1}/{assignments.length})
                </span>
              )}
            </DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() =>
                setIdx((i) => Math.min(assignments.length - 1, i + 1))
              }
              disabled={idx >= assignments.length - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* 內嵌 progress & grade 的 panel。外層 flex 容器(不自己捲),
            panel scrollable → 只有學生名單區捲動,排序/全選/區間列固定。 */}
        <div className="flex-1 min-h-0 flex flex-col">
          <StudentStatusPanel
            mode="revision"
            scrollable
            students={students}
            assignmentId={current?.id ?? 0}
            classroomId={classroomId}
            practiceMode={current?.practice_mode}
            isEditingStudents={false}
            onEditingStudentsChange={noop}
            onStudentIdsChanged={noop}
            loading={loading}
            onRevisionSelectionChange={setSelected}
            onRowReturn={handleReturnOne}
            onRowGrade={handleGradeOne}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="h-8 px-3 py-1 text-[13px]"
          >
            {t("common.cancel", "取消")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleReturn}
            disabled={submitting || selected.length === 0}
            className="h-8 px-3 py-1 text-[13px] border-orange-300 text-orange-600 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-2" />
            )}
            {t("gradingHub.returnBtn", "退回訂正（{{count}}）", {
              count: selected.length,
            })}
          </Button>
          <Button
            type="button"
            onClick={handleComplete}
            disabled={submitting || selected.length === 0}
            className="h-8 px-3 py-1 text-[13px] bg-green-600 hover:bg-green-700 text-white"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            {t("gradingHub.completeBtn", "完成批改（{{count}}）", {
              count: selected.length,
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
