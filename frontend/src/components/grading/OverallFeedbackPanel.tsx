/**
 * OverallFeedbackPanel - 批改頁右欄總評（作業類型不可知）
 *
 * 顯示：逐題燈號（可點擊跳題）、分數輸入、總評語、要求訂正 / 完成批改按鈕。
 * 此元件不得依 practice_mode 改變行為；所有作業類型共用。
 *
 * 與 practice_mode 相關的調整由 GradingPage 透過 props 指示，元件本身不感知模式：
 *   - 省略 `onRequestRevision` → 不顯示「要求訂正」按鈕（auto-graded 模式無訂正概念）
 *   - `isAutoScored` → 主按鈕文案改為「儲存」（auto-graded 模式不是「完成批改」，
 *     批改在學生作答當下就完成了，老師只是儲存最終分數/評語）
 *
 * 詳見 docs/design/grading-page-architecture.md
 */

import { useTranslation } from "react-i18next";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { TrafficLightDot } from "@/components/StudentStatusPanel";
import { User, Undo2, RotateCcw, CheckCircle2 } from "lucide-react";
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
  // #861 c-2: 省略不傳即不顯示「還原」按鈕（破壞性：清空該生分數與作答）
  onReset?: () => void;
  // 省略不傳即不顯示「要求訂正」按鈕（用於自動評分模式，如 rearrangement）
  onRequestRevision?: () => void;
  // true 時主按鈕文案顯示「儲存」而非「完成批改」（auto-graded 模式）
  isAutoScored?: boolean;
  // true 時分數唯讀、不顯示主按鈕（小考完全自動判分，老師不可改分/完成批改，僅可退回）
  autoScoreReadOnly?: boolean;
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
  onReset,
  onRequestRevision,
  autoScoreReadOnly,
  onJumpToItem,
}: OverallFeedbackPanelProps) {
  const { t } = useTranslation();

  // #861 c-2: 三顆動作鈕的 disabled 狀態與 Grade hub（StudentStatusPanel）一致
  const status = submission?.status;
  const resetDisabled =
    submitting ||
    !submission ||
    status === "NOT_STARTED" ||
    status === "unassigned";
  const returnDisabled = submitting || !submission || status === "RETURNED";
  // #861 c-2:「完成」鈕同時負責儲存老師改後的分數。已 GRADED 時預設禁用，
  // 但只要老師改動分數（與目前儲存值不同）就重新啟用，讓老師能存新分數。
  const storedScore =
    submission?.current_score != null
      ? Math.round(submission.current_score * 10) / 10
      : null;
  const scoreChanged = score !== storedScore;
  const gradeDisabled =
    submitting || !submission || (status === "GRADED" && !scoreChanged);

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
                            onClick={() =>
                              onJumpToItem(groupIndex, globalIndex)
                            }
                          >
                            {isPassed ? "✓" : isFailed ? "✗" : localIndex + 1}
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
            {autoScoreReadOnly ? (
              // 小考自動判分：分數唯讀，老師不可改
              <div className="w-full px-3 py-2 text-lg font-bold border-2 rounded text-center bg-gray-50 border-gray-200 text-gray-700">
                {score === null ? "—" : score}
              </div>
            ) : (
              <>
                <input
                  type="text"
                  inputMode="decimal"
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
              </>
            )}
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

            {/* #861 c-2: 三顆動作鈕（還原 / 退回 / 完成）外觀與 Grade hub
                StudentStatusPanel 的 row 按鈕完全一致 */}
            <div className="flex items-center justify-center gap-1">
              {onReset && (
                <button
                  type="button"
                  disabled={resetDisabled}
                  onClick={onReset}
                  title={t("gradingHub.resetShort")}
                  className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700/40 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Undo2 className="h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline text-xs whitespace-nowrap">
                    {t("gradingHub.resetShort")}
                  </span>
                </button>
              )}

              {onRequestRevision && (
                <button
                  type="button"
                  disabled={returnDisabled}
                  onClick={onRequestRevision}
                  title={t("gradingHub.returnShort")}
                  className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/20 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  <RotateCcw className="h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline text-xs whitespace-nowrap">
                    {t("gradingHub.returnShort")}
                  </span>
                </button>
              )}

              <button
                type="button"
                disabled={gradeDisabled}
                onClick={onComplete}
                title={t("gradingHub.gradeShort")}
                className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline text-xs whitespace-nowrap">
                  {t("gradingHub.gradeShort")}
                </span>
              </button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
