import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import ReadingAssessmentPanel, {
  type ReadingAssessmentPanelHandle,
} from "@/components/ReadingAssessmentPanel";
import VocabularySetPanel, {
  type VocabularySetPanelHandle,
} from "@/components/VocabularySetPanel";
import { RefSaveButton } from "@/components/shared/RefSaveButton";
import {
  practiceModeLabelKey,
  practiceModeBadgeClass,
  isAutoScoredMode,
} from "@/lib/practiceMode";
import { PracticeModeSettingsPanel } from "@/components/assignment/PracticeModeSettingsPanel";
import type { PracticeModeSettings } from "@/components/assignment/practiceModeSettings";
import { apiClient, ApiError } from "@/lib/api";
import { toast } from "sonner";
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
} from "lucide-react";
import { Assignment } from "@/types";
import StudentStatusPanel, {
  StudentProgress,
} from "@/components/StudentStatusPanel";
import { useSidebar } from "@/contexts/SidebarContext";

interface AssignmentContent {
  id: number;
  title: string;
  type?: string;
  order_index: number;
}

// #878 Stage 3.5：與派發共用同一設定型別（含 quiz_time_limit_seconds + 時間 literal union），
// 編輯區改用共用 PracticeModeSettingsPanel，與派發 dialog 一致（#846）。
type AdvancedSettings = PracticeModeSettings;

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
  classroomId,
  canUseAiGrading = false,
  onGradeClick,
  onBatchGradeClick,
  onAssignmentUpdated,
}: AssignmentDetailSheetProps) {
  const { t } = useTranslation();
  const { sidebarWidth } = useSidebar();
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [studentProgress, setStudentProgress] = useState<StudentProgress[]>([]);
  const [isEditingStudents, setIsEditingStudents] = useState(false);
  const [pendingStudentIds, setPendingStudentIds] = useState<number[] | null>(
    null,
  );

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
  const readingPanelRef = useRef<ReadingAssessmentPanelHandle>(null);
  const vocabPanelRef = useRef<VocabularySetPanelHandle>(null);
  const loadingRef = useRef<Set<number>>(new Set());

  // Auto-focus content edit panel so scroll works immediately
  const contentEditPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editingContentId) {
      requestAnimationFrame(() => {
        contentEditPanelRef.current?.focus();
      });
    }
  }, [editingContentId]);

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
    quiz_time_limit_seconds: 0,
    shuffle_questions: false,
    show_answer: false,
    play_audio: false,
    target_proficiency: 80,
    show_word: true,
    show_image: true,
    show_translation: true,
    show_option_images: false,
  });

  const fetchAssignmentData = useCallback(async () => {
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
        time_limit_per_question: ((detail.time_limit_per_question as number) ??
          30) as AdvancedSettings["time_limit_per_question"],
        quiz_time_limit_seconds: ((detail.quiz_time_limit_seconds as number) ??
          0) as AdvancedSettings["quiz_time_limit_seconds"],
        shuffle_questions: (detail.shuffle_questions as boolean) ?? false,
        show_answer: (detail.show_answer as boolean) ?? false,
        play_audio: (detail.play_audio as boolean) ?? false,
        target_proficiency: (detail.target_proficiency as number) ?? 80,
        show_word: (detail.show_word as boolean) ?? true,
        show_image: (detail.show_image as boolean) ?? true,
        show_translation: (detail.show_translation as boolean) ?? true,
        show_option_images: (detail.show_option_images as boolean) ?? false,
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
      setStudentProgress(progressData as StudentProgress[]);
    } catch {
      setStudentProgress([]);
      setAssignmentContents([]);
    } finally {
      setLoading(false);
    }
  }, [assignment]);

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
      setEditStartDate(
        assignment.start_date ? assignment.start_date.split("T")[0] : "",
      );
      setIsEditing(false);
      setDetailData(null);
      setAssignmentContents([]);
      setContentDetails({});
      setExpandedContentId(null);
      fetchAssignmentData();
    }
  }, [assignment?.id, open, fetchAssignmentData]);

  const averageScoreDisplay = useMemo(() => {
    const scoredStudents = studentProgress.filter(
      (sp) => sp.score !== undefined && sp.score !== null,
    );
    if (scoredStudents.length === 0) return "-";
    const avg =
      scoredStudents.reduce((sum, sp) => sum + sp.score!, 0) /
      scoredStudents.length;
    return `${avg.toFixed(1)}`;
  }, [studentProgress, assignment?.practice_mode]);

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
    // Validate date order
    if (editStartDate && editDueDate && editStartDate > editDueDate) {
      toast.error(
        t(
          "assignmentDetail.messages.startDateAfterDueDate",
          "開始日期不可晚於截止日期",
        ),
      );
      return;
    }
    setSaving(true);
    try {
      await apiClient.patch(`/api/teachers/assignments/${assignment.id}`, {
        title: editTitle,
        description: editInstructions,
        // Taiwan-only product: hardcode TST (+08:00) for TIMESTAMPTZ columns
        due_date: editDueDate ? `${editDueDate}T23:59:59+08:00` : null,
        start_date: editStartDate ? `${editStartDate}T00:00:00+08:00` : null,
        ...editAdvanced,
      });
      toast.success(t("assignmentDetail.messages.updateSuccess", "已儲存變更"));
      setIsEditing(false);
      onAssignmentUpdated?.();
    } catch (error) {
      // Issue #757: PATCH 在 play_audio 切到 True 時若副本缺例句音檔會回
      // 422 EXAMPLE_AUDIO_REQUIRED。對齊派發 dialog 的提示語、明確告訴
      // 老師缺哪些單字集 + 怎麼修。
      if (error instanceof ApiError && error.status === 422) {
        const detail = error.detail as {
          code?: string;
          content_titles?: string[];
        } | null;
        if (detail?.code === "EXAMPLE_AUDIO_REQUIRED") {
          const titles = detail.content_titles?.join("、") || "";
          toast.error(t("dialogs.assignmentDialog.errors.missingAudio"), {
            description: t("dialogs.assignmentDialog.errors.missingAudioDesc", {
              contents: titles,
            }),
          });
          return;
        }
        // Issue #632: 切到 word_cloze 時若副本缺克漏字答案，提示老師回編輯內容補齊
        if (detail?.code === "CLOZE_ANSWER_REQUIRED") {
          const titles = detail.content_titles?.join("、") || "";
          toast.error(t("dialogs.assignmentDialog.errors.missingClozeAnswer"), {
            description: t(
              "dialogs.assignmentDialog.errors.missingClozeAnswerDesc",
              { contents: titles },
            ),
          });
          return;
        }
      }
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
        ((detailData.time_limit_per_question as number) ??
          30) as AdvancedSettings["time_limit_per_question"],
      quiz_time_limit_seconds:
        ((detailData.quiz_time_limit_seconds as number) ??
          0) as AdvancedSettings["quiz_time_limit_seconds"],
      shuffle_questions: (detailData.shuffle_questions as boolean) ?? false,
      show_answer: (detailData.show_answer as boolean) ?? false,
      play_audio: (detailData.play_audio as boolean) ?? false,
      target_proficiency: (detailData.target_proficiency as number) ?? 80,
      show_word: (detailData.show_word as boolean) ?? true,
      show_image: (detailData.show_image as boolean) ?? true,
      show_translation: (detailData.show_translation as boolean) ?? true,
      show_option_images: (detailData.show_option_images as boolean) ?? false,
    });
    setIsEditing(false);
  };

  const handleSaveStudents = async () => {
    if (!assignment || !pendingStudentIds) return;
    setSaving(true);
    try {
      await apiClient.patch(`/api/teachers/assignments/${assignment.id}`, {
        student_ids: pendingStudentIds,
      });
      toast.success(t("assignmentDetail.messages.updateSuccess", "派發已更新"));
      setIsEditingStudents(false);
      setPendingStudentIds(null);
      fetchAssignmentData();
      onAssignmentUpdated?.();
    } catch {
      toast.error(t("assignmentDetail.messages.updateError", "更新失敗"));
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEditStudents = () => {
    setIsEditingStudents(false);
    setPendingStudentIds(null);
  };

  const getContentTypeBadge = () => {
    if (!assignment) return { label: "", className: "" };
    const contentType = assignment.content_type?.toUpperCase();
    const practiceMode = assignment.practice_mode;

    if (contentType === "VOCABULARY_SET" || contentType === "SENTENCE_MAKING") {
      // 依 practice_mode 取正確標籤（含三種小考）；未知才退回「單字集」
      const key = practiceModeLabelKey(practiceMode);
      return {
        label: key ? t(key) : t("classroomDetail.contentTypes.VOCABULARY_SET"),
        className: practiceModeBadgeClass(practiceMode),
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
  // 自動計分模式不需手動批改鈕；改用 registry 的 isAutoScoredMode（含三種小考，修舊本地 set 漏列）。
  const showGradingButtons = !isAutoScoredMode(assignment.practice_mode);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg md:max-w-xl lg:max-w-2xl p-0 flex flex-col"
          onEscapeKeyDown={(e) => {
            if (editingContentId) {
              e.preventDefault();
              setEditingContentId(null);
            }
          }}
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
                  disabled={loading}
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

                {assignment.practice_mode && (
                  <PracticeModeSettingsPanel
                    mode={assignment.practice_mode}
                    value={editAdvanced}
                    onChange={setEditAdvanced}
                  />
                )}
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
                      {averageScoreDisplay}
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

            {/* Student Status Panel (always shown) */}
            <StudentStatusPanel
              students={studentProgress}
              assignmentId={assignment?.id ?? 0}
              classroomId={classroomId}
              practiceMode={assignment?.practice_mode ?? undefined}
              isEditingStudents={isEditingStudents}
              onEditingStudentsChange={setIsEditingStudents}
              onStudentIdsChanged={setPendingStudentIds}
              onSave={handleSaveStudents}
              saving={saving}
              loading={loading}
            />
          </div>

          {/* Footer */}
          <div className="border-t dark:border-gray-700 px-6 py-4 flex justify-end gap-3">
            {isEditingStudents ? (
              <>
                <Button
                  variant="outline"
                  onClick={handleCancelEditStudents}
                  disabled={saving}
                >
                  <X className="h-4 w-4 mr-1.5" />
                  {t("common.cancel", "取消")}
                </Button>
                <Button onClick={handleSaveStudents} disabled={saving}>
                  {saving ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-1.5" />
                  )}
                  {t("assignmentDetail.sheet.saveStudents", "儲存派發")}
                </Button>
              </>
            ) : isEditing ? (
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

          {/* Content Edit Overlay — inside SheetContent to stay within Radix focus trap */}
          {editingContentId &&
            contentDetails[editingContentId] &&
            (() => {
              const editingDetail = contentDetails[editingContentId];
              const isVocabSet = ["VOCABULARY_SET", "SENTENCE_MAKING"].includes(
                editingDetail?.type?.toUpperCase() ?? "",
              );
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

              return (
                <div
                  ref={contentEditPanelRef}
                  tabIndex={-1}
                  className="fixed inset-0 z-[60] flex outline-none"
                >
                  {/* Backdrop — click to cancel */}
                  <div
                    className="absolute inset-0 bg-black/30"
                    onClick={() => setEditingContentId(null)}
                  />
                  {/* Panel */}
                  <div
                    className="absolute top-0 right-0 h-full bg-white dark:bg-gray-950 shadow-xl border-l flex flex-col"
                    style={{ left: `${sidebarWidth}px` }}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50 dark:bg-gray-800">
                      <div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                          {t(
                            "assignmentDetail.labels.editContent",
                            "編輯作業內容",
                          )}
                        </h2>
                        <p className="text-sm text-amber-600 mt-1">
                          ⚠️{" "}
                          {t(
                            "assignmentDetail.sheet.editContentWarning",
                            "注意：此為作業副本。刪除已有學生進度的題目將被阻止。",
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingContentId(null)}
                        >
                          {t("common.cancel", "取消")}
                        </Button>
                        <RefSaveButton
                          panelRef={
                            isVocabSet ? vocabPanelRef : readingPanelRef
                          }
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingContentId(null);
                            onOpenChange(false);
                          }}
                          className="hover:bg-gray-200"
                        >
                          <X className="h-5 w-5" />
                        </Button>
                      </div>
                    </div>
                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-6">
                      {isVocabSet ? (
                        <VocabularySetPanel
                          ref={vocabPanelRef}
                          content={{
                            id: editingContentId,
                            title: editingDetail.title || "",
                          }}
                          editingContent={editingDetail as never}
                          onUpdateContent={async () => {}}
                          onSave={handleEditSave}
                          lessonId={0}
                          isCreating={false}
                          isAssignmentCopy={true}
                          showOptionImages={editAdvanced.show_option_images}
                        />
                      ) : (
                        <ReadingAssessmentPanel
                          ref={readingPanelRef}
                          content={{
                            id: editingContentId,
                            title: editingDetail.title || "",
                          }}
                          editingContent={editingDetail as never}
                          onUpdateContent={async () => {}}
                          onSave={handleEditSave}
                          lessonId={0}
                          isCreating={false}
                          isAssignmentCopy={true}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
        </SheetContent>
      </Sheet>
    </>
  );
}
