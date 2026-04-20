import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import AIScoreDisplay from "@/components/shared/AIScoreDisplay";
import AudioRecorder from "@/components/shared/AudioRecorder";
import { TrafficLightDot, StatusLegend } from "@/components/StudentStatusPanel";
import {
  User,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Volume2,
  CheckCircle,
  AlertCircle,
  Users,
  X,
  Mic,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Loader2,
  Search,
} from "lucide-react";
import { Assignment } from "@/types";

interface AssignmentInfo extends Assignment {
  title: string;
}

interface StudentInfo {
  student_id: number;
  student_name: string;
  status: string;
  score?: number | null;
}

interface StudentsResponse {
  students: StudentInfo[];
}

interface SubmissionItem {
  question_text: string;
  question_translation?: string;
  audio_url?: string;
  question_audio_url?: string;
  student_answer?: string;
  transcript?: string;
  duration?: number;
  content_title?: string;
  feedback?: string;
  passed?: boolean | null;
  ai_scores?: {
    accuracy_score: number;
    fluency_score: number;
    pronunciation_score: number;
    completeness_score: number;
    overall_score: number;
    word_details?: Array<{
      word: string;
      accuracy_score: number;
      error_type?: string;
    }>;
    // 🎯 Issue #118: Metadata for upload status tracking
    _metadata?: {
      audio_upload_status?: "success" | "failed";
      source?: string;
      latency_ms?: number;
    };
  };
  item_progress_id?: number;
}

interface StudentSubmission {
  student_number: number;
  student_name: string;
  student_email: string;
  status: string;
  submitted_at?: string;
  content_type: string;
  submissions: SubmissionItem[];
  content_groups?: Array<{
    content_id: number;
    content_title: string;
    content_type?: string;
    submissions: SubmissionItem[];
  }>;
  current_score?: number;
  current_feedback?: string;
}

interface ItemFeedback {
  [key: number]: {
    feedback: string;
    passed: boolean | null;
  };
}

interface StudentListItem {
  student_id: number;
  student_name: string;
  status: string;
  score?: number | null;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function GradingPage() {
  const { t } = useTranslation();
  const { classroomId, assignmentId } = useParams<{
    classroomId: string;
    assignmentId: string;
  }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const studentId = searchParams.get("studentId");

  const [submission, setSubmission] = useState<StudentSubmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [score, setScore] = useState<number | null>(null);
  const [isAutoCalculatedScore, setIsAutoCalculatedScore] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [itemFeedbacks, setItemFeedbacks] = useState<ItemFeedback>({});

  // 新增狀態
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(0);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedTime, setLastSavedTime] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<
    "students" | "content" | "grading"
  >("content");

  const [reanalyzingItems, setReanalyzingItems] = useState<Set<number>>(
    new Set(),
  );

  // 學生列表相關
  const [studentList, setStudentList] = useState<StudentListItem[]>([]);
  const [assignmentTitle, setAssignmentTitle] = useState("");

  // 載入作業資訊和學生列表
  useEffect(() => {
    if (assignmentId) {
      loadAssignmentInfo();
      loadStudentList();
    }
  }, [assignmentId]);

  // 載入學生提交內容
  useEffect(() => {
    if (assignmentId && studentId) {
      loadSubmission();
    } else if (assignmentId && studentList.length > 0 && !studentId) {
      const firstStudent = studentList[0];
      if (firstStudent && firstStudent.student_id) {
        setSearchParams({ studentId: firstStudent.student_id.toString() });
      }
    }
  }, [assignmentId, studentId, studentList]);

  // 當提交資料載入後，同步更新學生列表狀態
  useEffect(() => {
    if (submission && studentId) {
      setStudentList((prev) =>
        prev.map((student) =>
          student.student_id === parseInt(studentId)
            ? { ...student, status: submission.status }
            : student,
        ),
      );
    }
  }, [submission?.status, studentId]);

  const loadAssignmentInfo = async () => {
    try {
      const response = (await apiClient.get(
        `/api/teachers/assignments/${assignmentId}`,
      )) as AssignmentInfo;
      setAssignmentTitle(
        response.title || `${t("gradingPage.labels.grading")} #${assignmentId}`,
      );
    } catch (error) {
      console.error("Failed to load assignment info:", error);
    }
  };

