/**
 * ReadingAssessmentPanel - 批改頁中間欄：朗讀類（例句朗讀 / 單字朗讀）
 *
 * 對應 practice_mode = "reading" | "word_reading"。
 * 呈現學生錄音、AI 發音評分、逐題通過狀態與評語。
 * 當 AI 分析失敗時，顯示「重新分析」按鈕（#638 feat）。
 *
 * 此元件不渲染與其他 practice_mode 相關的 UI；新類型請加新 Panel。
 *
 * 詳見 docs/design/grading-page-architecture.md
 */

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import AIScoreDisplay from "@/components/shared/AIScoreDisplay";
import AudioRecorder from "@/components/shared/AudioRecorder";
import {
  Volume2,
  CheckCircle,
  AlertCircle,
  X,
  Mic,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Loader2,
  Search,
} from "lucide-react";
import type {
  StudentSubmission,
  SubmissionItem,
  ItemFeedback,
} from "@/pages/teacher/GradingPage";

interface ReadingAssessmentPanelProps {
  submission: StudentSubmission;
  selectedGroupIndex: number;
  expandedRows: Set<number>;
  itemFeedbacks: ItemFeedback;
  reanalyzingItems: Set<number>;
  activeTab: "students" | "content" | "grading";
  onCheckRecordings: () => void;
  onApplyAISuggestions: () => void;
  onSelectGroup: (idx: number) => void;
  onToggleRow: (globalIndex: number) => void;
  onTogglePassed: (globalIndex: number, passed: boolean) => Promise<void>;
  onItemFeedbackChange: (globalIndex: number, feedback: string) => void;
  onAutoSave: () => Promise<void>;
  onReanalyzeItem: (itemProgressId: number) => void;
}

