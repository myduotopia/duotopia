import { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import StudentTable, { Student } from "@/components/StudentTable";
import { StudentDialogs } from "@/components/StudentDialogs";
import { ProgramDialog } from "@/components/ProgramDialog";
import { LessonDialog } from "@/components/LessonDialog";
import CreateProgramDialog from "@/components/CreateProgramDialog";
import ContentTypeDialog from "@/components/ContentTypeDialog";
import ReadingAssessmentPanel from "@/components/ReadingAssessmentPanel";
import VocabularySetPanel from "@/components/VocabularySetPanel";
import { AssignmentDialog } from "@/components/AssignmentDialog";
import BatchGradingModal from "@/components/BatchGradingModal";
import { StudentCompletionDashboard } from "@/components/StudentCompletionDashboard";
import { RecursiveTreeAccordion } from "@/components/shared/RecursiveTreeAccordion";
import { programTreeConfig } from "@/components/shared/programTreeConfig";
import {
  ArrowLeft,
  Users,
  BookOpen,
  Plus,
  Edit,
  FileText,
  X,
  Save,
  Mic,
  Trash2,
  Sparkles,
  Eye,
  Archive,
  ArchiveRestore,
  Search,
  StickyNote,
  Printer,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { getContentTypeIcon } from "@/lib/contentTypeIcon";
import { apiClient, ApiError } from "@/lib/api";
import { toast } from "sonner";
import AssignmentStickyNote from "@/components/AssignmentStickyNote";
import {
  buildStickyNotePageHtml,
  openPrintWindow,
} from "@/lib/stickyNotePrint";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import {
  Content,
  Assignment,
  Lesson,
  Program,
  ClassroomInfo,
  ContentItem,
  DialogType,
} from "@/types";

// Type compatibility for ReadingAssessmentPanel
interface ReadingAssessmentContent {
  id?: number;
  title?: string;
  items?: Array<{
    id: string | number;
    text: string;
    definition: string;
    audioUrl?: string;
    audio_url?: string;
    translation?: string;
    audioSettings?: {
      accent: string;
      gender: string;
      speed: string;
    };
  }>;
  target_wpm?: number;
  target_accuracy?: number;
  time_limit_seconds?: number;
}

interface ClassroomDetailProps {
  isTemplateMode?: boolean;
}

export default function ClassroomDetail({
  isTemplateMode = false,
}: ClassroomDetailProps) {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { mode } = useWorkspace();
  const isOrgMode = mode === "organization";
  const [classroom, setClassroom] = useState<ClassroomInfo | null>(null);
  const [templateProgram, setTemplateProgram] = useState<Program | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(
    isTemplateMode ? "programs" : "students",
  );
  // Track if we've initialized the tab based on student count
  const [hasInitializedTab, setHasInitializedTab] = useState(false);

  // Teacher subscription state
  const [canAssignHomework, setCanAssignHomework] = useState<boolean>(false);
  const [canUseAiGrading, setCanUseAiGrading] = useState<boolean>(true);
  const [teacherData, setTeacherData] = useState<{
    subscription_status?: string;
    days_remaining?: number;
  } | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [selectedContent, setSelectedContent] = useState<Content | null>(null);
  const [editingContent, setEditingContent] = useState<Content | null>(null);

  // Student dialog states
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [dialogType, setDialogType] = useState<DialogType>(null);

  // Program dialog states
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null);
  const [programDialogType, setProgramDialogType] = useState<
    "create" | "edit" | "delete" | null
  >(null);

  // Lesson dialog states
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [lessonDialogType, setLessonDialogType] = useState<
    "create" | "edit" | "delete" | null
  >(null);
  const [lessonProgramId, setLessonProgramId] = useState<number | undefined>(
    undefined,
  );

  // Copy program dialog state
  const [showCopyDialog, setShowCopyDialog] = useState(false);

  // Content type dialog state
  const [showContentTypeDialog, setShowContentTypeDialog] = useState(false);
  const [contentLessonInfo, setContentLessonInfo] = useState<{
    programName: string;
    lessonName: string;
    lessonId: number;
  } | null>(null);

  // Reading Assessment Editor state
  const [showReadingEditor, setShowReadingEditor] = useState(false);
  const [editorLessonId, setEditorLessonId] = useState<number | null>(null);
  const [editorContentId, setEditorContentId] = useState<number | null>(null);

  // Vocabulary Set Editor state
  const [showVocabularySetEditor, setShowVocabularySetEditor] = useState(false);
  const [vocabularySetLessonId, setVocabularySetLessonId] = useState<
    number | null
  >(null);
  const [vocabularySetContentId, setVocabularySetContentId] = useState<
    number | null
  >(null);

  // Assignment states
  const [showAssignmentDialog, setShowAssignmentDialog] = useState(false);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignmentsLoaded, setAssignmentsLoaded] = useState(false);
  const [selectedAssignment] = useState<Assignment | null>(null);
  const [showAssignmentDetails, setShowAssignmentDetails] = useState(false);
  // Filter states
  const [filterKeyword, setFilterKeyword] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterOverdue, setFilterOverdue] = useState(false);

  // Filter type → practice_mode mapping
  const filterTypeMap: Record<string, string> = {
    WORD_READING: "word_reading",
    WORD_SELECTION: "word_selection",
    SPEAKING: "reading",
    REARRANGEMENT: "rearrangement",
  };

  // Archive states
  const [showArchived, setShowArchived] = useState(false);
  const [archivedAssignments, setArchivedAssignments] = useState<Assignment[]>(
    [],
  );
  const filteredAssignments = (
    showArchived ? archivedAssignments : assignments
  ).filter((a) => {
    if (
      filterKeyword &&
      !a.title.toLowerCase().includes(filterKeyword.toLowerCase())
    )
      return false;
    if (filterType && a.practice_mode !== filterTypeMap[filterType])
      return false;
    if (filterDateFrom && a.created_at) {
      if (new Date(a.created_at) < new Date(filterDateFrom)) return false;
    }
    if (filterDateTo && a.created_at) {
      const endOfDay = new Date(filterDateTo);
      endOfDay.setHours(23, 59, 59, 999);
      if (new Date(a.created_at) > endOfDay) return false;
    }
    if (filterOverdue) {
      if (!a.due_date || new Date(a.due_date) >= new Date()) return false;
    }
    return true;
  });

  const [batchGradingModal, setBatchGradingModal] = useState({
    open: false,
    assignmentId: 0,
    classroomId: 0,
  });
  // Sticky note modal state
  const [stickyNoteModal, setStickyNoteModal] = useState({
    open: false,
    assignmentIndex: 0,
  });
  // Batch print selection
  const [selectedForPrint, setSelectedForPrint] = useState<Set<number>>(
    new Set(),
  );
  const [batchPrinting, setBatchPrinting] = useState(false);

  // Pagination (on filtered results)
  const [assignmentPage, setAssignmentPage] = useState(1);
  const assignmentPageSize = 10;
  const totalAssignmentPages = Math.ceil(
    filteredAssignments.length / assignmentPageSize,
  );
  const paginatedAssignments = filteredAssignments.slice(
    (assignmentPage - 1) * assignmentPageSize,
    assignmentPage * assignmentPageSize,
  );

  // Reset to page 1 when filters change
  useEffect(() => {
    setAssignmentPage(1);
  }, [filterKeyword, filterType, filterDateFrom, filterDateTo, filterOverdue]);

  const togglePrintSelection = (assignmentId: number) => {
    setSelectedForPrint((prev) => {
      const next = new Set(prev);
      if (next.has(assignmentId)) next.delete(assignmentId);
      else next.add(assignmentId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedForPrint.size === filteredAssignments.length) {
      setSelectedForPrint(new Set());
    } else {
      setSelectedForPrint(new Set(filteredAssignments.map((a) => a.id)));
    }
  };

  const handleBatchPrint = async () => {
    if (selectedForPrint.size === 0) return;
    setBatchPrinting(true);
    try {
      const selected = assignments.filter((a) => selectedForPrint.has(a.id));
      const progressResults = await Promise.all(
        selected.map(async (a) => {
          const response = await apiClient.get(
            `/api/teachers/assignments/${a.id}/progress`,
          );
          const arr = Array.isArray(response)
            ? response
            : (response as { data?: unknown[] }).data || [];
          return {
            title: a.title,
            students: arr
              .filter(
                (p: Record<string, unknown>) =>
                  p.status !== "unassigned" && p.is_assigned !== false,
              )
              .map((p: Record<string, unknown>) => ({
                student_number: (p.student_number as number) || 0,
                student_name:
                  (p.student_name as string) || (p.name as string) || "",
                score: (p.score as number) ?? undefined,
                status: (p.status as string) || "NOT_STARTED",
              })),
          };
        }),
      );

      const pages = progressResults.map(({ title, students }) => {
        const counts = students.reduce(
          (acc: Record<string, number>, s) => {
            acc[s.status] = (acc[s.status] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        );
        return buildStickyNotePageHtml(
          title,
          students,
          counts,
          { showNumber: true, showName: true, showScore: false },
          t,
        );
      });

      openPrintWindow(pages);
      setSelectedForPrint(new Set());
    } catch {
      toast.error(t("stickyNote.batchPrintError", "列印失敗"));
    } finally {
      setBatchPrinting(false);
    }
  };

  useEffect(() => {
    if (id) {
      if (isTemplateMode) {
        fetchTemplateProgramData();
      } else {
        fetchClassroomDetail();
        fetchPrograms();
        fetchStudents();
        fetchAssignments();
        fetchTeacherPermissions();
      }
    }
  }, [id, isTemplateMode]);

  useEffect(() => {
    // Check URL parameters for tab switching
    const searchParams = new URLSearchParams(location.search);
    const tab = searchParams.get("tab");
    if (tab === "assignments") {
      setActiveTab("assignments");
    }
  }, [location.search]);

  // Issue #150: Smart default tab based on student count
  // When class has students, default to "assignments" tab
  // When class has no students, keep "students" tab
  useEffect(() => {
    // Skip if in template mode or already initialized
    if (isTemplateMode || hasInitializedTab || loading) return;

    // Wait for assignments to be loaded before switching tab
    // (tab is disabled while loading, so switching won't work)
    if (!assignmentsLoaded) return;

    // Skip if URL already specifies a tab
    const searchParams = new URLSearchParams(location.search);
    if (searchParams.get("tab")) return;

    // Set default tab based on student count
    if (students.length > 0) {
      setActiveTab("assignments");
    }
    setHasInitializedTab(true);
  }, [
    students,
    loading,
    isTemplateMode,
    hasInitializedTab,
    location.search,
    assignmentsLoaded,
  ]);

  const fetchClassroomDetail = async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      const classrooms =
        (await apiClient.getTeacherClassrooms()) as ClassroomInfo[];
      const currentClassroom = classrooms.find((c) => c.id === Number(id));

      if (currentClassroom) {
        setClassroom(currentClassroom);
      } else {
        console.error("Classroom not found");
        navigate("/teacher/classrooms");
      }
    } catch (err) {
      console.error("Fetch classroom error:", err);
      navigate("/teacher/classrooms");
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  const refreshPrograms = async () => {
    if (isTemplateMode) {
      await fetchTemplateProgramData();
    } else {
      await fetchPrograms();
    }
  };

  const fetchTemplateProgramData = async () => {
    try {
      setLoading(true);

      const response = (await apiClient.getTemplateProgramDetail(
        Number(id),
      )) as Program;

      if (response) {
        // Convert template program data to match programs structure
        const programWithLessons: Program = {
          id: response.id,
          name: response.name,
          description: response.description,
          level: response.level,
          estimated_hours: response.estimated_hours,
          lessons: response.lessons || [],
        };

        setPrograms([programWithLessons]);
        setTemplateProgram(programWithLessons);

        // Set a mock classroom for UI consistency
        setClassroom({
          id: response.id,
          name: response.name,
          description: response.description,
          level: response.level || "A1",
          student_count: 0,
          students: [],
        });
      }
    } catch (err) {
      console.error("Fetch template program error:", err);
      navigate("/teacher/programs");
    } finally {
      setLoading(false);
    }
  };

  const fetchPrograms = async () => {
    try {
      // Use new API to get programs for this specific classroom
      const classroomPrograms = (await apiClient.getClassroomPrograms(
        Number(id),
      )) as Program[];

      // Fetch detailed info including lessons for each program
      const programsWithLessons = await Promise.all(
        classroomPrograms.map(async (program) => {
          try {
            const detail = (await apiClient.getProgramDetail(
              program.id,
            )) as Program;
            return {
              ...program,
              lessons: detail.lessons
                ? detail.lessons.sort(
                    (a: Lesson, b: Lesson) => a.order_index - b.order_index,
                  )
                : [],
            };
          } catch (err) {
            console.error(
              `Failed to fetch lessons for program ${program.id}:`,
              err,
            );
            return { ...program, lessons: [] };
          }
        }),
      );

      // Sort programs by order_index
      programsWithLessons.sort(
        (a, b) => (a.order_index || 0) - (b.order_index || 0),
      );
      setPrograms(programsWithLessons);
    } catch (err) {
      console.error("Fetch programs error:", err);
    }
  };

  const fetchStudents = async () => {
    try {
      const response = await apiClient.get(
        `/api/teachers/classrooms/${id}/students`,
      );
      setStudents(Array.isArray(response) ? response : []);
    } catch (err) {
      console.error("Failed to fetch students:", err);
      setStudents([]);
    }
  };

  const fetchAssignments = async () => {
    try {
      const [activeResponse, archivedResponse] = await Promise.all([
        apiClient.get(`/api/teachers/assignments/?classroom_id=${id}`),
        apiClient.get(
          `/api/teachers/assignments/?classroom_id=${id}&is_archived=true`,
        ),
      ]);
      setAssignments(Array.isArray(activeResponse) ? activeResponse : []);
      setArchivedAssignments(
        Array.isArray(archivedResponse) ? archivedResponse : [],
      );
    } catch (err) {
      console.error("Failed to fetch assignments:", err);
      setAssignments([]);
      setArchivedAssignments([]);
    } finally {
      setAssignmentsLoaded(true);
    }
  };

  const fetchTeacherPermissions = async () => {
    try {
      const dashboardData = (await apiClient.getTeacherDashboard()) as {
        can_assign_homework?: boolean;
        can_use_ai_grading?: boolean;
        subscription_status?: string;
        days_remaining?: number;
      };
      setCanAssignHomework(dashboardData.can_assign_homework || false);
      setCanUseAiGrading(dashboardData.can_use_ai_grading ?? true);
      setTeacherData({
        subscription_status: dashboardData.subscription_status,
        days_remaining: dashboardData.days_remaining,
      });
    } catch (err) {
      console.error("Failed to fetch teacher permissions:", err);
      setCanAssignHomework(false);
    }
  };

  const handleEditAssignment = (assignment: Assignment) => {
    // TODO: Open edit dialog with assignment data
    toast.info(
      t("classroomDetail.messages.prepareEditAssignment", {
        title: assignment.title,
      }),
    );
    setShowAssignmentDetails(false);
    // In production: open edit dialog
    // setEditingAssignment(assignment);
    // setShowEditAssignmentDialog(true);
  };

  const handleDeleteAssignment = async (assignment: Assignment) => {
    if (
      confirm(
        t("classroomDetail.messages.confirmDeleteAssignment", {
          title: assignment.title,
        }),
      )
    ) {
      try {
        await apiClient.delete(`/api/teachers/assignments/${assignment.id}`);
        toast.success(
          t("classroomDetail.messages.assignmentDeleted", {
            title: assignment.title,
          }),
        );
        setShowAssignmentDetails(false);
        fetchAssignments(); // Refresh the list
      } catch (error) {
        console.error("Failed to delete assignment:", error);
        toast.error(t("classroomDetail.messages.deleteAssignmentFailed"));
      }
    }
  };

  const handleArchiveAssignment = async (assignment: Assignment) => {
    if (
      confirm(
        t("classroomDetail.messages.confirmArchiveAssignment", {
          title: assignment.title,
        }),
      )
    ) {
      try {
        await apiClient.patch(
          `/api/teachers/assignments/${assignment.id}/archive`,
        );
        toast.success(
          t("classroomDetail.messages.assignmentArchived", {
            title: assignment.title,
          }),
        );
        fetchAssignments();
      } catch (error) {
        console.error("Failed to archive assignment:", error);
        toast.error(t("classroomDetail.messages.archiveAssignmentFailed"));
      }
    }
  };

  const handleUnarchiveAssignment = async (assignment: Assignment) => {
    if (
      !confirm(
        t("classroomDetail.messages.confirmUnarchiveAssignment", {
          title: assignment.title,
        }),
      )
    )
      return;
    try {
      await apiClient.patch(
        `/api/teachers/assignments/${assignment.id}/unarchive`,
      );
      toast.success(
        t("classroomDetail.messages.assignmentUnarchived", {
          title: assignment.title,
        }),
      );
      fetchAssignments();
    } catch (error) {
      console.error("Failed to unarchive assignment:", error);
      toast.error(t("classroomDetail.messages.unarchiveAssignmentFailed"));
    }
  };

  const handleContentClick = (content: Content) => {
    // 如果點擊的是同一個 content，則關閉 panel
    if (isPanelOpen && selectedContent?.id === content.id) {
      setIsPanelOpen(false);
      setSelectedContent(null);
      setEditingContent(null);
      return;
    }

    // 統一轉成小寫比對
    const contentType = content.type?.toLowerCase();

    // For reading_assessment and example_sentences type, use side panel for viewing/editing
    // EXAMPLE_SENTENCES uses the same ReadingAssessmentPanel as READING_ASSESSMENT
    if (
      contentType === "reading_assessment" ||
      contentType === "example_sentences"
    ) {
      setSelectedContent(content);
      setEditingContent({
        id: content.id,
        title: content.title,
        items_count: content.items_count,
        items: content.items || [],
        lesson_id: content.lesson_id,
        type: content.type,
        estimated_time: content.estimated_time,
        target_wpm: content.target_wpm,
        target_accuracy: content.target_accuracy,
        time_limit_seconds: content.time_limit_seconds,
        programName: content.programName,
        lessonName: content.lessonName,
      });
      setIsPanelOpen(true);
    } else if (contentType === "sentence_making") {
      // For SENTENCE_MAKING type, use side panel with VocabularySetPanel
      setSelectedContent(content);
      setEditingContent({
        id: content.id,
        title: content.title,
        items_count: content.items_count,
        items: content.items || [],
        lesson_id: content.lesson_id,
        type: content.type,
        estimated_time: content.estimated_time,
        target_wpm: content.target_wpm,
        target_accuracy: content.target_accuracy,
        time_limit_seconds: content.time_limit_seconds,
        programName: content.programName,
        lessonName: content.lessonName,
      });
      setIsPanelOpen(true);
    } else {
      // For other content types, use the existing panel
      setSelectedContent(content);
      setEditingContent({
        id: content.id,
        title: content.title,
        items_count: content.items_count,
        items: content.items || [],
        lesson_id: content.lesson_id,
        type: content.type,
        estimated_time: content.estimated_time,
        target_wpm: content.target_wpm || 60,
        target_accuracy: content.target_accuracy || 0.8,
        time_limit_seconds: content.time_limit_seconds || 600,
        programName: content.programName,
        lessonName: content.lessonName,
      });
      setIsPanelOpen(true);
    }
  };

  const closePanel = () => {
    setIsPanelOpen(false);
    setTimeout(() => {
      setSelectedContent(null);
      setEditingContent(null);
    }, 300);
  };

  const handleAddContentItem = () => {
    if (!editingContent) return;

    const newItem = {
      text: "",
      translation: "",
    };

    setEditingContent({
      ...editingContent,
      items: [...(editingContent.items || []), newItem],
    });
  };

  const handleUpdateContentItem = (
    index: number,
    field: "text" | "translation",
    value: string,
  ) => {
    if (!editingContent) return;

    const updatedItems = [...(editingContent.items || [])];
    updatedItems[index] = {
      ...updatedItems[index],
      [field]: value,
    };

    setEditingContent({
      ...editingContent,
      items: updatedItems,
    });
  };

  const handleDeleteContentItem = (index: number) => {
    if (!editingContent) return;

    const updatedItems =
      editingContent.items?.filter(
        (_: ContentItem, i: number) => i !== index,
      ) || [];
    setEditingContent({
      ...editingContent,
      items: updatedItems,
    });
  };

  const handleSaveContent = async () => {
    if (!editingContent || !selectedContent) return;

    // VocabularySetPanel / SentenceMakingPanel 已在內部完成 API save，
    // 這裡不需要再做第二次 PUT，否則會用不完整的 editingContent.items
    // 覆蓋掉 vocabulary_translation 等欄位 (#366)
    const contentType = selectedContent.type?.toLowerCase();
    if (contentType === "vocabulary_set" || contentType === "sentence_making") {
      // 直接更新前端 state，不重新載入整個 tree
      if (selectedContent.id) {
        setPrograms((prevPrograms) =>
          prevPrograms.map((program) => ({
            ...program,
            lessons: program.lessons?.map((lesson) => ({
              ...lesson,
              contents: lesson.contents?.map((content) =>
                content.id === selectedContent.id
                  ? { ...content, ...editingContent }
                  : content,
              ),
            })),
          })),
        );
      }
      closePanel();
      return;
    }

    try {
      // Update content via API
      await apiClient.updateContent(editingContent.id, {
        title: editingContent.title,
        items: editingContent.items,
        target_wpm: parseInt(String(editingContent.target_wpm || 60)),
        target_accuracy:
          parseFloat(String(editingContent.target_accuracy || 80)) / 100,
        time_limit_seconds: parseInt(
          String(editingContent.time_limit_seconds || 180),
        ),
      });

      toast.success(t("classroomDetail.messages.contentUpdated"));
      await refreshPrograms();
      closePanel();
    } catch (error: unknown) {
      console.error("Failed to update content:", error);
      // 解析 ApiError 的結構化錯誤訊息
      if (error instanceof ApiError) {
        const detail = error.detail;
        const errorMessage =
          typeof detail === "object" &&
          !Array.isArray(detail) &&
          detail?.message
            ? detail.message
            : typeof detail === "string"
              ? detail
              : null;
        toast.error(
          errorMessage || t("classroomDetail.messages.updateContentFailed"),
        );
      } else {
        toast.error(t("classroomDetail.messages.updateContentFailed"));
      }
    }
  };

  // Student CRUD handlers
  const handleCreateStudent = () => {
    setSelectedStudent(null);
    setDialogType("create");
  };

  const handleViewStudent = (student: Student) => {
    setSelectedStudent(student);
    setDialogType("view");
  };

  const handleEditStudent = (student: Student) => {
    setSelectedStudent(student);
    setDialogType("edit");
  };

  const handleResetPassword = async (student: Student) => {
    if (
      !confirm(
        t("classroomDetail.errors.confirmResetPassword", {
          name: student.name,
        }),
      )
    ) {
      return;
    }

    try {
      await apiClient.resetStudentPassword(student.id);
      // Refresh data
      fetchClassroomDetail();
    } catch (error) {
      console.error("Failed to reset password:", error);
      alert(t("classroomDetail.messages.resetPasswordFailed"));
    }
  };

  const handleSaveStudent = async () => {
    // Refresh data after save (parallel requests, no loading spinner)
    await Promise.all([
      fetchStudents(), // 更新學生列表（派作業需要）
      fetchClassroomDetail(false), // 更新班級資訊（學生數統計），不顯示載入畫面
    ]);
  };

  const handleDeleteStudent = async () => {
    // Refresh data after delete (parallel requests, no loading spinner)
    await Promise.all([
      fetchStudents(), // 更新學生列表（派作業需要）
      fetchClassroomDetail(false), // 更新班級資訊（學生數統計），不顯示載入畫面
    ]);
  };

  const handleCloseDialog = () => {
    setSelectedStudent(null);
    setDialogType(null);
  };

  const handleSwitchToEdit = () => {
    // Switch from view to edit mode
    setDialogType("edit");
  };

  const handleAddLesson = (programId: number) => {
    setSelectedLesson(null);
    setLessonProgramId(programId);
    setLessonDialogType("create");
  };

  const handleEditProgram = (programId: number) => {
    const program = programs.find((p) => p.id === programId);
    if (program) {
      setSelectedProgram(program);
      setProgramDialogType("edit");
    }
  };

  const handleEditLesson = (programId: number, lessonId: number) => {
    const program = programs.find((p) => p.id === programId);
    const lesson = program?.lessons?.find((l: Lesson) => l.id === lessonId);
    if (lesson) {
      setSelectedLesson(lesson);
      setLessonProgramId(programId);
      setLessonDialogType("edit");
    }
  };

  const handleDeleteProgram = (programId: number) => {
    const program = programs.find((p) => p.id === programId);
    if (program) {
      setSelectedProgram(program);
      setProgramDialogType("delete");
    }
  };

  const handleDeleteLesson = (programId: number, lessonId: number) => {
    const program = programs.find((p) => p.id === programId);
    const lesson = program?.lessons?.find((l: Lesson) => l.id === lessonId);
    if (lesson) {
      setSelectedLesson(lesson);
      setLessonProgramId(programId);
      setLessonDialogType("delete");
    }
  };

  const handleSaveProgram = (program: Program) => {
    if (programDialogType === "create") {
      setPrograms([...programs, program]);
    } else if (programDialogType === "edit") {
      setPrograms(programs.map((p) => (p.id === program.id ? program : p)));
    }
    fetchPrograms(); // Refresh data
  };

  const handleDeleteProgramConfirm = (programId: number) => {
    setPrograms(programs.filter((p) => p.id !== programId));
    fetchPrograms(); // Refresh data
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleSaveLesson = (lesson: any) => {
    const savedLesson = lesson;
    // 直接更新 state 而不是重新載入整個頁面
    if (lessonDialogType === "create" && lessonProgramId) {
      // 新增單元：找到對應的 program 並加入新單元
      setPrograms((prevPrograms) =>
        prevPrograms.map((program) => {
          if (program.id === lessonProgramId) {
            return {
              ...program,
              lessons: [...(program.lessons || []), savedLesson],
            };
          }
          return program;
        }),
      );
      toast.success(
        t("teacherTemplatePrograms.messages.lessonAdded", {
          name: savedLesson.name,
        }),
      );
    } else if (lessonDialogType === "edit") {
      // 編輯單元：更新對應的單元
      setPrograms((prevPrograms) =>
        prevPrograms.map((program) => ({
          ...program,
          lessons:
            program.lessons?.map((lesson) =>
              lesson.id === savedLesson.id ? savedLesson : lesson,
            ) || [],
        })),
      );
      toast.success(
        t("teacherTemplatePrograms.messages.lessonUpdated", {
          name: savedLesson.name,
        }),
      );
    }
  };

  const handleDeleteContent = async (
    lessonId: number,
    contentId: number,
    contentTitle: string,
  ) => {
    if (
      !confirm(
        t("classroomDetail.messages.confirmDeleteContent", {
          title: contentTitle,
        }),
      )
    ) {
      return;
    }

    try {
      // 呼叫 API 刪除內容
      await apiClient.deleteContent(contentId);

      // 更新本地狀態 - 從對應的 lesson 中移除該 content
      setPrograms((prevPrograms) =>
        prevPrograms.map((program) => ({
          ...program,
          lessons: program.lessons?.map((lesson: Lesson) => {
            if (lesson.id === lessonId) {
              return {
                ...lesson,
                contents: lesson.contents?.filter((c) => c.id !== contentId),
              };
            }
            return lesson;
          }),
        })),
      );

      toast.success(
        t("classroomDetail.messages.contentDeleted", { title: contentTitle }),
      );
    } catch (error) {
      console.error("Failed to delete content:", error);
      toast.error(t("classroomDetail.messages.deleteContentFailed"));
    }
  };

  const handleDeleteLessonConfirm = async (lessonId: number) => {
    try {
      // 找到包含這個 lesson 的 program
      const programWithLesson = programs.find((p) =>
        p.lessons?.some((l) => l.id === lessonId),
      );

      if (!programWithLesson) {
        toast.error(t("classroomDetail.messages.lessonNotFoundInProgram"));
        return;
      }

      // 公版課程使用不同的 API endpoint
      if (isTemplateMode) {
        // 公版課程直接使用 lesson ID 刪除
        await apiClient.deleteTemplateLesson(lessonId);
      } else {
        // 一般課程使用 lesson ID 刪除
        await apiClient.deleteLesson(lessonId);
      }

      // 更新本地狀態
      const updatedPrograms = programs.map((program) => {
        if (program.lessons) {
          return {
            ...program,
            lessons: program.lessons.filter((l) => l.id !== lessonId),
          };
        }
        return program;
      });
      setPrograms(updatedPrograms);

      toast.success(t("classroomDetail.messages.lessonDeleted"));
    } catch (error) {
      console.error("Failed to delete lesson:", error);
      toast.error(t("classroomDetail.messages.deleteLessonFailed"));
    }
  };

  const handleReorderPrograms = async (
    dragIndex: number,
    dropIndex: number,
  ) => {
    const newPrograms = [...programs];
    const [draggedItem] = newPrograms.splice(dragIndex, 1);
    newPrograms.splice(dropIndex, 0, draggedItem);

    // Update order_index for each program
    const updatedPrograms = newPrograms.map((program, index) => ({
      ...program,
      order_index: index + 1,
    }));

    setPrograms(updatedPrograms);

    // Save new order to backend
    try {
      const orderData = updatedPrograms.map((program, index) => ({
        id: program.id,
        order_index: index + 1,
      }));
      await apiClient.reorderPrograms(orderData);
    } catch (error) {
      console.error("Failed to save program order:", error);
      // 可選：恢復原始順序
      fetchPrograms();
    }
  };

  const handleReorderLessons = async (
    programId: number,
    dragIndex: number,
    dropIndex: number,
  ) => {
    const programIndex = programs.findIndex((p) => p.id === programId);
    if (programIndex !== -1 && programs[programIndex].lessons) {
      const updatedPrograms = [...programs];
      const lessons = [...updatedPrograms[programIndex].lessons!];

      // Reorder lessons
      const [draggedItem] = lessons.splice(dragIndex, 1);
      lessons.splice(dropIndex, 0, draggedItem);

      // Update order_index for each lesson
      const reorderedLessons = lessons.map((lesson, index) => ({
        ...lesson,
        order_index: index + 1,
      }));

      updatedPrograms[programIndex].lessons = reorderedLessons;
      setPrograms(updatedPrograms);

      // Save new order to backend
      try {
        const orderData = reorderedLessons.map((lesson, index) => ({
          id: lesson.id,
          order_index: index + 1,
        }));
        await apiClient.reorderLessons(programId, orderData);
      } catch (error) {
        console.error("Failed to save lesson order:", error);
        // 可選：恢復原始順序
        fetchPrograms();
      }
    }
  };

  const handleReorderContents = async (
    lessonId: number,
    fromIndex: number,
    toIndex: number,
  ) => {
    // Find the lesson
    let targetLesson: Lesson | undefined;
    let targetProgram: Program | undefined;

    for (const program of programs) {
      const lesson = program.lessons?.find((l) => l.id === lessonId);
      if (lesson) {
        targetLesson = lesson;
        targetProgram = program;
        break;
      }
    }

    if (!targetLesson || !targetLesson.contents || !targetProgram) return;

    const originalPrograms = [...programs];

    // Immediate UI update
    const newContents = [...targetLesson.contents];
    const [movedItem] = newContents.splice(fromIndex, 1);
    newContents.splice(toIndex, 0, movedItem);

    setPrograms((prevPrograms) =>
      prevPrograms.map((p) => {
        if (p.id === targetProgram!.id) {
          return {
            ...p,
            lessons: p.lessons?.map((l) =>
              l.id === lessonId ? { ...l, contents: newContents } : l,
            ),
          };
        }
        return p;
      }),
    );

    try {
      // Prepare order data
      const orderData = newContents.map((content, index) => ({
        id: content.id,
        order_index: index,
      }));

      await apiClient.reorderContents(lessonId, orderData);
      toast.success(t("classroomDetail.messages.reorderSuccess"));
    } catch (err) {
      console.error("Failed to reorder contents:", err);
      toast.error(t("classroomDetail.messages.reorderFailed"));
      // Revert on error
      setPrograms(originalPrograms);
    }
  };

  const handleCreateContent = (programId: number, lessonId: number) => {
    const program = programs.find((p) => p.id === programId);
    const lesson = program?.lessons?.find((l) => l.id === lessonId);
    if (lesson && program) {
      setContentLessonInfo({
        programName: program.name,
        lessonName: lesson.name,
        lessonId: lesson.id,
      });
      setShowContentTypeDialog(true);
    }
  };

  const handleContentTypeSelect = async (selection: {
    type: string;
    lessonId: number;
    programName: string;
    lessonName: string;
  }) => {
    // For reading_assessment and example_sentences, use popup for new content creation
    // EXAMPLE_SENTENCES uses the same ReadingAssessmentPanel as READING_ASSESSMENT
    if (
      selection.type === "reading_assessment" ||
      selection.type === "example_sentences" ||
      selection.type === "EXAMPLE_SENTENCES"
    ) {
      setEditorLessonId(selection.lessonId);
      setEditorContentId(null); // null for new content
      setShowReadingEditor(true);
      setShowContentTypeDialog(false);
    } else if (
      selection.type === "SENTENCE_MAKING" ||
      selection.type === "sentence_making" ||
      selection.type === "vocabulary_set" ||
      selection.type === "VOCABULARY_SET"
    ) {
      // For sentence_making/vocabulary_set, use popup for new content creation
      setVocabularySetLessonId(selection.lessonId);
      setVocabularySetContentId(null); // null for new content
      setShowVocabularySetEditor(true);
      setShowContentTypeDialog(false);
    } else {
      // For other content types, create directly
      try {
        const contentTypeNames: Record<string, string> = {
          reading_assessment: t(
            "classroomDetail.contentTypes.readingRecordingPractice",
          ),
        };

        const title =
          contentTypeNames[selection.type] ||
          t("classroomDetail.contentTypes.newContent");
        const items: Array<{ text: string; translation?: string }> = [];

        await apiClient.createContent(selection.lessonId, {
          type: selection.type,
          title: title,
          items: items,
          target_wpm: 60,
          target_accuracy: 0.8,
        });

        toast.success(t("classroomDetail.messages.contentCreated"));
        await refreshPrograms();
      } catch (error) {
        console.error("Failed to create content:", error);
        toast.error(t("classroomDetail.messages.createContentFailed"));
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (!classroom && !isTemplateMode) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">
          {t("classroomDetail.messages.notFound")}
        </p>
        <Button
          className="mt-4"
          onClick={() => navigate("/teacher/classrooms")}
        >
          {t("classroomDetail.buttons.backToList")}
        </Button>
      </div>
    );
  }

  if (isTemplateMode && !templateProgram) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">
          {t("classroomDetail.messages.templateNotFound")}
        </p>
        <Button className="mt-4" onClick={() => navigate("/teacher/programs")}>
          {t("classroomDetail.buttons.backToProgramList")}
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="relative">
        <div
          className={`transition-all duration-300 ${isPanelOpen ? "mr-[50%]" : ""}`}
        >
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 sm:mb-6 space-y-4 sm:space-y-0">
            <div className="flex items-center space-x-2 sm:space-x-4 w-full sm:w-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  navigate(
                    isTemplateMode
                      ? "/teacher/programs"
                      : "/teacher/classrooms",
                  )
                }
                className="flex-shrink-0"
              >
                <ArrowLeft className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{t("common.back")}</span>
              </Button>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 truncate">
                  {isTemplateMode ? templateProgram?.name : classroom?.name}
                </h2>
                {(isTemplateMode
                  ? templateProgram?.description
                  : classroom?.description) && (
                  <p className="text-sm sm:text-base text-gray-600 mt-1 truncate">
                    {isTemplateMode
                      ? templateProgram?.description
                      : classroom?.description}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Stats - only show for classroom mode */}
          {!isTemplateMode && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
              <div className="bg-white p-3 sm:p-4 rounded-lg shadow-sm border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs sm:text-sm text-gray-600">
                      {t("classroomDetail.stats.studentCount")}
                    </p>
                    <p className="text-xl sm:text-2xl font-bold">
                      {classroom?.student_count || 0}
                    </p>
                  </div>
                  <Users className="h-6 w-6 sm:h-8 sm:w-8 text-blue-500" />
                </div>
              </div>
              <div className="bg-white p-3 sm:p-4 rounded-lg shadow-sm border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs sm:text-sm text-gray-600">
                      {t("classroomDetail.stats.programCount")}
                    </p>
                    <p className="text-xl sm:text-2xl font-bold">
                      {programs.length}
                    </p>
                  </div>
                  <BookOpen className="h-6 w-6 sm:h-8 sm:w-8 text-green-500" />
                </div>
              </div>
              <div className="bg-white p-3 sm:p-4 rounded-lg shadow-sm border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs sm:text-sm text-gray-600">
                      {t("classroomDetail.stats.level")}
                    </p>
                    <p className="text-xl sm:text-2xl font-bold">
                      {classroom?.level || "A1"}
                    </p>
                  </div>
                  <div className="h-6 w-6 sm:h-8 sm:w-8 bg-purple-100 rounded-full flex items-center justify-center">
                    <span className="text-purple-600 font-bold text-sm sm:text-base">
                      L
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="bg-white rounded-lg shadow-sm border">
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
            >
              <div className="bg-white dark:bg-gray-900 px-3 sm:px-6 pt-2">
                {isTemplateMode ? (
                  /* Template mode - no tabs, just show programs */
                  <div className="h-12" />
                ) : (
                  <TabsList className="inline-flex h-auto bg-transparent p-0 gap-0">
                    <TabsTrigger
                      value="students"
                      className="relative px-4 sm:px-6 py-3 text-sm sm:text-base font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 data-[state=active]:text-blue-600 dark:data-[state=active]:text-blue-400 bg-transparent data-[state=active]:bg-transparent rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 dark:data-[state=active]:border-blue-400 transition-colors flex items-center gap-2"
                    >
                      <Users className="h-4 w-4 sm:h-5 sm:w-5" />
                      <span className="hidden sm:inline">
                        {t("classroomDetail.tabs.studentList")}
                      </span>
                      <span className="sm:hidden">
                        {t("classroomDetail.tabs.students")}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="programs"
                      className="relative px-4 sm:px-6 py-3 text-sm sm:text-base font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 data-[state=active]:text-blue-600 dark:data-[state=active]:text-blue-400 bg-transparent data-[state=active]:bg-transparent rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 dark:data-[state=active]:border-blue-400 transition-colors flex items-center gap-2"
                    >
                      <BookOpen className="h-4 w-4 sm:h-5 sm:w-5" />
                      <span className="hidden sm:inline">
                        {t("classroomDetail.tabs.programList")}
                      </span>
                      <span className="sm:hidden">
                        {t("classroomDetail.tabs.programs")}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="assignments"
                      className={`relative px-4 sm:px-6 py-3 text-sm sm:text-base font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 data-[state=active]:text-blue-600 dark:data-[state=active]:text-blue-400 bg-transparent data-[state=active]:bg-transparent rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 dark:data-[state=active]:border-blue-400 transition-colors flex items-center gap-2 ${
                        !canAssignHomework
                          ? "opacity-50 cursor-not-allowed"
                          : ""
                      }`}
                      disabled={!canAssignHomework}
                      onClick={(e) => {
                        if (!canAssignHomework) {
                          e.preventDefault();
                          toast.error(
                            t(
                              "classroomDetail.messages.subscriptionExpiredFeature",
                            ),
                          );
                        }
                      }}
                    >
                      <FileText className="h-4 w-4 sm:h-5 sm:w-5" />
                      <span className="hidden sm:inline">
                        {t("classroomDetail.tabs.assignmentManagement")}
                      </span>
                      <span className="sm:hidden">
                        {t("classroomDetail.tabs.assignments")}
                      </span>
                    </TabsTrigger>
                  </TabsList>
                )}
                {/* 底部分隔線 */}
                <div className="border-b border-gray-200 dark:border-gray-700 -mx-3 sm:-mx-6" />
              </div>

              {/* Students Tab - only show for classroom mode */}
              {!isTemplateMode && (
                <TabsContent value="students" className="p-3 sm:p-6">
                  <div className="flex items-center mb-4">
                    <Button
                      onClick={handleCreateStudent}
                      className="h-10 bg-blue-500 hover:bg-blue-600 text-white"
                      disabled={isOrgMode}
                      title={
                        isOrgMode
                          ? t(
                              "classroomDetail.messages.manageStudentsFromSchool",
                            )
                          : ""
                      }
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      {t("classroomDetail.buttons.addStudent")}
                    </Button>
                  </div>

                  <StudentTable
                    students={[...(classroom?.students || [])].sort((a, b) => {
                      // 按學號排序，沒有學號的放在後面
                      if (!a.student_number && !b.student_number) return 0;
                      if (!a.student_number) return 1;
                      if (!b.student_number) return -1;
                      return a.student_number.localeCompare(
                        b.student_number,
                        undefined,
                        { numeric: true },
                      );
                    })}
                    showClassroom={false}
                    onAddStudent={handleCreateStudent}
                    onViewStudent={handleViewStudent}
                    onEditStudent={handleEditStudent}
                    onResetPassword={handleResetPassword}
                    emptyMessage={t("classroomDetail.messages.noStudents")}
                    disableActions={isOrgMode}
                    disableReason={t(
                      "classroomDetail.messages.manageStudentsFromSchool",
                    )}
                  />
                </TabsContent>
              )}

              {/* Programs Tab */}
              <TabsContent value="programs" className="p-3 sm:p-6">
                <div className="flex items-center mb-4">
                  {!isTemplateMode && (
                    <Button
                      onClick={() => setShowCopyDialog(true)}
                      className="h-10 bg-blue-500 hover:bg-blue-600 text-white"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      {t("classroomDetail.buttons.createProgram")}
                    </Button>
                  )}
                </div>

                <RecursiveTreeAccordion
                  data={programs}
                  config={programTreeConfig}
                  title=""
                  showCreateButton={false}
                  onEdit={(item, level, parentId) => {
                    if (level === 0) handleEditProgram(item.id);
                    else if (level === 1)
                      handleEditLesson(parentId as number, item.id);
                  }}
                  onDelete={(item, level, parentId) => {
                    if (level === 0) handleDeleteProgram(item.id);
                    else if (level === 1)
                      handleDeleteLesson(parentId as number, item.id);
                    else if (level === 2)
                      handleDeleteContent(
                        parentId as number,
                        item.id,
                        item.title,
                      );
                  }}
                  onClick={(item, level, parentId) => {
                    if (level === 2) {
                      const program = programs.find((p) =>
                        p.lessons?.some((l) => l.id === parentId),
                      );
                      const lesson = program?.lessons?.find(
                        (l) => l.id === parentId,
                      );
                      handleContentClick({
                        ...item,
                        lesson_id: parentId as number,
                        lessonName: lesson?.name,
                        programName: program?.name,
                      });
                    }
                  }}
                  onCreate={(level, parentId) => {
                    if (level === 1) {
                      handleAddLesson(parentId as number);
                    } else if (level === 2) {
                      const program = programs.find((p) =>
                        p.lessons?.some((l) => l.id === parentId),
                      );
                      if (program) {
                        handleCreateContent(program.id, parentId as number);
                      }
                    }
                  }}
                  onReorder={(fromIndex, toIndex, level, parentId) => {
                    if (level === 0) handleReorderPrograms(fromIndex, toIndex);
                    else if (level === 1)
                      handleReorderLessons(
                        parentId as number,
                        fromIndex,
                        toIndex,
                      );
                    else if (level === 2)
                      handleReorderContents(
                        parentId as number,
                        fromIndex,
                        toIndex,
                      );
                  }}
                />
              </TabsContent>

              {/* Assignments Tab - only show for classroom mode */}
              {!isTemplateMode && (
                <TabsContent value="assignments" className="p-3 sm:p-6">
                  <div className="space-y-4 sm:space-y-6">
                    {/* Header with Create Button and Archive Toggle */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      {!showArchived && (
                        <Button
                          onClick={() => {
                            if (!canAssignHomework) {
                              toast.error(
                                t(
                                  "classroomDetail.messages.subscriptionExpired",
                                ),
                              );
                              return;
                            }
                            setShowAssignmentDialog(true);
                          }}
                          disabled={!canAssignHomework}
                          className={`h-10 ${
                            canAssignHomework
                              ? "bg-blue-500 hover:bg-blue-600 text-white"
                              : "bg-gray-300 text-gray-500 cursor-not-allowed"
                          }`}
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          {t("classroomDetail.buttons.assignNewHomework")}
                        </Button>
                      )}
                      {assignments.length > 0 && !showArchived && (
                        <Button
                          variant="outline"
                          onClick={handleBatchPrint}
                          disabled={
                            selectedForPrint.size === 0 || batchPrinting
                          }
                          className="h-10"
                        >
                          <Printer className="h-4 w-4 mr-2" />
                          {t("stickyNote.batchPrint")}
                          {selectedForPrint.size > 0 &&
                            ` (${selectedForPrint.size})`}
                        </Button>
                      )}
                      {!canAssignHomework && !showArchived && teacherData && (
                        <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 bg-yellow-50 dark:bg-yellow-900/20 px-3 py-2 rounded-lg border border-yellow-200 dark:border-yellow-800">
                          <span className="font-medium">
                            {t(
                              "classroomDetail.labels.subscriptionExpiredWarning",
                            )}
                          </span>
                          <span className="text-xs ml-2">
                            {teacherData.subscription_status === "subscribed"
                              ? t("classroomDetail.labels.daysRemaining", {
                                  days: teacherData.days_remaining || 0,
                                })
                              : t(
                                  "classroomDetail.labels.requiresSubscription",
                                )}
                          </span>
                        </div>
                      )}
                      <div className="sm:ml-auto flex">
                        <button
                          onClick={() => setShowArchived(false)}
                          className={`px-4 py-2 text-sm font-medium rounded-l-lg border ${
                            !showArchived
                              ? "bg-blue-500 text-white border-blue-500"
                              : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                          }`}
                        >
                          {t("classroomDetail.tabs.activeAssignments")}
                          {assignments.length > 0 && (
                            <span className="ml-1.5 text-xs">
                              ({assignments.length})
                            </span>
                          )}
                        </button>
                        <button
                          onClick={() => setShowArchived(true)}
                          className={`px-4 py-2 text-sm font-medium rounded-r-lg border-t border-r border-b ${
                            showArchived
                              ? "bg-blue-500 text-white border-blue-500"
                              : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                          }`}
                        >
                          <Archive className="inline-block w-4 h-4 mr-1 -mt-0.5" />
                          {t("classroomDetail.tabs.archivedAssignments")}
                          {archivedAssignments.length > 0 && (
                            <span className="ml-1.5 text-xs">
                              ({archivedAssignments.length})
                            </span>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Assignment Stats - Using Real Data (only for active view) */}
                    {!showArchived && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 sm:p-4 border dark:border-blue-800">
                          <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                            {t("classroomDetail.stats.totalAssignments")}
                          </div>
                          <div className="text-xl sm:text-2xl font-bold text-blue-600 dark:text-blue-400">
                            {assignments.length}
                          </div>
                        </div>
                        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 sm:p-4 border dark:border-green-800">
                          <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                            {t("classroomDetail.stats.completedAssignments")}
                          </div>
                          <div className="text-xl sm:text-2xl font-bold text-green-600 dark:text-green-400">
                            {
                              assignments.filter(
                                (a) => a.status === "completed",
                              ).length
                            }
                          </div>
                        </div>
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-3 sm:p-4 border dark:border-yellow-800">
                          <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                            {t("classroomDetail.stats.inProgressAssignments")}
                          </div>
                          <div className="text-xl sm:text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                            {
                              assignments.filter(
                                (a) =>
                                  a.status === "in_progress" ||
                                  a.status === "not_started",
                              ).length
                            }
                          </div>
                        </div>
                        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 sm:p-4 border dark:border-red-800">
                          <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                            {t("classroomDetail.stats.overdueAssignments")}
                          </div>
                          <div className="text-xl sm:text-2xl font-bold text-red-600 dark:text-red-400">
                            {
                              assignments.filter((a) => a.status === "overdue")
                                .length
                            }
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Filter Bar */}
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <select
                          value={filterType}
                          onChange={(e) => setFilterType(e.target.value)}
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200"
                        >
                          <option value="">
                            {t("classroomDetail.filters.allTypes")}
                          </option>
                          <option value="WORD_READING">
                            {t("classroomDetail.contentTypes.WORD_READING")}
                          </option>
                          <option value="WORD_SELECTION">
                            {t("classroomDetail.contentTypes.WORD_SELECTION")}
                          </option>
                          <option value="SPEAKING">
                            {t("classroomDetail.contentTypes.SPEAKING")}
                          </option>
                          <option value="REARRANGEMENT">
                            {t("classroomDetail.contentTypes.REARRANGEMENT")}
                          </option>
                        </select>
                        <div className="relative w-full md:w-[35%]">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                          <Input
                            placeholder={t(
                              "classroomDetail.filters.searchPlaceholder",
                            )}
                            value={filterKeyword}
                            onChange={(e) => setFilterKeyword(e.target.value)}
                            className="pl-9 h-9"
                          />
                        </div>
                        {/* Row 2 on mobile, same row on desktop */}
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            value={filterDateFrom}
                            onChange={(e) => setFilterDateFrom(e.target.value)}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200"
                            placeholder={t("classroomDetail.filters.startDate")}
                          />
                          <span className="text-gray-400 text-sm">~</span>
                          <input
                            type="date"
                            value={filterDateTo}
                            onChange={(e) => setFilterDateTo(e.target.value)}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200"
                            placeholder={t("classroomDetail.filters.endDate")}
                          />
                          <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap cursor-pointer">
                            <Checkbox
                              checked={filterOverdue}
                              onCheckedChange={(v) =>
                                setFilterOverdue(v === true)
                              }
                            />
                            {t("classroomDetail.filters.overdueOnly")}
                          </label>
                          {(filterKeyword ||
                            filterType ||
                            filterDateFrom ||
                            filterDateTo ||
                            filterOverdue) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-9 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 whitespace-nowrap"
                              onClick={() => {
                                setFilterKeyword("");
                                setFilterType("");
                                setFilterDateFrom("");
                                setFilterDateTo("");
                                setFilterOverdue(false);
                              }}
                            >
                              <X className="h-3.5 w-3.5 mr-1" />
                              {t("classroomDetail.filters.clearAll")}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Assignment List */}
                    {filteredAssignments.length > 0 ? (
                      <>
                        {/* Mobile: Card Layout */}
                        <div className="md:hidden space-y-3">
                          {paginatedAssignments.map((assignment) => {
                            const completionRate =
                              assignment.completion_rate || 0;
                            // 🎯 Issue #118: 根據 content_type + practice_mode 決定顯示標籤
                            const getTypeInfo = () => {
                              const contentType =
                                assignment.content_type?.toUpperCase();
                              const practiceMode = assignment.practice_mode;

                              // VOCABULARY_SET 或 SENTENCE_MAKING → 根據 practice_mode
                              if (
                                contentType === "VOCABULARY_SET" ||
                                contentType === "SENTENCE_MAKING"
                              ) {
                                if (practiceMode === "word_selection") {
                                  return {
                                    label: t(
                                      "classroomDetail.contentTypes.WORD_SELECTION",
                                    ),
                                    color:
                                      "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
                                  };
                                }
                                // default: word_reading
                                return {
                                  label: t(
                                    "classroomDetail.contentTypes.WORD_READING",
                                  ),
                                  color:
                                    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
                                };
                              }

                              // EXAMPLE_SENTENCES 或 READING_ASSESSMENT → 根據 practice_mode
                              if (
                                contentType === "EXAMPLE_SENTENCES" ||
                                contentType === "READING_ASSESSMENT"
                              ) {
                                if (practiceMode === "rearrangement") {
                                  return {
                                    label: t(
                                      "classroomDetail.contentTypes.REARRANGEMENT",
                                    ),
                                    color:
                                      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
                                  };
                                }
                                return {
                                  label: t(
                                    "classroomDetail.contentTypes.SPEAKING",
                                  ),
                                  color:
                                    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
                                };
                              }

                              // 其他類型保持原有邏輯
                              const otherTypeLabels: Record<
                                string,
                                { label: string; color: string }
                              > = {
                                SPEAKING_PRACTICE: {
                                  label: t(
                                    "classroomDetail.contentTypes.speakingPractice",
                                  ),
                                  color:
                                    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
                                },
                                SPEAKING_SCENARIO: {
                                  label: t(
                                    "classroomDetail.contentTypes.speakingScenario",
                                  ),
                                  color:
                                    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
                                },
                                LISTENING_CLOZE: {
                                  label: t(
                                    "classroomDetail.contentTypes.listeningCloze",
                                  ),
                                  color:
                                    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
                                },
                                SPEAKING_QUIZ: {
                                  label: t(
                                    "classroomDetail.contentTypes.speakingQuiz",
                                  ),
                                  color:
                                    "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
                                },
                              };

                              return (
                                otherTypeLabels[contentType || ""] || {
                                  label: t(
                                    "classroomDetail.labels.unknownType",
                                  ),
                                  color:
                                    "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
                                }
                              );
                            };
                            const typeInfo = getTypeInfo();

                            return (
                              <div
                                key={assignment.id}
                                className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-4 space-y-3"
                              >
                                {/* Title & AI Batch Grade Button */}
                                <div className="flex items-start justify-between gap-2">
                                  {!showArchived && (
                                    <Checkbox
                                      checked={selectedForPrint.has(
                                        assignment.id,
                                      )}
                                      onCheckedChange={() =>
                                        togglePrintSelection(assignment.id)
                                      }
                                      className="mt-1"
                                    />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <h4 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                                      {assignment.title}
                                    </h4>
                                    <span
                                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${typeInfo.color} mt-1`}
                                    >
                                      {typeInfo.label}
                                    </span>
                                  </div>
                                  {/* 🆕 rearrangement / word_selection 模式不顯示 AI 批改按鈕 */}
                                  {assignment.practice_mode !==
                                    "rearrangement" &&
                                    assignment.practice_mode !==
                                      "word_selection" && (
                                      <div className="flex flex-col items-end flex-shrink-0">
                                        {canUseAiGrading ? (
                                          <Button
                                            variant="default"
                                            size="sm"
                                            className="h-11 px-3 gap-1.5 bg-purple-600 hover:bg-purple-700 text-white"
                                            onClick={() => {
                                              setBatchGradingModal({
                                                open: true,
                                                assignmentId: assignment.id,
                                                classroomId: Number(id),
                                              });
                                            }}
                                          >
                                            <Sparkles className="w-5 h-5" />
                                            <span className="text-sm font-medium">
                                              {t(
                                                "assignmentDetail.buttons.batchGrade",
                                              )}
                                            </span>
                                          </Button>
                                        ) : (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-11 px-3 gap-1.5"
                                            onClick={() => {
                                              navigate(
                                                `/teacher/classroom/${id}/assignment/${assignment.id}`,
                                              );
                                            }}
                                          >
                                            <Eye className="w-5 h-5" />
                                            <span className="text-sm font-medium">
                                              {t(
                                                "classroomDetail.buttons.viewDetails",
                                              )}
                                            </span>
                                          </Button>
                                        )}
                                      </div>
                                    )}
                                </div>

                                {/* Description */}
                                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                                  {assignment.instructions ||
                                    t("classroomDetail.labels.noDescription")}
                                </p>

                                {/* Details Grid */}
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                  <div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                      {t("classroomDetail.labels.assignedTo")}
                                    </div>
                                    <div className="font-medium text-gray-900 dark:text-gray-100 mt-1">
                                      {assignment.student_count
                                        ? t(
                                            "classroomDetail.labels.studentCountWithUnit",
                                            { count: assignment.student_count },
                                          )
                                        : t("classroomDetail.labels.allClass")}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                      {t("classroomDetail.labels.dueDate")}
                                    </div>
                                    <div className="font-medium text-gray-900 dark:text-gray-100 mt-1">
                                      {assignment.due_date
                                        ? new Date(
                                            assignment.due_date,
                                          ).toLocaleDateString("zh-TW")
                                        : t(
                                            "classroomDetail.labels.noDeadline",
                                          )}
                                    </div>
                                  </div>
                                </div>

                                {/* Progress Bar */}
                                <div>
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                      {t(
                                        "classroomDetail.labels.completionProgress",
                                      )}
                                    </span>
                                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                      {completionRate}%
                                    </span>
                                  </div>
                                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                    <div
                                      className="bg-green-500 dark:bg-green-600 h-2 rounded-full transition-all"
                                      style={{ width: `${completionRate}%` }}
                                    ></div>
                                  </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="flex-1 h-12 min-h-12 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                                    onClick={() => {
                                      navigate(
                                        `/teacher/classroom/${id}/assignment/${assignment.id}`,
                                      );
                                    }}
                                  >
                                    {t("classroomDetail.buttons.viewDetails")}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="flex-1 h-12 min-h-12 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800 hover:bg-green-50 dark:hover:bg-green-900/20"
                                    onClick={() => {
                                      navigate(
                                        `/teacher/classroom/${id}/assignment/${assignment.id}/preview`,
                                      );
                                    }}
                                  >
                                    {t("classroomDetail.buttons.previewDemo")}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-12 min-h-12 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                                    onClick={() =>
                                      setStickyNoteModal({
                                        open: true,
                                        assignmentIndex: assignments.findIndex(
                                          (a) => a.id === assignment.id,
                                        ),
                                      })
                                    }
                                  >
                                    <StickyNote className="h-5 w-5" />
                                  </Button>
                                  {showArchived ? (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-12 min-h-12 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                                      onClick={() =>
                                        handleUnarchiveAssignment(assignment)
                                      }
                                    >
                                      <ArchiveRestore className="w-4 h-4 mr-1" />
                                      {t(
                                        "classroomDetail.buttons.unarchiveAssignment",
                                      )}
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-12 min-h-12 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                                      onClick={() =>
                                        handleArchiveAssignment(assignment)
                                      }
                                    >
                                      <Archive className="w-4 h-4 mr-1" />
                                      {t(
                                        "classroomDetail.buttons.archiveAssignment",
                                      )}
                                    </Button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Desktop: Table Layout */}
                        <div className="hidden md:block border dark:border-gray-700 rounded-lg overflow-hidden">
                          <table className="w-full">
                            <thead className="bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
                              <tr>
                                {!showArchived && (
                                  <th className="w-10 px-4 py-3">
                                    <Checkbox
                                      checked={
                                        filteredAssignments.length > 0 &&
                                        selectedForPrint.size ===
                                          filteredAssignments.length
                                      }
                                      onCheckedChange={toggleSelectAll}
                                    />
                                  </th>
                                )}
                                <th className="text-left px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-200">
                                  {t("classroomDetail.labels.assignmentTitle")}
                                </th>
                                <th className="text-left px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-200">
                                  {t("classroomDetail.labels.contentType")}
                                </th>
                                <th className="text-left px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-200">
                                  {t("classroomDetail.labels.assignedTo")}
                                </th>
                                <th className="text-left px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-200">
                                  {t("classroomDetail.labels.dueDate")}
                                </th>
                                <th className="text-left px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-200">
                                  {t(
                                    "classroomDetail.labels.completionProgress",
                                  )}
                                </th>
                                <th className="text-left px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-200">
                                  {t("common.actions", "操作")}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {paginatedAssignments.map((assignment) => {
                                const completionRate =
                                  assignment.completion_rate || 0;
                                // 🎯 Issue #118: 根據 content_type + practice_mode 決定顯示標籤
                                const getTypeInfo = () => {
                                  const contentType =
                                    assignment.content_type?.toUpperCase();
                                  const practiceMode = assignment.practice_mode;

                                  // VOCABULARY_SET 或 SENTENCE_MAKING → 根據 practice_mode
                                  if (
                                    contentType === "VOCABULARY_SET" ||
                                    contentType === "SENTENCE_MAKING"
                                  ) {
                                    if (practiceMode === "word_selection") {
                                      return {
                                        label: t(
                                          "classroomDetail.contentTypes.WORD_SELECTION",
                                        ),
                                        color:
                                          "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
                                      };
                                    }
                                    // default: word_reading
                                    return {
                                      label: t(
                                        "classroomDetail.contentTypes.WORD_READING",
                                      ),
                                      color:
                                        "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
                                    };
                                  }

                                  // EXAMPLE_SENTENCES 或 READING_ASSESSMENT → 根據 practice_mode
                                  if (
                                    contentType === "EXAMPLE_SENTENCES" ||
                                    contentType === "READING_ASSESSMENT"
                                  ) {
                                    if (practiceMode === "rearrangement") {
                                      return {
                                        label: t(
                                          "classroomDetail.contentTypes.REARRANGEMENT",
                                        ),
                                        color:
                                          "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
                                      };
                                    }
                                    return {
                                      label: t(
                                        "classroomDetail.contentTypes.SPEAKING",
                                      ),
                                      color:
                                        "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
                                    };
                                  }

                                  // 其他類型
                                  const otherTypeLabels: Record<
                                    string,
                                    { label: string; color: string }
                                  > = {
                                    SPEAKING_PRACTICE: {
                                      label: t(
                                        "classroomDetail.contentTypes.speakingPractice",
                                      ),
                                      color:
                                        "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
                                    },
                                    SPEAKING_SCENARIO: {
                                      label: t(
                                        "classroomDetail.contentTypes.speakingScenario",
                                      ),
                                      color:
                                        "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
                                    },
                                    LISTENING_CLOZE: {
                                      label: t(
                                        "classroomDetail.contentTypes.listeningCloze",
                                      ),
                                      color:
                                        "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
                                    },
                                    SPEAKING_QUIZ: {
                                      label: t(
                                        "classroomDetail.contentTypes.speakingQuiz",
                                      ),
                                      color:
                                        "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
                                    },
                                  };

                                  return (
                                    otherTypeLabels[contentType || ""] || {
                                      label: t(
                                        "classroomDetail.labels.unknownType",
                                      ),
                                      color:
                                        "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
                                    }
                                  );
                                };
                                const typeInfo = getTypeInfo();

                                return (
                                  <tr
                                    key={assignment.id}
                                    className="border-b hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:border-gray-600"
                                  >
                                    {!showArchived && (
                                      <td className="w-10 px-4 py-3">
                                        <Checkbox
                                          checked={selectedForPrint.has(
                                            assignment.id,
                                          )}
                                          onCheckedChange={() =>
                                            togglePrintSelection(assignment.id)
                                          }
                                        />
                                      </td>
                                    )}
                                    <td className="px-4 py-3">
                                      <div className="font-medium dark:text-gray-100">
                                        {assignment.title}
                                      </div>
                                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-gray-500 dark:text-gray-400">
                                        <span
                                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeInfo.color}`}
                                        >
                                          {typeInfo.label}
                                        </span>
                                        <span>
                                          {assignment.student_count
                                            ? t(
                                                "classroomDetail.labels.studentCountWithUnit",
                                                {
                                                  count:
                                                    assignment.student_count,
                                                },
                                              )
                                            : t(
                                                "classroomDetail.labels.allClass",
                                              )}
                                        </span>
                                        <span>
                                          {assignment.created_at
                                            ? new Date(
                                                assignment.created_at,
                                              ).toLocaleDateString("zh-TW")
                                            : "—"}
                                          {" ~ "}
                                          {assignment.due_date
                                            ? new Date(
                                                assignment.due_date,
                                              ).toLocaleDateString("zh-TW")
                                            : t(
                                                "classroomDetail.labels.noDeadline",
                                              )}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <span
                                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${typeInfo.color}`}
                                      >
                                        {typeInfo.label}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-sm dark:text-gray-300">
                                      {assignment.student_count
                                        ? t(
                                            "classroomDetail.labels.studentCountWithUnit",
                                            {
                                              count: assignment.student_count,
                                            },
                                          )
                                        : t("classroomDetail.labels.allClass")}
                                    </td>
                                    <td className="px-4 py-3 text-sm dark:text-gray-300">
                                      {assignment.due_date
                                        ? new Date(
                                            assignment.due_date,
                                          ).toLocaleDateString("zh-TW")
                                        : t(
                                            "classroomDetail.labels.noDeadline",
                                          )}
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-2">
                                        <div className="w-24 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                          <div
                                            className="bg-green-500 dark:bg-green-600 h-2 rounded-full"
                                            style={{
                                              width: `${completionRate}%`,
                                            }}
                                          ></div>
                                        </div>
                                        <span className="text-sm text-gray-600 dark:text-gray-400 w-10">
                                          {completionRate}%
                                        </span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex gap-2">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="text-blue-600 hover:text-blue-700 dark:text-blue-400 h-10 min-h-10"
                                          onClick={() => {
                                            navigate(
                                              `/teacher/classroom/${id}/assignment/${assignment.id}`,
                                            );
                                          }}
                                        >
                                          {t(
                                            "classroomDetail.buttons.viewDetails",
                                          )}
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="text-green-600 hover:text-green-700 dark:text-green-400 h-10 min-h-10"
                                          onClick={() => {
                                            navigate(
                                              `/teacher/classroom/${id}/assignment/${assignment.id}/preview`,
                                            );
                                          }}
                                        >
                                          {t(
                                            "classroomDetail.buttons.previewDemo",
                                          )}
                                        </Button>
                                        {/* 🆕 rearrangement / word_selection 模式不顯示 AI 批改按鈕 */}
                                        {assignment.practice_mode !==
                                          "rearrangement" &&
                                          assignment.practice_mode !==
                                            "word_selection" &&
                                          (canUseAiGrading ? (
                                            <Button
                                              variant="default"
                                              size="sm"
                                              className="h-10 min-h-10 bg-purple-600 hover:bg-purple-700 text-white"
                                              onClick={() => {
                                                setBatchGradingModal({
                                                  open: true,
                                                  assignmentId: assignment.id,
                                                  classroomId: Number(id),
                                                });
                                              }}
                                            >
                                              <Sparkles className="w-4 h-4 mr-1" />
                                              {t(
                                                "assignmentDetail.buttons.batchGrade",
                                              )}
                                            </Button>
                                          ) : (
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              className="h-10 min-h-10"
                                              onClick={() => {
                                                navigate(
                                                  `/teacher/classroom/${id}/assignment/${assignment.id}`,
                                                );
                                              }}
                                            >
                                              <Eye className="w-4 h-4 mr-1" />
                                              {t(
                                                "classroomDetail.buttons.viewDetails",
                                              )}
                                            </Button>
                                          ))}
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="text-amber-600 hover:text-amber-700 dark:text-amber-400 h-10 min-h-10"
                                          onClick={() =>
                                            setStickyNoteModal({
                                              open: true,
                                              assignmentIndex:
                                                assignments.findIndex(
                                                  (a) => a.id === assignment.id,
                                                ),
                                            })
                                          }
                                        >
                                          <StickyNote className="h-5 w-5" />
                                        </Button>
                                        {showArchived ? (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-orange-600 hover:text-orange-700 dark:text-orange-400 h-10 min-h-10"
                                            onClick={() =>
                                              handleUnarchiveAssignment(
                                                assignment,
                                              )
                                            }
                                          >
                                            <ArchiveRestore className="w-4 h-4 mr-1" />
                                            {t(
                                              "classroomDetail.buttons.unarchiveAssignment",
                                            )}
                                          </Button>
                                        ) : (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 h-10 min-h-10"
                                            onClick={() =>
                                              handleArchiveAssignment(
                                                assignment,
                                              )
                                            }
                                          >
                                            <Archive className="w-4 h-4 mr-1" />
                                            {t(
                                              "classroomDetail.buttons.archiveAssignment",
                                            )}
                                          </Button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {totalAssignmentPages > 1 && (
                          <div className="flex items-center justify-center gap-4 pt-4">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={assignmentPage === 1}
                              onClick={() =>
                                setAssignmentPage((p) => Math.max(1, p - 1))
                              }
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <span className="text-sm text-gray-600 dark:text-gray-400">
                              {t("classroomDetail.pagination.page", {
                                current: assignmentPage,
                                total: totalAssignmentPages,
                              })}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={assignmentPage === totalAssignmentPages}
                              onClick={() =>
                                setAssignmentPage((p) =>
                                  Math.min(totalAssignmentPages, p + 1),
                                )
                              }
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="border dark:border-gray-700 rounded-lg p-8 text-center text-gray-500 dark:text-gray-400">
                        {showArchived
                          ? t("classroomDetail.messages.noArchivedAssignments")
                          : t("classroomDetail.messages.noAssignments")}
                      </div>
                    )}
                  </div>
                </TabsContent>
              )}
            </Tabs>
          </div>
        </div>

        {/* Right Sliding Panel */}
        <div
          className={`fixed right-0 top-0 h-full w-full md:w-1/2 bg-white shadow-xl border-l transform transition-transform duration-300 z-50 ${
            isPanelOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          {selectedContent && (
            <div className="h-full flex flex-col">
              {/* Panel Header */}
              <div className="flex items-center justify-between p-4 border-b bg-gray-50">
                <h2 className="text-lg font-semibold text-gray-900">
                  {t("classroomDetail.labels.editContent")}
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={closePanel}
                  className="hover:bg-gray-200"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {/* Panel Content */}
              <div className="flex-1 overflow-y-auto p-4">
                {selectedContent.type?.toLowerCase() === "reading_assessment" ||
                selectedContent.type?.toLowerCase() === "example_sentences" ? (
                  /* ReadingAssessmentPanel has its own save button */
                  /* EXAMPLE_SENTENCES uses the same panel as READING_ASSESSMENT */
                  <ReadingAssessmentPanel
                    content={selectedContent as ReadingAssessmentContent}
                    editingContent={
                      editingContent as ReadingAssessmentContent | undefined
                    }
                    onUpdateContent={(
                      updatedContent: Record<string, unknown>,
                    ) => {
                      setEditingContent(updatedContent as unknown as Content);
                    }}
                    onSave={handleSaveContent}
                  />
                ) : selectedContent.type?.toLowerCase() === "sentence_making" ||
                  selectedContent.type?.toLowerCase() === "vocabulary_set" ? (
                  /* VocabularySetPanel has its own save button */
                  <VocabularySetPanel
                    content={selectedContent as ReadingAssessmentContent}
                    editingContent={
                      editingContent as ReadingAssessmentContent | undefined
                    }
                    onUpdateContent={(
                      updatedContent: Record<string, unknown>,
                    ) => {
                      setEditingContent(updatedContent as unknown as Content);
                    }}
                    onSave={handleSaveContent}
                  />
                ) : (
                  /* Other Content Types */
                  <div className="space-y-4">
                    {/* Content Info */}
                    <div className="bg-blue-50 p-3 rounded-lg">
                      <p className="text-sm font-medium text-blue-900">
                        {selectedContent.programName}
                      </p>
                      <p className="text-xs text-blue-700 mt-1">
                        {selectedContent.lessonName}
                      </p>
                    </div>

                    {/* Content Type Badge */}
                    <div className="flex items-center space-x-2">
                      <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                        {(() => {
                          const Icon = getContentTypeIcon(selectedContent.type);
                          return <Icon className="h-4 w-4 text-purple-600" />;
                        })()}
                      </div>
                      <div>
                        <p className="font-medium">{selectedContent.type}</p>
                        <p className="text-sm text-gray-500">
                          {t("classroomDetail.labels.itemsCount", {
                            count: Array.isArray(selectedContent.items)
                              ? selectedContent.items.length
                              : selectedContent.items_count || 0,
                          })}{" "}
                          •{" "}
                          {t("classroomDetail.labels.estimatedTime", {
                            time: selectedContent.estimated_time || "10",
                          })}
                        </p>
                      </div>
                    </div>

                    {/* Content Items - 真實內容編輯介面 */}
                    <div className="space-y-3">
                      <h4 className="font-medium text-sm">
                        {t("classroomDetail.labels.contentItems")}
                      </h4>
                      {editingContent &&
                      editingContent.items &&
                      editingContent.items.length > 0 ? (
                        editingContent.items.map(
                          (
                            item: {
                              text?: string;
                              translation?: string;
                              question?: string;
                              answer?: string;
                              options?: string[];
                            },
                            index: number,
                          ) => (
                            <div
                              key={index}
                              className="border rounded-lg p-3 space-y-2"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">
                                  {t("classroomDetail.labels.item")} {index + 1}
                                </span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleDeleteContentItem(index)}
                                >
                                  <Trash2 className="h-3 w-3 text-red-500" />
                                </Button>
                              </div>
                              <input
                                type="text"
                                className="w-full px-3 py-2 border rounded-md text-sm"
                                placeholder={t(
                                  "classroomDetail.labels.englishContent",
                                )}
                                value={item.text || ""}
                                onChange={(e) =>
                                  handleUpdateContentItem(
                                    index,
                                    "text",
                                    e.target.value,
                                  )
                                }
                              />
                              <input
                                type="text"
                                className="w-full px-3 py-2 border rounded-md text-sm"
                                placeholder={t(
                                  "classroomDetail.labels.chineseTranslation",
                                )}
                                value={item.translation || ""}
                                onChange={(e) =>
                                  handleUpdateContentItem(
                                    index,
                                    "translation",
                                    e.target.value,
                                  )
                                }
                              />
                              <div className="flex items-center space-x-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="flex-1"
                                >
                                  <Mic className="h-4 w-4 mr-1" />
                                  {t("classroomDetail.buttons.record")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-600"
                                  onClick={() => handleDeleteContentItem(index)}
                                >
                                  {t("common.delete")}
                                </Button>
                              </div>
                            </div>
                          ),
                        )
                      ) : (
                        <div className="text-center py-8 text-gray-500">
                          <p>{t("classroomDetail.labels.noContentItems")}</p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={handleAddContentItem}
                          >
                            <Plus className="h-4 w-4 mr-1" />
                            {t("classroomDetail.buttons.addItem")}
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Add Item Button - only show if there are items */}
                    {editingContent &&
                      editingContent.items &&
                      editingContent.items.length > 0 && (
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={handleAddContentItem}
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          {t("classroomDetail.buttons.addItem")}
                        </Button>
                      )}
                  </div>
                )}
              </div>

              {/* Panel Footer - Only show for types that don't have their own save button */}
              {selectedContent.type?.toLowerCase() !== "reading_assessment" &&
                selectedContent.type?.toLowerCase() !== "example_sentences" &&
                selectedContent.type?.toLowerCase() !== "sentence_making" &&
                selectedContent.type?.toLowerCase() !== "vocabulary_set" && (
                  <div className="p-4 border-t bg-gray-50">
                    <div className="flex space-x-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={closePanel}
                      >
                        {t("classroomDetail.buttons.cancel")}
                      </Button>
                      <Button className="flex-1" onClick={handleSaveContent}>
                        <Save className="h-4 w-4 mr-2" />
                        {t("classroomDetail.buttons.saveChanges")}
                      </Button>
                    </div>
                  </div>
                )}
            </div>
          )}
        </div>
      </div>

      {/* Student Dialogs */}
      <StudentDialogs
        student={selectedStudent}
        dialogType={dialogType}
        onClose={handleCloseDialog}
        onSave={handleSaveStudent}
        onDelete={handleDeleteStudent}
        onSwitchToEdit={handleSwitchToEdit}
        classrooms={classroom ? [classroom] : []}
      />

      {/* Program Dialog */}
      <ProgramDialog
        program={selectedProgram}
        dialogType={programDialogType}
        classroomId={Number(id)}
        onClose={() => {
          setSelectedProgram(null);
          setProgramDialogType(null);
        }}
        onSave={handleSaveProgram}
        onDelete={handleDeleteProgramConfirm}
      />

      {/* Lesson Dialog */}
      <LessonDialog
        lesson={selectedLesson}
        dialogType={lessonDialogType}
        programId={lessonProgramId}
        currentLessonCount={
          lessonProgramId
            ? programs.find((p) => p.id === lessonProgramId)?.lessons?.length ||
              0
            : 0
        }
        onClose={() => {
          setSelectedLesson(null);
          setLessonDialogType(null);
          setLessonProgramId(undefined);
        }}
        onSave={handleSaveLesson}
        onDelete={handleDeleteLessonConfirm}
      />

      {/* Create Program Dialog - Three Ways */}
      <CreateProgramDialog
        open={showCopyDialog}
        onClose={() => setShowCopyDialog(false)}
        onSuccess={() => {
          fetchPrograms(); // Refresh programs after creating
        }}
        classroomId={Number(id)}
        classroomName={classroom?.name || ""}
      />

      {/* Assignment Dialog */}
      <AssignmentDialog
        open={showAssignmentDialog}
        onClose={() => setShowAssignmentDialog(false)}
        classroomId={Number(id)}
        students={students}
        onSuccess={() => {
          fetchAssignments(); // Refresh assignments after creating
        }}
      />

      {/* Assignment Details Dialog */}
      {showAssignmentDetails && selectedAssignment && (
        <Dialog
          open={showAssignmentDetails}
          onOpenChange={setShowAssignmentDetails}
        >
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold">
                {t("classroomDetail.dialogs.assignmentDetailTitle", {
                  title: selectedAssignment.title,
                })}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-6">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm text-gray-600">
                    {t("classroomDetail.labels.contentType")}
                  </Label>
                  <p className="font-medium">
                    {(() => {
                      const contentTypeLabels: Record<string, string> = {
                        READING_ASSESSMENT: t(
                          "classroomDetail.contentTypes.readingAssessment",
                        ),
                        SPEAKING_PRACTICE: t(
                          "classroomDetail.contentTypes.speakingPractice",
                        ),
                        SPEAKING_SCENARIO: t(
                          "classroomDetail.contentTypes.speakingScenario",
                        ),
                        LISTENING_CLOZE: t(
                          "classroomDetail.contentTypes.listeningCloze",
                        ),
                        SENTENCE_MAKING: t(
                          "classroomDetail.contentTypes.sentenceMaking",
                        ),
                        SPEAKING_QUIZ: t(
                          "classroomDetail.contentTypes.speakingQuiz",
                        ),
                      };
                      return (
                        contentTypeLabels[
                          selectedAssignment.content_type || ""
                        ] ||
                        selectedAssignment.content_type ||
                        t("classroomDetail.labels.unknownType")
                      );
                    })()}
                  </p>
                </div>
                <div>
                  <Label className="text-sm text-gray-600">
                    {t("classroomDetail.labels.assignedDate")}
                  </Label>
                  <p className="font-medium">
                    {selectedAssignment.assigned_at
                      ? new Date(
                          selectedAssignment.assigned_at,
                        ).toLocaleDateString("zh-TW")
                      : t("classroomDetail.labels.notSet")}
                  </p>
                </div>
                <div>
                  <Label className="text-sm text-gray-600">
                    {t("classroomDetail.labels.dueDate")}
                  </Label>
                  <p className="font-medium">
                    {selectedAssignment.due_date
                      ? new Date(
                          selectedAssignment.due_date,
                        ).toLocaleDateString("zh-TW")
                      : t("classroomDetail.labels.noDeadline")}
                  </p>
                </div>
                <div>
                  <Label className="text-sm text-gray-600">
                    {t("classroomDetail.labels.assignedStudents")}
                  </Label>
                  <p className="font-medium">
                    {selectedAssignment.student_count || 0} 人
                  </p>
                </div>
              </div>

              {/* Instructions */}
              {selectedAssignment.instructions && (
                <div>
                  <Label className="text-sm text-gray-600">
                    {t("classroomDetail.labels.instructions")}
                  </Label>
                  <Card className="p-4 mt-2 bg-gray-50">
                    <p className="text-sm">{selectedAssignment.instructions}</p>
                  </Card>
                </div>
              )}

              {/* Progress */}
              <div>
                <Label className="text-sm text-gray-600 mb-3 block">
                  {t("classroomDetail.labels.completionProgress")}
                </Label>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {t("classroomDetail.labels.overallCompletionRate")}
                    </span>
                    <span className="text-2xl font-bold text-blue-600">
                      {selectedAssignment.completion_rate || 0}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-green-500 h-3 rounded-full transition-all"
                      style={{
                        width: `${selectedAssignment.completion_rate || 0}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Student Completion Dashboard */}
              <div>
                <Label className="text-sm text-gray-600 mb-3 block">
                  {t("classroomDetail.labels.studentList")}
                </Label>
                <StudentCompletionDashboard
                  assignmentId={selectedAssignment.id}
                  classroomId={Number(id)}
                  onRefresh={fetchAssignments}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => {
                    // TODO: Implement view student submissions
                    toast.info(
                      t(
                        "classroomDetail.messages.viewSubmissionsInDevelopment",
                      ),
                    );
                  }}
                >
                  <Users className="h-4 w-4 mr-2" />
                  {t("classroomDetail.buttons.viewSubmissions")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleEditAssignment(selectedAssignment)}
                >
                  <Edit className="h-4 w-4 mr-2" />
                  {t("classroomDetail.buttons.editAssignment")}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleDeleteAssignment(selectedAssignment)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t("classroomDetail.buttons.deleteAssignment")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Content Type Dialog */}
      {contentLessonInfo && (
        <ContentTypeDialog
          open={showContentTypeDialog}
          onClose={() => {
            setShowContentTypeDialog(false);
            setContentLessonInfo(null);
          }}
          onSelect={handleContentTypeSelect}
          lessonInfo={contentLessonInfo}
        />
      )}

      {/* Reading Assessment Editor */}
      {showReadingEditor && editorLessonId && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="relative w-full max-w-7xl max-h-[90vh] bg-white rounded-lg p-6 flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold">
                {t("classroomDetail.labels.readingAssessmentSettings")}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setShowReadingEditor(false);
                  setEditorLessonId(null);
                  setEditorContentId(null);
                }}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
              <ReadingAssessmentPanel
                content={undefined}
                editingContent={{ id: editorContentId || undefined }}
                lessonId={editorLessonId}
                onUpdateContent={() => {}}
                onSave={async () => {
                  // ReadingAssessmentPanel handles save internally
                  // Just close the editor on successful save
                  setShowReadingEditor(false);
                  setEditorLessonId(null);
                  setEditorContentId(null);
                  await refreshPrograms();
                  toast.success(t("classroomDetail.messages.contentSaved"));
                }}
                onCancel={() => {
                  setShowReadingEditor(false);
                  setEditorLessonId(null);
                  setEditorContentId(null);
                }}
                isCreating={!editorContentId}
              />
            </div>
          </div>
        </div>
      )}

      {/* Sentence Making Editor */}
      {showVocabularySetEditor && vocabularySetLessonId && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="relative w-full max-w-7xl max-h-[90vh] bg-white rounded-lg p-6 flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold">
                {t("vocabularySet.dialogTitle")}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setShowVocabularySetEditor(false);
                  setVocabularySetLessonId(null);
                  setVocabularySetContentId(null);
                }}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
              <VocabularySetPanel
                content={undefined}
                editingContent={{ id: vocabularySetContentId ?? undefined }}
                lessonId={vocabularySetLessonId}
                onUpdateContent={() => {}}
                onSave={async (
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  savedContent?: any,
                ) => {
                  // 即時更新前端狀態，不重整頁面
                  if (savedContent && vocabularySetLessonId) {
                    if (vocabularySetContentId) {
                      // 編輯模式：更新 title
                      setPrograms((prevPrograms) =>
                        prevPrograms.map((program) => ({
                          ...program,
                          lessons: program.lessons?.map((lesson) => ({
                            ...lesson,
                            contents: lesson.contents?.map((content) =>
                              content.id === vocabularySetContentId
                                ? { ...content, ...savedContent }
                                : content,
                            ),
                          })),
                        })),
                      );
                    } else {
                      // 新增模式：加入新內容
                      setPrograms((prevPrograms) =>
                        prevPrograms.map((program) => ({
                          ...program,
                          lessons: program.lessons?.map((lesson) => {
                            if (lesson.id === vocabularySetLessonId) {
                              return {
                                ...lesson,
                                contents: [
                                  ...(lesson.contents || []),
                                  savedContent,
                                ],
                              };
                            }
                            return lesson;
                          }),
                        })),
                      );
                    }
                  }
                  setShowVocabularySetEditor(false);
                  setVocabularySetLessonId(null);
                  setVocabularySetContentId(null);
                  toast.success(t("classroomDetail.messages.contentSaved"));
                }}
                onCancel={() => {
                  setShowVocabularySetEditor(false);
                  setVocabularySetLessonId(null);
                  setVocabularySetContentId(null);
                }}
                isCreating={!vocabularySetContentId}
              />
            </div>
          </div>
        </div>
      )}

      {/* Batch Grading Modal */}
      <BatchGradingModal
        open={batchGradingModal.open}
        onOpenChange={(open) =>
          setBatchGradingModal({ ...batchGradingModal, open })
        }
        assignmentId={batchGradingModal.assignmentId}
        classroomId={batchGradingModal.classroomId}
        onComplete={() => {
          setBatchGradingModal({
            open: false,
            assignmentId: 0,
            classroomId: 0,
          });
          fetchAssignments();
        }}
      />

      {/* Sticky Note Modal */}
      <AssignmentStickyNote
        open={stickyNoteModal.open}
        onClose={() => setStickyNoteModal({ open: false, assignmentIndex: 0 })}
        assignments={assignments}
        initialAssignmentIndex={stickyNoteModal.assignmentIndex}
        classroomId={Number(id)}
      />
    </>
  );
}
