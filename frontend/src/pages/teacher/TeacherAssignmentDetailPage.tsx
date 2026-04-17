import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import TeacherLayout from "@/components/TeacherLayout";
import ReadingAssessmentPanel from "@/components/ReadingAssessmentPanel";
import VocabularySetPanel from "@/components/VocabularySetPanel";
import BatchGradingModal from "@/components/BatchGradingModal";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import {
  ArrowLeft,
  Edit2,
  Save,
  X,
  Calendar,
  Users,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Search,
  BookOpen,
  Sparkles,
} from "lucide-react";
import { Student, Assignment } from "@/types";
import { cn } from "@/lib/utils";
// dnd-kit imports
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

// Extended assignment interface for this specific page
interface AssignmentDetail extends Assignment {
  content_type: string;
  content_id: number;
  assigned_date?: string; // Alternative field name
  students?: number[]; // Alternative field name
  practice_mode?:
    | "reading"
    | "rearrangement"
    | "word_reading"
    | "word_selection"; // 練習模式
  content?: {
    title: string;
    type: string;
    items?: Array<{
      text?: string;
      question?: string;
      answer?: string;
      options?: string[];
    }>;
    target_wpm?: number;
    target_accuracy?: number;
    time_limit_seconds?: number;
  };
}

interface StudentProgress {
  student_id: number; // 🔥 改為 student_id (資料庫主鍵)
  student_number: string; // 🔥 student_number 是學號字串（如 "S002"）
  student_name: string;
  // 對應後端 AssignmentStatus
  status:
    | "NOT_STARTED"
    | "IN_PROGRESS"
    | "SUBMITTED"
    | "GRADED"
    | "RETURNED"
    | "RESUBMITTED"
    | "unassigned";
  submission_date?: string;
  score?: number;
  attempts?: number;
  last_activity?: string;
  is_assigned?: boolean;
  is_interim_score?: boolean; // #469: 暫存分數標記
  // 🔥 新增時間戳欄位用於狀態進度判斷（方案C）
  timestamps?: {
    started_at?: string;
    submitted_at?: string;
    graded_at?: string;
    returned_at?: string;
    resubmitted_at?: string;
    created_at?: string;
    updated_at?: string;
  };
}

// Content detail type for assignment content items
interface ContentDetail {
  id?: number;
  title?: string;
  items?: Array<{
    id: number;
    text: string;
    translation?: string;
    audio_url?: string;
    definition: string;
    has_student_progress?: boolean;
    distractors?: string[];
    // 統一翻譯欄位 (#366)
    vocabulary_translation?: string;
    vocabulary_translation_lang?: string;
    parts_of_speech?: string[];
  }>;
  type?: string;
  audio_urls?: string[];
}

// 可排序的內容項目組件（移到函數外部）
interface SortableContentItemProps {
  content: {
    id: number;
    title: string;
    type?: string;
    order_index: number;
  };
  index: number;
  totalItems: number; // 總項目數，用於判斷是否可以上下移動
  expandedContentId: number | null;
  contentDetails: Record<number, ContentDetail>;
  onExpand: (id: number) => void;
  onEdit: (id: number) => void;
  onMoveUp: (id: number) => void; // 向上移動
  onMoveDown: (id: number) => void; // 向下移動
  getContentTypeLabel: (type: string) => string;
}

