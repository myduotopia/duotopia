/**
 * AssignmentAnalysisDialog - 作業分析報告對話框
 *
 * 流程：
 * 1. 估算成本 → 2. 確認扣點 → 3. 顯示報告
 */

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
import { Badge } from "@/components/ui/badge";
import { Loader2, BarChart3, AlertCircle, CheckCircle2 } from "lucide-react";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";

interface AnalysisEstimate {
  assignment_id: number;
  assignment_title: string;
  practice_mode: string;
  student_count: number;
  estimated_tokens: number;
  estimated_points: number;
  quota_remaining: number;
  has_sufficient_quota: boolean;
  has_existing_report: boolean;
  existing_report_id: number | null;
}

interface AnalysisReport {
  id: number;
  status: string;
  summary: string;
  report_data: Record<string, unknown>;
  practice_mode: string;
  student_count: number;
  tokens_used: number;
  points_deducted: number;
  created_at: string;
  completed_at: string;
}

interface AssignmentAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId: number;
  assignmentTitle: string;
}

type Phase = "loading" | "estimate" | "generating" | "report" | "error";

export function AssignmentAnalysisDialog({
  open,
  onOpenChange,
  assignmentId,
  assignmentTitle,
}: AssignmentAnalysisDialogProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("loading");
  const [estimate, setEstimate] = useState<AnalysisEstimate | null>(null);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (open) {
      loadEstimateOrReport();
    }
  }, [open, assignmentId]);

  const loadEstimateOrReport = async () => {
    setPhase("loading");
    try {
      const reportRes = (await apiClient.get(
        `/api/teachers/assignments/${assignmentId}/analysis-report`,
      )) as { has_report: boolean; report: AnalysisReport | null };
      if (reportRes.has_report && reportRes.report) {
        setReport(reportRes.report);
        setPhase("report");
        return;
      }

      const estimateRes = (await apiClient.post(
        `/api/teachers/assignments/${assignmentId}/estimate-analysis`,
      )) as AnalysisEstimate;
      setEstimate(estimateRes);
      setPhase("estimate");
    } catch (err) {
      setError(t("analysisDialog.errors.loadFailed"));
      setPhase("error");
    }
  };

  const handleGenerate = async () => {
    setPhase("generating");
    try {
      const result = (await apiClient.post(
        `/api/teachers/assignments/${assignmentId}/generate-analysis`,
      )) as {
        report_id: number;
        status: string;
        summary: string;
        report_data: Record<string, unknown>;
        student_count: number;
        tokens_used: number;
        points_deducted: number;
        created_at: string;
        completed_at: string;
      };
      setReport({
        id: result.report_id,
        status: result.status,
        summary: result.summary,
        report_data: result.report_data,
        practice_mode: estimate?.practice_mode || "",
        student_count: result.student_count,
        tokens_used: result.tokens_used,
        points_deducted: result.points_deducted,
        created_at: result.created_at,
        completed_at: result.completed_at,
      });
      setPhase("report");
      toast.success(t("analysisDialog.messages.reportGenerated"));
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : t("analysisDialog.errors.generateFailed");
      if (errorMessage.includes("402") || errorMessage.includes("Insufficient")) {
        setError(t("analysisDialog.errors.insufficientQuota"));
      } else {
        setError(errorMessage);
      }
      setPhase("error");
    }
  };

  const practiceModeName = (mode: string) => {
    return t(`analysisDialog.practiceMode.${mode}`, mode);
  };

  const renderReport = () => {
    if (!report?.report_data) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = report.report_data as any;

    return (
      <div className="space-y-4 max-h-[60vh] overflow-y-auto">
        {data.overall_summary && (
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-600" />
              {t("analysisDialog.report.overallSummary")}
            </h4>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {String(data.overall_summary)}
            </p>
          </div>
        )}

        {data.class_statistics && (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
            <h4 className="font-medium mb-3">
              {t("analysisDialog.report.classStatistics")}
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Object.entries(
                data.class_statistics as Record<string, unknown>,
              ).map(([key, value]) => (
                <div key={key} className="text-center">
                  <div className="text-lg font-semibold">
                    {typeof value === "number"
                      ? Number.isInteger(value)
                        ? String(value)
                        : value.toFixed(1)
                      : String(value ?? "")}
                  </div>
                  <div className="text-xs text-gray-500">{key}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(data.difficult_sentences ?? data.word_analysis) != null && (
          <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4">
            <h4 className="font-medium mb-3">
              {data.difficult_sentences
                ? t("analysisDialog.report.difficultSentences")
                : t("analysisDialog.report.wordAnalysis")}
            </h4>
            <div className="space-y-2">
              {(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (data.difficult_sentences || data.word_analysis) as any[]
              )
                ?.slice(0, 5)
                .map((item: any, i: number) => (
                  <div
                    key={i}
                    className="text-sm border-l-2 border-orange-400 pl-3"
                  >
                    <div className="font-medium">
                      {String(item.sentence || item.word || "")}
                    </div>
                    <div className="text-gray-500">
                      {item.error_rate
                        ? `${t("analysisDialog.report.errorRate")}: ${String(item.error_rate)}`
                        : item.correct_rate
                          ? `${t("analysisDialog.report.correctRate")}: ${String(item.correct_rate)}`
                          : ""}
                    </div>
                    {item.analysis && (
                      <div className="text-gray-600 mt-1">
                        {String(item.analysis)}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}

        {data.student_insights && (
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
            <h4 className="font-medium mb-3">
              {t("analysisDialog.report.studentInsights")}
            </h4>
            <div className="space-y-3">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(data.student_insights as any[])?.map(
                (student: any, i: number) => (
                  <div
                    key={i}
                    className="text-sm bg-white dark:bg-gray-800 rounded p-3"
                  >
                    <div className="font-medium mb-1">
                      {String(student.name || "")}
                    </div>
                    {student.strength && (
                      <div className="text-green-600">
                        {t("analysisDialog.report.strength")}
                        {String(student.strength)}
                      </div>
                    )}
                    {student.weakness && (
                      <div className="text-orange-600">
                        {t("analysisDialog.report.weakness")}
                        {String(student.weakness)}
                      </div>
                    )}
                    {student.suggestion && (
                      <div className="text-blue-600">
                        {t("analysisDialog.report.suggestion")}
                        {String(student.suggestion)}
                      </div>
                    )}
                  </div>
                ),
              )}
            </div>
          </div>
        )}

        {data.teaching_suggestions && (
          <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4">
            <h4 className="font-medium mb-2">
              {t("analysisDialog.report.teachingSuggestions")}
            </h4>
            <ul className="list-disc list-inside space-y-1 text-sm">
              {(data.teaching_suggestions as string[])?.map(
                (suggestion: string, i: number) => (
                  <li key={i}>{suggestion}</li>
                ),
              )}
            </ul>
          </div>
        )}

        <div className="text-xs text-gray-400 text-right">
          {t("analysisDialog.report.generatedAt")}
          {report?.completed_at
            ? new Date(report.completed_at).toLocaleString()
            : "-"}{" "}
          | {t("analysisDialog.report.pointsUsed")}
          {report?.points_deducted || 0}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            {t("analysisDialog.title")} - {assignmentTitle}
          </DialogTitle>
        </DialogHeader>

        {phase === "loading" && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        )}

        {phase === "estimate" && estimate && (
          <div className="space-y-4">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-3">
              <div className="flex justify-between">
                <span>{t("analysisDialog.estimate.practiceMode")}</span>
                <Badge variant="outline">
                  {practiceModeName(estimate.practice_mode)}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span>{t("analysisDialog.estimate.studentCount")}</span>
                <span className="font-medium">
                  {t("analysisDialog.estimate.studentCountValue", {
                    count: estimate.student_count,
                  })}
                </span>
              </div>
              <div className="flex justify-between">
                <span>{t("analysisDialog.estimate.estimatedPoints")}</span>
                <span className="font-medium text-orange-600">
                  {t("analysisDialog.estimate.pointsValue", {
                    count: estimate.estimated_points,
                  })}
                </span>
              </div>
              <div className="flex justify-between">
                <span>{t("analysisDialog.estimate.remainingQuota")}</span>
                <span
                  className={`font-medium ${estimate.has_sufficient_quota ? "text-green-600" : "text-red-600"}`}
                >
                  {t("analysisDialog.estimate.pointsValue", {
                    count: estimate.quota_remaining,
                  })}
                </span>
              </div>
            </div>

            {!estimate.has_sufficient_quota && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {t("analysisDialog.errors.insufficientQuota")}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("analysisDialog.buttons.cancel")}
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={!estimate.has_sufficient_quota}
              >
                <BarChart3 className="h-4 w-4 mr-2" />
                {t("analysisDialog.buttons.confirm", {
                  points: estimate.estimated_points,
                })}
              </Button>
            </DialogFooter>
          </div>
        )}

        {phase === "generating" && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            <p className="text-gray-500">
              {t("analysisDialog.messages.generating")}
            </p>
          </div>
        )}

        {phase === "report" && renderReport()}

        {phase === "error" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("analysisDialog.buttons.close")}
              </Button>
              <Button onClick={loadEstimateOrReport}>
                {t("analysisDialog.buttons.retry")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