  const loadStudentList = async () => {
    try {
      const response = (await apiClient.get(
        `/api/teachers/assignments/${assignmentId}/students`,
      )) as StudentsResponse;

      const statusPriority: Record<string, number> = {
        IN_PROGRESS: 1,
        RETURNED: 1,
        SUBMITTED: 2,
        RESUBMITTED: 2,
        NOT_STARTED: 3,
        GRADED: 4,
        NOT_ASSIGNED: 99,
      };

      const sortedStudents = (response.students || []).sort((a, b) => {
        const aPriority = statusPriority[a.status] || 50;
        const bPriority = statusPriority[b.status] || 50;

        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }

        return a.student_id - b.student_id;
      });

      setStudentList(sortedStudents);
    } catch (error) {
      console.error("Failed to load student list:", error);
    }
  };

  const loadSubmission = async () => {
    try {
      setLoading(true);
      const response = (await apiClient.get(
        `/api/teachers/assignments/${assignmentId}/submissions/${studentId}`,
      )) as StudentSubmission;

      setSubmission(response);

      if (
        response.current_score !== undefined &&
        response.current_score !== null
      ) {
        setScore(
          response.current_score != null
            ? Math.round(response.current_score * 10) / 10
            : null,
        );

        const feedbackText = response.current_feedback || "";

        if (feedbackText.includes("題目 ") && feedbackText.includes("總評:")) {
          const totalFeedbackMatch = feedbackText.match(/總評:\s*([\s\S]*?)$/);
          setFeedback(totalFeedbackMatch ? totalFeedbackMatch[1].trim() : "");
        } else if (feedbackText.includes("題目 ")) {
          setFeedback("");
        } else {
          setFeedback(feedbackText);
        }
      } else {
        setScore(null);
        setFeedback("");
      }

      // 載入個別題目的評語和通過狀態
      const loadedFeedbacks: ItemFeedback = {};
      if (response.content_groups) {
        let globalIndex = 0;
        response.content_groups.forEach((group) => {
          group.submissions.forEach((sub) => {
            // 只要有 feedback 或 passed 欄位存在（不管是什麼值），都載入
            if (sub.feedback !== undefined || sub.passed !== undefined) {
              loadedFeedbacks[globalIndex] = {
                feedback: sub.feedback || "",
                passed: sub.passed ?? null,
              };
            }
            globalIndex++;
          });
        });
      } else if (response.submissions) {
        response.submissions.forEach((sub, index) => {
          // 只要有 feedback 或 passed 欄位存在（不管是什麼值），都載入
          if (sub.feedback !== undefined || sub.passed !== undefined) {
            loadedFeedbacks[index] = {
              feedback: sub.feedback || "",
              passed: sub.passed ?? null,
            };
          }
        });
      }
      setItemFeedbacks(loadedFeedbacks);
      setSelectedGroupIndex(0);
      setExpandedRows(new Set());
    } catch (error) {
      console.error("Failed to load submission:", error);
      toast.error(t("gradingPage.messages.loadError"));
    } finally {
      setLoading(false);
    }
  };

  const performAutoSave = async (feedbacksToSave?: typeof itemFeedbacks) => {
    if (!submission || submitting) return;

    setSaveStatus("saving");
    try {
      const feedbacks = feedbacksToSave || itemFeedbacks;

      const itemResults: Array<{
        item_index: number;
        feedback: string;
        passed: boolean | null;
        score: number;
      }> = [];
      Object.entries(feedbacks).forEach(([index, fb]) => {
        itemResults.push({
          item_index: parseInt(index),
          feedback: fb.feedback || "",
          passed: fb.passed,
          score: fb.passed === true ? 100 : fb.passed === false ? 60 : 0,
        });
      });

      const payload = {
        student_id: parseInt(studentId!),
        score: score ?? 0,
        feedback: feedback || "",
        item_results: itemResults,
        update_status: false,
      };

      await apiClient.post(
        `/api/teachers/assignments/${assignmentId}/grade`,
        payload,
      );

      setSaveStatus("saved");
      setLastSavedTime(new Date());

      // 3 秒後清除「已儲存」狀態
      setTimeout(() => {
        setSaveStatus("idle");
      }, 3000);
    } catch (error) {
      console.error("Auto-save failed:", error);
      setSaveStatus("error");
    }
  };

  // 檢查錄音狀態（只標記無錄音的題目）- 處理所有題目
  const handleCheckRecordings = async () => {
    if (!submission) return;

    const newFeedbacks = { ...itemFeedbacks };
    let noRecordingCount = 0;
    let totalQuestions = 0;

    // 處理所有題組
    if (submission.content_groups) {
      let globalIndex = 0;
      submission.content_groups.forEach((group) => {
        group.submissions.forEach((item) => {
          totalQuestions++;
          const hasRecording = !!item.audio_url;

          if (!hasRecording) {
            // 沒錄音 → ✗
            newFeedbacks[globalIndex] = {
              passed: false,
              feedback:
                newFeedbacks[globalIndex]?.feedback ||
                t("gradingPage.messages.noRecordingPleaseResubmit"),
            };
            noRecordingCount++;
          } else {
            // 有錄音 → 移除 passed 狀態（不打勾也不打叉）
            if (newFeedbacks[globalIndex]) {
              const currentFeedback = newFeedbacks[globalIndex];
              newFeedbacks[globalIndex] = {
                passed: null,
                feedback: currentFeedback.feedback || "",
              };
            }
          }
          globalIndex++;
        });
      });
    } else if (submission.submissions) {
      // 處理沒有分組的情況
      submission.submissions.forEach((item, index) => {
        totalQuestions++;
        const hasRecording = !!item.audio_url;

        if (!hasRecording) {
          newFeedbacks[index] = {
            passed: false,
            feedback:
              newFeedbacks[index]?.feedback ||
              t("gradingPage.messages.noRecordingPleaseResubmit"),
          };
          noRecordingCount++;
        } else {
          // 有錄音 → 移除 passed 狀態
          if (newFeedbacks[index]) {
            const currentFeedback = newFeedbacks[index];
            newFeedbacks[index] = {
              passed: null,
              feedback: currentFeedback.feedback || "",
            };
          }
        }
      });
    }

    setItemFeedbacks(newFeedbacks);

    // 立即儲存 - 傳入最新的 feedbacks
    await performAutoSave(newFeedbacks);

    // 顯示結果
    if (noRecordingCount === 0) {
      toast.success(
        t("gradingPage.messages.allRecorded", { count: totalQuestions }),
        {
          duration: 3000,
        },
      );
    } else {
      toast.warning(
        t("gradingPage.messages.missingRecordings", {
          count: noRecordingCount,
        }),
        {
          duration: 3000,
        },
      );
    }
  };

  const handleReanalyzeItem = async (itemProgressId: number) => {
    if (!assignmentId) return;

    setReanalyzingItems((prev) => new Set(prev).add(itemProgressId));

    try {
      const response = (await apiClient.post(
        `/api/teachers/assignments/${assignmentId}/reanalyze-item/${itemProgressId}`,
      )) as { success: boolean; ai_scores: SubmissionItem["ai_scores"] };

      if (response.success && submission) {
        const updatedSubmissions = submission.submissions.map(
          (item: SubmissionItem) =>
            item.item_progress_id === itemProgressId
              ? { ...item, ai_scores: response.ai_scores }
              : item,
        );
        const updatedGroups = submission.content_groups?.map(
          (
            group: NonNullable<StudentSubmission["content_groups"]>[number],
          ) => ({
            ...group,
            submissions: group.submissions.map((item: SubmissionItem) =>
              item.item_progress_id === itemProgressId
                ? { ...item, ai_scores: response.ai_scores }
                : item,
            ),
          }),
        );
        setSubmission({
          ...submission,
          submissions: updatedSubmissions,
          content_groups: updatedGroups,
        });
        toast.success(t("gradingPage.messages.reanalyzeSuccess"));
      } else {
        toast.error(t("gradingPage.messages.reanalyzeFailed"));
      }
    } catch {
      toast.error(t("gradingPage.messages.reanalyzeFailed"));
    } finally {
      setReanalyzingItems((prev) => {
        const next = new Set(prev);
        next.delete(itemProgressId);
        return next;
      });
    }
  };

  // 套用 AI 建議 - 調用 batch-grade API
  const handleApplyAISuggestions = async () => {
    if (!submission || !studentId) return;

    try {
      // Show loading toast
      const loadingToast = toast.loading(t("gradingPage.messages.aiGrading"));

      // Call batch-grade API with single student
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
        processed: number;
        results: BatchGradingResult[];
      }

      const response = await apiClient.post<BatchGradingResponse>(
        `/api/teachers/assignments/${assignmentId}/batch-grade`,
        {
          classroom_id: classroomId,
          student_ids: [parseInt(studentId)],
        },
      );

      // Dismiss loading toast
      toast.dismiss(loadingToast);

      if (response.results.length === 0) {
        toast.error(t("gradingPage.messages.noStudentToGrade"));
        return;
      }

      // Get the result for current student
      const result = response.results[0];

      // Update score and feedback (round to 1 decimal place)
      setScore(Math.round(result.total_score * 10) / 10);
      setFeedback(result.feedback || "");
      setIsAutoCalculatedScore(true);

      // Reload submission to get updated item feedbacks
      await loadSubmission();

      toast.success(t("gradingPage.messages.aiGradingComplete"));
    } catch (error) {
      console.error("AI grading failed:", error);
      toast.error(t("gradingPage.messages.aiGradingFailed"));
    }
  };

  const handleCompleteGrading = async () => {
    if (!submission) return;

    try {
      setSubmitting(true);

      const itemResults: Array<{
        item_index: number;
        feedback: string;
        passed: boolean | null;
        score: number;
      }> = [];
      Object.entries(itemFeedbacks).forEach(([index, fb]) => {
        itemResults.push({
          item_index: parseInt(index),
          feedback: fb.feedback || "",
          passed: fb.passed,
          score: fb.passed === true ? 100 : fb.passed === false ? 60 : 0,
        });
      });

      await apiClient.post(`/api/teachers/assignments/${assignmentId}/grade`, {
        student_id: parseInt(studentId!),
        score: score ?? 0,
        feedback: feedback || "",
        item_results: itemResults,
        update_status: true,
      });

      toast.success(t("gradingPage.messages.gradingSuccess"));

      if (submission) {
        submission.status = "GRADED";
      }

      setStudentList((prev) =>
        prev.map((student) =>
          student.student_id === parseInt(studentId!)
            ? { ...student, status: "GRADED", score: score ?? null }
            : student,
        ),
      );

      const assignedStudents = studentList.filter(
        (s) => s.status && s.status !== "NOT_ASSIGNED",
      );
      const currentAssignedIndex = assignedStudents.findIndex(
        (s) => s.student_id === parseInt(studentId!),
      );

      if (currentAssignedIndex < assignedStudents.length - 1) {
        await handleNextStudent();
      }
    } catch (error) {
      console.error("Failed to complete grading:", error);
      toast.error(t("gradingPage.messages.gradingFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestRevision = async () => {
    if (!submission) return;

    try {
      setSubmitting(true);

      await apiClient.post(
        `/api/teachers/assignments/${assignmentId}/return-for-revision`,
        {
          student_id: parseInt(studentId!),
          message: t("gradingPage.messages.pleaseRevise"),
        },
      );

      toast.success(t("gradingPage.messages.revisionRequested"));

      if (submission) {
        submission.status = "RETURNED";
      }

      setStudentList((prev) =>
        prev.map((student) =>
          student.student_id === parseInt(studentId!)
            ? { ...student, status: "RETURNED" }
            : student,
        ),
      );

      await loadSubmission();
    } catch (error) {
      console.error("Failed to request revision:", error);
      toast.error(t("gradingPage.messages.revisionFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePreviousStudent = async () => {
    const assignedStudents = studentList.filter(
      (s) => s.status && s.status !== "NOT_ASSIGNED",
    );
    const currentAssignedIndex = assignedStudents.findIndex(
      (s) => s.student_id === parseInt(studentId || "0"),
    );

    if (currentAssignedIndex > 0) {
      const prevStudent = assignedStudents[currentAssignedIndex - 1];
      setSearchParams({ studentId: (prevStudent.student_id || 0).toString() });
    }
  };

  const handleNextStudent = async () => {
    const assignedStudents = studentList.filter(
      (s) => s.status && s.status !== "NOT_ASSIGNED",
    );
    const currentAssignedIndex = assignedStudents.findIndex(
      (s) => s.student_id === parseInt(studentId || "0"),
    );

    if (currentAssignedIndex < assignedStudents.length - 1) {
      const nextStudent = assignedStudents[currentAssignedIndex + 1];
      setSearchParams({ studentId: (nextStudent.student_id || 0).toString() });
    }
  };

  const handleStudentSelect = async (student: StudentListItem) => {
    setSearchParams({ studentId: (student.student_id || 0).toString() });
    setActiveTab("content"); // 選擇學生後自動切換到題組 tab
  };

  // 取得當前題組
  const getCurrentGroup = () => {
    if (!submission?.content_groups) return null;
    return submission.content_groups[selectedGroupIndex];
  };

  // 計算題組的起始 global index
  const getGroupBaseIndex = (groupIndex: number) => {
    if (!submission?.content_groups) return 0;
    let baseIndex = 0;
    for (let i = 0; i < groupIndex; i++) {
      baseIndex += submission.content_groups[i].submissions.length;
    }
    return baseIndex;
  };

  // 切換行展開/收合
  const toggleRowExpanded = (rowIndex: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(rowIndex)) {
      newExpanded.delete(rowIndex);
    } else {
      newExpanded.add(rowIndex);
    }
    setExpandedRows(newExpanded);
  };

  // 計算總題數
  const getTotalQuestions = () => {
    if (submission?.content_groups && submission.content_groups.length > 0) {
      return submission.content_groups.reduce(
        (sum, group) => sum + group.submissions.length,
        0,
      );
    }
    return submission?.submissions?.length || 0;
  };

  const totalQuestions = getTotalQuestions();
  const currentGroup = getCurrentGroup();
  const baseGlobalIndex = getGroupBaseIndex(selectedGroupIndex);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-2">
            <div className="flex items-center gap-1 sm:gap-4 flex-1 min-w-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  navigate(
                    `/teacher/classroom/${classroomId}/assignment/${assignmentId}`,
                  )
                }
                className="flex-shrink-0"
              >
                <ArrowLeft className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{t("common.back")}</span>
              </Button>
              <div className="border-l h-8 mx-1 hidden md:block"></div>
              <div className="flex flex-col min-w-0 flex-1">
                <h1 className="text-sm sm:text-lg md:text-xl font-semibold truncate">
                  <span className="hidden sm:inline">
                    {t("gradingPage.labels.gradingAssignment")}{" "}
                  </span>
                  {assignmentTitle}
                </h1>
                {submission && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <TrafficLightDot status={submission.status} size={12} />
                    <User className="h-3 w-3 text-gray-500" />
                    <span className="text-xs sm:text-sm text-gray-600 font-medium">
                      {submission.student_name}
                    </span>
                  </div>
                )}
              </div>

              {/* 儲存狀態指示器 */}
              {saveStatus !== "idle" && (
                <div className="ml-2 sm:ml-4 hidden sm:block">
                  {saveStatus === "saving" && (
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <div className="animate-spin rounded-full h-3 w-3 border-b border-gray-500"></div>
                      {t("gradingPage.messages.saving")}
                    </span>
                  )}
                  {saveStatus === "saved" && lastSavedTime && (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      {t("gradingPage.messages.saved")}{" "}
                      {lastSavedTime.toLocaleTimeString("zh-TW")}
                    </span>
                  )}
                  {saveStatus === "error" && (
                    <span className="text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {t("gradingPage.messages.saveFailed")}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* 學生切換導航 */}
            <div className="flex items-center gap-1 sm:gap-4 flex-shrink-0">
              {(() => {
                const assignedStudents = studentList.filter(
                  (s) => s.status && s.status !== "NOT_ASSIGNED",
                );
                const currentAssignedIndex = assignedStudents.findIndex(
                  (s) => s.student_id === parseInt(studentId || "0"),
                );
                const isCurrentStudentAssigned = currentAssignedIndex !== -1;

                return (
                  <>
                    <span className="text-xs sm:text-sm text-gray-500 hidden md:inline">
                      {isCurrentStudentAssigned
                        ? `${currentAssignedIndex + 1} / ${assignedStudents.length} 位已指派學生`
                        : `未指派學生 (${assignedStudents.length} 位已指派)`}
                    </span>
                    <span className="text-xs text-gray-500 md:hidden">
                      {isCurrentStudentAssigned
                        ? `${currentAssignedIndex + 1} / ${assignedStudents.length}`
                        : `-`}
                    </span>
                    <div className="flex gap-0 sm:gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handlePreviousStudent}
                        disabled={
                          !isCurrentStudentAssigned ||
                          currentAssignedIndex === 0
                        }
                        className="h-8 w-8 sm:h-10 sm:w-10"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleNextStudent}
                        disabled={
                          !isCurrentStudentAssigned ||
                          currentAssignedIndex === assignedStudents.length - 1
                        }
                        className="h-8 w-8 sm:h-10 sm:w-10"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Tab 導航 */}
      <div className="bg-white border-b lg:hidden sticky top-16 z-10 shadow-sm">
        <div className="max-w-full mx-auto px-4">
          <div className="flex">
            <button
              onClick={() => setActiveTab("students")}
              className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "students"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t("gradingPage.tabs.students")}
            </button>
            <button
              onClick={() => setActiveTab("content")}
              className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "content"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t("gradingPage.tabs.questions")}
            </button>
            <button
              onClick={() => setActiveTab("grading")}
              className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "grading"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t("gradingPage.tabs.overallReview")}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-12 gap-4">
          {/* 左側 - 學生列表 */}
          <div
            className={`col-span-12 lg:col-span-2 ${activeTab === "students" ? "block" : "hidden lg:block"}`}
          >
            <Card className="p-3">
              <h3 className="text-sm font-medium mb-3 flex items-center justify-between text-gray-700">
                <div className="flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  <span>{t("gradingPage.labels.students")}</span>
                </div>
                <span className="text-xs text-gray-500">
                  (
                  {
                    studentList.filter(
                      (s) => s.status && s.status !== "NOT_ASSIGNED",
                    ).length
                  }
                  /{studentList.length})
                </span>
              </h3>
              <StatusLegend columns={1} />
              <div className="space-y-1 mt-3">
                {studentList.map((student) => {
                  // Not yet assigned OR assigned but not started → nothing to grade, disable
                  const isClickable =
                    !!student.status &&
                    student.status !== "NOT_ASSIGNED" &&
                    student.status !== "NOT_STARTED";

                  return (
                    <button
                      key={student.student_id}
                      onClick={() =>
                        isClickable && handleStudentSelect(student)
                      }
                      disabled={!isClickable}
                      className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
                        !isClickable
                          ? "opacity-50 cursor-not-allowed bg-gray-50"
                          : student.student_id === parseInt(studentId!)
                            ? "bg-blue-100 text-blue-700"
                            : "hover:bg-gray-100"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <TrafficLightDot status={student.status} size={12} />
                        <span className="truncate font-medium flex-1">
                          {student.student_name}
                        </span>
                        {student.score != null && (
                          <span className="text-xs font-bold text-gray-700 shrink-0 tabular-nums">
                            {(Math.round(student.score * 10) / 10).toFixed(1)}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* 中間 - 題組內容 */}
          <div
            className={`col-span-12 lg:col-span-6 ${activeTab === "content" ? "block" : "hidden lg:block"}`}
          >
            {submission ? (
              <div className="space-y-3">
                {/* 桌機版操作按鈕 */}
                <div className="hidden lg:flex items-center gap-2 mb-3">
                  <Button
                    size="sm"
                    onClick={handleCheckRecordings}
                    className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-700 dark:text-white"
                  >
                    <Search className="h-4 w-4" />
                    {t("gradingPage.buttons.checkRecording")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleApplyAISuggestions}
                    className="flex items-center gap-1 bg-purple-600 hover:bg-purple-700 text-white dark:bg-purple-600 dark:hover:bg-purple-700 dark:text-white"
                  >
                    <Sparkles className="h-4 w-4" />
                    {t("gradingPage.buttons.applyAISuggestions")}
                  </Button>
                  {/* 題組選擇器 */}
                  {submission.content_groups &&
                    submission.content_groups.length > 1 && (
                      <>
                        <span className="text-sm font-medium whitespace-nowrap">
                          {t("gradingPage.labels.groupTitle")}
                        </span>
                        <select
                          value={selectedGroupIndex}
                          onChange={(e) => {
                            setSelectedGroupIndex(parseInt(e.target.value));
                            setActiveTab("content");
                          }}
                          className="border rounded-md px-3 py-1.5 text-sm"
                        >
                          {submission.content_groups.map((group, index) => (
                            <option key={group.content_id} value={index}>
                              {group.content_title} ({group.submissions.length}
                              題)
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                </div>

                {/* 手機版操作按鈕 */}
                <div className="lg:hidden sticky top-28 z-10 -mx-4 sm:-mx-6 mb-3">
                  <Card className="p-3 rounded-none sm:rounded-lg shadow-md">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={handleCheckRecordings}
                          className="flex-1 flex items-center justify-center gap-1 bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-700 dark:text-white"
                        >
                          <Search className="h-4 w-4" />
                          {t("gradingPage.labels.examineRecording")}
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleApplyAISuggestions}
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
                              onChange={(e) => {
                                setSelectedGroupIndex(parseInt(e.target.value));
                              }}
                              className="flex-1 border rounded-md px-3 py-1.5 text-sm bg-white"
                            >
                              {submission.content_groups.map((group, index) => (
                                <option key={group.content_id} value={index}>
                                  {group.content_title} (
                                  {group.submissions.length}題)
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                    </div>
                  </Card>
                </div>

                {/* 題目 Table */}
                {currentGroup && (
                  <Card className="p-4">
                    <div className="space-y-0 divide-y">
                      {currentGroup.submissions.map((item, localIndex) => {
                        const globalIndex = baseGlobalIndex + localIndex;
                        const isExpanded = expandedRows.has(globalIndex);
                        const itemFeedback = itemFeedbacks[globalIndex];

                        return (
                          <div
                            key={globalIndex}
                            id={`item-${globalIndex}`}
                            className="py-4"
                          >
                            {/* 主要行 */}
                            <div
                              className="md:grid md:grid-cols-12 flex flex-col gap-3 items-start cursor-pointer hover:bg-gray-50 rounded-lg p-2 -mx-2"
                              onClick={() => toggleRowExpanded(globalIndex)}
                            >
                              {/* 通過狀態 */}
                              <div
                                className="md:col-span-1 flex flex-row md:flex-col gap-2 md:gap-1 w-full md:w-auto"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Button
                                  size="sm"
                                  variant={
                                    itemFeedback?.passed === true
                                      ? "default"
                                      : "outline"
                                  }
                                  className={`w-full p-1 h-7 ${
                                    itemFeedback?.passed === true
                                      ? "bg-green-600 hover:bg-green-700"
                                      : ""
                                  }`}
                                  onClick={async () => {
                                    const newItemFeedbacks = {
                                      ...itemFeedbacks,
                                      [globalIndex]: {
                                        ...itemFeedbacks[globalIndex],
                                        feedback:
                                          itemFeedbacks[globalIndex]
                                            ?.feedback || "",
                                        passed: true,
                                      },
                                    };
                                    setItemFeedbacks(newItemFeedbacks);
                                    // 按鈕動作立即儲存
                                    await performAutoSave(newItemFeedbacks);
                                  }}
                                  disabled={submission?.status === "GRADED"}
                                >
                                  <CheckCircle className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant={
                                    itemFeedback?.passed === false
                                      ? "default"
                                      : "outline"
                                  }
                                  className={`w-full p-1 h-7 ${
                                    itemFeedback?.passed === false
                                      ? "bg-red-600 hover:bg-red-700"
                                      : ""
                                  }`}
                                  onClick={async () => {
                                    const newItemFeedbacks = {
                                      ...itemFeedbacks,
                                      [globalIndex]: {
                                        ...itemFeedbacks[globalIndex],
                                        feedback:
                                          itemFeedbacks[globalIndex]
                                            ?.feedback || "",
                                        passed: false,
                                      },
                                    };
                                    setItemFeedbacks(newItemFeedbacks);
                                    // 按鈕動作立即儲存
                                    await performAutoSave(newItemFeedbacks);
                                  }}
                                  disabled={submission?.status === "GRADED"}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>

                              {/* 題目 */}
                              <div className="md:col-span-4 w-full">
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

                              {/* 學生錄音 */}
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
                                    <span>
                                      {t("gradingPage.labels.noRecording")}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* 評語 */}
                              <div
                                className="md:col-span-4 w-full"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Textarea
                                  value={itemFeedback?.feedback || ""}
                                  onChange={(e) => {
                                    setItemFeedbacks({
                                      ...itemFeedbacks,
                                      [globalIndex]: {
                                        ...itemFeedbacks[globalIndex],
                                        feedback: e.target.value,
                                        passed:
                                          itemFeedbacks[globalIndex]?.passed ??
                                          null,
                                      },
                                    });
                                  }}
                                  onBlur={async () => {
                                    // 離開輸入框時立即儲存
                                    await performAutoSave();
                                  }}
                                  placeholder={t(
                                    "gradingPage.labels.feedbackPlaceholder",
                                  )}
                                  className="min-h-[60px] resize-none text-xs bg-white dark:bg-white"
                                  readOnly={submission?.status === "GRADED"}
                                  disabled={submission?.status === "GRADED"}
                                />
                              </div>

                              {/* 展開按鈕 */}
                              <div className="md:col-span-1 w-full md:w-auto flex justify-center">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleRowExpanded(globalIndex);
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

                            {/* 展開的詳細資訊 */}
                            {isExpanded && (
                              <div className="mt-3 pl-8 space-y-3">
                                {/* 參考音檔 */}
                                {item.question_audio_url && (
                                  <div>
                                    <label className="text-xs font-semibold text-gray-600 mb-1 block">
                                      {t("gradingPage.labels.referenceAudio")}
                                    </label>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        const audio = new Audio(
                                          item.question_audio_url!,
                                        );
                                        audio.play().catch((err) => {
                                          console.error(
                                            "Failed to play audio:",
                                            err,
                                          );
                                          toast.error(
                                            t(
                                              "gradingPage.messages.audioPlayError",
                                            ),
                                          );
                                        });
                                      }}
                                    >
                                      <Volume2 className="h-3 w-3 mr-1" />
                                      {t(
                                        "gradingPage.labels.playReferenceAudio",
                                      )}
                                    </Button>
                                  </div>
                                )}

                                {/* 語音辨識結果 */}
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

                                {/* AI 評分 */}
                                <div>
                                  <label className="text-xs font-semibold text-gray-600 mb-1 block">
                                    {t("gradingPage.labels.aiAutoScoring")}
                                  </label>

                                  {/* 🎯 Issue #118: 音檔上傳異常警告 */}
                                  {item.ai_scores?._metadata
                                    ?.audio_upload_status === "failed" && (
                                    <div className="flex items-center gap-2 text-amber-600 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg mb-2">
                                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                      <div>
                                        <p className="text-xs font-medium">
                                          {t(
                                            "gradingPage.messages.audioUploadFailed",
                                          )}
                                        </p>
                                        <p className="text-xs text-amber-500">
                                          {t(
                                            "gradingPage.messages.audioUploadFailedDetail",
                                          )}
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
                                      {item.audio_url &&
                                        item.item_progress_id && (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="mt-3 mx-auto flex"
                                            disabled={reanalyzingItems.has(
                                              item.item_progress_id,
                                            )}
                                            onClick={() =>
                                              handleReanalyzeItem(
                                                item.item_progress_id!,
                                              )
                                            }
                                          >
                                            {reanalyzingItems.has(
                                              item.item_progress_id,
                                            ) ? (
                                              <>
                                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                                {t(
                                                  "gradingPage.messages.reanalyzing",
                                                )}
                                              </>
                                            ) : (
                                              <>
                                                <Mic className="h-3 w-3 mr-1" />
                                                {t(
                                                  "gradingPage.buttons.reanalyze",
                                                )}
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
                      })}
                    </div>
                  </Card>
                )}
              </div>
            ) : (
              <div className="text-center text-gray-500">
                {t("gradingPage.messages.notFound")}
              </div>
            )}
          </div>

          {/* 右側 - 總評 */}
          <div
            className={`col-span-12 lg:col-span-4 ${activeTab === "grading" ? "block" : "hidden lg:block"}`}
          >
            <Card className="p-4 lg:sticky lg:top-24">
              {/* 手機版學生資訊 */}
              {submission && (
                <div className="mb-4 pb-4 border-b lg:hidden">
                  <div className="flex items-center gap-1.5">
                    <TrafficLightDot status={submission.status} size={14} />
                    <User className="h-4 w-4 text-gray-500" />
                    <span className="font-medium">
                      {submission.student_name}
                    </span>
                  </div>
                </div>
              )}
              <h4 className="font-medium text-sm mb-3">
                {t("gradingPage.labels.overallFeedback")}
              </h4>

              <div className="space-y-3">
                {/* 逐題燈號（分題組） */}
                {submission && submission.content_groups && (
                  <div className="pb-3 border-b space-y-3">
                    <label className="text-xs font-medium block">
                      {t("gradingPage.labels.itemStatus")} ({totalQuestions} 題)
                    </label>
                    {submission.content_groups.map((group, groupIndex) => {
                      // Calculate base index for this group
                      let groupBaseIndex = 0;
                      for (let i = 0; i < groupIndex; i++) {
                        groupBaseIndex +=
                          submission.content_groups![i].submissions.length;
                      }

                      return (
                        <div key={group.content_id} className="space-y-1">
                          <div className="text-xs text-gray-600 font-medium">
                            {group.content_title} ({group.submissions.length}{" "}
                            題)
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
                                  title={`題目 ${localIndex + 1}: ${isPassed ? t("gradingPage.labels.passed") : isFailed ? t("gradingPage.labels.needsRevision") : hasRecording ? t("gradingPage.labels.hasRecording") : t("gradingPage.labels.noRecording")}`}
                                  onClick={() => {
                                    // 切換到對應題組
                                    setSelectedGroupIndex(groupIndex);
                                    // 展開對應題目
                                    const newExpanded = new Set(expandedRows);
                                    newExpanded.add(globalIndex);
                                    setExpandedRows(newExpanded);
                                    // 切換到內容 tab（手機版）
                                    setActiveTab("content");
                                    // 滾動到對應題目
                                    requestAnimationFrame(() => {
                                      document
                                        .getElementById(`item-${globalIndex}`)
                                        ?.scrollIntoView({
                                          behavior: "smooth",
                                          block: "center",
                                        });
                                    });
                                  }}
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

                {/* 分數評定 — 老師直接填分數，不填就是未評分 */}
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    {t("gradingPage.labels.giveScore")}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={score === null ? "" : score}
                    onBlur={async () => {
                      // 離開輸入框時立即儲存
                      await performAutoSave();
                    }}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === "") {
                        setScore(null);
                        setIsAutoCalculatedScore(false);
                      } else if (/^\d+(\.\d{0,1})?$/.test(value)) {
                        const numValue = parseFloat(value);
                        if (numValue >= 0 && numValue <= 100) {
                          setScore(numValue);
                          setIsAutoCalculatedScore(false);
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

                {/* 總評語回饋 */}
                <div>
                  <label className="text-xs font-medium mb-2 block">
                    {t("gradingPage.labels.overallFeedback")}
                  </label>
                  <Textarea
                    value={feedback}
                    onChange={(e) => {
                      setFeedback(e.target.value);
                    }}
                    onBlur={async () => {
                      // 離開輸入框時立即儲存
                      await performAutoSave();
                    }}
                    placeholder={t("gradingPage.labels.overallEncouragement")}
                    rows={4}
                    className="resize-none text-sm bg-white dark:bg-white"
                  />
                </div>

                {/* 操作按鈕 */}
                <div className="space-y-4 pt-4 border-t">
                  {/* 狀態流程提示 */}
                  <div className="text-center text-xs text-gray-500">
                    {t("gradingPage.labels.selectGradingStatus")}
                  </div>

                  {/* 狀態選擇按鈕 */}
                  <div className="flex gap-2">
                    {/* 要求訂正 */}
                    <Button
                      onClick={handleRequestRevision}
                      disabled={submitting || !submission}
                      variant={
                        submission?.status === "RETURNED"
                          ? "default"
                          : "outline"
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

                    {/* 已完成 */}
                    <Button
                      onClick={handleCompleteGrading}
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
        </div>
      </div>
    </div>
  );
}