function SortableContentItem({
  content,
  index,
  totalItems,
  expandedContentId,
  contentDetails,
  onExpand,
  onEdit,
  onMoveUp,
  onMoveDown,
  getContentTypeLabel,
}: SortableContentItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: content.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card className="p-3 sm:p-4 hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {/* 移動端上下按鈕 - 只在移動端顯示 */}
            <div className="flex flex-col gap-1 sm:hidden">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onMoveUp(content.id)}
                disabled={index === 0}
                className="h-6 w-6 p-0 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="向上移動"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onMoveDown(content.id)}
                disabled={index === totalItems - 1}
                className="h-6 w-6 p-0 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="向下移動"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
            {/* 拖拽手柄 - 桌面端顯示，移動端隱藏 */}
            <button
              {...attributes}
              {...listeners}
              className="hidden sm:flex cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 active:text-gray-700 touch-manipulation flex-shrink-0 p-1"
              aria-label="拖拽排序"
            >
              <GripVertical className="h-5 w-5" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 mb-2 flex-wrap">
                <span className="text-xs sm:text-sm font-bold text-blue-600 flex-shrink-0">
                  #{index + 1}
                </span>
                <span className="font-medium text-sm sm:text-base truncate">
                  {content.title}
                </span>
                <Badge variant="outline" className="text-xs flex-shrink-0">
                  {getContentTypeLabel(content.type || "")}
                </Badge>
              </div>
              {expandedContentId === content.id &&
                contentDetails[content.id] && (
                  <div className="mt-3 space-y-2 p-2 sm:p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <div className="text-xs sm:text-sm">
                      <span className="text-gray-600 dark:text-gray-300">
                        題目數量：
                      </span>
                      <span className="font-medium ml-2">
                        {contentDetails[content.id].items?.length || 0} 題
                      </span>
                    </div>
                    {contentDetails[content.id].items?.map((item, idx) => (
                      <div
                        key={idx}
                        className="text-xs p-2 bg-white dark:bg-gray-800 rounded break-words"
                      >
                        <span className="text-gray-600 dark:text-gray-400">
                          {idx + 1}.
                        </span>{" "}
                        <span className="font-medium">{item.text}</span>
                        {item.translation && (
                          <span className="text-gray-500 ml-2">
                            ({item.translation})
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </div>
          <div className="flex gap-1 sm:gap-2 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onExpand(content.id)}
              className="text-blue-600 hover:text-blue-700 text-xs sm:text-sm px-2 sm:px-3"
            >
              <ChevronRight
                className={cn(
                  "h-3 w-3 sm:h-4 sm:w-4 transition-transform",
                  expandedContentId === content.id && "rotate-90",
                )}
              />
              <span className="hidden sm:inline ml-1">展開</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(content.id)}
              className="text-orange-600 hover:text-orange-700 border-orange-200 hover:bg-orange-50 text-xs sm:text-sm px-2 sm:px-3"
            >
              <Edit2 className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-1" />
              <span className="hidden sm:inline">編輯</span>
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function TeacherAssignmentDetailPage() {
  const { t } = useTranslation();
  const { classroomId, assignmentId } = useParams<{
    classroomId: string;
    assignmentId: string;
  }>();
  const navigate = useNavigate();

  // 檢查是否有 editContent 查詢參數
  const searchParams = new URLSearchParams(window.location.search);
  const shouldEditContent = searchParams.get("editContent") === "true";

  const [assignment, setAssignment] = useState<AssignmentDetail | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentProgress, setStudentProgress] = useState<StudentProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editingData, setEditingData] = useState<Partial<AssignmentDetail>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedContent, setExpandedContent] = useState(shouldEditContent); // 如果有 editContent 參數，自動展開
  const [assignmentContents, setAssignmentContents] = useState<
    Array<{
      id: number;
      title: string;
      type?: string;
      order_index: number;
    }>
  >([]);
  const [expandedContentId, setExpandedContentId] = useState<number | null>(
    null,
  );
  const [editingContentId, setEditingContentId] = useState<number | null>(null);
  const [contentDetails, setContentDetails] = useState<
    Record<number, ContentDetail>
  >({});
  const [activeDragId, setActiveDragId] = useState<number | null>(null); // 追蹤正在拖拽的項目
  const [showBatchGradingModal, setShowBatchGradingModal] = useState(false);
  const [canUseAiGrading, setCanUseAiGrading] = useState<boolean>(true);

  // 🔥 追蹤正在載入的內容 ID，避免重複請求（Race Condition 保護）
  const loadingRef = useRef<Set<number>>(new Set());

  // dnd-kit sensors - 優化移動端拖拽體驗
  // PointerSensor 同時支持鼠標和觸摸事件
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        // 移動端：需要按住一段時間或移動一定距離才開始拖拽（避免與滾動衝突）
        delay: 150, // 150ms 延遲，給滾動留出時間
        tolerance: 8, // 允許 8px 的移動容差（避免輕微觸摸就觸發拖拽）
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Fetch AI grading availability
  useEffect(() => {
    apiClient
      .getTeacherDashboard()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((data: any) => {
        setCanUseAiGrading(data.can_use_ai_grading ?? true);
      })
      .catch(() => {
        // Default to true if fetch fails
      });
  }, []);

  useEffect(() => {
    let isActive = true;
    const abortController = new AbortController();

    const fetchData = async () => {
      if (!isActive) return;

      // Fetch in sequence to ensure dependencies are met
      await fetchAssignmentDetail();
      if (!isActive) return;

      await fetchStudents();
      if (!isActive) return;

      // Don't fail if progress API doesn't exist
      try {
        await fetchStudentProgress();
      } catch {
        // Progress API might not exist yet, which is okay
      }
    };

    if (classroomId && assignmentId) {
      fetchData();
    }

    return () => {
      isActive = false;
      abortController.abort();
    };
  }, [classroomId, assignmentId]);

  const fetchAssignmentDetail = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<
        AssignmentDetail & {
          assigned_at?: string;
          assigned_date?: string;
          created_at?: string;
          students_progress?: Array<{ student_number: number }>;
        }
      >(`/api/teachers/assignments/${assignmentId}`);

      // Handle different possible date field names
      const assignedDate =
        response.assigned_at || response.assigned_date || response.created_at;

      // Extract student IDs - only count actually assigned students, not all students
      let studentIds: number[] = [];
      if (
        response.students_progress &&
        Array.isArray(response.students_progress)
      ) {
        // Only include students who are actually assigned
        studentIds = response.students_progress
          .filter(
            (sp: { is_assigned?: boolean; student_number: number }) =>
              sp.is_assigned === true,
          )
          .map((sp: { student_number: number }) => sp.student_number)
          .filter((id) => id !== null);
      }

      // Process assigned students

      // 獲取作業的副本內容列表
      const contents =
        (
          response as {
            contents?: Array<{
              id: number;
              title: string;
              type?: string;
              order_index: number;
            }>;
          }
        ).contents || [];
      setAssignmentContents(contents);

      // 從 contents 陣列取得第一個內容的類型
      const firstContentType = contents.length > 0 ? contents[0].type : null;

      const assignmentData = {
        ...response,
        assigned_at: assignedDate,
        students: studentIds,
        student_count: studentIds.length,
        content_type: firstContentType || "", // 🔥 從 contents 陣列取得類型
        instructions:
          (response as AssignmentDetail & { description?: string })
            .description || response.instructions, // API returns 'description'
      };

      setAssignment(assignmentData);
      setEditingData({
        title: response.title,
        instructions:
          (response as AssignmentDetail & { description?: string })
            .description || response.instructions,
        due_date: response.due_date ? response.due_date.split("T")[0] : "",
      });
    } catch (error) {
      console.error("Failed to fetch assignment detail:", error);
      toast.error(t("assignmentDetail.messages.loadError"));
      // Set mock data for development
      const mockAssignment: AssignmentDetail = {
        id: Number(assignmentId),
        title: "作業標題",
        instructions: "作業說明",
        content_type: "READING_ASSESSMENT",
        content_id: 1,
        due_date: "2025-09-30",
        assigned_at: new Date().toISOString(),
        classroom_id: Number(classroomId),
        students: [1, 2], // Mock 2 assigned students
        student_count: 2,
        completion_rate: 0,
      };
      setAssignment(mockAssignment);
      setEditingData({
        title: mockAssignment.title,
        instructions: mockAssignment.instructions,
        due_date: mockAssignment.due_date,
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchStudents = async () => {
    try {
      const response = await apiClient.get(
        `/api/teachers/classrooms/${classroomId}/students`,
      );
      const studentList = Array.isArray(response) ? response : [];
      setStudents(studentList);
    } catch (error) {
      console.error("Failed to fetch students:", error);
    }
  };

  const [isLoadingProgress, setIsLoadingProgress] = useState(false);

  const fetchStudentProgress = async () => {
    if (isLoadingProgress) {
      // Skip duplicate request silently
      return;
    }

    setIsLoadingProgress(true);
    // Loading progress...
    try {
      // Try to get progress data from API
      let response;
      try {
        response = await apiClient.get(
          `/api/teachers/assignments/${assignmentId}/progress`,
        );
      } catch {
        // If API doesn't exist, create empty response
        response = [];
      }

      // Handle both array and object responses
      const progressArray = Array.isArray(response)
        ? response
        : (response as { data?: unknown[] }).data || [];

      // Progress loaded successfully

      // If we have progress data from API
      if (progressArray.length > 0) {
        // Create a map of progress data
        const progressMap = new Map();

        interface ProgressItem {
          student_id?: number; // 🔥 加入 student_id 欄位 (資料庫主鍵)
          student_number?: number;
          id?: number;
          student_name?: string;
          name?: string;
          status?: string;
          submission_date?: string;
          submitted_at?: string;
          score?: number;
          grading?: { score?: number };
          feedback?: string;
          attempts?: number;
          last_activity?: string;
          updated_at?: string;
          timestamps?: StudentProgress["timestamps"];
          is_assigned?: boolean; // 🔥 加入 is_assigned 欄位
          is_interim_score?: boolean; // #469: 暫存分數標記
        }

        progressArray.forEach((item: ProgressItem) => {
          // 🔥 重要：item.student_id 是 student 的資料庫 ID (整數)
          // item.student_number 是學號 (字串，如 "S002")
          const studentId = item.student_id; // 🔥 修復：使用 student_id 而非 id
          const studentNumber = item.student_number || ""; // 學號是字串

          // 🔥 修復：使用 API 回傳的真實 is_assigned 值
          const isAssigned = item.is_assigned === true;

          progressMap.set(studentId, {
            student_id: studentId, // 🔥 資料庫 ID
            student_number: studentNumber, // 🔥 學號字串
            student_name: item.student_name || item.name || "未知學生",
            status: item.status || (isAssigned ? "NOT_STARTED" : "unassigned"),
            submission_date: item.submission_date || item.submitted_at,
            score: item.score,
            attempts: item.attempts || 0,
            last_activity: item.last_activity || item.updated_at,
            timestamps: item.timestamps, // 🔥 加入 timestamps
            is_assigned: isAssigned, // 🔥 使用真實值而不是強制設為 true
            is_interim_score: item.is_interim_score || false,
          });
        });

        // Add all classroom students

        // Check if students are loaded - only show data we have from API
        if (students && students.length > 0) {
          const allProgress = students.map((student) => {
            if (progressMap.has(student.id)) {
              const progress = progressMap.get(student.id);
              return progress!; // 🔥 確保不是 undefined
            } else {
              // If no progress data for this student, they are unassigned
              return {
                student_id: student.id, // 🔥 資料庫 ID
                student_number: student.student_number || "", // 🔥 學號字串
                student_name: student.name,
                status: "unassigned" as const,
                submission_date: undefined,
                score: undefined,
                attempts: 0,
                last_activity: undefined,
                is_assigned: false,
              };
            }
          });
          setStudentProgress(allProgress);
        } else {
          // If students not loaded yet, just use the progress data we have
          const progressList = Array.from(progressMap.values());
          setStudentProgress(progressList);
        }
      } else {
        // No progress data from API - API must provide real data
        // No progress data available
        setStudentProgress([]);
      }
    } catch (error) {
      console.error("Failed to fetch student progress:", error);
      // API failed - show empty, don't create fake data
      setStudentProgress([]);
    } finally {
      setIsLoadingProgress(false);
    }
  };

  const handleSave = async () => {
    if (!editingData.title) {
      toast.error(t("assignmentDetail.messages.titleRequired"));
      return;
    }

    try {
      // Use PATCH for partial update
      const updateData = {
        title: editingData.title,
        instructions: editingData.instructions || "",
        due_date: editingData.due_date
          ? `${editingData.due_date}T00:00:00`
          : undefined,
      };

      await apiClient.patch(
        `/api/teachers/assignments/${assignmentId}`,
        updateData,
      );
      toast.success(t("assignmentDetail.messages.updateSuccess"));
      setIsEditing(false);

      // Update local state immediately
      if (assignment) {
        setAssignment({
          ...assignment,
          title: updateData.title,
          instructions: updateData.instructions,
          due_date: updateData.due_date,
        });
      }

      // Refresh from server
      fetchAssignmentDetail();
    } catch (error) {
      console.error("Failed to update assignment:", error);
      toast.error(t("assignmentDetail.messages.updateFailed"));
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditingData({
      title: assignment?.title,
      instructions: assignment?.instructions,
      due_date: assignment?.due_date ? assignment.due_date.split("T")[0] : "",
    });
  };

  const loadContentDetail = async (contentId: number, forceReload = false) => {
    // 🔥 如果已有緩存且不強制重載，直接返回（避免重複請求）
    if (!forceReload && contentDetails[contentId]) {
      return;
    }

    // 🔥 正在載入中，避免重複請求（Race Condition 保護）
    if (loadingRef.current.has(contentId)) {
      return;
    }

    loadingRef.current.add(contentId);

    try {
      const detail = await apiClient.getContentDetail(contentId);
      setContentDetails((prev) => ({
        ...prev,
        [contentId]: detail as ContentDetail,
      }));
    } catch (error) {
      console.error("Failed to load content detail:", error);
      toast.error(
        t("assignmentDetail.messages.loadContentError") || "無法載入內容詳情",
      );
    } finally {
      // 🔥 請求完成後移除標記（無論成功或失敗）
      loadingRef.current.delete(contentId);
    }
  };

  const handleAssignStudent = async (studentId: number) => {
    try {
      // Get current assigned students from studentProgress
      const currentAssignedIds = studentProgress
        .filter((p) => p.is_assigned === true)
        .map((p) => p.student_id);
      const updatedStudentIds = [...currentAssignedIds, studentId];

      // Update assignment with new student list
      await apiClient.patch(`/api/teachers/assignments/${assignmentId}`, {
        student_ids: updatedStudentIds, // 🔥 修復：後端期望 student_ids 而非 students
      });

      // Update local state
      if (assignment) {
        setAssignment({
          ...assignment,
          students: updatedStudentIds,
          student_count: updatedStudentIds.length,
        });
      }

      // Update student progress
      setStudentProgress((prev) =>
        prev.map((p) =>
          p.student_id === studentId // 🔥 使用 student_id 比較，不是 student_number
            ? { ...p, status: "NOT_STARTED" as const, is_assigned: true }
            : p,
        ),
      );

      // Refresh progress data to ensure sync
      await fetchStudentProgress();

      toast.success(t("assignmentDetail.messages.assignSuccess"));
    } catch (error) {
      console.error("Failed to assign student:", error);
      toast.error(t("assignmentDetail.messages.assignFailed"));
    }
  };

  const handleUnassignStudent = async (
    studentId: number,
    studentName: string,
    status: string,
  ) => {
    // 🔥 重要：studentId 現在是資料庫的整數 ID，不是學號字串
    try {
      // Check if student has started
      if (status === "in_progress") {
        const confirmed = window.confirm(
          t("assignmentDetail.messages.unassignConfirm", { name: studentName }),
        );
        if (!confirmed) return;
      } else if (
        status === "submitted" ||
        status === "completed" ||
        status === "graded"
      ) {
        toast.error(
          t("assignmentDetail.messages.cannotUnassignCompleted", {
            name: studentName,
          }),
        );
        return;
      }

      // Call unassign API
      const response = await apiClient.post(
        `/api/teachers/assignments/${assignmentId}/unassign`,
        {
          student_ids: [studentId],
          force: status === "in_progress",
        },
      );

      interface UnassignResponse {
        protected?: Array<{ reason: string }>;
      }

      if (response && typeof response === "object" && "protected" in response) {
        const typedResponse = response as UnassignResponse;
        if (
          typedResponse.protected &&
          Array.isArray(typedResponse.protected) &&
          typedResponse.protected.length > 0
        ) {
          toast.warning(typedResponse.protected[0].reason);
          return;
        }
      }

      // Update local state - get current assigned students from studentProgress
      const currentAssignedIds = studentProgress
        .filter((p) => p.is_assigned === true)
        .map((p) => p.student_id);
      const updatedStudentIds = currentAssignedIds.filter(
        (id: number) => id !== studentId,
      );

      if (assignment) {
        setAssignment({
          ...assignment,
          students: updatedStudentIds,
          student_count: updatedStudentIds.length,
        });
      }

      // Update student progress
      setStudentProgress((prev) =>
        prev.map((p) =>
          p.student_id === studentId // 🔥 使用 student_id 比較，不是 student_number
            ? { ...p, status: "unassigned" as const, is_assigned: false }
            : p,
        ),
      );

      // Refresh progress data to ensure sync
      await fetchStudentProgress();

      toast.success(
        t("assignmentDetail.messages.unassignSuccess", { name: studentName }),
      );
    } catch (error) {
      console.error("Failed to unassign student:", error);
      toast.error(t("assignmentDetail.messages.unassignFailed"));
    }
  };

  // 處理拖拽開始
  const handleContentDragStart = (event: DragStartEvent) => {
    setActiveDragId(Number(event.active.id));
  };

  // 處理拖拽排序
  const handleContentDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null); // 清除拖拽狀態

    if (over && active.id !== over.id) {
      const oldIndex = assignmentContents.findIndex(
        (c) => c.id === Number(active.id),
      );
      const newIndex = assignmentContents.findIndex(
        (c) => c.id === Number(over.id),
      );

      // 🔥 保存舊順序（用於錯誤恢復）
      const oldContents = [...assignmentContents];

      // 立即更新 UI（樂觀更新）
      const newContents = arrayMove(assignmentContents, oldIndex, newIndex);
      setAssignmentContents(newContents);

      // 🔥 背景保存順序（不刷新頁面）
      try {
        const orderData = newContents.map((content, index) => ({
          content_id: content.id,
          order_index: index + 1,
        }));

        await apiClient.put(
          `/api/teachers/assignments/${assignmentId}/contents/reorder`,
          orderData,
        );

        // 靜默成功，不顯示 toast（用戶已經看到順序改變）
      } catch (error) {
        console.error("Failed to reorder contents:", error);
        // 恢復原順序
        setAssignmentContents(oldContents);
        toast.error("更新順序失敗，已恢復原順序");
      }
    }
  };

  // 處理向上移動（移動端按鈕）
  const handleMoveUp = async (contentId: number) => {
    const currentIndex = assignmentContents.findIndex(
      (c) => c.id === contentId,
    );
    if (currentIndex <= 0) return; // 已經是最上面

    const newIndex = currentIndex - 1;
    const oldContents = [...assignmentContents];
    const newContents = arrayMove(assignmentContents, currentIndex, newIndex);
    setAssignmentContents(newContents);

    try {
      const orderData = newContents.map((content, index) => ({
        content_id: content.id,
        order_index: index + 1,
      }));

      await apiClient.put(
        `/api/teachers/assignments/${assignmentId}/contents/reorder`,
        orderData,
      );
    } catch (error) {
      console.error("Failed to move content up:", error);
      setAssignmentContents(oldContents);
      toast.error("移動失敗，請重試");
    }
  };

  // 處理向下移動（移動端按鈕）
  const handleMoveDown = async (contentId: number) => {
    const currentIndex = assignmentContents.findIndex(
      (c) => c.id === contentId,
    );
    if (currentIndex >= assignmentContents.length - 1) return; // 已經是最下面

    const newIndex = currentIndex + 1;
    const oldContents = [...assignmentContents];
    const newContents = arrayMove(assignmentContents, currentIndex, newIndex);
    setAssignmentContents(newContents);

    try {
      const orderData = newContents.map((content, index) => ({
        content_id: content.id,
        order_index: index + 1,
      }));

      await apiClient.put(
        `/api/teachers/assignments/${assignmentId}/contents/reorder`,
        orderData,
      );
    } catch (error) {
      console.error("Failed to move content down:", error);
      setAssignmentContents(oldContents);
      toast.error("移動失敗，請重試");
    }
  };

  const getContentTypeLabel = (type: string) => {
    // API 可能返回: reading_assessment, READING_ASSESSMENT, EXAMPLE_SENTENCES 等
    // 翻譯檔案中有多種格式的 key，按優先順序嘗試

    // 1. 先嘗試原始值（大寫 SNAKE_CASE）
    const originalKey = `assignmentDetail.contentTypes.${type}`;
    const originalTranslated = t(originalKey);
    if (originalTranslated !== originalKey) {
      return originalTranslated;
    }

    // 2. 嘗試小寫 snake_case
    const lowerType = type.toLowerCase();
    const lowerKey = `assignmentDetail.contentTypes.${lowerType}`;
    const lowerTranslated = t(lowerKey);
    if (lowerTranslated !== lowerKey) {
      return lowerTranslated;
    }

    // 3. 嘗試 gradingPage.contentTypes（大寫格式）
    const gradingKey = `gradingPage.contentTypes.${type}`;
    const gradingTranslated = t(gradingKey);
    if (gradingTranslated !== gradingKey) {
      return gradingTranslated;
    }

    // 4. 如果都失敗，返回原始值
    return type;
  };

  // Calculate statistics (only for assigned students)
  const assignedProgress = studentProgress.filter(
    (p) => p.status !== "unassigned",
  );
  const stats = {
    total: assignedProgress.length,
    notStarted: assignedProgress.filter((p) => p.status === "NOT_STARTED")
      .length,
    inProgress: assignedProgress.filter((p) => p.status === "IN_PROGRESS")
      .length,
    submitted: assignedProgress.filter((p) => p.status === "SUBMITTED").length,
    returned: assignedProgress.filter((p) => p.status === "RETURNED").length,
    resubmitted: assignedProgress.filter((p) => p.status === "RESUBMITTED")
      .length,
    graded: assignedProgress.filter((p) => p.status === "GRADED").length,
    unassigned: studentProgress.filter((p) => p.status === "unassigned").length,
  };

  const completionRate =
    stats.total > 0 ? Math.round((stats.graded / stats.total) * 100) : 0;

  // Filter students
  const filteredProgress = studentProgress.filter((progress) => {
    const matchesSearch = progress.student_name
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesStatus =
      statusFilter === "all" || progress.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return (
      <TeacherLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">{t("common.loading")}</p>
          </div>
        </div>
      </TeacherLayout>
    );
  }

  if (!assignment) {
    return (
      <TeacherLayout>
        <div className="text-center py-12">
          <p className="text-gray-500">
            {t("assignmentDetail.messages.notFound")}
          </p>
          <Button
            className="mt-4"
            onClick={() =>
              navigate(`/teacher/classroom/${classroomId}?tab=assignments`)
            }
          >
            {t("assignmentDetail.buttons.backToList")}
          </Button>
        </div>
      </TeacherLayout>
    );
  }

  return (
    <TeacherLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="space-y-4">
          {/* Back Button & Title */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <Button
              variant="ghost"
              onClick={() =>
                navigate(`/teacher/classroom/${classroomId}?tab=assignments`)
              }
              className="h-12 min-h-12 w-full sm:w-auto"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("assignmentDetail.buttons.backToList")}
            </Button>
            <div className="flex-1">
              {isEditing ? (
                <Input
                  value={editingData.title || ""}
                  onChange={(e) =>
                    setEditingData({ ...editingData, title: e.target.value })
                  }
                  className="text-xl sm:text-2xl font-bold h-12"
                  placeholder={t("assignmentDetail.labels.assignmentTitle")}
                />
              ) : (
                <h1 className="text-2xl sm:text-3xl font-bold dark:text-gray-100">
                  {assignment.title}
                </h1>
              )}
            </div>
          </div>

          {/* Action Buttons - rearrangement 和 word_selection 模式隱藏所有批改按鈕 */}
          {assignment?.practice_mode !== "rearrangement" &&
            assignment?.practice_mode !== "word_selection" && (
              <div className="flex flex-row gap-2 sm:gap-3">
                {/* 批改作業按鈕 */}
                <Button
                  onClick={() =>
                    navigate(
                      `/teacher/classroom/${classroomId}/assignment/${assignmentId}/grading`,
                    )
                  }
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-700 dark:text-white h-12 min-h-12 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-blue-400 dark:focus:ring-offset-gray-800"
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  {t("assignmentDetail.buttons.gradeAssignment")}
                </Button>
                {/* AI批改按鈕 — 只有額度足夠時顯示 (#227) */}
                {canUseAiGrading && (
                  <div className="flex-1 flex flex-col">
                    <Button
                      onClick={() => setShowBatchGradingModal(true)}
                      disabled={stats.total === 0}
                      className={cn(
                        "w-full h-12 min-h-12 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-blue-400 dark:focus:ring-offset-gray-800",
                        "bg-purple-600 hover:bg-purple-700 text-white dark:bg-purple-600 dark:hover:bg-purple-700 dark:text-white",
                        "disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed dark:disabled:bg-gray-700 dark:disabled:text-gray-500",
                      )}
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      {t("assignmentDetail.buttons.batchGrade")}
                    </Button>
                  </div>
                )}
              </div>
            )}
        </div>

        {/* Assignment Info Card */}
        <Card className="relative p-4 sm:p-6 dark:bg-gray-800 dark:border-gray-700">
          {/* 編輯按鈕 - 右上角 */}
          {isEditing ? (
            <div className="absolute top-4 right-4 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleCancel();
                }}
                className="text-gray-600 hover:text-gray-700 border-gray-200 hover:bg-gray-50"
              >
                <X className="h-4 w-4 mr-1" />
                {t("assignmentDetail.buttons.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSave();
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Save className="h-4 w-4 mr-1" />
                {t("assignmentDetail.buttons.save")}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsEditing(true);
              }}
              className="absolute top-4 right-4 text-orange-600 hover:text-orange-700 border-orange-200 hover:bg-orange-50"
            >
              <Edit2 className="h-4 w-4 mr-1" />
              {t("assignmentDetail.buttons.edit")}
            </Button>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <label className="text-sm text-gray-600 dark:text-gray-300 mb-2 block">
                {t("assignmentDetail.labels.contentType")}
              </label>
              <Badge
                variant="outline"
                className="text-base dark:border-gray-600 dark:text-gray-200"
              >
                {assignment.content_type
                  ? getContentTypeLabel(assignment.content_type)
                  : t("assignmentDetail.labels.notSet")}
              </Badge>
            </div>
            <div>
              <label className="text-sm text-gray-600 dark:text-gray-300 mb-2 block">
                {t("assignmentDetail.labels.assignedDate")}
              </label>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <span className="dark:text-gray-200">
                  {assignment.assigned_at || assignment.created_at
                    ? new Date(
                        assignment.assigned_at || assignment.created_at || "",
                      ).toLocaleDateString("zh-TW")
                    : t("assignmentDetail.labels.notSet")}
                </span>
              </div>
            </div>
            <div>
              <label className="text-sm text-gray-600 dark:text-gray-300 mb-2 block">
                {t("assignmentDetail.labels.dueDate")}
              </label>
              {isEditing ? (
                <Input
                  type="date"
                  value={
                    editingData.due_date
                      ? editingData.due_date.split("T")[0]
                      : ""
                  }
                  onChange={(e) =>
                    setEditingData({ ...editingData, due_date: e.target.value })
                  }
                  className="dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                />
              ) : (
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  <span className="dark:text-gray-200">
                    {assignment.due_date
                      ? new Date(assignment.due_date).toLocaleDateString(
                          "zh-TW",
                        )
                      : t("assignmentDetail.labels.notSet")}
                  </span>
                </div>
              )}
            </div>
            <div>
              <label className="text-sm text-gray-600 dark:text-gray-300 mb-2 block">
                {t("assignmentDetail.labels.assignedStudents")}
              </label>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <span className="dark:text-gray-200">
                  {(() => {
                    // Only use progress data - count students with is_assigned = true
                    const assignedCount = studentProgress.filter(
                      (p) => p.is_assigned === true,
                    ).length;

                    // Progress stats updated

                    return `${assignedCount} ${t("assignmentDetail.labels.people")}`;
                  })()}
                </span>
              </div>
            </div>
          </div>

          {/* Instructions */}
          <div className="mt-6">
            <label className="text-sm text-gray-600 dark:text-gray-300 mb-2 block">
              {t("assignmentDetail.labels.instructions")}
            </label>
            {isEditing ? (
              <Textarea
                value={editingData.instructions || ""}
                onChange={(e) =>
                  setEditingData({
                    ...editingData,
                    instructions: e.target.value,
                  })
                }
                placeholder={t(
                  "assignmentDetail.labels.instructionsPlaceholder",
                )}
                rows={3}
                className="dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
              />
            ) : (
              <p className="text-gray-700 dark:text-gray-200">
                {assignment.instructions ||
                  t("assignmentDetail.labels.noInstructions")}
              </p>
            )}
          </div>
        </Card>

        {/* 作業單元內容列表 (Assignment Copy Contents) */}
        {assignmentContents.length > 0 && (
          <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
            <div
              className="flex items-center justify-between cursor-pointer"
              onClick={() => setExpandedContent(!expandedContent)}
            >
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <h3 className="text-lg font-semibold dark:text-gray-100">
                  作業單元內容 ({assignmentContents.length})
                </h3>
              </div>
              {expandedContent ? (
                <ChevronUp className="dark:text-gray-300" />
              ) : (
                <ChevronDown className="dark:text-gray-300" />
              )}
            </div>

            {expandedContent && (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleContentDragStart}
                onDragEnd={handleContentDragEnd}
              >
                <SortableContext
                  items={assignmentContents.map((c) => c.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="mt-4 space-y-2">
                    {assignmentContents.map((content, index) => (
                      <SortableContentItem
                        key={content.id}
                        content={content}
                        index={index}
                        totalItems={assignmentContents.length}
                        expandedContentId={expandedContentId}
                        contentDetails={contentDetails}
                        onExpand={(id) => {
                          if (expandedContentId === id) {
                            setExpandedContentId(null);
                          } else {
                            setExpandedContentId(id);
                            loadContentDetail(id);
                          }
                        }}
                        onEdit={(id) => {
                          setEditingContentId(id);
                          loadContentDetail(id);
                        }}
                        onMoveUp={handleMoveUp}
                        onMoveDown={handleMoveDown}
                        getContentTypeLabel={getContentTypeLabel}
                      />
                    ))}
                  </div>
                </SortableContext>
                {/* 拖拽視覺反饋 - 移動端優化 */}
                <DragOverlay>
                  {activeDragId ? (
                    <Card className="p-4 shadow-lg opacity-90 bg-white dark:bg-gray-800 border-2 border-blue-500">
                      <div className="flex items-center gap-2">
                        <GripVertical className="h-5 w-5 text-gray-400" />
                        <span className="font-medium">
                          {assignmentContents.find((c) => c.id === activeDragId)
                            ?.title || "移動中..."}
                        </span>
                      </div>
                    </Card>
                  ) : null}
                </DragOverlay>
              </DndContext>
            )}
          </Card>
        )}

        {/* 編輯副本內容對話框 */}
        {editingContentId && contentDetails[editingContentId] && (
          <Dialog
            open={editingContentId !== null}
            onOpenChange={(open) => !open && setEditingContentId(null)}
          >
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {t("assignmentDetail.labels.editContent", "編輯作業內容")}
                </DialogTitle>
                <p className="text-sm text-amber-600 mt-2">
                  ⚠️ 注意：此為作業副本。刪除已有學生進度的題目將被阻止。
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
                        editingContent={contentDetails[editingContentId]}
                        onUpdateContent={async () => {}}
                        onSave={handleEditSave}
                        lessonId={0}
                        isCreating={false}
                        isAssignmentCopy={
                          assignment?.practice_mode === "word_selection"
                        }
                      />
                    );
                  }

                  return (
                    <ReadingAssessmentPanel
                      content={{
                        id: editingContentId,
                        title: contentDetails[editingContentId].title || "",
                      }}
                      editingContent={contentDetails[editingContentId]}
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

        {/* Progress Overview */}
        <Card className="p-4 sm:p-6 dark:bg-gray-800 dark:border-gray-700">
          <h3 className="text-base sm:text-lg font-semibold mb-4 dark:text-gray-100">
            {t("assignmentDetail.labels.completionRate")}
          </h3>

          {/* Completion Rate */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {t("assignmentDetail.labels.overallCompletionRate")}
              </span>
              <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {completionRate}%
              </span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
              <div
                className="bg-gradient-to-r from-blue-500 to-green-500 h-3 rounded-full transition-all"
                style={{ width: `${completionRate}%` }}
              />
            </div>
          </div>

          {/* Status Progress */}
          <div className="relative overflow-x-auto pb-4">
            <div className="min-w-[800px] relative">
              {/* Progress Line */}
              <div
                className="absolute top-8 left-0 right-0 h-0.5 bg-gray-200 dark:bg-gray-700"
                style={{ zIndex: 0 }}
              >
                <div
                  className="h-full bg-gradient-to-r from-gray-400 via-blue-500 to-green-500"
                  style={{ width: `${completionRate}%` }}
                />
              </div>

              {/* Status Cards - Horizontal Progress */}
              <div className="relative flex justify-between items-start">
                {/* 已指派 */}
                <div className="flex flex-col items-center flex-1">
                  <div className="w-16 h-16 rounded-full bg-gray-100 border-4 border-white shadow-sm flex items-center justify-center relative z-10">
                    <div className="text-xl font-bold text-gray-600">
                      {stats.total}
                    </div>
                  </div>
                  <div className="text-xs text-gray-600 mt-2 font-medium">
                    {t("assignmentDetail.labels.assigned")}
                  </div>
                  <div className="text-xs text-gray-400">
                    {stats.total} {t("assignmentDetail.labels.people")}
                  </div>
                </div>

                {/* Arrow */}
                <div className="flex-shrink-0 flex items-center pt-6">
                  <ChevronRight className="h-5 w-5 text-gray-400" />
                </div>

                {/* 未開始 */}
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-16 h-16 rounded-full ${stats.notStarted > 0 ? "bg-gray-100" : "bg-gray-50"} border-4 border-white shadow-sm flex items-center justify-center relative z-10`}
                  >
                    <div
                      className={`text-xl font-bold ${stats.notStarted > 0 ? "text-gray-500" : "text-gray-300"}`}
                    >
                      {stats.notStarted}
                    </div>
                  </div>
                  <div className="text-xs text-gray-600 mt-2 font-medium">
                    {t("assignmentDetail.labels.notStarted")}
                  </div>
                </div>

                {/* Arrow */}
                <div className="flex-shrink-0 flex items-center pt-6">
                  <ChevronRight className="h-5 w-5 text-gray-400" />
                </div>

                {/* 進行中 */}
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-16 h-16 rounded-full ${stats.inProgress > 0 ? "bg-blue-100" : "bg-gray-50"} border-4 border-white shadow-sm flex items-center justify-center relative z-10`}
                  >
                    <div
                      className={`text-xl font-bold ${stats.inProgress > 0 ? "text-blue-600" : "text-gray-300"}`}
                    >
                      {stats.inProgress}
                    </div>
                  </div>
                  <div className="text-xs text-gray-600 mt-2 font-medium">
                    {t("assignmentDetail.labels.inProgress")}
                  </div>
                </div>

                {/* rearrangement 和 word_selection 模式：隱藏 已提交/待訂正/已訂正 步驟 */}
                {assignment?.practice_mode !== "rearrangement" &&
                  assignment?.practice_mode !== "word_selection" && (
                    <>
                      {/* Arrow */}
                      <div className="flex-shrink-0 flex items-center pt-6">
                        <ChevronRight className="h-5 w-5 text-gray-400" />
                      </div>

                      {/* 已提交 */}
                      <div className="flex flex-col items-center flex-1">
                        <div
                          className={`w-16 h-16 rounded-full ${stats.submitted > 0 ? "bg-orange-100" : "bg-gray-50"} border-4 border-white shadow-sm flex items-center justify-center relative z-10`}
                        >
                          <div
                            className={`text-xl font-bold ${stats.submitted > 0 ? "text-orange-600" : "text-gray-300"}`}
                          >
                            {stats.submitted}
                          </div>
                        </div>
                        <div className="text-xs text-gray-600 mt-2 font-medium">
                          {t("assignmentDetail.labels.submitted")}
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="flex-shrink-0 flex items-center pt-6">
                        <ChevronRight className="h-5 w-5 text-gray-400" />
                      </div>

                      {/* 待訂正 */}
                      <div className="flex flex-col items-center flex-1">
                        <div
                          className={`w-16 h-16 rounded-full ${stats.returned > 0 ? "bg-red-100" : "bg-gray-50"} border-4 border-white shadow-sm flex items-center justify-center relative z-10`}
                        >
                          <div
                            className={`text-xl font-bold ${stats.returned > 0 ? "text-red-600" : "text-gray-300"}`}
                          >
                            {stats.returned}
                          </div>
                        </div>
                        <div className="text-xs text-gray-600 mt-2 font-medium">
                          {t("assignmentDetail.labels.returned")}
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="flex-shrink-0 flex items-center pt-6">
                        <ChevronRight className="h-5 w-5 text-gray-400" />
                      </div>

                      {/* 已訂正 */}
                      <div className="flex flex-col items-center flex-1">
                        <div
                          className={`w-16 h-16 rounded-full ${stats.resubmitted > 0 ? "bg-purple-100" : "bg-gray-50"} border-4 border-white shadow-sm flex items-center justify-center relative z-10`}
                        >
                          <div
                            className={`text-xl font-bold ${stats.resubmitted > 0 ? "text-purple-600" : "text-gray-300"}`}
                          >
                            {stats.resubmitted}
                          </div>
                        </div>
                        <div className="text-xs text-gray-600 mt-2 font-medium">
                          {t("assignmentDetail.labels.resubmitted")}
                        </div>
                      </div>
                    </>
                  )}

                {/* Arrow */}
                <div className="flex-shrink-0 flex items-center pt-6">
                  <ChevronRight className="h-5 w-5 text-gray-400" />
                </div>

                {/* 已完成 */}
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-16 h-16 rounded-full ${stats.graded > 0 ? "bg-green-100" : "bg-gray-50"} border-4 border-white shadow-sm flex items-center justify-center relative z-10`}
                  >
                    <div
                      className={`text-xl font-bold ${stats.graded > 0 ? "text-green-600" : "text-gray-300"}`}
                    >
                      {stats.graded}
                    </div>
                  </div>
                  <div className="text-xs text-gray-600 mt-2 font-medium">
                    {t("assignmentDetail.labels.graded")}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Student List */}
        <Card className="p-4 sm:p-6 dark:bg-gray-800 dark:border-gray-700">
          <div className="space-y-4 mb-4">
            <div>
              <h3 className="text-base sm:text-lg font-semibold mb-2 dark:text-gray-100">
                {t("assignmentDetail.labels.studentList")}
              </h3>
              {/* Legend */}
              <div className="flex items-center gap-3 sm:gap-4 text-xs flex-wrap">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-gray-200 dark:bg-gray-600" />
                  <span className="text-gray-600 dark:text-gray-400">
                    {t("gradingPage.labels.notReached")}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="relative w-3 h-3">
                    <div className="absolute inset-0 w-3 h-3 rounded-full bg-blue-500" />
                    <div className="absolute inset-0 w-3 h-3 rounded-full bg-blue-400 animate-ping" />
                  </div>
                  <span className="text-gray-600 dark:text-gray-400">
                    {t("gradingPage.labels.currentStatus")}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="text-gray-600 dark:text-gray-400">
                    {t("gradingPage.labels.completed")}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
              {/* Search */}
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder={t("assignmentDetail.labels.searchPlaceholder")}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 w-full h-12 min-h-12 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                />
              </div>

              {/* Status Filter - 🆕 rearrangement 模式只顯示 4 種狀態 */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border rounded-md h-12 min-h-12 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
              >
                <option value="all">
                  {t("assignmentDetail.labels.allStatuses")}
                </option>
                <option value="unassigned">
                  {t("assignmentDetail.labels.unassigned")}
                </option>
                <option value="NOT_STARTED">
                  {t("assignmentDetail.labels.notStarted")}
                </option>
                <option value="IN_PROGRESS">
                  {t("assignmentDetail.labels.inProgress")}
                </option>
                {/* rearrangement 和 word_selection 模式隱藏 已提交/待訂正/已訂正 */}
                {assignment?.practice_mode !== "rearrangement" &&
                  assignment?.practice_mode !== "word_selection" && (
                    <>
                      <option value="SUBMITTED">
                        {t("assignmentDetail.labels.submitted")}
                      </option>
                      <option value="RETURNED">
                        {t("assignmentDetail.labels.returned")}
                      </option>
                      <option value="RESUBMITTED">
                        {t("assignmentDetail.labels.resubmitted")}
                      </option>
                    </>
                  )}
                <option value="GRADED">
                  {t("assignmentDetail.labels.graded")}
                </option>
              </select>
            </div>
          </div>

          {/* Mobile: Card Layout */}
          <div className="md:hidden space-y-3">
            {filteredProgress.length > 0 ? (
              filteredProgress.map((progress) => {
                const isAssigned = progress.is_assigned === true;
                const currentStatus =
                  progress.status?.toUpperCase() || "NOT_STARTED";

                // Get status info for display
                const getStatusInfo = () => {
                  if (!isAssigned)
                    return {
                      label: t("assignmentDetail.labels.unassigned"),
                      color:
                        "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400",
                    };

                  // rearrangement 和 word_selection 模式：SUBMITTED/RETURNED/RESUBMITTED 都顯示為「已完成」
                  const isSimplifiedMode =
                    assignment?.practice_mode === "rearrangement" ||
                    assignment?.practice_mode === "word_selection";
                  if (
                    isSimplifiedMode &&
                    (currentStatus === "SUBMITTED" ||
                      currentStatus === "RETURNED" ||
                      currentStatus === "RESUBMITTED" ||
                      currentStatus === "GRADED")
                  ) {
                    return {
                      label: t("assignmentDetail.labels.graded"),
                      color:
                        "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300",
                    };
                  }

                  switch (currentStatus) {
                    case "NOT_STARTED":
                      return {
                        label: t("assignmentDetail.labels.notStarted"),
                        color:
                          "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300",
                      };
                    case "IN_PROGRESS":
                      return {
                        label: t("assignmentDetail.labels.inProgress"),
                        color:
                          "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300",
                      };
                    case "SUBMITTED":
                      return {
                        label: t("assignmentDetail.labels.submitted"),
                        color:
                          "bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300",
                      };
                    case "RETURNED":
                      return {
                        label: t("assignmentDetail.labels.returned"),
                        color:
                          "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300",
                      };
                    case "RESUBMITTED":
                      return {
                        label: t("assignmentDetail.labels.resubmitted"),
                        color:
                          "bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300",
                      };
                    case "GRADED":
                      return {
                        label: t("assignmentDetail.labels.graded"),
                        color:
                          "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300",
                      };
                    default:
                      return {
                        label: currentStatus,
                        color:
                          "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400",
                      };
                  }
                };

                const statusInfo = getStatusInfo();
                const upperStatus = currentStatus;

                return (
                  <div
                    key={
                      progress.student_id || `student-${progress.student_name}`
                    }
                    className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-3"
                  >
                    <div className="flex items-center gap-3">
                      {/* Avatar */}
                      <div
                        className={`w-10 h-10 rounded-full ${isAssigned ? "bg-blue-100 dark:bg-blue-900" : "bg-gray-100 dark:bg-gray-700"} flex items-center justify-center flex-shrink-0`}
                      >
                        <span
                          className={`text-sm font-medium ${isAssigned ? "text-blue-600 dark:text-blue-400" : "text-gray-400 dark:text-gray-500"}`}
                        >
                          {progress.student_name.charAt(0)}
                        </span>
                      </div>

                      {/* Name & Status */}
                      <div className="flex-1 min-w-0">
                        <div
                          className={`font-medium text-sm truncate ${!isAssigned ? "text-gray-400 dark:text-gray-500" : "dark:text-gray-100"}`}
                        >
                          {progress.student_name}
                        </div>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                      </div>

                      {/* Action Button */}
                      <div className="flex-shrink-0">
                        {isAssigned ? (
                          <>
                            {/* Issue #165: rearrangement/word_selection 模式不顯示任何批改/查看結果按鈕 */}
                            {assignment?.practice_mode === "rearrangement" ||
                            assignment?.practice_mode === "word_selection"
                              ? null
                              : (upperStatus === "SUBMITTED" ||
                                  upperStatus === "RESUBMITTED" ||
                                  upperStatus === "GRADED" ||
                                  upperStatus === "RETURNED") && (
                                  <Button
                                    variant="outline"
                                    className="text-orange-600 border-orange-600 hover:bg-orange-50 h-12 min-h-12 px-3 text-sm dark:border-orange-500 dark:text-orange-400 dark:hover:bg-orange-900/20"
                                    onClick={() =>
                                      navigate(
                                        `/teacher/classroom/${classroomId}/assignment/${assignmentId}/grading`,
                                      )
                                    }
                                  >
                                    {t("assignmentDetail.buttons.grade")}
                                  </Button>
                                )}
                            {(upperStatus === "NOT_STARTED" ||
                              upperStatus === "IN_PROGRESS") && (
                              <Button
                                variant="outline"
                                className="text-red-600 border-red-600 hover:bg-red-50 h-12 min-h-12 px-3 text-sm dark:border-red-500 dark:text-red-400 dark:hover:bg-red-900/20"
                                onClick={() =>
                                  handleUnassignStudent(
                                    progress.student_id,
                                    progress.student_name,
                                    progress.status,
                                  )
                                }
                              >
                                {t("assignmentDetail.buttons.unassign")}
                              </Button>
                            )}
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            className="text-green-600 border-green-600 hover:bg-green-50 h-12 min-h-12 px-3 text-sm dark:border-green-500 dark:text-green-400 dark:hover:bg-green-900/20"
                            onClick={() =>
                              handleAssignStudent(progress.student_id)
                            }
                          >
                            {t("assignmentDetail.buttons.assign")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="border dark:border-gray-700 rounded-lg p-8 text-center text-gray-500 dark:text-gray-400">
                {t("assignmentDetail.messages.noMatchingStudents")}
              </div>
            )}
          </div>

          {/* Desktop: Table Layout */}
          <div className="hidden md:block border dark:border-gray-700 rounded-lg overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-200 min-w-[150px]">
                    {t("assignmentDetail.labels.studentName")}
                  </th>
                  <th className="px-2 py-3 text-center text-sm font-medium text-gray-700 dark:text-gray-200 w-20">
                    {t("assignmentDetail.labels.assigned")}
                  </th>
                  <th className="px-2 py-3 text-center text-sm font-medium text-gray-700 dark:text-gray-200 w-20">
                    {t("assignmentDetail.labels.notStarted")}
                  </th>
                  <th className="px-2 py-3 text-center text-sm font-medium text-gray-700 dark:text-gray-200 w-20">
                    {t("assignmentDetail.labels.inProgress")}
                  </th>
                  {/* rearrangement 和 word_selection 模式隱藏 已提交/待訂正/已訂正 欄位 */}
                  {assignment?.practice_mode !== "rearrangement" &&
                    assignment?.practice_mode !== "word_selection" && (
                      <>
                        <th className="px-2 py-3 text-center text-sm font-medium text-gray-700 dark:text-gray-200 w-20">
                          {t("assignmentDetail.labels.submitted")}
                        </th>
                        <th className="px-2 py-3 text-center text-sm font-medium text-gray-700 dark:text-gray-200 w-20">
                          {t("assignmentDetail.labels.returned")}
                        </th>
                        <th className="px-2 py-3 text-center text-sm font-medium text-gray-700 dark:text-gray-200 w-20">
                          {t("assignmentDetail.labels.resubmitted")}
                        </th>
                      </>
                    )}
                  <th className="px-2 py-3 text-center text-sm font-medium text-gray-700 dark:text-gray-200 w-20">
                    {t("assignmentDetail.labels.graded")}
                  </th>
                  <th className="px-3 py-3 text-center text-sm font-medium text-gray-700 dark:text-gray-200 w-20">
                    {assignment?.practice_mode === "word_selection"
                      ? t("assignmentDetail.labels.proficiency") || "熟練度"
                      : t("assignmentDetail.labels.score")}
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-700 dark:text-gray-200 min-w-[120px]">
                    {t("assignmentDetail.labels.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredProgress.length > 0 ? (
                  filteredProgress.map((progress) => {
                    // 簡化邏輯：直接使用 is_assigned 欄位
                    const isAssigned = progress.is_assigned === true;
                    const currentStatus =
                      progress.status?.toUpperCase() || "NOT_STARTED";

                    // Status indicator function
                    const getStatusIndicator = (statusName: string) => {
                      const timestamps = progress.timestamps;

                      // 🔥 重新設計：根據當前狀態和時間戳決定每個圓點狀態
                      let isActive = false; // 當前狀態
                      let isPassed = false; // 已經過的狀態

                      // Debug for specific students
                      if (
                        progress.student_name === "蔡雅芳" ||
                        progress.student_name === "謝志偉"
                      ) {
                        // Debug: student status check
                        // currentStatus,
                        // timestamps,
                        // returned_at: timestamps?.returned_at,
                        // resubmitted_at: timestamps?.resubmitted_at
                      }

                      // 根據 currentStatus 和時間戳判斷
                      switch (statusName) {
                        case "ASSIGNED":
                          // 已指派：只有已指派的學生才會顯示這個狀態
                          // Rendered assignment indicator
                          isPassed = isAssigned;
                          isActive =
                            isAssigned && currentStatus === "NOT_STARTED";
                          break;

                        case "NOT_STARTED":
                          // 未開始
                          isActive = currentStatus === "NOT_STARTED";
                          isPassed = [
                            "IN_PROGRESS",
                            "SUBMITTED",
                            "GRADED",
                            "RETURNED",
                            "RESUBMITTED",
                          ].includes(currentStatus);
                          break;

                        case "IN_PROGRESS":
                          // 進行中
                          isActive = currentStatus === "IN_PROGRESS";
                          isPassed = [
                            "SUBMITTED",
                            "GRADED",
                            "RETURNED",
                            "RESUBMITTED",
                          ].includes(currentStatus);
                          break;

                        case "SUBMITTED":
                          // 已提交
                          isActive = currentStatus === "SUBMITTED";
                          isPassed = [
                            "GRADED",
                            "RETURNED",
                            "RESUBMITTED",
                          ].includes(currentStatus);
                          break;

                        case "RETURNED":
                          // 🔥 待訂正：根據當前狀態和時間戳判斷
                          if (currentStatus === "RETURNED") {
                            // 當前狀態就是 RETURNED
                            isActive = true;
                            isPassed = false;
                          } else if (currentStatus === "RESUBMITTED") {
                            // 如果當前是 RESUBMITTED，表示已經過 RETURNED
                            isActive = false;
                            isPassed = true;
                          } else if (
                            currentStatus === "GRADED" &&
                            timestamps?.returned_at
                          ) {
                            // 如果已完成且有 returned_at，表示經過訂正流程
                            isActive = false;
                            isPassed = true;
                          } else {
                            isActive = false;
                            isPassed = false;
                          }
                          break;

                        case "RESUBMITTED":
                          // 🔥 重新提交：當前狀態是 RESUBMITTED
                          if (currentStatus === "RESUBMITTED") {
                            isActive = true;
                            isPassed = false;
                          } else if (
                            timestamps?.resubmitted_at &&
                            timestamps?.returned_at
                          ) {
                            const returnedTime = new Date(
                              timestamps.returned_at,
                            ).getTime();
                            const resubmittedTime = new Date(
                              timestamps.resubmitted_at,
                            ).getTime();
                            if (
                              resubmittedTime > returnedTime &&
                              currentStatus === "GRADED"
                            ) {
                              // 已經批改完成，RESUBMITTED 是過去式
                              isActive = false;
                              isPassed = true;
                            } else {
                              isActive = false;
                              isPassed = false;
                            }
                          } else {
                            isActive = false;
                            isPassed = false;
                          }
                          break;

                        case "GRADED":
                          // 已完成
                          isActive = currentStatus === "GRADED";
                          isPassed = false;
                          break;

                        default:
                          isActive = false;
                          isPassed = false;
                      }

                      let actuallyPassed = isPassed;

                      if (!isAssigned && statusName !== "ASSIGNED") {
                        return (
                          <div className="w-3 h-3 rounded-full bg-gray-200 mx-auto" />
                        );
                      }

                      if (statusName === "ASSIGNED") {
                        return isAssigned ? (
                          <div className="w-3 h-3 rounded-full bg-green-500 mx-auto" />
                        ) : (
                          <div className="w-3 h-3 rounded-full bg-gray-200 mx-auto" />
                        );
                      }

                      if (isActive) {
                        // Current status - special handling for GRADED (completed)
                        if (statusName === "GRADED") {
                          // Completed status - static green circle
                          return (
                            <div className="w-3 h-3 rounded-full bg-green-500 mx-auto" />
                          );
                        } else {
                          // Other current statuses - animated pulse
                          return (
                            <div className="relative w-3 h-3 mx-auto">
                              <div className="absolute inset-0 w-3 h-3 rounded-full bg-blue-500" />
                              <div className="absolute inset-0 w-3 h-3 rounded-full bg-blue-400 animate-ping" />
                            </div>
                          );
                        }
                      }

                      if (actuallyPassed) {
                        // Actually passed through this status
                        return (
                          <div className="w-3 h-3 rounded-full bg-green-400 mx-auto" />
                        );
                      }

                      // Not reached yet or skipped
                      return (
                        <div className="w-3 h-3 rounded-full bg-gray-200 mx-auto" />
                      );
                    };

                    return (
                      <tr
                        key={
                          progress.student_id ||
                          `student-${progress.student_name}`
                        }
                        className={`border-t dark:border-gray-700 ${isAssigned ? "hover:bg-gray-50 dark:hover:bg-gray-700" : "bg-gray-50 dark:bg-gray-800 opacity-60"}`}
                      >
                        <td className="px-4 py-3 min-w-[150px]">
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-8 h-8 rounded-full ${isAssigned ? "bg-blue-100 dark:bg-blue-900" : "bg-gray-100 dark:bg-gray-700"} flex items-center justify-center`}
                            >
                              <span
                                className={`text-sm font-medium ${isAssigned ? "text-blue-600 dark:text-blue-400" : "text-gray-400 dark:text-gray-500"}`}
                              >
                                {progress.student_name.charAt(0)}
                              </span>
                            </div>
                            <span
                              className={`font-medium ${!isAssigned ? "text-gray-400 dark:text-gray-500" : "dark:text-gray-100"}`}
                            >
                              {progress.student_name}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-3 text-center w-20">
                          {getStatusIndicator("ASSIGNED")}
                        </td>
                        <td className="px-2 py-3 text-center w-20">
                          {getStatusIndicator("NOT_STARTED")}
                        </td>
                        <td className="px-2 py-3 text-center w-20">
                          {getStatusIndicator("IN_PROGRESS")}
                        </td>
                        {/* rearrangement 和 word_selection 模式隱藏 已提交/待訂正/已訂正 欄位 */}
                        {assignment?.practice_mode !== "rearrangement" &&
                          assignment?.practice_mode !== "word_selection" && (
                            <>
                              <td className="px-2 py-3 text-center w-20">
                                {getStatusIndicator("SUBMITTED")}
                              </td>
                              <td className="px-2 py-3 text-center w-20">
                                {getStatusIndicator("RETURNED")}
                              </td>
                              <td className="px-2 py-3 text-center w-20">
                                {getStatusIndicator("RESUBMITTED")}
                              </td>
                            </>
                          )}
                        <td className="px-2 py-3 text-center w-20">
                          {getStatusIndicator("GRADED")}
                        </td>
                        <td className="px-3 py-3 text-center w-20">
                          {isAssigned &&
                          (currentStatus === "GRADED" ||
                            currentStatus === "RETURNED" ||
                            (progress.is_interim_score &&
                              progress.score != null)) ? (
                            <span
                              className={`font-bold ${
                                progress.is_interim_score
                                  ? "text-blue-500 dark:text-blue-400 italic"
                                  : progress.score && progress.score >= 80
                                    ? "text-green-600 dark:text-green-400"
                                    : "text-red-600 dark:text-red-400"
                              }`}
                            >
                              {progress.is_interim_score && "~"}
                              {(progress.score || 0).toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-gray-300 dark:text-gray-600">
                              -
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex gap-2 justify-center">
                            {isAssigned ? (
                              <>
                                {(() => {
                                  // 使用大寫的狀態值進行比較
                                  const upperStatus =
                                    progress.status?.toUpperCase();

                                  // Issue #165: rearrangement/word_selection 模式不顯示任何批改/查看結果按鈕
                                  // 只有未開始或進行中可取消指派
                                  if (
                                    assignment?.practice_mode ===
                                    "rearrangement"
                                  ) {
                                    if (
                                      upperStatus === "NOT_STARTED" ||
                                      upperStatus === "IN_PROGRESS"
                                    ) {
                                      return (
                                        <Button
                                          variant="outline"
                                          className="text-red-600 border-red-600 hover:bg-red-50 transition-colors h-12 min-h-12 dark:border-red-500 dark:text-red-400 dark:hover:bg-red-900/20"
                                          onClick={() =>
                                            handleUnassignStudent(
                                              progress.student_id,
                                              progress.student_name,
                                              progress.status,
                                            )
                                          }
                                        >
                                          {t(
                                            "assignmentDetail.buttons.unassign",
                                          )}
                                        </Button>
                                      );
                                    }
                                    return null;
                                  }

                                  // word_selection 模式：不顯示批改按鈕，只有未開始或進行中可取消指派
                                  if (
                                    assignment?.practice_mode ===
                                    "word_selection"
                                  ) {
                                    if (
                                      upperStatus === "NOT_STARTED" ||
                                      upperStatus === "IN_PROGRESS"
                                    ) {
                                      return (
                                        <Button
                                          variant="outline"
                                          className="text-red-600 border-red-600 hover:bg-red-50 transition-colors h-12 min-h-12 dark:border-red-500 dark:text-red-400 dark:hover:bg-red-900/20"
                                          onClick={() =>
                                            handleUnassignStudent(
                                              progress.student_id,
                                              progress.student_name,
                                              progress.status,
                                            )
                                          }
                                        >
                                          {t(
                                            "assignmentDetail.buttons.unassign",
                                          )}
                                        </Button>
                                      );
                                    }
                                    return null;
                                  }

                                  // 如果是已提交、已批改、待訂正或重新提交，顯示批改按鈕
                                  if (
                                    upperStatus === "SUBMITTED" ||
                                    upperStatus === "RESUBMITTED" ||
                                    upperStatus === "GRADED" ||
                                    upperStatus === "RETURNED"
                                  ) {
                                    return (
                                      <Button
                                        variant="outline"
                                        className="text-orange-600 border-orange-600 hover:bg-orange-50 transition-colors h-12 min-h-12 dark:border-orange-500 dark:text-orange-400 dark:hover:bg-orange-900/20"
                                        onClick={() => {
                                          // 導向到批改頁面，帶上 studentId
                                          navigate(
                                            `/teacher/classroom/${classroomId}/assignment/${assignmentId}/grading?studentId=${progress.student_id}`,
                                          );
                                        }}
                                      >
                                        {t("assignmentDetail.buttons.grade")}
                                      </Button>
                                    );
                                  }

                                  // 只有未開始或進行中的才能取消指派
                                  if (
                                    upperStatus === "NOT_STARTED" ||
                                    upperStatus === "IN_PROGRESS"
                                  ) {
                                    return (
                                      <Button
                                        variant="outline"
                                        className="text-red-600 border-red-600 hover:bg-red-50 transition-colors h-12 min-h-12 dark:border-red-500 dark:text-red-400 dark:hover:bg-red-900/20"
                                        onClick={() =>
                                          handleUnassignStudent(
                                            progress.student_id,
                                            progress.student_name,
                                            progress.status,
                                          )
                                        }
                                      >
                                        {t("assignmentDetail.buttons.unassign")}
                                      </Button>
                                    );
                                  }

                                  // 其他狀態不顯示任何按鈕
                                  return null;
                                })()}
                              </>
                            ) : (
                              <Button
                                variant="outline"
                                className="text-green-600 border-green-600 hover:bg-green-50 hover:border-green-700 hover:text-green-700 transition-colors cursor-pointer h-12 min-h-12 dark:border-green-500 dark:text-green-400 dark:hover:bg-green-900/20"
                                onClick={() =>
                                  handleAssignStudent(progress.student_id)
                                }
                              >
                                {t("assignmentDetail.buttons.assign")}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-8 text-center text-gray-500 dark:text-gray-400"
                    >
                      {t("assignmentDetail.messages.noMatchingStudents")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Batch Grading Modal */}
        <BatchGradingModal
          open={showBatchGradingModal}
          onOpenChange={setShowBatchGradingModal}
          assignmentId={Number(assignmentId)}
          classroomId={Number(classroomId)}
          onComplete={() => {
            // Refresh student progress after batch grading
            fetchStudentProgress();
          }}
        />
      </div>
    </TeacherLayout>
  );
}
