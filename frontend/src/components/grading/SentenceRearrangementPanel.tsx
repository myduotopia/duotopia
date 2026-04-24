/**
 * SentenceRearrangementPanel - 批改頁中間欄：例句重組
 *
 * 對應 practice_mode = "rearrangement"（學生將打亂的單字重組成正確例句）。
 * 此活動無錄音、無 AI 語音評分；系統在學生答完當下直接判定 COMPLETED 並算好
 * expected_score，老師不需要（也不該）手動切換通過狀態。
 *
 * ✓/✗ 為 render-time 純顯示：
 *   - item.item_status === "COMPLETED" && expected_score >= 60 → 綠 ✓
 *   - item.item_status === "COMPLETED" && expected_score <  60 → 紅 ✗
 *   - 其他（尚未作答 / 無分數）                                → 灰色 placeholder
 * 完全不讀 itemFeedbacks、不 onClick、不 autosave。
 *
 * 展開區會顯示「選字歷程」雛型（目前先用綠色 chip 呈現完整正確答案），
 * 多次 attempt 的詳細歷程要等 #679 後端改動完成才會真正上。
 *
 * 詳見 docs/design/grading-page-architecture.md
 */

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  CheckCircle,
  X,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Clock,
  RotateCcw,
  Target,
} from "lucide-react";
import type {
  StudentSubmission,
  ItemFeedback,
  SubmissionItem,
} from "@/pages/teacher/GradingPage";

interface SentenceRearrangementPanelProps {
  submission: StudentSubmission;
  selectedGroupIndex: number;
  expandedRows: Set<number>;
  activeTab: "students" | "content" | "grading";
  onSelectGroup: (idx: number) => void;
  onToggleRow: (globalIndex: number) => void;
  // 以下 props 為相容 GradingPage 的 panelProps spread 而保留，此 panel 並不使用：
  itemFeedbacks?: ItemFeedback;
  onTogglePassed?: (globalIndex: number, passed: boolean) => Promise<void>;
  onItemFeedbackChange?: (globalIndex: number, feedback: string) => void;
  onAutoSave?: () => Promise<void>;
}

