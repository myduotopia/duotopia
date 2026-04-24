/**
 * GradingPage - 教師批改單一學生作業的頁面
 *
 * ⚠️ 架構慣例：本頁採「同路由 + practice_mode 分流」模式。
 *    - 所有作業類型（例句朗讀、例句重組、單字朗讀、單字選擇、...）共用此頁。
 *    - Header / 左欄 / 右欄 = 作業類型不可知（Assignment-type agnostic）的共用元件，
 *      位於 src/components/grading/，**不要**依作業類型改它們的行為。
 *    - 中間欄 = 作業類型專屬 Panel，依 submission.practice_mode 選擇。
 *
 * 新增作業類型 / 修改此分流邏輯前請先閱讀：
 *   docs/design/grading-page-architecture.md
 */

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import { Assignment } from "@/types";
import {
  GradingHeader,
  StudentListPanel,
  OverallFeedbackPanel,
  ReadingAssessmentPanel,
  SentenceRearrangementPanel,
} from "@/components/grading";

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

export interface RearrangementSelection {
  position?: number;
  selected?: string;
  correct?: string;
  is_correct?: boolean;
  timestamp?: string;
}

export interface RearrangementData {
  selections?: RearrangementSelection[];
  retries?: number;
  completed_at?: string;
  timeout?: boolean;
}

export interface SubmissionItem {
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
  rearrangement_data?: RearrangementData;
  error_count?: number;
  correct_word_count?: number;
  retry_count?: number;
  expected_score?: number | null;
  timeout_ended?: boolean;
  max_errors?: number | null;
  item_status?: string;
  completed_at?: string | null;
}

export type PracticeMode =
  | "reading"
  | "rearrangement"
  | "word_reading"
  | "word_selection";

