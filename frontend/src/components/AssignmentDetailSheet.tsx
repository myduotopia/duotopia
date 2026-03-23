import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import ReadingAssessmentPanel from "@/components/ReadingAssessmentPanel";
import VocabularySetPanel from "@/components/VocabularySetPanel";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import {
  Pencil,
  Save,
  X,
  Loader2,
  CheckCircle,
  Sparkles,
  BookOpen,
  ChevronRight,
  Edit2,
  Settings2,
} from "lucide-react";
import { Assignment } from "@/types";

interface StudentProgress {
  student_id: number;
  student_number: string;
  student_name: string;
  status: string;
  score?: number;
  is_assigned?: boolean;
}

interface AssignmentContent {
  id: number;
  title: string;
  type?: string;
  order_index: number;
}

interface AdvancedSettings {
  time_limit_per_question: number;
  shuffle_questions: boolean;
  show_answer: boolean;
  play_audio: boolean;
  target_proficiency: number;
  show_word: boolean;
  show_image: boolean;
  show_translation: boolean;
}

interface ContentDetail {
  id?: number;
  title?: string;
  type?: string;
  items?: Array<{
    id: number;
    text: string;
    translation?: string;
    definition?: string;
    audio_url?: string;
    has_student_progress?: boolean;
    distractors?: string[];
  }>;
}

interface AssignmentDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignment: Assignment | null;
  classroomId: string;
  canUseAiGrading?: boolean;
  onGradeClick?: (assignmentId: number) => void;
  onBatchGradeClick?: (assignmentId: number) => void;
  onAssignmentUpdated?: () => void;
}

