/**
 * RequestRevisionModal — 班級作業列表「批次要求訂正」彈窗（#830）
 *
 * 薄殼:內嵌 progress & grade 的 StudentStatusPanel（mode="revision"）讓外觀完全一致,
 * 只差:無 tabs、checkbox 勾選要退回的學生、工具列換成「全選未達100 + 分數區間」、
 * 點姓名開該生批改頁。
 *
 * title 顯示作業名稱 + 上一份/下一份箭頭(切換到相鄰作業的退回 modal),仿 GradingHeader。
 * 學生名單在 modal 內捲動,不撐破 modal。
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
import { Loader2, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";
import StudentStatusPanel, {
  type StudentProgress,
} from "@/components/StudentStatusPanel";

interface RevisionAssignment {
  id: number;
  title: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 可退回的作業清單（未封存非朗讀），支援上一份/下一份切換 */
  assignments: RevisionAssignment[];
  /** 被點開的作業在 assignments 中的索引 */
  initialIndex: number;
  classroomId: string | number;
  /** 退回成功後通知父層 refetch */
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
  }, [open, current, t]);

  const handleSubmit = useCallback(async () => {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
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
            <DialogTitle className="flex-1 min-w-0 text-center truncate">
              {current?.title ?? t("requestRevision.title", "要求訂正")}
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
          {assignments.length > 1 && (
            <p className="text-center text-xs text-gray-400">
              {idx + 1} / {assignments.length}
            </p>
          )}
        </DialogHeader>

        {/* 內嵌 progress & grade 的 panel;捲動容器與 pg modal(AssignmentDetailSheet)
            一致:外層 flex-1 overflow-y-auto + 自然高度 panel。Dialog 用 max-height,
            故需 min-h-0 才能縮到比內容小而出現卷軸。 */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <StudentStatusPanel
            mode="revision"
            students={students}
            assignmentId={current?.id ?? 0}
            classroomId={classroomId}
            isEditingStudents={false}
            onEditingStudentsChange={noop}
            onStudentIdsChanged={noop}
            loading={loading}
            onRevisionSelectionChange={setSelected}
          />
        </div>

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