export interface StudentSubmission {
  student_number: number;
  student_name: string;
  student_email: string;
  status: string;
  submitted_at?: string;
  content_type: string;
  practice_mode?: PracticeMode;
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

export interface ItemFeedback {
  [key: number]: {
    feedback: string;
    passed: boolean | null;
  };
}

export interface StudentListItem {
  student_id: number;
  student_name: string;
  status: string;
  score?: number | null;
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

// 自動評分模式：系統在學生完成當下就算好分數，批改頁對這類作業不跑「老師手動點 +
// autosave」那套狀態機；✓/✗ 由 render-time 從 item 資料推導。
const isAutoScoredMode = (mode?: string) => mode === "rearrangement";

const deriveAutoPassed = (item: SubmissionItem): boolean | null => {
  if (item.item_status !== "COMPLETED") return null;
  if (item.expected_score == null) return null;
  return item.expected_score >= 60;
};

const computeDerivedFeedbacks = (
  submission: StudentSubmission | null,
): ItemFeedback => {
  if (!submission) return {};
  const result: ItemFeedback = {};
  let globalIndex = 0;
  const groups = submission.content_groups;
  if (groups) {
    groups.forEach((group) => {
      group.submissions.forEach((item) => {
        result[globalIndex] = {
          feedback: "",
          passed: deriveAutoPassed(item),
        };
        globalIndex++;
      });
    });
  } else {
    submission.submissions.forEach((item, index) => {
      result[index] = {
        feedback: "",
        passed: deriveAutoPassed(item),
      };
    });
  }
  return result;
};

export default function GradingPage() {
  const { t } = useTranslation();
  const { classroomId, assignmentId } = useParams<{
    classroomId: string;
    assignmentId: string;
  }>();
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

      // 載入個別題目老師手動批改的結果
      // 自動評分模式（如 rearrangement）不走這套 state，✓/✗ 由 panel render-time
      // 從 item 資料推導；右欄 summary 由 computeDerivedFeedbacks 另外算。
      const loadedFeedbacks: ItemFeedback = {};
      if (response.content_groups) {
        let globalIndex = 0;
        response.content_groups.forEach((group) => {
          group.submissions.forEach((sub) => {
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
    // 自動評分模式（如 rearrangement）沒有手動批改可存，直接 no-op
    if (isAutoScoredMode(submission.practice_mode)) return;

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

  const toggleRowExpanded = (rowIndex: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(rowIndex)) {
      newExpanded.delete(rowIndex);
    } else {
      newExpanded.add(rowIndex);
    }
    setExpandedRows(newExpanded);
  };

  const handleTogglePassed = async (globalIndex: number, passed: boolean) => {
    const newItemFeedbacks = {
      ...itemFeedbacks,
      [globalIndex]: {
        ...itemFeedbacks[globalIndex],
        feedback: itemFeedbacks[globalIndex]?.feedback || "",
        passed,
      },
    };
    setItemFeedbacks(newItemFeedbacks);
    await performAutoSave(newItemFeedbacks);
  };

  const handleItemFeedbackChange = (globalIndex: number, value: string) => {
    setItemFeedbacks({
      ...itemFeedbacks,
      [globalIndex]: {
        ...itemFeedbacks[globalIndex],
        feedback: value,
        passed: itemFeedbacks[globalIndex]?.passed ?? null,
      },
    });
  };

  const handleJumpToItem = (groupIndex: number, globalIndex: number) => {
    setSelectedGroupIndex(groupIndex);
    const newExpanded = new Set(expandedRows);
    newExpanded.add(globalIndex);
    setExpandedRows(newExpanded);
    setActiveTab("content");
    requestAnimationFrame(() => {
      document.getElementById(`item-${globalIndex}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  };

  const totalQuestions = submission?.content_groups?.length
    ? submission.content_groups.reduce(
        (sum, group) => sum + group.submissions.length,
        0,
      )
    : submission?.submissions?.length || 0;

  // 右欄 summary 小格子要能和中間欄顯示一致：
  // - 自動評分模式 → 從 item 資料推導 passed（不進 itemFeedbacks state）
  // - 手動批改模式 → 直接沿用 itemFeedbacks
  const feedbacksForDisplay: ItemFeedback = isAutoScoredMode(
    submission?.practice_mode,
  )
    ? computeDerivedFeedbacks(submission)
    : itemFeedbacks;

  const renderContentPanel = () => {
    if (!submission) {
      return (
        <div className="col-span-12 lg:col-span-6">
          <div className="text-center text-gray-500">
            {t("gradingPage.messages.notFound")}
          </div>
        </div>
      );
    }

    const panelProps = {
      submission,
      selectedGroupIndex,
      expandedRows,
      itemFeedbacks,
      activeTab,
      onSelectGroup: (idx: number) => {
        setSelectedGroupIndex(idx);
        setActiveTab("content");
      },
      onToggleRow: toggleRowExpanded,
      onTogglePassed: handleTogglePassed,
      onItemFeedbackChange: handleItemFeedbackChange,
      onAutoSave: () => performAutoSave(),
    };

    if (submission.practice_mode === "rearrangement") {
      return <SentenceRearrangementPanel {...panelProps} />;
    }

    return (
      <ReadingAssessmentPanel
        {...panelProps}
        reanalyzingItems={reanalyzingItems}
        onCheckRecordings={handleCheckRecordings}
        onApplyAISuggestions={handleApplyAISuggestions}
        onReanalyzeItem={handleReanalyzeItem}
      />
    );
  };

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
      <GradingHeader
        assignmentTitle={assignmentTitle}
        submission={submission}
        saveStatus={saveStatus}
        lastSavedTime={lastSavedTime}
        students={studentList}
        currentStudentId={studentId}
        classroomId={classroomId}
        assignmentId={assignmentId}
        onPreviousStudent={handlePreviousStudent}
        onNextStudent={handleNextStudent}
      />

      {/* Tab 導航（手機版）*/}
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
          <StudentListPanel
            students={studentList}
            currentStudentId={studentId}
            onSelect={handleStudentSelect}
            activeTab={activeTab}
          />

          {renderContentPanel()}

          <OverallFeedbackPanel
            submission={submission}
            score={score}
            feedback={feedback}
            itemFeedbacks={feedbacksForDisplay}
            isAutoCalculatedScore={isAutoCalculatedScore}
            submitting={submitting}
            activeTab={activeTab}
            totalQuestions={totalQuestions}
            onScoreChange={(v) => {
              setScore(v);
              setIsAutoCalculatedScore(false);
            }}
            onFeedbackChange={setFeedback}
            onAutoSave={() => performAutoSave()}
            onComplete={handleCompleteGrading}
            onRequestRevision={
              isAutoScoredMode(submission?.practice_mode)
                ? undefined
                : handleRequestRevision
            }
            onJumpToItem={handleJumpToItem}
          />
        </div>
      </div>
    </div>
  );
}
