/**
 * RequestRevisionModal — 班級作業列表「批次要求訂正」彈窗（#830）
 *
 * 薄殼:內嵌 progress & grade 的 StudentStatusPanel（mode="revision"）讓外觀完全一致,
 * 只差:無 tabs、checkbox 勾選要退回的學生、工具列換成「全選未達100 + 分數區間」、
 * 點姓名開該生批改頁。確認退回 → POST batch-return-for-revision。
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
import { Loader2, RotateCcw } from "lucide-react";
import StudentStatusPanel, {
  type StudentProgress,
} from "@/components/StudentStatusPanel";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId: number;
  classroomId: string | number;
  /** 退回成功後通知父層 refetch */
  onDone?: () => void;
}

const noop = () => {};

export function RequestRevisionModal({
  open,
  onOpenChange,
  assignmentId,
  classroomId,
  onDone,
}: Props) {
  const { t } = useTranslation();
  const [students, setStudents] = useState<StudentProgress[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);

  useEffect(() => {
    if (!open || !assignmentId) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setSelected([]);
      try {
        const resp = (await apiClient.get(
          `/api/teachers/assignments/${assignmentId}/progress`,
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
  }, [open, assignmentId, t]);

  const handleSubmit = useCallback(async () => {
    if (selected.length === 0) return;
    setSubmitting(true);
    try {
      await apiClient.post(
        `/api/teachers/assignments/${assignmentId}/batch-return-for-revision`,
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
  }, [selected, assignmentId, t, onOpenChange, onDone]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("requestRevision.title", "要求訂正")}</DialogTitle>
        </DialogHeader>

        <StudentStatusPanel
          mode="revision"
          scrollable
          students={students}
          assignmentId={assignmentId}
          classroomId={classroomId}
          isEditingStudents={false}
          onEditingStudentsChange={noop}
          onStudentIdsChanged={noop}
          loading={loading}
          onRevisionSelectionChange={setSelected}
        />

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t("common.cancel", "取消")}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || selected.length === 0}
            className="bg-orange-600 hover:bg-orange-700 text-white"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-2" />
            )}
            {t("requestRevision.confirm", "確認退回（{{count}} 位）", {
              count: selected.length,
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
