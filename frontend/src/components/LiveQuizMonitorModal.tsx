/**
 * LiveQuizMonitorModal — Issue #835 監考即時看板
 *
 * 老師按「開始考試」後自動彈出。薄殼沿用批改 hub 的 Dialog 外框 + StudentStatusPanel
 * （mode="revision" + readOnly 純看模式）顯示全班逐人作答現況：紅綠燈狀態、答對/總題、
 * 依答對數即時排行（排名變動時平滑滑動 + 上升閃綠）。
 *
 * 約每 2 秒輪詢 /quiz/live-progress 更新；底部「收卷」按鈕（直接收卷、不二次確認，與
 * ClassroomDetail 列上 switch 一致）呼叫 /quiz/close 強制收尾全班，收卷後切「已收卷」並停止輪詢。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiClient, type LiveQuizProgress } from "@/lib/api";
import { toast } from "sonner";
import { Loader2, Square } from "lucide-react";
import StudentStatusPanel, {
  type StudentProgress,
} from "@/components/StudentStatusPanel";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Assignment.id（老師端） */
  assignmentId: number;
  classroomId: string | number;
  practiceMode: string;
  title: string;
  /** 收卷成功後通知父層 refetch 作業列表 */
  onClosed?: () => void;
  intervalMs?: number;
}

const noop = () => {};

export default function LiveQuizMonitorModal({
  open,
  onOpenChange,
  assignmentId,
  classroomId,
  practiceMode,
  title,
  onClosed,
  intervalMs = 2000,
}: Props) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<LiveQuizProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  const isClosed = progress?.state === "closed";

  // 輪詢 live-progress（收卷後停止）
  useEffect(() => {
    if (!open || !assignmentId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const data = await apiClient.getLiveQuizProgress(assignmentId);
        if (cancelled) return;
        setProgress(data);
        setLoading(false);
        if (data.state === "closed") return; // 已收卷停止輪詢
      } catch {
        // 暫態錯誤忽略，下一輪再試
      }
      if (!cancelled) timer = setTimeout(poll, intervalMs);
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, assignmentId, intervalMs]);

  // 「已進行」計時（每秒刷新顯示，僅進行中）
  useEffect(() => {
    if (!open || isClosed || !progress?.opened_at) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, isClosed, progress?.opened_at]);

  const handleClose = useCallback(async () => {
    setClosing(true);
    try {
      const result = await apiClient.closeLiveQuiz(assignmentId);
      setProgress((prev) => (prev ? { ...prev, ...result } : prev));
      toast.success(t("liveQuizMonitor.collected", "已收卷，全班成績已結算"));
      onClosedRef.current?.();
    } catch {
      toast.error(t("liveQuizMonitor.collectFailed", "收卷失敗，請重試"));
    } finally {
      setClosing(false);
    }
  }, [assignmentId, t]);

  const elapsedLabel = (() => {
    if (!progress?.opened_at) return null;
    const openedMs = new Date(progress.opened_at).getTime();
    const sec = Math.max(0, Math.floor((nowMs - openedMs) / 1000));
    const mm = Math.floor(sec / 60);
    const ss = sec % 60;
    return `${mm}:${String(ss).padStart(2, "0")}`;
  })();

  const students: StudentProgress[] = (progress?.students ?? []).map((s) => ({
    ...s,
    status: s.status as StudentProgress["status"],
    score: s.score ?? undefined,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>{title}</span>
            {isClosed ? (
              <span className="text-xs font-normal px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                {t("liveQuizMonitor.stateClosed", "已收卷")}
              </span>
            ) : (
              <span className="text-xs font-normal px-2 py-0.5 rounded bg-green-100 text-green-700">
                {t("liveQuizMonitor.stateOpen", "考試進行中")}
                {elapsedLabel ? ` · ${elapsedLabel}` : ""}
              </span>
            )}
            {progress && (
              <span className="text-xs font-normal text-gray-500">
                {t("liveQuizMonitor.submittedCount", "已交")}{" "}
                {progress.submitted_count}/{progress.total_students}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            // revision 模式才有逐人 metric（答對/總題）版面；readOnly 再關掉所有批改互動 → 純監考看板
            <StudentStatusPanel
              students={students}
              assignmentId={assignmentId}
              classroomId={classroomId}
              practiceMode={practiceMode}
              mode="revision"
              readOnly
              scrollable
              isEditingStudents={false}
              onEditingStudentsChange={noop}
              onStudentIdsChanged={noop}
              loading={false}
            />
          )}
        </div>

        {!isClosed && (
          <DialogFooter>
            {/* 收卷直接收、不二次確認 */}
            <Button
              variant="destructive"
              onClick={handleClose}
              disabled={closing}
            >
              {closing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Square className="h-4 w-4 mr-1.5" />
                  {t("liveQuizMonitor.collect", "收卷")}
                </>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
