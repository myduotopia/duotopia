/**
 * OverallFeedbackPanel - 批改頁右欄總評（作業類型不可知）
 *
 * 顯示：逐題燈號（可點擊跳題）、分數輸入、總評語、要求訂正 / 完成批改按鈕。
 * 此元件不得依 practice_mode 改變行為；所有作業類型共用。
 *
 * 詳見 docs/design/grading-page-architecture.md
 */

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { TrafficLightDot } from "@/components/StudentStatusPanel";
import { User, CheckCircle, X } from "lucide-react";
import type {
  StudentSubmission,
  ItemFeedback,
} from "@/pages/teacher/GradingPage";

interface OverallFeedbackPanelProps {
  submission: StudentSubmission | null;
  score: number | null;
  feedback: string;
  itemFeedbacks: ItemFeedback;
  isAutoCalculatedScore: boolean;
  submitting: boolean;
  activeTab: "students" | "content" | "grading";
  totalQuestions: number;
  onScoreChange: (value: number | null) => void;
  onFeedbackChange: (value: string) => void;
  onAutoSave: () => Promise<void>;
  onComplete: () => void;
  onRequestRevision: () => void;
  onJumpToItem: (groupIndex: number, globalIndex: number) => void;
}

export function OverallFeedbackPanel({
  submission,
  score,
  feedback,
  itemFeedbacks,
  isAutoCalculatedScore,
  submitting,
  activeTab,
  totalQuestions,
  onScoreChange,
  onFeedbackChange,
  onAutoSave,
  onComplete,
  onRequestRevision,
  onJumpToItem,
}: OverallFeedbackPanelProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`col-span-12 lg:col-span-4 ${
        activeTab === "grading" ? "block" : "hidden lg:block"
      }`}
    >
      <Card className="p-4 lg:sticky lg:top-24">
        {submission && (
          <div className="mb-4 pb-4 border-b lg:hidden">
            <div className="flex items-center gap-1.5">
              <TrafficLightDot status={submission.status} size={14} />
              <User className="h-4 w-4 text-gray-500" />
              <span className="font-medium">{submission.student_name}</span>
            </div>
          </div>
        )}
        <h4 className="font-medium text-sm mb-3">
          {t("gradingPage.labels.overallFeedback")}
        </h4>

        <div className="space-y-3">
          {submission && submission.content_groups && (
            <div className="pb-3 border-b space-y-3">
              <label className="text-xs font-medium block">
                {t("gradingPage.labels.itemStatus")} ({totalQuestions} 題)
              </label>
              {submission.content_groups.map((group, groupIndex) => {
                let groupBaseIndex = 0;
                for (let i = 0; i < groupIndex; i++) {
                  groupBaseIndex +=
                    submission.content_groups![i].submissions.length;
                }

                return (
                  <div key={group.content_id} className="space-y-1">
                    <div className="text-xs text-gray-600 font-medium">
                      {group.content_title} ({group.submissions.length} 題)
                    </div>
                    <div className="grid grid-cols-10 gap-1">
                      {group.submissions.map((item, localIndex) => {
                        const globalIndex = groupBaseIndex + localIndex;
                        const result = itemFeedbacks[globalIndex];
                        const isPassed = result?.passed === true;
                        const isFailed = result?.passed === false;
                        const hasRecording = item.audio_url;

                        return (
                          <div
                            key={localIndex}
                            className={`
                              w-8 h-8 rounded-md flex items-center justify-center text-xs font-medium
                              transition-all cursor-pointer
                              ${
                                isPassed
                                  ? "bg-green-500 text-white shadow-sm hover:bg-green-600"
                                  : isFailed
                                    ? "bg-red-500 text-white shadow-sm hover:bg-red-600"
                                    : hasRecording
                                      ? "bg-gray-200 text-gray-600 hover:bg-gray-300"
                                      : "bg-gray-100 text-gray-400 border border-dashed border-gray-300 hover:bg-gray-200"
                              }
                            `}
                            title={`題目 ${localIndex + 1}: ${
                              isPassed
                                ? t("gradingPage.labels.passed")
                                : isFailed
                                  ? t("gradingPage.labels.needsRevision")
                                  : hasRecording
                                    ? t("gradingPage.labels.hasRecording")
                                    : t("gradingPage.labels.noRecording")
                            }`}
                            onClick={() => onJumpToItem(groupIndex, globalIndex)}
                          >
                            {isPassed
                              ? "✓"
                              : isFailed
                                ? "✗"
                                : localIndex + 1}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-2 block">
              {t("gradingPage.labels.giveScore")}
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={score === null ? "" : score}
              onBlur={async () => {
                await onAutoSave();
              }}
              onChange={(e) => {
                const value = e.target.value;
                if (value === "") {
                  onScoreChange(null);
                } else if (/^\d+(\.\d{0,1})?$/.test(value)) {
                  const numValue = parseFloat(value);
                  if (numValue >= 0 && numValue <= 100) {
                    onScoreChange(numValue);
                  }
                }
              }}
              placeholder={t("gradingPage.labels.enterScore")}
              className="w-full px-3 py-2 text-lg font-bold border-2 rounded focus:outline-none focus:ring-2 text-center bg-white border-blue-500 text-blue-600 focus:ring-blue-500"
            />
            {isAutoCalculatedScore && (
              <div className="text-xs text-green-600 dark:text-green-400 text-center mt-1 font-medium">
                {t("gradingPage.labels.usingAverageScore")}
              </div>
            )}
            <div className="text-xs text-gray-500 text-center mt-1">
              {t("gradingPage.labels.scoreRange")}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium mb-2 block">
              {t("gradingPage.labels.overallFeedback")}
            </label>
            <Textarea
              value={feedback}
              onChange={(e) => {
                onFeedbackChange(e.target.value);
              }}
              onBlur={async () => {
                await onAutoSave();
              }}
              placeholder={t("gradingPage.labels.overallEncouragement")}
              rows={4}
              className="resize-none text-sm bg-white dark:bg-white"
            />
          </div>

          <div className="space-y-4 pt-4 border-t">
            <div className="text-center text-xs text-gray-500">
              {t("gradingPage.labels.selectGradingStatus")}
            </div>

            <div className="flex gap-2">
              <Button
                onClick={onRequestRevision}
                disabled={submitting || !submission}
                variant={
                  submission?.status === "RETURNED" ? "default" : "outline"
                }
                className={`flex-1 ${
                  submission?.status === "RETURNED"
                    ? "bg-orange-600 hover:bg-orange-700 text-white"
                    : "border-orange-600 text-orange-600 hover:bg-orange-50"
                }`}
              >
                <X className="h-4 w-4 mr-2" />
                {t("gradingPage.buttons.requestRevision")}
              </Button>

              <Button
                onClick={onComplete}
                disabled={submitting || !submission}
                variant={
                  submission?.status === "GRADED" ? "default" : "outline"
                }
                className={`flex-1 ${
                  submission?.status === "GRADED"
                    ? "bg-green-600 hover:bg-green-700 text-white"
                    : "border-green-600 text-green-600 hover:bg-green-50"
                }`}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                {t("gradingPage.buttons.completeGrading")}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
