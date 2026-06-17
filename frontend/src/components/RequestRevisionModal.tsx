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
import { Progress } from "@/components/ui/progress";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import {
  Loader2,
  RotateCcw,
  CheckCircle2,
  Undo2,
  Sparkles,
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
  /** 朗讀/口說作業：是否可用 AI 批改（控制 hub 內「AI 批改」鈕） */
  canUseAiGrading?: boolean;
}

const noop = () => {};

export function RequestRevisionModal({
  open,
  onOpenChange,
  assignments,
  initialIndex,
  classroomId,
  onDone,
  canUseAiGrading,
}: Props) {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(initialIndex);
  const [students, setStudents] = useState<StudentProgress[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  // AI 批改進度（null = 未在批改）；aiGrading 由它衍生
  const [aiProgress, setAiProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const aiGrading = aiProgress !== null;
  // AI 批改算完分數後，重新載入名單（總分/指標才會更新）
  const [reloadKey, setReloadKey] = useState(0);

  // 開啟時對齊到被點的作業
  useEffect(() => {
    if (open) setIdx(initialIndex);
  }, [open, initialIndex]);

  const current = assignments[idx];
  const isReading =
    current?.practice_mode === "reading" ||
    current?.practice_mode === "word_reading";

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

  // AI 批改：把非-GRADED 學生分批（每批 5）、少量並行（3）呼叫 batch-grade，顯示真實進度。
  // batch-grade 多人模式後端自動跳過 GRADED；只補送「有錄音但未評估」的題到 Azure。
  // 不改狀態；算完重載名單讓總分/指標更新。之後老師再用 完成批改/退回 收尾。
  const handleAiGrade = useCallback(async () => {
    if (!current) return;
    const targetIds = students
      .filter((s) => s.status !== "GRADED" && s.status !== "unassigned")
      .map((s) => s.student_id);
    if (targetIds.length === 0) {
      toast.error(t("gradingHub.noTarget", "沒有符合的學生"));
      return;
    }

    const CHUNK = 5;
    const CONCURRENCY = 3;
    const chunks: number[][] = [];
    for (let i = 0; i < targetIds.length; i += CHUNK) {
      chunks.push(targetIds.slice(i, i + CHUNK));
    }

    setAiProgress({ current: 0, total: targetIds.length });
    let cursor = 0;
    let done = 0;
    let failed = 0;
    const worker = async () => {
      while (cursor < chunks.length) {
        const chunk = chunks[cursor++];
        try {
          await apiClient.post(
            `/api/teachers/assignments/${current.id}/batch-grade`,
            { classroom_id: Number(classroomId), student_ids: chunk },
          );
        } catch {
          failed += chunk.length;
        }
        done += chunk.length;
        setAiProgress({ current: done, total: targetIds.length });
      }
    };
    try {
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker),
      );
      if (failed > 0) {
        toast.warning(
          t("gradingHub.aiGradePartial", "完成 {{ok}}，失敗 {{fail}}", {
            ok: targetIds.length - failed,
            fail: failed,
          }),
        );
      } else {
        toast.success(t("gradingHub.aiGradeSuccess", "AI 批改完成"));
      }
      setReloadKey((k) => k + 1);
      onDone?.();
    } finally {
      setAiProgress(null);
    }
  }, [current, students, classroomId, t, onDone]);

  // 退回訂正：batch-return-for-revision（小考建訂正 session、凍結分數）
  // 送出前先排除已是 RETURNED 的學生（取消其勾選）。
  const handleReturn = useCallback(async () => {
    if (!current) return;
    const ids = selected.filter((id) => {
      const s = students.find((x) => x.student_id === id);
      return !!s && s.status !== "RETURNED";
    });
    if (ids.length === 0) {
      toast.error(t("gradingHub.noTarget", "沒有符合的學生"));
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.post(
        `/api/teachers/assignments/${current.id}/batch-return-for-revision`,
        { student_ids: ids },
      );
      toast.success(
        t("requestRevision.success", "已退回 {{count}} 位學生訂正", {
          count: ids.length,
        }),
      );
      // 不關 modal：就地更新被退回學生的狀態，讓老師自行關閉
      setStudents((prev) =>
        prev.map((s) =>
          ids.includes(s.student_id)
            ? { ...s, status: "RETURNED" as const }
            : s,
        ),
      );
      onDone?.();
    } catch {
      toast.error(t("requestRevision.submitFailed", "退回失敗"));
    } finally {
      setSubmitting(false);
    }
  }, [current, selected, students, t, onDone]);

  // 完成批改：finalize-batch-grade，勾選學生設 GRADED（不覆寫分數）
  // 送出前先排除已是 GRADED 的學生（取消其勾選）。
  const handleComplete = useCallback(async () => {
    if (!current) return;
    const ids = selected.filter((id) => {
      const s = students.find((x) => x.student_id === id);
      return !!s && s.status !== "GRADED";
    });
    if (ids.length === 0) {
      toast.error(t("gradingHub.noTarget", "沒有符合的學生"));
      return;
    }
    setSubmitting(true);
    try {
      const teacher_decisions: Record<string, "GRADED"> = {};
      ids.forEach((id) => {
        teacher_decisions[String(id)] = "GRADED";
      });
      await apiClient.post(
        `/api/teachers/assignments/${current.id}/finalize-batch-grade`,
        { classroom_id: Number(classroomId), teacher_decisions },
      );
      toast.success(
        t("gradingHub.completeSuccess", "已完成 {{count}} 位學生批改", {
          count: ids.length,
        }),
      );
      // 不關 modal：就地更新被批改學生的狀態，讓老師自行關閉
      setStudents((prev) =>
        prev.map((s) =>
          ids.includes(s.student_id) ? { ...s, status: "GRADED" as const } : s,
        ),
      );
      onDone?.();
    } catch {
      toast.error(t("gradingHub.completeFailed", "完成批改失敗"));
    } finally {
      setSubmitting(false);
    }
  }, [current, selected, students, classroomId, t, onDone]);

  // 還原為未開始（批次）：清空該生此作業的分數與作答紀錄（#861，破壞性）。
  // 送出前排除已未開始者。
  const handleResetBatch = useCallback(async () => {
    if (!current) return;
    const ids = selected.filter((id) => {
      const s = students.find((x) => x.student_id === id);
      return !!s && s.status !== "NOT_STARTED" && s.status !== "unassigned";
    });
    if (ids.length === 0) {
      toast.error(t("gradingHub.noTarget", "沒有符合的學生"));
      return;
    }
    // #861: 破壞性動作，會清空分數與作答紀錄，先確認。
    if (
      !window.confirm(
        t(
          "gradingHub.resetConfirm",
          "還原會清空這 {{count}} 位學生此作業的分數與所有作答紀錄，且無法復原。確定要還原嗎？",
          { count: ids.length },
        ),
      )
    ) {
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.post(
        `/api/teachers/assignments/${current.id}/batch-reset-not-started`,
        { student_ids: ids },
      );
      toast.success(
        t("gradingHub.resetSuccess", "已還原 {{count}} 位學生為未開始", {
          count: ids.length,
        }),
      );
      // #861: 還原會清空分數與作答；本地同步清掉顯示分數，避免顯示殘留舊值。
      setStudents((prev) =>
        prev.map((s) =>
          ids.includes(s.student_id)
            ? {
                ...s,
                status: "NOT_STARTED" as const,
                score: undefined,
                correct_count: null,
                total_questions: null,
                metrics: null,
                is_interim_score: false,
              }
            : s,
        ),
      );
      onDone?.();
    } catch {
      toast.error(t("gradingHub.resetFailed", "還原失敗"));
    } finally {
      setSubmitting(false);
    }
  }, [current, selected, students, t, onDone]);

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
        // 不重載名單，只就地更新該生狀態（避免畫面跳動）
        setStudents((prev) =>
          prev.map((s) =>
            s.student_id === studentId
              ? { ...s, status: "RETURNED" as const }
              : s,
          ),
        );
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
        // 不重載名單，只就地更新該生狀態（避免畫面跳動）
        setStudents((prev) =>
          prev.map((s) =>
            s.student_id === studentId
              ? { ...s, status: "GRADED" as const }
              : s,
          ),
        );
        onDone?.();
      } catch {
        toast.error(t("gradingHub.completeFailed", "完成批改失敗"));
      }
    },
    [current, classroomId, t, onDone],
  );

  // 單一學生：還原為未開始（#861：清空該生此作業的分數與作答紀錄，破壞性）
  const handleResetOne = useCallback(
    async (studentId: number) => {
      if (!current) return;
      // #861: 破壞性動作，會清空該生此作業的分數與作答紀錄，先確認。
      if (
        !window.confirm(
          t(
            "gradingHub.rowResetConfirm",
            "還原會清空該學生此作業的分數與所有作答紀錄，且無法復原。確定要還原嗎？",
          ),
        )
      ) {
        return;
      }
      try {
        await apiClient.post(
          `/api/teachers/assignments/${current.id}/batch-reset-not-started`,
          { student_ids: [studentId] },
        );
        toast.success(t("gradingHub.rowResetSuccess", "已還原該學生為未開始"));
        // #861: 還原會清空分數與作答；本地同步清掉顯示分數。
        setStudents((prev) =>
          prev.map((s) =>
            s.student_id === studentId
              ? {
                  ...s,
                  status: "NOT_STARTED" as const,
                  score: undefined,
                  correct_count: null,
                  total_questions: null,
                  metrics: null,
                  is_interim_score: false,
                }
              : s,
          ),
        );
        onDone?.();
      } catch {
        toast.error(t("gradingHub.resetFailed", "還原失敗"));
      }
    },
    [current, t, onDone],
  );

  // 每顆 batch 鈕的數字 = 該動作實際會處理的人數（扣除已是同狀態而會被略過的勾選）
  const countExcluding = (...excluded: string[]) =>
    selected.filter((id) => {
      const s = students.find((x) => x.student_id === id);
      // s.status 已是字串字面量 union（StudentProgress.status），不需再 String() 包裝
      return !!s && !excluded.includes(s.status);
    }).length;
  const resetCount = countExcluding("NOT_STARTED", "unassigned");
  const returnCount = countExcluding("RETURNED");
  const gradeCount = countExcluding("GRADED");

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
            onRowReset={handleResetOne}
            onRowReturn={handleReturnOne}
            onRowGrade={handleGradeOne}
          />
        </div>

        <DialogFooter className="grid grid-cols-2 gap-x-2 gap-y-3 pt-2 sm:flex sm:gap-x-0 sm:gap-y-0 sm:pt-0">
          {/* 朗讀/口說：AI 批改（batch-grade 算分，取代舊 AI Grade modal） */}
          {isReading && canUseAiGrading && (
            <Button
              type="button"
              onClick={handleAiGrade}
              disabled={submitting || aiGrading}
              className="h-8 px-3 py-1 text-[13px] bg-purple-600 hover:bg-purple-700 text-white"
            >
              {aiGrading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              {aiGrading && aiProgress
                ? t(
                    "gradingHub.aiGradeProgress",
                    "AI 批改中 {{current}}/{{total}}",
                    {
                      current: aiProgress.current,
                      total: aiProgress.total,
                    },
                  )
                : t("assignmentDetail.buttons.batchGrade", "AI 批改")}
            </Button>
          )}
          <Button
            type="button"
            onClick={handleResetBatch}
            disabled={submitting || aiGrading || resetCount === 0}
            className="h-8 px-3 py-1 text-[13px] bg-slate-500 hover:bg-slate-600 text-white"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Undo2 className="h-4 w-4 mr-2" />
            )}
            {t("gradingHub.resetBtn", "還原（{{count}}）", {
              count: resetCount,
            })}
          </Button>
          <Button
            type="button"
            onClick={handleReturn}
            disabled={submitting || aiGrading || returnCount === 0}
            className="h-8 px-3 py-1 text-[13px] bg-orange-600 hover:bg-orange-700 text-white"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-2" />
            )}
            {t("gradingHub.returnBtn", "退回訂正（{{count}}）", {
              count: returnCount,
            })}
          </Button>
          <Button
            type="button"
            onClick={handleComplete}
            disabled={submitting || aiGrading || gradeCount === 0}
            className="h-8 px-3 py-1 text-[13px] bg-green-600 hover:bg-green-700 text-white"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            {t("gradingHub.completeBtn", "完成批改（{{count}}）", {
              count: gradeCount,
            })}
          </Button>
        </DialogFooter>

        {/* AI 批改進度條：貼在 modal 下邊界（全寬細 bar） */}
        {aiGrading && aiProgress && (
          <div className="absolute bottom-0 left-0 right-0">
            <Progress
              value={
                aiProgress.total
                  ? (aiProgress.current / aiProgress.total) * 100
                  : 0
              }
              className="h-1.5 rounded-none rounded-b-lg"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