export function ReadingAssessmentPanel({
  submission,
  selectedGroupIndex,
  expandedRows,
  itemFeedbacks,
  reanalyzingItems,
  activeTab,
  onCheckRecordings,
  onApplyAISuggestions,
  onSelectGroup,
  onToggleRow,
  onTogglePassed,
  onItemFeedbackChange,
  onAutoSave,
  onReanalyzeItem,
}: ReadingAssessmentPanelProps) {
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

  const renderItem = (item: SubmissionItem, localIndex: number) => {
    const globalIndex = baseGlobalIndex + localIndex;
    const isExpanded = expandedRows.has(globalIndex);
    const itemFeedback = itemFeedbacks[globalIndex];

    return (
      <div key={globalIndex} id={`item-${globalIndex}`} className="py-4">
        <div
          className="md:grid md:grid-cols-12 flex flex-col gap-3 items-start cursor-pointer hover:bg-gray-50 rounded-lg p-2 -mx-2"
          onClick={() => onToggleRow(globalIndex)}
        >
          <div
            className="md:col-span-1 flex flex-row md:flex-col gap-2 md:gap-1 w-full md:w-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              size="sm"
              variant={itemFeedback?.passed === true ? "default" : "outline"}
              className={`w-full p-1 h-7 ${
                itemFeedback?.passed === true
                  ? "bg-green-600 hover:bg-green-700"
                  : ""
              }`}
              onClick={() => onTogglePassed(globalIndex, true)}
              disabled={submission?.status === "GRADED"}
            >
              <CheckCircle className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant={itemFeedback?.passed === false ? "default" : "outline"}
              className={`w-full p-1 h-7 ${
                itemFeedback?.passed === false
                  ? "bg-red-600 hover:bg-red-700"
                  : ""
              }`}
              onClick={() => onTogglePassed(globalIndex, false)}
              disabled={submission?.status === "GRADED"}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>

          <div className="md:col-span-4 w-full">
            <div className="flex items-start gap-2">
              <span className="text-xs font-semibold text-gray-500 mt-1">
                {localIndex + 1}.
              </span>
              <div className="flex-1">
                <p className="font-medium text-sm">{item.question_text}</p>
                {item.question_translation && (
                  <p className="text-xs text-gray-500 mt-1">
                    {item.question_translation}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div
            className="md:col-span-2 w-full flex justify-center md:justify-start"
            onClick={(e) => e.stopPropagation()}
          >
            {item.audio_url ? (
              <AudioRecorder
                variant="compact"
                title=""
                existingAudioUrl={item.audio_url}
                readOnly={true}
                disabled={false}
                className="border-0 p-0 shadow-none bg-white dark:bg-white"
              />
            ) : (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Mic className="h-4 w-4" />
                <span>{t("gradingPage.labels.noRecording")}</span>
              </div>
            )}
          </div>

          <div
            className="md:col-span-4 w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <Textarea
              value={itemFeedback?.feedback || ""}
              onChange={(e) =>
                onItemFeedbackChange(globalIndex, e.target.value)
              }
              onBlur={async () => {
                await onAutoSave();
              }}
              placeholder={t("gradingPage.labels.feedbackPlaceholder")}
              className="min-h-[60px] resize-none text-xs bg-white dark:bg-white"
              readOnly={submission?.status === "GRADED"}
              disabled={submission?.status === "GRADED"}
            />
          </div>

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
          <div className="mt-3 pl-8 space-y-3">
            {item.question_audio_url && (
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">
                  {t("gradingPage.labels.referenceAudio")}
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const audio = new Audio(item.question_audio_url!);
                    audio.play().catch((err) => {
                      console.error("Failed to play audio:", err);
                      toast.error(t("gradingPage.messages.audioPlayError"));
                    });
                  }}
                >
                  <Volume2 className="h-3 w-3 mr-1" />
                  {t("gradingPage.labels.playReferenceAudio")}
                </Button>
              </div>
            )}

            {item.transcript && (
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">
                  {t("gradingPage.labels.transcription")}
                </label>
                <div className="p-2 bg-green-50 border border-green-200 rounded text-xs">
                  {item.transcript}
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">
                {t("gradingPage.labels.aiAutoScoring")}
              </label>

              {item.ai_scores?._metadata?.audio_upload_status === "failed" && (
                <div className="flex items-center gap-2 text-amber-600 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg mb-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-medium">
                      {t("gradingPage.messages.audioUploadFailed")}
                    </p>
                    <p className="text-xs text-amber-500">
                      {t("gradingPage.messages.audioUploadFailedDetail")}
                    </p>
                  </div>
                </div>
              )}

              {item.ai_scores ? (
                <AIScoreDisplay
                  scores={item.ai_scores}
                  hasRecording={!!item.audio_url}
                  title=""
                />
              ) : (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded text-xs text-gray-500 text-center">
                  {t("gradingPage.messages.noAIScore")}
                  {!item.audio_url &&
                    ` ${t("gradingPage.messages.missingRecordingFile")}`}
                  {item.audio_url && item.item_progress_id && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 mx-auto flex"
                      disabled={reanalyzingItems.has(item.item_progress_id)}
                      onClick={() => onReanalyzeItem(item.item_progress_id!)}
                    >
                      {reanalyzingItems.has(item.item_progress_id) ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          {t("gradingPage.messages.reanalyzing")}
                        </>
                      ) : (
                        <>
                          <Mic className="h-3 w-3 mr-1" />
                          {t("gradingPage.buttons.reanalyze")}
                        </>
                      )}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
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
        <div className="hidden lg:flex items-center gap-2 mb-3">
          <Button
            size="sm"
            onClick={onCheckRecordings}
            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-700 dark:text-white"
          >
            <Search className="h-4 w-4" />
            {t("gradingPage.buttons.checkRecording")}
          </Button>
          <Button
            size="sm"
            onClick={onApplyAISuggestions}
            className="flex items-center gap-1 bg-purple-600 hover:bg-purple-700 text-white dark:bg-purple-600 dark:hover:bg-purple-700 dark:text-white"
          >
            <Sparkles className="h-4 w-4" />
            {t("gradingPage.buttons.applyAISuggestions")}
          </Button>
          {submission.content_groups && submission.content_groups.length > 1 && (
            <>
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
            </>
          )}
        </div>

        <div className="lg:hidden sticky top-28 z-10 -mx-4 sm:-mx-6 mb-3">
          <Card className="p-3 rounded-none sm:rounded-lg shadow-md">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={onCheckRecordings}
                  className="flex-1 flex items-center justify-center gap-1 bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-700 dark:text-white"
                >
                  <Search className="h-4 w-4" />
                  {t("gradingPage.labels.examineRecording")}
                </Button>
                <Button
                  size="sm"
                  onClick={onApplyAISuggestions}
                  className="flex-1 flex items-center justify-center gap-1 bg-purple-600 hover:bg-purple-700 text-white dark:bg-purple-600 dark:hover:bg-purple-700 dark:text-white"
                >
                  <Sparkles className="h-4 w-4" />
                  {t("gradingPage.buttons.applyAISuggestions")}
                </Button>
              </div>
              {submission.content_groups &&
                submission.content_groups.length > 1 && (
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
                )}
            </div>
          </Card>
        </div>

        {currentGroup && (
          <Card className="p-4">
            <div className="space-y-0 divide-y">
              {currentGroup.submissions.map((item, localIndex) =>
                renderItem(item, localIndex),
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
