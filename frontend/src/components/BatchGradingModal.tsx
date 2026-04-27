import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import { Loader2, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TrafficLightDot,
  useStatusLabel,
} from "@/components/StudentStatusPanel";

// Teacher's decision for each student
type TeacherDecision = "RETURNED" | "GRADED" | null;

// Sort priority by student status. Same ordering as GradingPage's sidebar so
// teachers see students in a consistent order across both screens.
// IN_PROGRESS and RETURNED share priority 1 — both need teacher attention
// (resubmissions land here) so they cluster at the top of the list. Update
// here AND in GradingPage if the ordering rule changes.
const STATUS_SORT_PRIORITY: Record<string, number> = {
  IN_PROGRESS: 1,
  RETURNED: 1,
  SUBMITTED: 2,
  RESUBMITTED: 2,
  NOT_STARTED: 3,
  GRADED: 4,
  NOT_ASSIGNED: 99,
};

// A student counts as "inactive" for batch auto-decision purposes when they
// haven't actually submitted work — those rows skip the score-based default
// and force the teacher to decide manually.
const isInactiveStatus = (status: string) =>
  status === "NOT_STARTED" || status === "IN_PROGRESS" || status === "RETURNED";

interface BatchGradingResult {
  student_id: number;
  student_name: string;
  total_score: number;
  missing_items: number;
  total_items: number;
  completed_items: number;
  avg_pronunciation: number;
  avg_accuracy: number;
  avg_fluency: number;
  avg_completeness: number;
  feedback?: string;
  status: string;
}

interface BatchGradingResponse {
  total_students: number;
  results: BatchGradingResult[];
}

interface BatchGradeFinalizeResponse {
  returned_count: number;
  graded_count: number;
  unchanged_count: number;
  total_count: number;
}

interface BatchGradingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId: number;
  classroomId: number;
  onComplete?: () => void;
}