function formatCompletedAt(timestamp?: string | null): string {
  if (!timestamp) return "";
  try {
    const d = new Date(timestamp);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function splitAnswerWords(sentence: string): string[] {
  return sentence.trim().split(/\s+/).filter(Boolean);
}

export function SentenceRearrangementPanel({
  submission,
  selectedGroupIndex,
  expandedRows,
  activeTab,
  onSelectGroup,
  onToggleRow,
}: SentenceRearrangementPanelProps) {
  const { t } = useTranslation();

  const currentGroup = submission.content_groups
    ? submission.content_groups[selectedGroupIndex]
    : null;

  let baseGlobalIndex = 0;
  if (submission.content_groups) {
    for (let i = 0; i < selectedGroupIndex; i++) {
      baseGlobalIndex += submission.content_groups[i].submissions.length;
    }
  }

  const renderSelectionHistory = (item: SubmissionItem) => {
    // 只有完成的題目才顯示歷程；否則顯示 placeholder
    if (item.item_status !== "COMPLETED") {
      return (
        <div className="p-3 bg-gray-50 border border-gray-200 rounded text-xs text-gray-500 text-center">
          {t("gradingPage.rearrangement.messages.noHistory")}
        </div>
      );
    }

    const words = splitAnswerWords(item.question_text);
    const formattedTime = formatCompletedAt(item.completed_at);

    return (
      <div className="space-y-2">
        {formattedTime && (
          <div className="text-xs text-gray-500 font-mono">
            {t("gradingPage.rearrangement.labels.completedAt")}：{formattedTime}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {words.map((word, idx) => (
            <span
              key={idx}
              className="inline-flex items-center px-2.5 py-1 rounded-md border border-green-200 bg-green-50 text-green-700 text-xs font-semibold font-mono"
            >
              {word}
            </span>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div
      className={`col-span-12 lg:col-span-6 ${
        activeTab === "content" ? "block" : "hidden lg:block"
      }`}
    >
      <div className="space-y-3">
        {submission.content_groups && submission.content_groups.length > 1 && (
          <>
            <div className="hidden lg:flex items-center gap-2 mb-3">
              <span className="text-sm font-medium whitespace-nowrap">
                {t("gradingPage.labels.groupTitle")}
              </span>
              <select
                value={selectedGroupIndex}
                onChange={(e) => onSelectGroup(parseInt(e.target.value))}
                className="border rounded-md px-3 py-1.5 text-sm"
              >
                {submission.content_groups.map((group, index) => (
                  <option key={group.content_id} value={index}>
                    {group.content_title} ({group.submissions.length}題)
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:hidden sticky top-28 z-10 -mx-4 sm:-mx-6 mb-3">
              <Card className="p-3 rounded-none sm:rounded-lg shadow-md">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium whitespace-nowrap">
                    {t("gradingPage.labels.groupTitle")}
                  </span>
                  <select
                    value={selectedGroupIndex}
                    onChange={(e) => onSelectGroup(parseInt(e.target.value))}
                    className="flex-1 border rounded-md px-3 py-1.5 text-sm bg-white"
                  >
                    {submission.content_groups.map((group, index) => (
                      <option key={group.content_id} value={index}>
                        {group.content_title} ({group.submissions.length}題)
                      </option>
                    ))}
                  </select>
                </div>
              </Card>
            </div>
          </>
        )}

        {currentGroup && (
          <Card className="p-4">
            <div className="space-y-0 divide-y">
              {currentGroup.submissions.map((item, localIndex) => {
                const globalIndex = baseGlobalIndex + localIndex;
                const isExpanded = expandedRows.has(globalIndex);

                const errorCount = item.error_count ?? 0;
                const maxErrors = item.max_errors ?? null;
                const correctWords = item.correct_word_count ?? 0;
                const retryCount = item.retry_count ?? 0;
                const expectedScore = item.expected_score;
                const timedOut = item.timeout_ended === true;

                // 純顯示 ✓/✗：直接從 item 資料推導，不依賴 itemFeedbacks
                const isCompleted = item.item_status === "COMPLETED";
                const hasScore = expectedScore != null;
                const isPassed: boolean | null =
                  isCompleted && hasScore ? expectedScore! >= 60 : null;

                return (
                  <div
                    key={globalIndex}
                    id={`item-${globalIndex}`}
                    className="py-4"
                  >
                    <div
                      className="md:grid md:grid-cols-12 flex flex-col gap-3 items-start cursor-pointer hover:bg-gray-50 rounded-lg p-2 -mx-2"
                      onClick={() => onToggleRow(globalIndex)}
                    >
                      {/* ✓/✗ 純顯示（依 item_status + expected_score 推導，不可手動切換）*/}
                      <div className="md:col-span-1 flex flex-row md:flex-col gap-2 md:gap-1 w-full md:w-auto">
                        <div
                          className={`w-full p-1 h-7 flex items-center justify-center rounded-md border ${
                            isPassed === true
                              ? "bg-green-600 border-green-600 text-white"
                              : "border-gray-200 text-gray-300"
                          }`}
                          aria-label={
                            isPassed === true ? "passed" : "not-passed-check"
                          }
                        >
                          <CheckCircle className="h-3 w-3" />
                        </div>
                        <div
                          className={`w-full p-1 h-7 flex items-center justify-center rounded-md border ${
                            isPassed === false
                              ? "bg-red-600 border-red-600 text-white"
                              : "border-gray-200 text-gray-300"
                          }`}
                          aria-label={
                            isPassed === false ? "failed" : "not-failed-check"
                          }
                        >
                          <X className="h-3 w-3" />
                        </div>
                      </div>

                      {/* 題目 */}
                      <div className="md:col-span-6 w-full">
                        <div className="flex items-start gap-2">
                          <span className="text-xs font-semibold text-gray-500 mt-1">
                            {localIndex + 1}.
                          </span>
                          <div className="flex-1">
                            <p className="font-medium text-sm">
                              {item.question_text}
                            </p>
                            {item.question_translation && (
                              <p className="text-xs text-gray-500 mt-1">
                                {item.question_translation}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 作答統計 */}
                      <div
                        className="md:col-span-4 w-full"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex flex-col gap-1 text-xs">
                          <div className="flex items-center gap-1">
                            <AlertCircle
                              className={`h-3 w-3 ${
                                maxErrors != null && errorCount >= maxErrors
                                  ? "text-red-500"
                                  : "text-gray-400"
                              }`}
                            />
                            <span className="text-gray-600">
                              {t("gradingPage.rearrangement.labels.errors")}:{" "}
                              <span className="font-semibold">
                                {errorCount}
                                {maxErrors != null ? ` / ${maxErrors}` : ""}
                              </span>
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Target className="h-3 w-3 text-gray-400" />
                            <span className="text-gray-600">
                              {t(
                                "gradingPage.rearrangement.labels.correctWords",
                              )}
                              : <span className="font-semibold">{correctWords}</span>
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <RotateCcw className="h-3 w-3 text-gray-400" />
                            <span className="text-gray-600">
                              {t("gradingPage.rearrangement.labels.retryCount")}
                              : <span className="font-semibold">{retryCount}</span>
                            </span>
                          </div>
                          {expectedScore != null && (
                            <div className="flex items-center gap-1">
                              <span className="text-gray-600">
                                {t(
                                  "gradingPage.rearrangement.labels.expectedScore",
                                )}
                                :{" "}
                                <span className="font-semibold text-blue-600">
                                  {Number(expectedScore).toFixed(1)}
                                </span>
                              </span>
                            </div>
                          )}
                          {timedOut && (
                            <div className="flex items-center gap-1 text-amber-600">
                              <Clock className="h-3 w-3" />
                              <span className="text-xs font-medium">
                                {t("gradingPage.rearrangement.labels.timedOut")}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 展開按鈕 */}
                      <div className="md:col-span-1 w-full md:w-auto flex justify-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleRow(globalIndex);
                          }}
                          className="p-2 h-10 md:h-7"
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-6 w-6 md:h-4 md:w-4" />
                          ) : (
                            <ChevronDown className="h-6 w-6 md:h-4 md:w-4" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 pl-8 space-y-4">
                        <div>
                          <label className="text-xs font-semibold text-gray-600 mb-2 block">
                            {t(
                              "gradingPage.rearrangement.labels.selectionHistory",
                            )}
                          </label>
                          {renderSelectionHistory(item)}
                        </div>

                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <label className="text-xs font-semibold text-gray-600">
                              {t(
                                "gradingPage.rearrangement.labels.detailedErrorHistory",
                              )}
                            </label>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600">
                              {t("common.comingSoon", "Coming Soon")}
                            </span>
                          </div>
                          <div className="p-3 bg-gray-50 border border-dashed border-gray-300 rounded text-xs text-gray-500">
                            {t(
                              "gradingPage.rearrangement.messages.detailedErrorHistoryComingSoon",
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