export function AssignmentDetailSheet({
  open,
  onOpenChange,
  assignment,
  classroomId: _classroomId,
  canUseAiGrading = false,
  onGradeClick,
  onBatchGradeClick,
  onAssignmentUpdated,
}: AssignmentDetailSheetProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [studentProgress, setStudentProgress] = useState<StudentProgress[]>([]);

  // Content state
  const [assignmentContents, setAssignmentContents] = useState<
    AssignmentContent[]
  >([]);
  const [expandedContentId, setExpandedContentId] = useState<number | null>(
    null,
  );
  const [contentDetails, setContentDetails] = useState<
    Record<number, ContentDetail>
  >({});
  const [editingContentId, setEditingContentId] = useState<number | null>(null);
  const loadingRef = useRef<Set<number>>(new Set());

  // Detail data from API (includes advanced settings)
  const [detailData, setDetailData] = useState<Record<string, unknown> | null>(
    null,
  );

  // Edit form state
  const [editTitle, setEditTitle] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editAdvanced, setEditAdvanced] = useState<AdvancedSettings>({
    time_limit_per_question: 30,
    shuffle_questions: false,
    show_answer: false,
    play_audio: false,
    target_proficiency: 80,
    show_word: true,
    show_image: true,
    show_translation: true,
  });

  // Reset state when assignment changes or sheet closes
  useEffect(() => {
    if (assignment && open) {
      setEditTitle(assignment.title);
      setEditInstructions(
        assignment.instructions || assignment.description || "",
      );
      setEditDueDate(
        assignment.due_date ? assignment.due_date.split("T")[0] : "",
      );
      setEditStartDate("");
      setIsEditing(false);
      setDetailData(null);
      setAssignmentContents([]);
      setContentDetails({});
      setExpandedContentId(null);
      fetchAssignmentData();
    }
  }, [assignment?.id, open]);

  const fetchAssignmentData = async () => {
    if (!assignment) return;
    setLoading(true);
    try {
      // Fetch assignment detail (includes contents) and student progress in parallel
      const [detailResponse, progressResponse] = await Promise.all([
        apiClient.get(`/api/teachers/assignments/${assignment.id}`),
        apiClient
          .get(`/api/teachers/assignments/${assignment.id}/progress`)
          .catch(() => []),
      ]);

      // Store full detail response for advanced settings
      const detail = detailResponse as Record<string, unknown>;
      setDetailData(detail);

      // Initialize start_date from detail
      const startDateStr = detail.start_date as string | null;
      setEditStartDate(startDateStr ? startDateStr.split("T")[0] : "");

      // Initialize advanced settings from detail
      setEditAdvanced({
        time_limit_per_question:
          (detail.time_limit_per_question as number) ?? 30,
        shuffle_questions: (detail.shuffle_questions as boolean) ?? false,
        show_answer: (detail.show_answer as boolean) ?? false,
        play_audio: (detail.play_audio as boolean) ?? false,
        target_proficiency: (detail.target_proficiency as number) ?? 80,
        show_word: (detail.show_word as boolean) ?? true,
        show_image: (detail.show_image as boolean) ?? true,
        show_translation: (detail.show_translation as boolean) ?? true,
      });

      // Extract contents from detail response
      const contents =
        (detail as { contents?: AssignmentContent[] }).contents || [];
      setAssignmentContents(contents);

      // Extract student progress
      const progressData = Array.isArray(progressResponse)
        ? progressResponse
        : (
            progressResponse as {
              students_progress?: unknown[];
              data?: unknown[];
            }
          ).students_progress ||
          (progressResponse as { data?: unknown[] }).data ||
          [];
      setStudentProgress(
        (progressData as StudentProgress[]).filter(
          (p) => p.status !== "unassigned" && p.is_assigned !== false,
        ),
      );
    } catch {
      setStudentProgress([]);
      setAssignmentContents([]);
    } finally {
      setLoading(false);
    }
  };

  const loadContentDetail = async (contentId: number, forceReload = false) => {
    if (!forceReload && contentDetails[contentId]) return;
    if (loadingRef.current.has(contentId)) return;
    loadingRef.current.add(contentId);
    try {
      const detail = await apiClient.getContentDetail(contentId);
      setContentDetails((prev) => ({
        ...prev,
        [contentId]: detail as ContentDetail,
      }));
    } catch (error) {
      console.error("Failed to load content detail:", error);
    } finally {
      loadingRef.current.delete(contentId);
    }
  };

  const handleSave = async () => {
    if (!assignment) return;
    setSaving(true);
    try {
      await apiClient.patch(`/api/teachers/assignments/${assignment.id}`, {
        title: editTitle,
        description: editInstructions,
        due_date: editDueDate ? `${editDueDate}T23:59:59` : null,
        start_date: editStartDate ? `${editStartDate}T00:00:00` : null,
        ...editAdvanced,
      });
      toast.success(t("assignmentDetail.messages.updateSuccess", "已儲存變更"));
      setIsEditing(false);
      onAssignmentUpdated?.();
    } catch {
      toast.error(t("assignmentDetail.messages.updateError", "儲存失敗"));
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    if (!assignment || !detailData) return;
    setEditTitle(assignment.title);
    setEditInstructions(
      assignment.instructions || assignment.description || "",
    );
    setEditDueDate(
      assignment.due_date ? assignment.due_date.split("T")[0] : "",
    );
    const startDateStr = detailData.start_date as string | null;
    setEditStartDate(startDateStr ? startDateStr.split("T")[0] : "");
    setEditAdvanced({
      time_limit_per_question:
        (detailData.time_limit_per_question as number) ?? 30,
      shuffle_questions: (detailData.shuffle_questions as boolean) ?? false,
      show_answer: (detailData.show_answer as boolean) ?? false,
      play_audio: (detailData.play_audio as boolean) ?? false,
      target_proficiency: (detailData.target_proficiency as number) ?? 80,
      show_word: (detailData.show_word as boolean) ?? true,
      show_image: (detailData.show_image as boolean) ?? true,
      show_translation: (detailData.show_translation as boolean) ?? true,
    });
    setIsEditing(false);
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, { label: string; className: string }> = {
      SUBMITTED: {
        label: t("assignmentDetail.status.submitted", "已繳交"),
        className:
          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
      },
      GRADED: {
        label: t("assignmentDetail.status.graded", "已批改"),
        className:
          "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
      },
      IN_PROGRESS: {
        label: t("assignmentDetail.status.inProgress", "進行中"),
        className:
          "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
      },
      NOT_STARTED: {
        label: t("assignmentDetail.status.notStarted", "未開始"),
        className:
          "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
      },
      RETURNED: {
        label: t("assignmentDetail.status.returned", "已退回"),
        className:
          "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
      },
      RESUBMITTED: {
        label: t("assignmentDetail.status.resubmitted", "已重交"),
        className:
          "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
      },
    };
    return config[status] || config.NOT_STARTED;
  };

  const getContentTypeBadge = () => {
    if (!assignment) return { label: "", className: "" };
    const contentType = assignment.content_type?.toUpperCase();
    const practiceMode = assignment.practice_mode;

    if (contentType === "VOCABULARY_SET" || contentType === "SENTENCE_MAKING") {
      if (practiceMode === "word_selection") {
        return {
          label: t("classroomDetail.contentTypes.WORD_SELECTION"),
          className:
            "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
        };
      }
      return {
        label: t("classroomDetail.contentTypes.WORD_READING"),
        className:
          "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
      };
    }

    if (
      contentType === "EXAMPLE_SENTENCES" ||
      contentType === "READING_ASSESSMENT"
    ) {
      if (practiceMode === "rearrangement") {
        return {
          label: t("classroomDetail.contentTypes.REARRANGEMENT"),
          className:
            "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
        };
      }
      return {
        label: t("classroomDetail.contentTypes.SPEAKING"),
        className:
          "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
      };
    }

    const otherTypeLabels: Record<
      string,
      { label: string; className: string }
    > = {
      SPEAKING_PRACTICE: {
        label: t("classroomDetail.contentTypes.speakingPractice"),
        className:
          "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
      },
      SPEAKING_SCENARIO: {
        label: t("classroomDetail.contentTypes.speakingScenario"),
        className:
          "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
      },
      LISTENING_CLOZE: {
        label: t("classroomDetail.contentTypes.listeningCloze"),
        className:
          "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
      },
      SPEAKING_QUIZ: {
        label: t("classroomDetail.contentTypes.speakingQuiz"),
        className:
          "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
      },
    };

    return (
      otherTypeLabels[contentType || ""] || {
        label: t("classroomDetail.labels.unknownType"),
        className:
          "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
      }
    );
  };

  const getContentTypeLabel = (type: string) => {
    const upper = type.toUpperCase();
    if (upper === "VOCABULARY_SET" || upper === "SENTENCE_MAKING") {
      return t("classroomDetail.contentTypes.VOCABULARY_SET", "單字集");
    }
    if (upper === "READING_ASSESSMENT" || upper === "EXAMPLE_SENTENCES") {
      return t("classroomDetail.contentTypes.SPEAKING", "例句朗讀");
    }
    return type;
  };

  if (!assignment) return null;

  const completionRate = assignment.completion_rate || 0;
  const typeBadge = getContentTypeBadge();
  const showGradingButtons =
    assignment.practice_mode !== "rearrangement" &&
    assignment.practice_mode !== "word_selection";

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg md:max-w-xl lg:max-w-2xl p-0 flex flex-col"
        >
          {/* Header */}
          <SheetHeader className="px-6 pt-6 pb-4 border-b dark:border-gray-700">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-lg">
                {isEditing
                  ? t("assignmentDetail.sheet.editTitle", "編輯作業")
                  : t("assignmentDetail.sheet.viewTitle", "作業詳情")}
              </SheetTitle>
              {!isEditing && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                  className="gap-1.5 mr-6"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {t("assignmentDetail.sheet.editButton", "編輯")}
                </Button>
              )}
            </div>
            <SheetDescription className="sr-only">
              {assignment.title}
            </SheetDescription>
          </SheetHeader>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {isEditing ? (
              /* ─── Edit Mode ─── */
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t("assignmentDetail.sheet.titleLabel", "作業標題")}
                  </label>
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t("assignmentDetail.sheet.instructionsLabel", "作業說明")}
                  </label>
                  <Textarea
                    value={editInstructions}
                    onChange={(e) => setEditInstructions(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t("assignmentDetail.sheet.startDateLabel", "開始日期")}
                    </label>
                    <Input
                      type="date"
                      value={editStartDate}
                      onChange={(e) => setEditStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t("assignmentDetail.sheet.dueDateLabel", "截止日期")}
                    </label>
                    <Input
                      type="date"
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                    />
                  </div>
                </div>

                {/* 進階設定 */}
                <div className="border dark:border-gray-700 rounded-lg p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4 text-gray-500" />
                    <Label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t(
                        "dialogs.assignmentDialog.practiceMode.advancedSettings",
                        "進階設定",
                      )}
                    </Label>
                  </div>

                  {/* 例句重組專用 - 播放音檔 */}
                  {assignment.practice_mode === "rearrangement" && (
                    <div>
                      <Label className="text-xs text-gray-600 dark:text-gray-400 mb-2 block">
                        {t("dialogs.assignmentDialog.practiceMode.playAudio")}
                      </Label>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setEditAdvanced((prev) => ({
                              ...prev,
                              play_audio: true,
                            }))
                          }
                          className={`flex-1 p-3 rounded-lg border text-sm ${
                            editAdvanced.play_audio
                              ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-600"
                              : "border-gray-200 dark:border-gray-600 hover:border-gray-300"
                          }`}
                        >
                          🔊{" "}
                          {t(
                            "dialogs.assignmentDialog.practiceMode.playAudioYes",
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEditAdvanced((prev) => ({
                              ...prev,
                              play_audio: false,
                            }))
                          }
                          className={`flex-1 p-3 rounded-lg border text-sm ${
                            !editAdvanced.play_audio
                              ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-600"
                              : "border-gray-200 dark:border-gray-600 hover:border-gray-300"
                          }`}
                        >
                          🔇{" "}
                          {t(
                            "dialogs.assignmentDialog.practiceMode.playAudioNo",
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 單字選擇專用 - 達標熟悉度 */}
                  {assignment.practice_mode === "word_selection" && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-xs text-gray-600 dark:text-gray-400">
                          {t(
                            "dialogs.assignmentDialog.practiceMode.targetProficiency",
                          )}
                        </Label>
                        <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                          {editAdvanced.target_proficiency}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={50}
                        max={100}
                        step={5}
                        value={editAdvanced.target_proficiency}
                        onChange={(e) =>
                          setEditAdvanced((prev) => ({
                            ...prev,
                            target_proficiency: Number(e.target.value),
                          }))
                        }
                        className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {t(
                          "dialogs.assignmentDialog.practiceMode.targetProficiencyDesc",
                        )}
                      </p>
                    </div>
                  )}

                  {/* 單字選擇專用 - 題目呈現方式 */}
                  {assignment.practice_mode === "word_selection" && (
                    <div>
                      <Label className="text-xs text-gray-600 dark:text-gray-400 mb-2 block">
                        {t(
                          "dialogs.assignmentDialog.practiceMode.questionDisplay",
                        )}
                      </Label>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setEditAdvanced((prev) => ({
                              ...prev,
                              show_word: true,
                              play_audio: false,
                            }))
                          }
                          className={`flex-1 p-3 rounded-lg border text-sm ${
                            editAdvanced.show_word && !editAdvanced.play_audio
                              ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-600"
                              : "border-gray-200 dark:border-gray-600 hover:border-gray-300"
                          }`}
                        >
                          👁️{" "}
                          {t(
                            "dialogs.assignmentDialog.practiceMode.displayWord",
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEditAdvanced((prev) => ({
                              ...prev,
                              show_word: false,
                              play_audio: true,
                            }))
                          }
                          className={`flex-1 p-3 rounded-lg border text-sm ${
                            !editAdvanced.show_word && editAdvanced.play_audio
                              ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-600"
                              : "border-gray-200 dark:border-gray-600 hover:border-gray-300"
                          }`}
                        >
                          🔊{" "}
                          {t(
                            "dialogs.assignmentDialog.practiceMode.playAudioWord",
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    {/* 時間限制 */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-600 dark:text-gray-400">
                        {t("dialogs.assignmentDialog.practiceMode.timeLimit")}
                      </Label>
                      <select
                        value={editAdvanced.time_limit_per_question}
                        onChange={(e) =>
                          setEditAdvanced((prev) => ({
                            ...prev,
                            time_limit_per_question: Number(e.target.value),
                          }))
                        }
                        className="w-full h-9 px-3 rounded-md border border-gray-200 dark:border-gray-600 dark:bg-gray-800 text-sm"
                      >
                        {(assignment.practice_mode === "rearrangement" ||
                          assignment.practice_mode === "word_reading" ||
                          assignment.practice_mode === "word_selection") && (
                          <option value={0}>
                            {t(
                              "dialogs.assignmentDialog.practiceMode.unlimited",
                            )}
                          </option>
                        )}
                        <option value={10}>
                          10{" "}
                          {t("dialogs.assignmentDialog.practiceMode.seconds")}
                        </option>
                        <option value={20}>
                          20{" "}
                          {t("dialogs.assignmentDialog.practiceMode.seconds")}
                        </option>
                        <option value={30}>
                          30{" "}
                          {t("dialogs.assignmentDialog.practiceMode.seconds")}
                        </option>
                        <option value={40}>
                          40{" "}
                          {t("dialogs.assignmentDialog.practiceMode.seconds")}
                        </option>
                      </select>
                    </div>

                    {/* 打亂順序 */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-600 dark:text-gray-400">
                        {t(
                          "dialogs.assignmentDialog.practiceMode.shuffleQuestions",
                        )}
                      </Label>
                      <div className="flex items-center h-9">
                        <input
                          type="checkbox"
                          checked={editAdvanced.shuffle_questions}
                          onChange={(e) =>
                            setEditAdvanced((prev) => ({
                              ...prev,
                              shuffle_questions: e.target.checked,
                            }))
                          }
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">
                          {t(
                            "dialogs.assignmentDialog.practiceMode.shuffleQuestionsDesc",
                          )}
                        </span>
                      </div>
                    </div>

                    {/* 例句重組專用 - 顯示答案 */}
                    {assignment.practice_mode === "rearrangement" && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-600 dark:text-gray-400">
                          {t(
                            "dialogs.assignmentDialog.practiceMode.showAnswer",
                          )}
                        </Label>
                        <div className="flex items-center h-9">
                          <input
                            type="checkbox"
                            checked={editAdvanced.show_answer}
                            onChange={(e) =>
                              setEditAdvanced((prev) => ({
                                ...prev,
                                show_answer: e.target.checked,
                              }))
                            }
                            className="h-4 w-4 rounded border-gray-300"
                          />
                          <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.showAnswerDesc",
                            )}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* 單字朗讀專用 - 顯示翻譯 */}
                    {assignment.practice_mode === "word_reading" && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-600 dark:text-gray-400">
                          {t(
                            "dialogs.assignmentDialog.practiceMode.showTranslation",
                          )}
                        </Label>
                        <div className="flex items-center h-9">
                          <input
                            type="checkbox"
                            checked={editAdvanced.show_translation}
                            onChange={(e) =>
                              setEditAdvanced((prev) => ({
                                ...prev,
                                show_translation: e.target.checked,
                              }))
                            }
                            className="h-4 w-4 rounded border-gray-300"
                          />
                          <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.showTranslationDesc",
                            )}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* 顯示圖片 (word_reading + word_selection) */}
                    {(assignment.practice_mode === "word_reading" ||
                      assignment.practice_mode === "word_selection") && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-600 dark:text-gray-400">
                          {t("dialogs.assignmentDialog.practiceMode.showImage")}
                        </Label>
                        <div className="flex items-center h-9">
                          <input
                            type="checkbox"
                            checked={editAdvanced.show_image}
                            onChange={(e) =>
                              setEditAdvanced((prev) => ({
                                ...prev,
                                show_image: e.target.checked,
                              }))
                            }
                            className="h-4 w-4 rounded border-gray-300"
                          />
                          <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.showImageDesc",
                            )}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* ─── Read-Only Mode ─── */
              <div className="space-y-5">
                {/* Title & badges */}
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {assignment.title}
                  </h3>
                  <div className="flex gap-2 flex-wrap">
                    <Badge variant="secondary" className={typeBadge.className}>
                      {typeBadge.label}
                    </Badge>
                  </div>
                  {(assignment.instructions || assignment.description) && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                      {assignment.instructions || assignment.description}
                    </p>
                  )}
                </div>

                {/* Grading Buttons */}
                {showGradingButtons && (
                  <div className="flex gap-2">
                    <Button
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-700 dark:text-white"
                      onClick={() => onGradeClick?.(assignment.id)}
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      {t(
                        "assignmentDetail.buttons.gradeAssignment",
                        "批改作業",
                      )}
                    </Button>
                    {canUseAiGrading && (
                      <Button
                        className="flex-1 bg-purple-600 hover:bg-purple-700 text-white dark:bg-purple-600 dark:hover:bg-purple-700 dark:text-white"
                        onClick={() => onBatchGradeClick?.(assignment.id)}
                      >
                        <Sparkles className="h-4 w-4 mr-2" />
                        {t("assignmentDetail.buttons.batchGrade", "AI 批改")}
                      </Button>
                    )}
                  </div>
                )}

                {/* Stats grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t("classroomDetail.labels.assignedTo")}
                    </div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1">
                      {assignment.student_count
                        ? t("classroomDetail.labels.studentCountWithUnit", {
                            count: assignment.student_count,
                          })
                        : t("classroomDetail.labels.allClass")}
                    </div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t("classroomDetail.labels.dueDate")}
                    </div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1">
                      {assignment.due_date
                        ? new Date(assignment.due_date).toLocaleDateString(
                            "zh-TW",
                          )
                        : t("classroomDetail.labels.noDeadline")}
                    </div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t("classroomDetail.labels.completionProgress")}
                    </div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1">
                      {completionRate}%
                    </div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t("assignmentDetail.sheet.averageScore", "平均分數")}
                    </div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1">
                      {(() => {
                        const scoredStudents = studentProgress.filter(
                          (sp) => sp.score !== undefined && sp.score !== null,
                        );
                        if (scoredStudents.length === 0) return "-";
                        const avg =
                          scoredStudents.reduce(
                            (sum, sp) => sum + sp.score!,
                            0,
                          ) / scoredStudents.length;
                        return `${avg.toFixed(1)}${assignment.practice_mode === "word_selection" ? "%" : ""}`;
                      })()}
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-green-500 dark:bg-green-600 h-2 rounded-full transition-all"
                    style={{ width: `${completionRate}%` }}
                  />
                </div>

                {/* Assignment Contents */}
                {assignmentContents.length > 0 && (
                  <div className="border dark:border-gray-700 rounded-lg">
                    <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-800 rounded-t-lg">
                      <BookOpen className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                        {t(
                          "assignmentDetail.sheet.contentTitle",
                          "作業單元內容",
                        )}{" "}
                        ({assignmentContents.length})
                      </h4>
                    </div>
                    <div className="p-3 space-y-2">
                      {assignmentContents.map((content, index) => (
                        <div
                          key={content.id}
                          className="border dark:border-gray-700 rounded-lg p-3 hover:shadow-md transition-shadow"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-1 min-w-0 flex-wrap">
                              <span className="text-sm font-bold text-blue-600 flex-shrink-0">
                                #{index + 1}
                              </span>
                              <span className="font-medium text-sm truncate">
                                {content.title}
                              </span>
                              <Badge
                                variant="outline"
                                className="text-xs flex-shrink-0"
                              >
                                {getContentTypeLabel(content.type || "")}
                              </Badge>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (expandedContentId === content.id) {
                                    setExpandedContentId(null);
                                  } else {
                                    setExpandedContentId(content.id);
                                    loadContentDetail(content.id);
                                  }
                                }}
                                className="text-blue-600 hover:text-blue-700 text-xs px-2"
                              >
                                <ChevronRight
                                  className={`h-4 w-4 transition-transform ${
                                    expandedContentId === content.id
                                      ? "rotate-90"
                                      : ""
                                  }`}
                                />
                                <span className="ml-1">
                                  {t("common.expand", "展開")}
                                </span>
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingContentId(content.id);
                                  loadContentDetail(content.id);
                                }}
                                className="text-orange-600 hover:text-orange-700 border-orange-200 hover:bg-orange-50 text-xs px-2"
                              >
                                <Edit2 className="h-3.5 w-3.5 mr-1" />
                                {t("common.edit", "編輯")}
                              </Button>
                            </div>
                          </div>
                          {/* Expanded content detail */}
                          {expandedContentId === content.id &&
                            contentDetails[content.id] && (
                              <div className="mt-3 space-y-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                                <div className="text-sm">
                                  <span className="text-gray-600 dark:text-gray-300">
                                    {t(
                                      "assignmentDetail.sheet.questionCount",
                                      "題目數量：",
                                    )}
                                  </span>
                                  <span className="font-medium ml-2">
                                    {contentDetails[content.id].items?.length ||
                                      0}{" "}
                                    {t(
                                      "assignmentDetail.sheet.itemCount",
                                      "題",
                                    )}
                                  </span>
                                </div>
                                <div className="space-y-1 max-h-60 overflow-y-auto">
                                  {contentDetails[content.id].items?.map(
                                    (item, idx) => (
                                      <div
                                        key={item.id}
                                        className="text-xs p-2 bg-white dark:bg-gray-800 rounded"
                                      >
                                        <span className="text-gray-600 dark:text-gray-400">
                                          {idx + 1}.
                                        </span>{" "}
                                        <span className="font-medium">
                                          {item.text}
                                        </span>
                                        {item.translation && (
                                          <span className="text-gray-500 ml-2">
                                            ({item.translation})
                                          </span>
                                        )}
                                      </div>
                                    ),
                                  )}
                                </div>
                              </div>
                            )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Student Progress List (always shown) */}
            <div className="border-t dark:border-gray-700 pt-4">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                {t("assignmentDetail.sheet.studentProgress", "學生完成狀況")}
              </h4>
              {loading ? (
                <div className="flex items-center justify-center py-8 text-gray-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : studentProgress.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">
                  {t("assignmentDetail.sheet.noStudents", "尚無學生資料")}
                </p>
              ) : (
                <div className="space-y-1">
                  {studentProgress.map((sp) => {
                    const badge = getStatusBadge(sp.status);
                    const hasScore =
                      sp.score !== undefined &&
                      sp.score !== null &&
                      (sp.status === "GRADED" ||
                        sp.status === "RETURNED" ||
                        sp.status === "RESUBMITTED");
                    return (
                      <div
                        key={sp.student_id || sp.student_number}
                        className="flex items-center justify-between py-2 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          {sp.student_name}
                        </span>
                        <div className="flex items-center gap-2">
                          {hasScore && (
                            <span
                              className={`text-sm font-bold ${
                                sp.score! >= 80
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-red-600 dark:text-red-400"
                              }`}
                            >
                              {sp.score!.toFixed(1)}
                              {assignment.practice_mode === "word_selection" &&
                                "%"}
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t dark:border-gray-700 px-6 py-4 flex justify-end gap-3">
            {isEditing ? (
              <>
                <Button
                  variant="outline"
                  onClick={handleCancelEdit}
                  disabled={saving}
                >
                  <X className="h-4 w-4 mr-1.5" />
                  {t("common.cancel", "取消")}
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-1.5" />
                  )}
                  {t("assignmentDetail.sheet.save", "儲存變更")}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.close", "關閉")}
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Content Edit Dialog */}
      {editingContentId && contentDetails[editingContentId] && (
        <Dialog
          open={editingContentId !== null}
          onOpenChange={(dialogOpen) =>
            !dialogOpen && setEditingContentId(null)
          }
        >
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {t("assignmentDetail.labels.editContent") || "編輯作業內容"}
              </DialogTitle>
              <p className="text-sm text-amber-600 mt-2">
                ⚠️{" "}
                {t(
                  "assignmentDetail.sheet.editContentWarning",
                  "注意：此為作業副本。刪除已有學生進度的題目將被阻止。",
                )}
              </p>
            </DialogHeader>
            <div className="mt-4">
              {(() => {
                const contentType =
                  contentDetails[editingContentId]?.type?.toUpperCase();
                const isVocabSet =
                  contentType === "VOCABULARY_SET" ||
                  contentType === "SENTENCE_MAKING";

                const handleEditSave = async () => {
                  const savedContentId = editingContentId;
                  setEditingContentId(null);
                  if (savedContentId) {
                    setContentDetails((prev) => {
                      const updated = { ...prev };
                      delete updated[savedContentId];
                      return updated;
                    });
                    await loadContentDetail(savedContentId, true);
                  }
                };

                if (isVocabSet) {
                  return (
                    <VocabularySetPanel
                      content={{
                        id: editingContentId,
                        title: contentDetails[editingContentId].title || "",
                      }}
                      editingContent={contentDetails[editingContentId] as never}
                      onUpdateContent={async () => {}}
                      onSave={handleEditSave}
                      lessonId={0}
                      isCreating={false}
                      isAssignmentCopy={true}
                    />
                  );
                }

                return (
                  <ReadingAssessmentPanel
                    content={{
                      id: editingContentId,
                      title: contentDetails[editingContentId].title || "",
                    }}
                    editingContent={contentDetails[editingContentId] as never}
                    onUpdateContent={async () => {}}
                    onSave={handleEditSave}
                    lessonId={0}
                    isCreating={false}
                    isAssignmentCopy={true}
                  />
                );
              })()}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setEditingContentId(null)}
              >
                {t("common.cancel")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
