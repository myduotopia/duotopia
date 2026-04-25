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
 * 展開區「選字歷程」label 永遠顯示，但內容依分數分流：
 *   - expected_score > 60 → 用綠色 chip 呈現完整正確答案（雛型，等 #679 補完整 attempts[] 再接真實資料）
 *   - 其他（沒分數 / ≤ 60）→ 顯示「更詳細的作答紀錄 Coming Soon」灰色佔位文字
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
    // 分流：> 60 才顯示綠色 chips 雛型；其餘（沒分數 / ≤ 60）顯示 Coming Soon 佔位
    const expectedScore = item.expected_score;
    const showChips = expectedScore != null && expectedScore > 60;

    if (!showChips) {
      return (
        <div className="text-xs text-gray-400 italic">
          {t("gradingPage.rearrangement.labels.detailedHistoryComingSoon")}
        </div>
      );
    }

    // ⚠️ 示意圖：目前後端還沒提供每次作答（含 retry / timeout）的完整逐字歷程，
    // 這裡先拿正確答案切成 chips 當 placeholder，讓老師知道未來會看到什麼樣的 UI。
    // 等 #679 後端補完 attempts[] 資料後再接真實資料。
    // Layout 參照 docs/design/pencil-new.pen 案例 1（一次答對）：
    //   時間 · 「完成」綠 pill · 單字 chips 一字排開
    const formattedTime = formatCompletedAt(item.completed_at);
    const words = splitAnswerWords(item.question_text);

    return (
      <div className="flex flex-wrap items-center gap-2.5">
        {formattedTime && (
          <span className="text-xs font-semibold text-gray-700 font-mono">
            {formattedTime}
          </span>
        )}
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-semibold">
          {t("gradingPage.rearrangement.badges.completed")}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {words.map((word, idx) => (
            <span
              key={idx}
              className="inline-flex items-center px-2.5 py-1 rounded-md border border-green-200 bg-green-50 text-green-700 text-xs font-semibold"
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