export default function BatchGradingModal({
  open,
  onOpenChange,
  assignmentId,
  classroomId,
  onComplete,
}: BatchGradingModalProps) {
  const { t } = useTranslation();
  const getStatusLabel = useStatusLabel();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [results, setResults] = useState<BatchGradingResult[] | null>(null);
  const [teacherDecisions, setTeacherDecisions] = useState<
    Record<number, TeacherDecision>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      // Reset state when modal opens
      setResults(null);
      setProgress(null);
      setTeacherDecisions({});
      // Automatically start grading
      handleStartGrading();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleStartGrading recreated each render; only run on modal open
  }, [open]);

  const handleStartGrading = async () => {
    setLoading(true);
    setProgress({ current: 0, total: 0 });

    try {
      const response = await apiClient.post<BatchGradingResponse>(
        `/api/teachers/assignments/${assignmentId}/batch-grade`,
        {
          classroom_id: classroomId,
        },
      );

      const sortedResults = [...response.results].sort((a, b) => {
        const aPriority = STATUS_SORT_PRIORITY[a.status] ?? 50;
        const bPriority = STATUS_SORT_PRIORITY[b.status] ?? 50;
        if (aPriority !== bPriority) return aPriority - bPriority;
        return a.student_id - b.student_id;
      });

      setResults(sortedResults);
      setProgress({
        current: response.total_students,
        total: response.total_students,
      });

      // Pre-select decision based on total_score:
      //   >= 70        → GRADED (completed)
      //   < 69         → RETURNED (send back)
      //   [69, 70)     → null (borderline; teacher decides)
      //   inactive     → null (teacher decides)
      const initialDecisions: Record<number, TeacherDecision> = {};
      response.results.forEach((r) => {
        if (isInactiveStatus(r.status)) {
          initialDecisions[r.student_id] = null;
        } else if (r.total_score >= 70) {
          initialDecisions[r.student_id] = "GRADED";
        } else if (r.total_score < 69) {
          initialDecisions[r.student_id] = "RETURNED";
        } else {
          initialDecisions[r.student_id] = null;
        }
      });
      setTeacherDecisions(initialDecisions);

      toast.success(
        t("batchGrading.messages.success", {
          count: response.total_students,
        }),
      );
    } catch (error) {
      console.error("Batch grading failed:", error);
      toast.error(t("batchGrading.messages.error"));
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitSingleStudent = async (studentId: number) => {
    const decision = teacherDecisions[studentId];
    if (!decision) {
      toast.warning(t("batchGrading.selectDecisionFirst"));
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.post<BatchGradeFinalizeResponse>(
        `/api/teachers/assignments/${assignmentId}/finalize-batch-grade`,
        {
          classroom_id: classroomId,
          teacher_decisions: { [studentId]: decision },
        },
      );

      const studentName =
        results?.find((r) => r.student_id === studentId)?.student_name || "";
      toast.success(
        t("batchGrading.singleSubmitSuccess", { name: studentName }),
      );

      // Remove student from list
      setResults(
        (prev) => prev?.filter((r) => r.student_id !== studentId) || null,
      );
    } catch (error) {
      console.error("Error submitting single student:", error);
      toast.error(t("batchGrading.errorDescription"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitAll = async () => {
    setIsSubmitting(true);

    try {
      const response = await apiClient.post<BatchGradeFinalizeResponse>(
        `/api/teachers/assignments/${assignmentId}/finalize-batch-grade`,
        {
          classroom_id: classroomId,
          teacher_decisions: teacherDecisions,
        },
      );

      toast.success(
        t("batchGrading.allSubmitSuccess", {
          graded: response.graded_count,
          returned: response.returned_count,
          unchanged: response.unchanged_count,
        }),
      );

      onComplete?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Error finalizing grading:", error);
      toast.error(t("batchGrading.errorDescription"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectAll = (decision: TeacherDecision) => {
    const allDecisions: Record<number, TeacherDecision> = {};
    results?.forEach((r) => {
      allDecisions[r.student_id] = decision;
    });
    setTeacherDecisions(allDecisions);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw] max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl font-bold">
            {t("batchGrading.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Progress Section */}
          {loading && progress && (
            <div className="flex items-center gap-3 p-3 sm:p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin text-blue-600 flex-shrink-0" />
              <span className="font-medium text-sm sm:text-base text-blue-900 dark:text-blue-300">
                {t("batchGrading.progress", {
                  current: progress.current,
                  total: progress.total,
                })}
              </span>
            </div>
          )}

          {/* Results Section */}
          {results && (
            <>
              {/* Select All Controls - Responsive 2+1 Layout */}
              <div className="mb-4">
                {/* Mobile: 2+1 layout */}
                <div className="flex flex-col gap-2 sm:hidden">
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleSelectAll("GRADED")}
                      className="flex-1 h-12 min-h-12 bg-green-600 hover:bg-green-700 text-white dark:bg-green-600 dark:hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-blue-400 dark:focus:ring-offset-gray-800"
                    >
                      {t("batchGrading.decisionGraded")}
                    </Button>
                    <Button
                      onClick={() => handleSelectAll("RETURNED")}
                      className="flex-1 h-12 min-h-12 bg-red-600 hover:bg-red-700 text-white dark:bg-red-600 dark:hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-blue-400 dark:focus:ring-offset-gray-800"
                    >
                      {t("batchGrading.decisionReturned")}
                    </Button>
                  </div>
                  <Button
                    onClick={() => handleSelectAll(null)}
                    variant="outline"
                    className="w-full h-12 min-h-12 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-blue-400 dark:focus:ring-offset-gray-800"
                  >
                    {t("batchGrading.clearAll")}
                  </Button>
                </div>

                {/* Tablet+: Three buttons in a row */}
                <div className="hidden sm:flex gap-3">
                  <Button
                    onClick={() => handleSelectAll("GRADED")}
                    className="flex-1 h-12 min-h-12 bg-green-600 hover:bg-green-700 text-white dark:bg-green-600 dark:hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-blue-400 dark:focus:ring-offset-gray-800"
                  >
                    {t("batchGrading.selectAllGraded")}
                  </Button>
                  <Button
                    onClick={() => handleSelectAll("RETURNED")}
                    className="flex-1 h-12 min-h-12 bg-red-600 hover:bg-red-700 text-white dark:bg-red-600 dark:hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-blue-400 dark:focus:ring-offset-gray-800"
                  >
                    {t("batchGrading.selectAllReturned")}
                  </Button>
                  <Button
                    onClick={() => handleSelectAll(null)}
                    variant="outline"
                    className="flex-1 h-12 min-h-12 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-blue-400 dark:focus:ring-offset-gray-800"
                  >
                    {t("batchGrading.clearAll")}
                  </Button>
                </div>
              </div>

              {/* Desktop Table View (lg and above) */}
              <div className="hidden lg:block border dark:border-gray-700 rounded-lg overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th className="px-4 py-4 text-left text-base font-semibold text-gray-700 dark:text-gray-300">
                        {t("batchGrading.studentName")}
                      </th>
                      <th className="px-3 py-4 text-center text-base font-semibold text-gray-700 dark:text-gray-300">
                        {t("batchGrading.pronunciation")}
                      </th>
                      <th className="px-3 py-4 text-center text-base font-semibold text-gray-700 dark:text-gray-300">
                        {t("batchGrading.accuracy")}
                      </th>
                      <th className="px-3 py-4 text-center text-base font-semibold text-gray-700 dark:text-gray-300">
                        {t("batchGrading.fluency")}
                      </th>
                      <th className="px-3 py-4 text-center text-base font-semibold text-gray-700 dark:text-gray-300">
                        {t("batchGrading.completeness")}
                      </th>
                      <th className="px-3 py-4 text-center text-base font-semibold text-gray-700 dark:text-gray-300">
                        {t("batchGrading.totalScore")}
                      </th>
                      <th className="px-3 py-4 text-center text-base font-semibold text-gray-700 dark:text-gray-300">
                        {t("batchGrading.missingItems")}
                      </th>
                      <th className="px-4 py-4 text-center text-base font-semibold text-gray-700 dark:text-gray-300">
                        {t("batchGrading.decision")}
                      </th>
                      <th className="px-3 py-4 text-center text-base font-semibold text-gray-700 dark:text-gray-300">
                        {t("batchGrading.action")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((result) => {
                      return (
                        <tr
                          key={result.student_id}
                          className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          <td className="px-4 py-4 text-base font-medium dark:text-gray-300">
                            <div className="flex items-start gap-2">
                              <TrafficLightDot
                                status={result.status}
                                size={12}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate">
                                  {result.student_name}
                                </div>
                                <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                                  {getStatusLabel(result.status)}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-4 text-center">
                            <span className="text-lg font-semibold text-blue-600 dark:text-blue-400">
                              {(result.avg_pronunciation ?? 0).toFixed(0)}
                            </span>
                          </td>
                          <td className="px-3 py-4 text-center">
                            <span className="text-lg font-semibold text-purple-600 dark:text-purple-400">
                              {(result.avg_accuracy ?? 0).toFixed(0)}
                            </span>
                          </td>
                          <td className="px-3 py-4 text-center">
                            <span className="text-lg font-semibold text-teal-600 dark:text-teal-400">
                              {(result.avg_fluency ?? 0).toFixed(0)}
                            </span>
                          </td>
                          <td className="px-3 py-4 text-center">
                            <span className="text-lg font-semibold text-indigo-600 dark:text-indigo-400">
                              {(result.avg_completeness ?? 0).toFixed(0)}
                            </span>
                          </td>
                          <td className="px-3 py-4 text-center">
                            <span
                              className={`text-xl font-bold ${
                                result.total_score >= 80
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-red-600 dark:text-red-400"
                              }`}
                            >
                              {result.total_score.toFixed(1)}
                            </span>
                          </td>
                          <td className="px-3 py-4 text-center">
                            {result.missing_items > 0 ? (
                              <span className="text-lg font-semibold text-red-600 dark:text-red-400">
                                {result.missing_items}
                              </span>
                            ) : (
                              <span className="text-lg font-semibold text-green-600 dark:text-green-400">
                                0
                              </span>
                            )}
                          </td>

                          {/* Button Group Decision Column - Desktop */}
                          <td className="px-4 py-4">
                            <div className="flex flex-col gap-2">
                              <Button
                                variant={
                                  teacherDecisions[result.student_id] ===
                                  "GRADED"
                                    ? "default"
                                    : "outline"
                                }
                                size="sm"
                                aria-label={t(
                                  "batchGrading.aria.markAsGraded",
                                  {
                                    name: result.student_name,
                                  },
                                )}
                                aria-pressed={
                                  teacherDecisions[result.student_id] ===
                                  "GRADED"
                                }
                                className={cn(
                                  "justify-start text-sm font-medium w-full",
                                  teacherDecisions[result.student_id] ===
                                    "GRADED" &&
                                    "bg-green-600 hover:bg-green-700 text-white dark:bg-green-600 dark:hover:bg-green-700",
                                )}
                                onClick={() =>
                                  setTeacherDecisions((prev) => ({
                                    ...prev,
                                    [result.student_id]: "GRADED",
                                  }))
                                }
                              >
                                ✓ {t("batchGrading.decisionGraded")}
                              </Button>

                              <Button
                                variant={
                                  teacherDecisions[result.student_id] ===
                                  "RETURNED"
                                    ? "default"
                                    : "outline"
                                }
                                size="sm"
                                aria-label={t(
                                  "batchGrading.aria.markAsReturned",
                                  { name: result.student_name },
                                )}
                                aria-pressed={
                                  teacherDecisions[result.student_id] ===
                                  "RETURNED"
                                }
                                className={cn(
                                  "justify-start text-sm font-medium w-full",
                                  teacherDecisions[result.student_id] ===
                                    "RETURNED" &&
                                    "bg-red-600 hover:bg-red-700 text-white dark:bg-red-600 dark:hover:bg-red-700",
                                )}
                                onClick={() =>
                                  setTeacherDecisions((prev) => ({
                                    ...prev,
                                    [result.student_id]: "RETURNED",
                                  }))
                                }
                              >
                                ↩ {t("batchGrading.decisionReturned")}
                              </Button>

                              <Button
                                variant={
                                  teacherDecisions[result.student_id] === null
                                    ? "default"
                                    : "outline"
                                }
                                size="sm"
                                aria-label={t(
                                  "batchGrading.aria.markAsPending",
                                  { name: result.student_name },
                                )}
                                aria-pressed={
                                  teacherDecisions[result.student_id] === null
                                }
                                className={cn(
                                  "justify-start text-sm font-medium w-full",
                                  teacherDecisions[result.student_id] ===
                                    null &&
                                    "bg-gray-600 hover:bg-gray-700 text-white dark:bg-gray-500 dark:hover:bg-gray-600",
                                )}
                                onClick={() =>
                                  setTeacherDecisions((prev) => ({
                                    ...prev,
                                    [result.student_id]: null,
                                  }))
                                }
                              >
                                ⏸ {t("batchGrading.decisionPending")}
                              </Button>
                            </div>
                          </td>

                          {/* Single Submit Button */}
                          <td className="px-4 py-3 text-center">
                            <Button
                              size="sm"
                              onClick={() =>
                                handleSubmitSingleStudent(result.student_id)
                              }
                              disabled={
                                !teacherDecisions[result.student_id] ||
                                isSubmitting
                              }
                            >
                              {t("batchGrading.submitSingle")}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile/Tablet Card View (below lg) */}
              <div className="lg:hidden space-y-3">
                {results.map((result) => {
                  return (
                    <Card key={result.student_id} className="p-3 sm:p-4">
                      {/* Student Name Header */}
                      <div className="mb-3 pb-2 border-b dark:border-gray-700 flex items-start gap-2">
                        <TrafficLightDot status={result.status} size={14} />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-base sm:text-lg truncate">
                            {result.student_name}
                          </div>
                          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                            {getStatusLabel(result.status)}
                          </div>
                        </div>
                      </div>

                      {/* Score Grid - 2 columns on mobile */}
                      <div className="grid grid-cols-2 gap-2 mb-3 text-xs sm:text-sm">
                        <div className="flex justify-between items-center p-2 bg-blue-50 dark:bg-blue-900/20 rounded">
                          <span className="text-gray-600 dark:text-gray-400">
                            {t("batchGrading.pronunciation")}:
                          </span>
                          <span className="text-blue-600 dark:text-blue-400 font-medium">
                            {(result.avg_pronunciation ?? 0).toFixed(0)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center p-2 bg-purple-50 dark:bg-purple-900/20 rounded">
                          <span className="text-gray-600 dark:text-gray-400">
                            {t("batchGrading.accuracy")}:
                          </span>
                          <span className="text-purple-600 dark:text-purple-400 font-medium">
                            {(result.avg_accuracy ?? 0).toFixed(0)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center p-2 bg-teal-50 dark:bg-teal-900/20 rounded">
                          <span className="text-gray-600 dark:text-gray-400">
                            {t("batchGrading.fluency")}:
                          </span>
                          <span className="text-teal-600 dark:text-teal-400 font-medium">
                            {(result.avg_fluency ?? 0).toFixed(0)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded">
                          <span className="text-gray-600 dark:text-gray-400">
                            {t("batchGrading.completeness")}:
                          </span>
                          <span className="text-indigo-600 dark:text-indigo-400 font-medium">
                            {(result.avg_completeness ?? 0).toFixed(0)}
                          </span>
                        </div>
                      </div>

                      {/* Total Score and Missing Items - Prominent Display */}
                      <div className="flex justify-between items-center mb-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            {t("batchGrading.totalScore")}:
                          </span>
                          <span
                            className={`text-2xl font-bold ${
                              result.total_score >= 80
                                ? "text-green-600 dark:text-green-400"
                                : "text-red-600 dark:text-red-400"
                            }`}
                          >
                            {result.total_score.toFixed(1)}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-gray-600 dark:text-gray-400 block">
                            {t("batchGrading.missingItems")}
                          </span>
                          {result.missing_items > 0 ? (
                            <span className="text-red-600 dark:text-red-400 font-bold text-lg">
                              {result.missing_items}
                            </span>
                          ) : (
                            <span className="text-green-600 dark:text-green-400 font-bold text-lg">
                              0
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Decision and Submit Buttons - Two Row Layout */}
                      {/* Row 1: Three decision buttons (simplified text) */}
                      <div className="flex gap-2 mb-2">
                        <Button
                          variant={
                            teacherDecisions[result.student_id] === "GRADED"
                              ? "default"
                              : "outline"
                          }
                          aria-label={t("batchGrading.aria.markAsGraded", {
                            name: result.student_name,
                          })}
                          aria-pressed={
                            teacherDecisions[result.student_id] === "GRADED"
                          }
                          className={cn(
                            "flex-1 text-sm min-h-[44px] py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-blue-400 dark:focus:ring-offset-gray-800",
                            teacherDecisions[result.student_id] === "GRADED" &&
                              "bg-green-700 hover:bg-green-800 text-white dark:bg-green-600 dark:hover:bg-green-700 dark:text-white font-semibold",
                          )}
                          onClick={() =>
                            setTeacherDecisions((prev) => ({
                              ...prev,
                              [result.student_id]: "GRADED",
                            }))
                          }
                        >
                          {t("batchGrading.decisionGraded")}
                        </Button>
                        <Button
                          variant={
                            teacherDecisions[result.student_id] === "RETURNED"
                              ? "default"
                              : "outline"
                          }
                          aria-label={t("batchGrading.aria.markAsReturned", {
                            name: result.student_name,
                          })}
                          aria-pressed={
                            teacherDecisions[result.student_id] === "RETURNED"
                          }
                          className={cn(
                            "flex-1 text-sm min-h-[44px] py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-blue-400 dark:focus:ring-offset-gray-800",
                            teacherDecisions[result.student_id] ===
                              "RETURNED" &&
                              "bg-red-700 hover:bg-red-800 text-white dark:bg-red-600 dark:hover:bg-red-700 dark:text-white font-semibold",
                          )}
                          onClick={() =>
                            setTeacherDecisions((prev) => ({
                              ...prev,
                              [result.student_id]: "RETURNED",
                            }))
                          }
                        >
                          {t("batchGrading.decisionReturned")}
                        </Button>
                        <Button
                          variant={
                            teacherDecisions[result.student_id] === null
                              ? "default"
                              : "outline"
                          }
                          aria-label={t("batchGrading.aria.markAsPending", {
                            name: result.student_name,
                          })}
                          aria-pressed={
                            teacherDecisions[result.student_id] === null
                          }
                          className={cn(
                            "flex-1 text-sm min-h-[44px] py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-blue-400 dark:focus:ring-offset-gray-800",
                            teacherDecisions[result.student_id] === null &&
                              "bg-gray-700 hover:bg-gray-800 text-white dark:bg-gray-500 dark:hover:bg-gray-600 dark:text-white font-semibold",
                          )}
                          onClick={() =>
                            setTeacherDecisions((prev) => ({
                              ...prev,
                              [result.student_id]: null,
                            }))
                          }
                        >
                          {t("batchGrading.decisionPending")}
                        </Button>
                      </div>

                      {/* Row 2: Submit button (right-aligned) */}
                      <div className="flex justify-end">
                        <Button
                          onClick={() =>
                            handleSubmitSingleStudent(result.student_id)
                          }
                          disabled={
                            !teacherDecisions[result.student_id] || isSubmitting
                          }
                          className={cn(
                            "bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-700 dark:text-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-blue-400 dark:focus:ring-offset-gray-800",
                            "disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed dark:disabled:bg-gray-700 dark:disabled:text-gray-500",
                          )}
                        >
                          {t("batchGrading.submitSingle")}
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 mt-6 flex-col sm:flex-row">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="w-full sm:w-auto focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-blue-400 dark:focus:ring-offset-gray-800"
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSubmitAll}
            disabled={isSubmitting || loading}
            className={cn(
              "w-full sm:w-auto min-w-[100px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-blue-400 dark:focus:ring-offset-gray-800",
              "disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed dark:disabled:bg-gray-700 dark:disabled:text-gray-500",
            )}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("batchGrading.processing")}
              </>
            ) : (
              <>
                <CheckCircle className="mr-2 h-4 w-4" />
                {t("batchGrading.submitAll")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
