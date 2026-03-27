import React, { useState, useEffect, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import {
  Users,
  ChevronRight,
  ChevronDown,
  BookOpen,
  FileText,
  CheckCircle2,
  Circle,
  Package,
  Layers,
  ChevronLeft,
  ArrowRight,
  Check,
  Calendar as CalendarIconAlt,
  Clock,
  MessageSquare,
  Loader2,
  Gauge,
  ShoppingCart,
  GripVertical,
  X,
  Globe,
  Building2,
  Settings,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useWorkspaceSafe } from "@/contexts/WorkspaceContext";

interface Student {
  id: number;
  name: string;
  email?: string; // Make email optional to match global Student type
  student_number?: string; // Student ID number for display and sorting
}

// ContentItem 包含 audio_url 資訊，用於驗證音檔是否存在
interface ContentItemData {
  id: number;
  text: string;
  translation?: string;
  audio_url?: string | null;
}

interface Content {
  id: number;
  title: string;
  type: string;
  lesson_id: number;
  items_count?: number;
  items?: ContentItemData[]; // 包含音檔資訊的項目列表
  level?: string;
}

interface Lesson {
  id: number;
  name: string;
  description?: string;
  order_index: number;
  contents?: Content[];
}

interface Program {
  id: number;
  name: string;
  description?: string;
  level?: string;
  lessons?: Lesson[];
  teacher_id?: number;
  organization_id?: string;
  school_id?: string;
  is_template?: boolean;
}

interface AssignmentDialogProps {
  open: boolean;
  onClose: () => void;
  classroomId: number;
  students: Student[];
  onSuccess?: () => void;
  /** Override organization context (for use outside WorkspaceProvider, e.g. org admin module) */
  organizationId?: string;
  /** Override school context (for use outside WorkspaceProvider, e.g. org admin module) */
  schoolId?: string;
}

// =============================================================================
// Content Type Compatibility Helpers
// =============================================================================
// 處理新舊 ContentType 的相容性：
// - READING_ASSESSMENT (legacy) → EXAMPLE_SENTENCES (new) - 例句集
// - SENTENCE_MAKING (legacy) → VOCABULARY_SET (new) - 單字集

const isExampleSentencesType = (type: string): boolean => {
  const normalizedType = type?.toUpperCase();
  return ["READING_ASSESSMENT", "EXAMPLE_SENTENCES"].includes(normalizedType);
};

const isVocabularySetType = (type: string): boolean => {
  const normalizedType = type?.toUpperCase();
  return ["SENTENCE_MAKING", "VOCABULARY_SET"].includes(normalizedType);
};

// Content type labels - using i18n
// Map READING_ASSESSMENT and EXAMPLE_SENTENCES both to "例句集"
const getContentTypeLabel = (type: string, t: (key: string) => string) => {
  // Normalize type for display - both READING_ASSESSMENT and EXAMPLE_SENTENCES show as "例句集"
  if (isExampleSentencesType(type)) {
    return t(`dialogs.assignmentDialog.contentTypes.EXAMPLE_SENTENCES`);
  }
  if (isVocabularySetType(type)) {
    return t(`dialogs.assignmentDialog.contentTypes.VOCABULARY_SET`);
  }
  return t(`dialogs.assignmentDialog.contentTypes.${type}`) || type;
};

interface QuotaInfo {
  quota_total: number;
  quota_used: number;
  quota_remaining: number;
  plan_name: string;
}

// 購物車項目的詳細資訊（用於排序和顯示）
interface CartItem {
  contentId: number;
  programName: string;
  lessonName: string;
  contentTitle: string;
  contentType: string;
  itemsCount?: number;
  order: number; // 用於排序
  hasMissingAudio: boolean; // 是否有缺少音檔的項目
}

// 可拖曳的購物車項目組件
interface SortableCartItemProps {
  item: CartItem;
  index: number;
  onRemove: (contentId: number) => void;
  t: (key: string) => string;
}

function SortableCartItem({ item, index, onRemove, t }: SortableCartItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.contentId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "p-2 bg-white hover:shadow-md transition-shadow",
        isDragging && "shadow-lg ring-2 ring-blue-500",
      )}
    >
      <div className="flex items-start gap-2">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing mt-1 p-1 hover:bg-gray-100 rounded"
        >
          <GripVertical className="h-4 w-4 text-gray-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-xs font-bold text-blue-600">
              #{index + 1}
            </span>
            <span className="text-xs font-medium truncate">
              {item.contentTitle}
            </span>
          </div>
          <div className="text-xs text-gray-500 truncate">
            {item.programName} / {item.lessonName}
          </div>
          <div className="flex items-center gap-1 mt-1">
            <Badge variant="outline" className="px-1 py-0 text-xs">
              {getContentTypeLabel(item.contentType, t)}
            </Badge>
            {item.itemsCount && (
              <span className="text-xs text-gray-500">
                {item.itemsCount} 題
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => onRemove(item.contentId)}
          className="p-1 hover:bg-red-50 rounded text-red-500 hover:text-red-700"
          title="移除"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </Card>
  );
}

export function AssignmentDialog({
  open,
  onClose,
  classroomId,
  students,
  onSuccess,
  organizationId: propOrganizationId,
  schoolId: propSchoolId,
}: AssignmentDialogProps) {
  const { t } = useTranslation();
  // useWorkspaceSafe 在 WorkspaceProvider 外（如機構管理模組）不會 throw，而是回傳 null
  const workspace = useWorkspaceSafe();

  // 支援 props 覆蓋 WorkspaceContext（用於機構管理模組）
  const effectiveOrganizationId =
    propOrganizationId || workspace?.selectedOrganization?.id || null;
  const effectiveSchoolId =
    propSchoolId || workspace?.selectedSchool?.id || null;
  // 只要有 organizationId（不論來源），就視為機構模式
  const isOrgMode =
    (workspace?.mode === "organization" &&
      workspace?.selectedOrganization !== null) ||
    !!propOrganizationId;

  const [loading, setLoading] = useState(false);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [internalStudents, setInternalStudents] = useState<Student[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [loadingClassroomPrograms, setLoadingClassroomPrograms] =
    useState(false);
  const [loadingOrgPrograms, setLoadingOrgPrograms] = useState(false);
  const [loadingLessons, setLoadingLessons] = useState<Record<number, boolean>>(
    {},
  );
  const [currentStep, setCurrentStep] = useState(1);
  // 只在機構模式且有機構 ID 時顯示「機構教材」tab
  const showOrgTab = isOrgMode && effectiveOrganizationId !== null;

  const [activeTab, setActiveTab] = useState<
    "template" | "classroom" | "organization"
  >(showOrgTab ? "organization" : "template");

  // 學生列表：優先用外部傳入的，否則內部載入的
  const effectiveStudents = students.length > 0 ? students : internalStudents;

  // 分別儲存公版和班級課程
  const [templatePrograms, setTemplatePrograms] = useState<Program[]>([]);
  const [classroomPrograms, setClassroomPrograms] = useState<Program[]>([]);
  const [orgPrograms, setOrgPrograms] = useState<Program[]>([]);

  // Memoize combined programs to avoid repeated array concatenation
  const allPrograms = useMemo(
    () => [...templatePrograms, ...classroomPrograms, ...orgPrograms],
    [templatePrograms, classroomPrograms, orgPrograms],
  );

  const [expandedPrograms, setExpandedPrograms] = useState<Set<number>>(
    new Set(),
  );
  const [expandedLessons, setExpandedLessons] = useState<Set<number>>(
    new Set(),
  );

  // 購物車：儲存詳細的選擇項目（用於排序和顯示）
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [quotaInfo, setQuotaInfo] = useState<QuotaInfo | null>(null);

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const [formData, setFormData] = useState({
    title: "",
    instructions: "",
    student_ids: [] as number[],
    assign_to_all: true,
    due_date: undefined as Date | undefined,
    start_date: undefined as Date | undefined,
    // ===== 例句集作答模式設定 =====
    practice_mode: "" as
      | ""
      | "reading"
      | "rearrangement"
      | "word_reading"
      | "word_selection", // 作答模式（空字串 = 未選擇）
    time_limit_per_question: 30 as 0 | 10 | 20 | 30 | 40, // 每題時間限制 (0 = 不限時)
    shuffle_questions: false, // 是否打亂順序
    show_answer: false, // 答題結束後是否顯示正確答案（例句重組專用）
    play_audio: false, // 是否播放音檔（例句重組/單字集專用）
    // ===== 單字集專用設定 =====
    target_proficiency: 80, // 達標熟悉度 (50-100%)
    show_translation: true, // 顯示翻譯（單字朗讀專用）
    show_word: true, // 顯示單字（單字選擇專用）
    show_image: true, // 顯示圖片
  });

  // 內部載入學生列表（當外部未傳入時）
  const loadStudents = async () => {
    if (!effectiveSchoolId) return;
    setLoadingStudents(true);
    try {
      const data = (await apiClient.getClassroomStudents(
        effectiveSchoolId,
        classroomId,
      )) as Student[];
      if (!data || data.length === 0) {
        toast.error("此班級尚無學生，無法派發作業");
        onClose();
        return;
      }
      setInternalStudents(data);
      // 載入完成後更新 student_ids
      setFormData((prev) => ({
        ...prev,
        student_ids: data.map((s) => s.id),
      }));
    } catch {
      toast.error("載入學生列表失敗");
      onClose();
    } finally {
      setLoadingStudents(false);
    }
  };

  useEffect(() => {
    if (open) {
      // 如果外部未傳入學生，內部自行載入
      if (students.length === 0) {
        setInternalStudents([]);
        loadStudents();
      } else {
        setInternalStudents(students);
      }
      loadTemplatePrograms();
      loadClassroomPrograms();
      if (showOrgTab) {
        loadOrgPrograms();
      }
      loadQuotaInfo();
      // Reset form when dialog opens
      setCartItems([]);
      setFormData({
        title: "",
        instructions: "",
        student_ids: students.map((s) => s.id), // 預設全選所有學生（外部傳入時）
        assign_to_all: true,
        due_date: undefined,
        start_date: new Date(), // 預設為今天
        practice_mode: "", // Step 1 需要使用者主動選擇
        time_limit_per_question: 30 as 0 | 10 | 20 | 30 | 40,
        shuffle_questions: false,
        show_answer: false,
        play_audio: false,
        // 單字集專用設定
        target_proficiency: 80,
        show_translation: true,
        show_word: true,
        show_image: true,
      });
      setCurrentStep(1);
      setActiveTab(showOrgTab ? "organization" : "template");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load functions recreated each render; only run on dialog open/context change
  }, [open, classroomId, students, showOrgTab]);

  // 當練習模式改變時，清除不相容的購物車項目
  // 單字模式只能選單字集，需要移除例句集項目
  // 例句模式可以選全部，不需要清除
  useEffect(() => {
    if (
      formData.practice_mode === "word_reading" ||
      formData.practice_mode === "word_selection"
    ) {
      setCartItems((prev) => {
        const filtered = prev.filter((item) =>
          isVocabularySetType(item.contentType),
        );
        return filtered.length !== prev.length ? filtered : prev;
      });
    }
  }, [formData.practice_mode]);

  const loadQuotaInfo = async () => {
    try {
      // 根據工作區 context 決定查哪個配額
      const params = new URLSearchParams();
      if (effectiveOrganizationId) {
        params.append("organization_id", effectiveOrganizationId);
      }
      const url = `/api/teachers/subscription${params.toString() ? `?${params.toString()}` : ""}`;

      const response = await apiClient.get<{
        subscription_period: {
          quota_total: number;
          quota_used: number;
          plan_name: string;
        };
      }>(url);

      if (response.subscription_period) {
        setQuotaInfo({
          quota_total: response.subscription_period.quota_total,
          quota_used: response.subscription_period.quota_used,
          quota_remaining:
            response.subscription_period.quota_total -
            response.subscription_period.quota_used,
          plan_name: response.subscription_period.plan_name,
        });
      }
    } catch (error) {
      console.error("Failed to load quota info:", error);
    }
  };

  // 加載公版課程（模板）
  const loadTemplatePrograms = async () => {
    try {
      setLoadingTemplates(true);

      // 個人教材：只傳送 is_template=true，讓後端返回 teacher_id 匹配的教材
      // 不傳送 school_id 或 organization_id，這樣才能拿到老師自己的教材
      const params = new URLSearchParams();
      params.append("is_template", "true");

      const response = await apiClient.get<Program[]>(
        `/api/teachers/programs?${params.toString()}`,
      );

      setTemplatePrograms(response);
    } catch (error) {
      console.error("Failed to load template programs:", error);
      toast.error(t("dialogs.assignmentDialog.errors.loadTemplateFailed"));
      setTemplatePrograms([]);
    } finally {
      setLoadingTemplates(false);
    }
  };

  // 加載班級課程（只能看到當前班級的課程）
  const loadClassroomPrograms = async () => {
    try {
      setLoadingClassroomPrograms(true);
      const response = await apiClient.get<Program[]>(
        `/api/teachers/programs?classroom_id=${classroomId}`,
      );
      setClassroomPrograms(response);
    } catch (error) {
      console.error("Failed to load classroom programs:", error);
      toast.error(
        t("dialogs.assignmentDialog.errors.loadClassroomProgramsFailed"),
      );
      setClassroomPrograms([]);
    } finally {
      setLoadingClassroomPrograms(false);
    }
  };

  // 加載機構教材（機構層級的課程）
  // 注意：機構 API 已回傳完整階層（lessons → contents → items），不需額外 lazy-load
  const loadOrgPrograms = async () => {
    if (!effectiveOrganizationId) return;

    try {
      setLoadingOrgPrograms(true);
      const response = await apiClient.get<Program[]>(
        `/api/organizations/${effectiveOrganizationId}/programs`,
      );
      setOrgPrograms(response);
    } catch (error) {
      console.error("Failed to load organization programs:", error);
      toast.error("載入機構教材失敗");
      setOrgPrograms([]);
    } finally {
      setLoadingOrgPrograms(false);
    }
  };

  const loadProgramLessons = async (programId: number) => {
    // Check if lessons already loaded in any list
    const program = allPrograms.find((p) => p.id === programId);
    if (program?.lessons && program.lessons.length > 0) {
      return; // Already loaded
    }

    // 判斷是否為機構教材（org API 已回傳完整階層，理論上不需要再載入）
    const isOrgProgram = orgPrograms.some((p: Program) => p.id === programId);

    try {
      setLoadingLessons((prev) => ({ ...prev, [programId]: true }));

      let detail: Program;
      if (isOrgProgram && effectiveOrganizationId) {
        // 使用機構 API 取得詳情（含 lessons → contents → items）
        detail = await apiClient.get<Program>(
          `/api/organizations/${effectiveOrganizationId}/programs/${programId}`,
        );
      } else {
        detail = await apiClient.get<Program>(
          `/api/teachers/programs/${programId}`,
        );
      }

      // Update the program with lessons in all lists
      const updatePrograms = (prev: Program[]) =>
        prev.map((p) =>
          p.id === programId ? { ...p, lessons: detail.lessons || [] } : p,
        );

      setTemplatePrograms(updatePrograms);
      setClassroomPrograms(updatePrograms);
      setOrgPrograms(updatePrograms);
    } catch (error) {
      console.debug(`Failed to load lessons for program ${programId}:`, error);
      toast.error(t("dialogs.assignmentDialog.errors.loadLessonsFailed"));
    } finally {
      setLoadingLessons((prev) => ({ ...prev, [programId]: false }));
    }
  };

  const loadLessonContents = async (lessonId: number) => {
    // Find the lesson and check if contents already loaded in any list
    let foundLesson: Lesson | undefined;
    let isOrgLesson = false;
    allPrograms.forEach((program) => {
      const lesson = program.lessons?.find((l) => l.id === lessonId);
      if (lesson) {
        foundLesson = lesson;
        if (orgPrograms.some((p: Program) => p.id === program.id)) {
          isOrgLesson = true;
        }
      }
    });

    if (foundLesson?.contents && foundLesson.contents.length > 0) {
      return; // Already loaded
    }

    // 機構教材的 contents 已在 loadOrgPrograms/loadProgramLessons 時載入
    // 如果還是沒有，就用機構 API 重新取得整個 program
    if (isOrgLesson && effectiveOrganizationId) {
      // 找到此 lesson 所屬的 program，重新載入整個 program
      const parentProgram = orgPrograms.find((p: Program) =>
        p.lessons?.some((l) => l.id === lessonId),
      );
      if (parentProgram) {
        await loadProgramLessons(parentProgram.id);
        return;
      }
    }

    try {
      setLoadingLessons((prev) => ({ ...prev, [lessonId]: true }));
      const contents = await apiClient.get<Content[]>(
        `/api/teachers/lessons/${lessonId}/contents`,
      );

      // Update the lesson with contents in all lists
      const updatePrograms = (prev: Program[]) =>
        prev.map((program) => ({
          ...program,
          lessons: program.lessons?.map((lesson) =>
            lesson.id === lessonId ? { ...lesson, contents } : lesson,
          ),
        }));

      setTemplatePrograms(updatePrograms);
      setClassroomPrograms(updatePrograms);
      setOrgPrograms(updatePrograms);
    } catch (error) {
      console.debug(`Failed to load contents for lesson ${lessonId}:`, error);
      toast.error(t("dialogs.assignmentDialog.errors.loadContentsFailed"));
    } finally {
      setLoadingLessons((prev) => ({ ...prev, [lessonId]: false }));
    }
  };

  const toggleProgram = async (programId: number) => {
    const isExpanding = !expandedPrograms.has(programId);

    setExpandedPrograms((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(programId)) {
        newSet.delete(programId);
      } else {
        newSet.add(programId);
      }
      return newSet;
    });

    // Load lessons when expanding
    if (isExpanding) {
      await loadProgramLessons(programId);
    }
  };

  const toggleLesson = async (lessonId: number) => {
    const isExpanding = !expandedLessons.has(lessonId);

    setExpandedLessons((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(lessonId)) {
        newSet.delete(lessonId);
      } else {
        newSet.add(lessonId);
      }
      return newSet;
    });

    // Load contents when expanding
    if (isExpanding) {
      await loadLessonContents(lessonId);
    }
  };

  // 取得目前購物車中的內容類型（正規化後）
  const getCartContentTypeCategory = ():
    | "example_sentences"
    | "vocabulary_set"
    | null => {
    if (cartItems.length === 0) return null;
    const firstItemType = cartItems[0].contentType;
    if (isExampleSentencesType(firstItemType)) return "example_sentences";
    if (isVocabularySetType(firstItemType)) return "vocabulary_set";
    return null;
  };

  // 檢查內容是否可選（根據已選練習模式篩選）
  const isContentSelectable = (contentType: string): boolean => {
    const mode = formData.practice_mode;
    if (!mode) return true; // 未選模式，全部可選

    // 例句模式：例句集 + 單字集都可選（單字集用 example_sentence 出題）
    if (mode === "reading" || mode === "rearrangement") {
      return true;
    }
    // 單字模式：只能選單字集
    if (mode === "word_reading" || mode === "word_selection") {
      return isVocabularySetType(contentType);
    }
    return true;
  };

  // 添加/移除內容到購物車
  const toggleContent = (
    contentId: number,
    programName: string,
    lessonName: string,
    content: Content,
  ) => {
    // 檢查是否已選擇（如果已選擇，可以移除）
    const exists = cartItems.find((item) => item.contentId === contentId);
    if (!exists && !isContentSelectable(content.type)) {
      // 單字模式下無法選擇例句集
      toast.warning(
        t("dialogs.assignmentDialog.errors.mixedContentType", {
          type: t("dialogs.assignmentDialog.contentTypes.VOCABULARY_SET"),
        }),
      );
      return;
    }

    setCartItems((prev) => {
      const existsInPrev = prev.find((item) => item.contentId === contentId);
      if (existsInPrev) {
        // 移除
        return prev.filter((item) => item.contentId !== contentId);
      } else {
        // 添加 - 檢查是否有缺少音檔的項目
        const hasMissingAudio = content.items
          ? content.items.some((item) => !item.audio_url)
          : false;
        return [
          ...prev,
          {
            contentId,
            programName,
            lessonName,
            contentTitle: content.title,
            contentType: content.type,
            itemsCount: content.items_count,
            order: prev.length, // 順序為當前數量
            hasMissingAudio,
          },
        ];
      }
    });
  };

  // 從購物車移除項目
  const removeFromCart = (contentId: number) => {
    setCartItems((prev) => {
      const filtered = prev.filter((item) => item.contentId !== contentId);
      // 重新計算順序
      return filtered.map((item, index) => ({ ...item, order: index }));
    });
  };

  // 處理拖曳結束事件
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setCartItems((items) => {
        const oldIndex = items.findIndex(
          (item) => item.contentId === active.id,
        );
        const newIndex = items.findIndex((item) => item.contentId === over.id);

        const reorderedItems = arrayMove(items, oldIndex, newIndex);
        // 重新計算順序
        return reorderedItems.map((item, index) => ({ ...item, order: index }));
      });
    }
  };

  const toggleAllInLesson = (
    lesson: Lesson,
    programName: string,
    lessonName: string,
  ) => {
    if (!lesson.contents) return;

    // 只考慮可選擇的內容（與購物車中類型相容的）
    const selectableContents = lesson.contents.filter((c) =>
      isContentSelectable(c.type),
    );

    if (selectableContents.length === 0) {
      // 沒有可選擇的內容（都被類型限制）
      const cartCategory = getCartContentTypeCategory();
      const cartTypeName =
        cartCategory === "example_sentences"
          ? t("dialogs.assignmentDialog.contentTypes.EXAMPLE_SENTENCES")
          : t("dialogs.assignmentDialog.contentTypes.VOCABULARY_SET");
      toast.warning(
        t("dialogs.assignmentDialog.errors.mixedContentType", {
          type: cartTypeName,
        }),
      );
      return;
    }

    const selectableContentIds = selectableContents.map((c) => c.id);
    const allSelected = selectableContentIds.every((id) =>
      cartItems.some((item) => item.contentId === id),
    );

    if (allSelected) {
      // 移除所有可選擇的
      setCartItems((prev) => {
        const filtered = prev.filter(
          (item) => !selectableContentIds.includes(item.contentId),
        );
        return filtered.map((item, index) => ({ ...item, order: index }));
      });
    } else {
      // 添加所有可選擇的
      setCartItems((prev) => {
        const existingIds = new Set(prev.map((item) => item.contentId));
        const newItems = selectableContents
          .filter((content) => !existingIds.has(content.id))
          .map((content, idx) => ({
            contentId: content.id,
            programName,
            lessonName,
            contentTitle: content.title,
            contentType: content.type,
            itemsCount: content.items_count,
            order: prev.length + idx,
            hasMissingAudio: content.items
              ? content.items.some((item) => !item.audio_url)
              : false,
          }));
        return [...prev, ...newItems];
      });
    }
  };

  const toggleStudent = (studentId: number) => {
    setFormData((prev) => {
      const newIds = prev.student_ids.includes(studentId)
        ? prev.student_ids.filter((id) => id !== studentId)
        : [...prev.student_ids, studentId];

      return {
        ...prev,
        student_ids: newIds,
        assign_to_all: newIds.length === effectiveStudents.length,
      };
    });
  };

  const toggleAllStudents = () => {
    setFormData((prev) => ({
      ...prev,
      assign_to_all: !prev.assign_to_all,
      student_ids: !prev.assign_to_all
        ? effectiveStudents.map((s) => s.id)
        : [],
    }));
  };

  const handleSubmit = async () => {
    // Validation
    if (cartItems.length === 0) {
      toast.error(t("dialogs.assignmentDialog.errors.noContentSelected"));
      return;
    }
    if (!formData.title.trim()) {
      toast.error(t("dialogs.assignmentDialog.errors.titleRequired"));
      return;
    }
    if (formData.student_ids.length === 0) {
      toast.error(t("dialogs.assignmentDialog.errors.noStudentSelected"));
      return;
    }

    // #227: 配額不足不阻擋建立作業，配額提示已在 header 顯示

    setLoading(true);
    try {
      // 按購物車順序排列的內容 ID
      const sortedContentIds = cartItems
        .sort((a, b) => a.order - b.order)
        .map((item) => item.contentId);

      // 根據練習模式和播放音檔設定決定 answer_mode
      // - 例句朗讀 (reading) → speaking 模式
      // - 例句重組 (rearrangement) + 播放音檔 → listening 模式
      // - 例句重組 (rearrangement) + 不播放音檔 → writing 模式
      let answerMode: "speaking" | "listening" | "writing";
      if (formData.practice_mode === "reading") {
        answerMode = "speaking";
      } else if (formData.play_audio) {
        answerMode = "listening";
      } else {
        answerMode = "writing";
      }

      // Create one assignment with multiple contents (新架構)
      const payload = {
        title: formData.title,
        description: formData.instructions || undefined, // 欄位名稱改為 description
        classroom_id: classroomId,
        content_ids: sortedContentIds, // 多個內容 ID（已排序）
        student_ids: formData.assign_to_all ? [] : formData.student_ids,
        due_date: formData.due_date
          ? formData.due_date.toISOString()
          : undefined,
        start_date: formData.start_date
          ? formData.start_date.toISOString()
          : undefined,
        answer_mode: answerMode, // 根據練習模式決定
        // ===== 例句集作答模式設定 =====
        practice_mode: formData.practice_mode,
        time_limit_per_question: formData.time_limit_per_question,
        shuffle_questions: formData.shuffle_questions,
        show_answer: formData.show_answer,
        play_audio: formData.play_audio,
        // ===== 單字集作答模式設定 =====
        target_proficiency: formData.target_proficiency,
        show_translation: formData.show_translation,
        show_word: formData.show_word,
        show_image: formData.show_image,
        // ===== 機構模式：傳遞機構/學校 ID 以供後端授權驗證 =====
        ...(effectiveOrganizationId && {
          organization_id: effectiveOrganizationId,
        }),
        ...(effectiveSchoolId && { school_id: effectiveSchoolId }),
      };

      const result = await apiClient.post<{ student_count: number }>(
        "/api/teachers/assignments/create",
        payload,
      );

      toast.success(
        t("dialogs.assignmentDialog.success.created", {
          count: result.student_count || 0,
        }),
      );
      onSuccess?.();
      handleClose();
    } catch (error: unknown) {
      console.error("Failed to create assignment:", error);

      // 處理 HTTP 402 配額不足錯誤
      if (
        error &&
        typeof error === "object" &&
        "response" in error &&
        error.response &&
        typeof error.response === "object" &&
        "status" in error.response &&
        error.response.status === 402
      ) {
        const errorData = "data" in error.response ? error.response.data : null;
        const detailMessage =
          errorData &&
          typeof errorData === "object" &&
          "detail" in errorData &&
          errorData.detail &&
          typeof errorData.detail === "object" &&
          "message" in errorData.detail
            ? String(errorData.detail.message)
            : "請升級方案或等待下個計費週期";

        toast.error(t("dialogs.assignmentDialog.errors.quotaExceeded"), {
          description: detailMessage,
          action: {
            label: t("dialogs.assignmentDialog.actions.viewPlans"),
            onClick: () => {
              window.location.href = "/teacher/subscription";
            },
          },
        });
      } else {
        toast.error(t("dialogs.assignmentDialog.errors.createFailed"));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({
      title: "",
      instructions: "",
      student_ids: [],
      assign_to_all: true,
      due_date: undefined,
      start_date: undefined,
      practice_mode: "",
      time_limit_per_question: 30 as 0 | 20 | 30 | 40,
      shuffle_questions: false,
      show_answer: false,
      play_audio: false,
      // 單字集專用設定
      target_proficiency: 80,
      show_translation: true,
      show_word: true,
      show_image: true,
    });
    setCartItems([]);
    setExpandedPrograms(new Set());
    setExpandedLessons(new Set());
    setCurrentStep(1);
    setActiveTab(showOrgTab ? "organization" : "template");
    onClose();
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return !!formData.practice_mode; // 必須選擇練習模式
      case 2:
        return cartItems.length > 0;
      case 3:
        return formData.student_ids.length > 0;
      case 4:
        return formData.title.trim().length > 0;
      default:
        return false;
    }
  };

  // 檢查是否需要音檔但有缺少音檔的內容
  const checkAudioRequirement = (): boolean => {
    // 判斷練習模式是否需要音檔
    const needsAudio =
      formData.practice_mode === "reading" || // 例句朗讀需要音檔
      (formData.practice_mode === "rearrangement" && formData.play_audio); // 例句重組 + 播放音檔需要音檔

    if (!needsAudio) {
      return true; // 不需要音檔，直接通過
    }

    // 檢查是否有缺少音檔的內容
    const hasContentWithMissingAudio = cartItems.some(
      (item) => item.hasMissingAudio,
    );

    if (hasContentWithMissingAudio) {
      toast.error(t("dialogs.assignmentDialog.errors.missingAudio"), {
        description: t("dialogs.assignmentDialog.errors.missingAudioDesc"),
      });
      return false;
    }

    return true;
  };

  // 處理下一步按鈕點擊
  const handleNextStep = () => {
    // 從 step 2（選教材）移動到 step 3 時，檢查音檔驗證
    if (currentStep === 2) {
      if (!checkAudioRequirement()) {
        return; // 驗證失敗，不繼續
      }
    }
    setCurrentStep(currentStep + 1);
  };

  const steps = [
    {
      number: 1,
      title: t("dialogs.assignmentDialog.steps.practiceMode"),
      icon: Settings,
    },
    {
      number: 2,
      title: t("dialogs.assignmentDialog.steps.selectContent"),
      icon: BookOpen,
    },
    {
      number: 3,
      title: t("dialogs.assignmentDialog.steps.selectStudents"),
      icon: Users,
    },
    {
      number: 4,
      title: t("dialogs.assignmentDialog.steps.details"),
      icon: FileText,
    },
  ];

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className="!w-full !max-w-5xl h-full flex flex-col p-0 sm:!max-w-5xl"
      >
        {/* Compact Header with Clear Steps - 響應式方案 C */}
        <div className="px-6 py-3 border-b bg-gray-50">
          {/* 大螢幕 (≥1024px)：標題 + 步驟同一行 */}
          {/* 小螢幕 (<1024px)：標題 → 配額 → 步驟 三行 */}

          {/* 第一行：標題（小螢幕單獨一行，大螢幕與步驟同行） */}
          <div className="flex items-center justify-between lg:mb-2">
            <SheetTitle className="text-lg font-semibold">
              {t("dialogs.assignmentDialog.title")}
            </SheetTitle>

            {/* 大螢幕：步驟顯示在標題右側（預留空間給 X 按鈕） */}
            <div className="hidden lg:flex items-center gap-3 pr-8">
              {steps.map((s, index) => {
                const Icon = s.icon;
                const isActive = s.number === currentStep;
                const isCompleted = s.number < currentStep;

                return (
                  <React.Fragment key={s.number}>
                    <div className="flex items-center gap-1.5">
                      <div
                        className={cn(
                          "w-7 h-7 rounded-full flex items-center justify-center font-medium transition-all shrink-0",
                          isActive && "bg-blue-600 text-white shadow-sm",
                          isCompleted && "bg-green-500 text-white",
                          !isActive &&
                            !isCompleted &&
                            "bg-gray-200 text-gray-500",
                        )}
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <span className="text-sm">{s.number}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Icon
                          className={cn(
                            "h-4 w-4 shrink-0",
                            isActive && "text-blue-600",
                            isCompleted && "text-green-600",
                            !isActive && !isCompleted && "text-gray-400",
                          )}
                        />
                        <span
                          className={cn(
                            "text-sm whitespace-nowrap",
                            isActive && "text-gray-900 font-semibold",
                            isCompleted && "text-green-700 font-medium",
                            !isActive && !isCompleted && "text-gray-500",
                          )}
                        >
                          {s.title}
                        </span>
                      </div>
                    </div>
                    {index < steps.length - 1 && (
                      <ChevronRight className="h-4 w-4 text-gray-300 shrink-0" />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* 第二行：配額（大螢幕顯示，小螢幕也在這裡顯示） */}
          {quotaInfo && (
            <div className="flex items-center gap-2 text-xs mt-2 lg:mt-0">
              <Gauge
                className={cn(
                  "h-3 w-3",
                  quotaInfo.quota_remaining <= 0
                    ? "text-amber-500"
                    : "text-gray-500",
                )}
              />
              <span className="text-gray-600">
                {t("dialogs.assignmentDialog.quota.remainingColon")}
                <span
                  className={cn(
                    "font-semibold ml-1",
                    quotaInfo.quota_remaining > 300
                      ? "text-green-600"
                      : quotaInfo.quota_remaining > 100
                        ? "text-orange-600"
                        : quotaInfo.quota_remaining > 0
                          ? "text-red-600"
                          : "text-red-700",
                  )}
                >
                  {quotaInfo.quota_remaining}
                </span>
                <span className="text-gray-500">
                  {" "}
                  / {quotaInfo.quota_total}{" "}
                  {t("dialogs.assignmentDialog.quota.seconds")}
                </span>
              </span>
              {quotaInfo.quota_remaining <= 0 ? (
                <Badge
                  variant="outline"
                  className="text-xs py-0 px-1.5 text-amber-600 border-amber-300"
                >
                  {t("dialogs.assignmentDialog.quota.noAiAnalysis")}
                </Badge>
              ) : (
                quotaInfo.quota_remaining <= 100 && (
                  <Badge
                    variant="outline"
                    className="text-xs py-0 px-1.5 text-amber-600 border-amber-300"
                  >
                    {t("dialogs.assignmentDialog.quota.low")}
                  </Badge>
                )
              )}
            </div>
          )}

          {/* 第三行：步驟（僅小螢幕顯示，置中，超小螢幕換行） */}
          <div className="flex lg:hidden items-center justify-center mt-2">
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 sm:gap-x-3">
              {steps.map((s, index) => {
                const Icon = s.icon;
                const isActive = s.number === currentStep;
                const isCompleted = s.number < currentStep;

                return (
                  <React.Fragment key={s.number}>
                    <div className="flex items-center gap-1.5">
                      <div
                        className={cn(
                          "w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center font-medium transition-all shrink-0",
                          isActive && "bg-blue-600 text-white shadow-sm",
                          isCompleted && "bg-green-500 text-white",
                          !isActive &&
                            !isCompleted &&
                            "bg-gray-200 text-gray-500",
                        )}
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        ) : (
                          <span className="text-xs sm:text-sm">{s.number}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Icon
                          className={cn(
                            "h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 hidden sm:block",
                            isActive && "text-blue-600",
                            isCompleted && "text-green-600",
                            !isActive && !isCompleted && "text-gray-400",
                          )}
                        />
                        <span
                          className={cn(
                            "text-xs sm:text-sm whitespace-nowrap",
                            isActive && "text-gray-900 font-semibold",
                            isCompleted && "text-green-700 font-medium",
                            !isActive && !isCompleted && "text-gray-500",
                          )}
                        >
                          {s.title}
                        </span>
                      </div>
                    </div>
                    {index < steps.length - 1 && (
                      <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-gray-300 shrink-0" />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>

        {/* Content Area - Maximized Height with Scroll */}
        <div className="flex-1 min-h-0 overflow-auto px-6 py-3">
          {/* Step 2: Select Contents (was Step 1) */}
          {currentStep === 2 && (
            <div className="h-full flex flex-col sm:flex-row gap-4 overflow-auto sm:overflow-hidden">
              {/* 課程列表 - 小螢幕最小高度 400px，大螢幕 70% */}
              <div className="flex-1 flex flex-col min-h-[400px] sm:min-h-0">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm text-gray-600">
                    {t("dialogs.assignmentDialog.selectContent.description")}
                  </p>
                </div>

                {/* Tab 切換：公版 / 班級版 */}
                <Tabs
                  value={activeTab}
                  onValueChange={(v) =>
                    setActiveTab(v as "template" | "classroom" | "organization")
                  }
                  className="flex-1 flex flex-col min-h-0"
                >
                  <TabsList
                    className={`grid w-full ${showOrgTab ? "grid-cols-3" : "grid-cols-2"} mb-2`}
                  >
                    <TabsTrigger
                      value="template"
                      className="flex items-center gap-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                    >
                      <Globe className="h-4 w-4" />
                      個人教材
                    </TabsTrigger>
                    {showOrgTab && (
                      <TabsTrigger
                        value="organization"
                        className="flex items-center gap-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                      >
                        <Building2 className="h-4 w-4" />
                        機構教材
                      </TabsTrigger>
                    )}
                    <TabsTrigger
                      value="classroom"
                      className="flex items-center gap-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                    >
                      <Users className="h-4 w-4" />
                      班級課程
                    </TabsTrigger>
                  </TabsList>

                  {/* 個人教材 Tab */}
                  <TabsContent
                    value="template"
                    className="flex-1 mt-0 overflow-hidden min-h-0"
                  >
                    <ScrollArea className="h-full border rounded-lg p-3">
                      {loadingTemplates ? (
                        <div className="flex flex-col items-center justify-center h-96">
                          <div className="relative">
                            {/* Outer ring */}
                            <div className="absolute inset-0 animate-ping">
                              <div className="h-16 w-16 rounded-full border-4 border-blue-200 opacity-75"></div>
                            </div>
                            {/* Inner spinning circle */}
                            <Loader2 className="h-16 w-16 animate-spin text-blue-600 mx-auto relative" />
                          </div>
                          <p className="mt-6 text-lg font-medium text-gray-700">
                            {t(
                              "dialogs.assignmentDialog.selectContent.loading",
                            )}
                          </p>
                          <p className="mt-2 text-sm text-gray-500">
                            {t(
                              "dialogs.assignmentDialog.selectContent.loadingDesc",
                            )}
                          </p>
                        </div>
                      ) : templatePrograms.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-96">
                          <Package className="h-16 w-16 text-gray-300 mb-4" />
                          <p className="text-gray-500">
                            {t("dialogs.assignmentDialog.selectContent.empty")}
                          </p>
                          <p className="text-sm text-gray-400 mt-2">
                            {t(
                              "dialogs.assignmentDialog.selectContent.emptyDesc",
                            )}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {templatePrograms.map((program) => (
                            <Card key={program.id} className="overflow-hidden">
                              {program.lessons && program.lessons.length > 0 ? (
                                <button
                                  onClick={() => toggleProgram(program.id)}
                                  className="w-full p-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                                >
                                  <div className="flex items-center gap-2">
                                    {loadingLessons[program.id] ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : expandedPrograms.has(program.id) ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" />
                                    )}
                                    <Package className="h-4 w-4 text-blue-600" />
                                    <span className="font-medium">
                                      {program.name}
                                    </span>
                                    {program.level && (
                                      <Badge variant="outline" className="ml-2">
                                        {program.level}
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm text-gray-500">
                                      {t(
                                        "dialogs.assignmentDialog.selectContent.units",
                                        { count: program.lessons.length },
                                      )}
                                    </span>
                                    {loadingLessons[program.id] && (
                                      <span className="text-xs text-blue-600">
                                        {t(
                                          "dialogs.assignmentDialog.selectContent.loadingLabel",
                                        )}
                                      </span>
                                    )}
                                  </div>
                                </button>
                              ) : (
                                <div className="w-full p-3 flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Package className="h-4 w-4 text-gray-400" />
                                    <span className="font-medium text-gray-500">
                                      {program.name}
                                    </span>
                                    {program.level && (
                                      <Badge variant="outline" className="ml-2">
                                        {program.level}
                                      </Badge>
                                    )}
                                  </div>
                                  <span className="text-sm text-gray-400">
                                    {t(
                                      "dialogs.assignmentDialog.selectContent.noUnits",
                                    )}
                                  </span>
                                </div>
                              )}

                              {expandedPrograms.has(program.id) &&
                                program.lessons && (
                                  <div className="border-t bg-gray-50">
                                    {program.lessons.map((lesson) => (
                                      <div key={lesson.id} className="ml-6">
                                        {lesson.contents &&
                                        lesson.contents.length > 0 ? (
                                          <button
                                            onClick={() =>
                                              toggleLesson(lesson.id)
                                            }
                                            className="w-full p-2 flex items-center justify-between hover:bg-gray-100 transition-colors"
                                          >
                                            <div className="flex items-center gap-2">
                                              {loadingLessons[lesson.id] ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                              ) : expandedLessons.has(
                                                  lesson.id,
                                                ) ? (
                                                <ChevronDown className="h-4 w-4" />
                                              ) : (
                                                <ChevronRight className="h-4 w-4" />
                                              )}
                                              <Layers className="h-4 w-4 text-green-600" />
                                              <span className="text-sm">
                                                {lesson.name}
                                              </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <span className="text-xs text-gray-500">
                                                {t(
                                                  "dialogs.assignmentDialog.selectContent.contents",
                                                  {
                                                    count:
                                                      lesson.contents.length,
                                                  },
                                                )}
                                              </span>
                                              {loadingLessons[lesson.id] && (
                                                <span className="text-xs text-blue-600">
                                                  {t(
                                                    "dialogs.assignmentDialog.selectContent.loadingLabel",
                                                  )}
                                                </span>
                                              )}
                                              {!loadingLessons[lesson.id] && (
                                                <span
                                                  className="h-6 px-2 text-xs cursor-pointer rounded bg-gray-100 hover:bg-gray-200 transition-colors inline-flex items-center"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleAllInLesson(
                                                      lesson,
                                                      program.name,
                                                      lesson.name,
                                                    );
                                                  }}
                                                >
                                                  {lesson.contents.every((c) =>
                                                    cartItems.some(
                                                      (item) =>
                                                        item.contentId === c.id,
                                                    ),
                                                  )
                                                    ? t(
                                                        "dialogs.assignmentDialog.selectContent.deselectAll",
                                                      )
                                                    : t(
                                                        "dialogs.assignmentDialog.selectContent.selectAll",
                                                      )}
                                                </span>
                                              )}
                                            </div>
                                          </button>
                                        ) : (
                                          <div className="w-full p-2 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                              <Layers className="h-4 w-4 text-gray-400" />
                                              <span className="text-sm text-gray-500">
                                                {lesson.name}
                                              </span>
                                            </div>
                                            <span className="text-xs text-gray-400">
                                              {t(
                                                "dialogs.assignmentDialog.selectContent.noContents",
                                              )}
                                            </span>
                                          </div>
                                        )}

                                        {expandedLessons.has(lesson.id) &&
                                          lesson.contents && (
                                            <div className="ml-6 space-y-1 pb-2 bg-white">
                                              {lesson.contents.map(
                                                (content) => {
                                                  const isSelected =
                                                    cartItems.some(
                                                      (item) =>
                                                        item.contentId ===
                                                        content.id,
                                                    );
                                                  const isDisabled =
                                                    !isSelected &&
                                                    !isContentSelectable(
                                                      content.type,
                                                    );
                                                  return (
                                                    <button
                                                      key={content.id}
                                                      onClick={() =>
                                                        toggleContent(
                                                          content.id,
                                                          program.name,
                                                          lesson.name,
                                                          content,
                                                        )
                                                      }
                                                      disabled={isDisabled}
                                                      className={cn(
                                                        "w-full p-2 flex items-center gap-2 rounded transition-colors text-left",
                                                        isSelected &&
                                                          "bg-blue-50 hover:bg-blue-100",
                                                        !isSelected &&
                                                          !isDisabled &&
                                                          "hover:bg-gray-50",
                                                        isDisabled &&
                                                          "opacity-40 cursor-not-allowed",
                                                      )}
                                                    >
                                                      {isSelected ? (
                                                        <CheckCircle2 className="h-4 w-4 text-blue-600 flex-shrink-0" />
                                                      ) : (
                                                        <Circle className="h-4 w-4 text-gray-400 flex-shrink-0" />
                                                      )}
                                                      <div className="flex-1">
                                                        <div className="text-sm font-medium">
                                                          {content.title}
                                                        </div>
                                                        <div className="flex items-center gap-2 text-xs text-gray-500">
                                                          <Badge
                                                            variant="outline"
                                                            className="px-1 py-0"
                                                          >
                                                            {getContentTypeLabel(
                                                              content.type,
                                                              t,
                                                            )}
                                                          </Badge>
                                                          {content.items_count && (
                                                            <span>
                                                              {
                                                                content.items_count
                                                              }{" "}
                                                              {t(
                                                                "dialogs.assignmentDialog.selectContent.items",
                                                              )}
                                                            </span>
                                                          )}
                                                        </div>
                                                      </div>
                                                    </button>
                                                  );
                                                },
                                              )}
                                            </div>
                                          )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                            </Card>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </TabsContent>

                  {/* 機構教材 Tab */}
                  {showOrgTab && (
                    <TabsContent
                      value="organization"
                      className="flex-1 mt-0 overflow-hidden min-h-0"
                    >
                      <ScrollArea className="h-full border rounded-lg p-3">
                        {loadingOrgPrograms ? (
                          <div className="flex flex-col items-center justify-center h-96">
                            <div className="relative">
                              <div className="absolute inset-0 animate-ping">
                                <div className="h-16 w-16 rounded-full border-4 border-blue-200 opacity-75"></div>
                              </div>
                              <Loader2 className="h-16 w-16 animate-spin text-blue-600 mx-auto relative" />
                            </div>
                            <p className="mt-6 text-lg font-medium text-gray-700">
                              {t(
                                "dialogs.assignmentDialog.selectContent.loading",
                              )}
                            </p>
                            <p className="mt-2 text-sm text-gray-500">
                              載入機構教材中...
                            </p>
                          </div>
                        ) : orgPrograms.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-96">
                            <Building2 className="h-16 w-16 text-gray-300 mb-4" />
                            <p className="text-gray-500">此機構尚無教材</p>
                            <p className="text-sm text-gray-400 mt-2">
                              請聯絡機構管理員建立共享教材
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {orgPrograms.map((program) => (
                              <Card
                                key={program.id}
                                className="overflow-hidden"
                              >
                                {program.lessons &&
                                program.lessons.length > 0 ? (
                                  <button
                                    onClick={() => toggleProgram(program.id)}
                                    className="w-full p-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                                  >
                                    <div className="flex items-center gap-2">
                                      {loadingLessons[program.id] ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : expandedPrograms.has(program.id) ? (
                                        <ChevronDown className="h-4 w-4" />
                                      ) : (
                                        <ChevronRight className="h-4 w-4" />
                                      )}
                                      <Package className="h-4 w-4 text-blue-600" />
                                      <span className="font-medium">
                                        {program.name}
                                      </span>
                                      {program.level && (
                                        <Badge
                                          variant="outline"
                                          className="ml-2"
                                        >
                                          {program.level}
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm text-gray-500">
                                        {t(
                                          "dialogs.assignmentDialog.selectContent.units",
                                          {
                                            count: program.lessons.length,
                                          },
                                        )}
                                      </span>
                                      {loadingLessons[program.id] && (
                                        <span className="text-xs text-blue-600">
                                          {t(
                                            "dialogs.assignmentDialog.selectContent.loadingLabel",
                                          )}
                                        </span>
                                      )}
                                    </div>
                                  </button>
                                ) : (
                                  <div className="w-full p-3 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <Package className="h-4 w-4 text-gray-400" />
                                      <span className="font-medium text-gray-500">
                                        {program.name}
                                      </span>
                                      {program.level && (
                                        <Badge
                                          variant="outline"
                                          className="ml-2"
                                        >
                                          {program.level}
                                        </Badge>
                                      )}
                                    </div>
                                    <span className="text-sm text-gray-400">
                                      {t(
                                        "dialogs.assignmentDialog.selectContent.noUnits",
                                      )}
                                    </span>
                                  </div>
                                )}

                                {expandedPrograms.has(program.id) &&
                                  program.lessons && (
                                    <div className="border-t bg-gray-50">
                                      {program.lessons.map((lesson) => (
                                        <div key={lesson.id} className="ml-6">
                                          {lesson.contents &&
                                          lesson.contents.length > 0 ? (
                                            <button
                                              onClick={() =>
                                                toggleLesson(lesson.id)
                                              }
                                              className="w-full p-2 flex items-center justify-between hover:bg-gray-100 transition-colors"
                                            >
                                              <div className="flex items-center gap-2">
                                                {loadingLessons[lesson.id] ? (
                                                  <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : expandedLessons.has(
                                                    lesson.id,
                                                  ) ? (
                                                  <ChevronDown className="h-4 w-4" />
                                                ) : (
                                                  <ChevronRight className="h-4 w-4" />
                                                )}
                                                <Layers className="h-4 w-4 text-green-600" />
                                                <span className="text-sm">
                                                  {lesson.name}
                                                </span>
                                              </div>
                                              <div className="flex items-center gap-2">
                                                <span className="text-xs text-gray-500">
                                                  {t(
                                                    "dialogs.assignmentDialog.selectContent.contents",
                                                    {
                                                      count:
                                                        lesson.contents.length,
                                                    },
                                                  )}
                                                </span>
                                              </div>
                                            </button>
                                          ) : (
                                            <div className="w-full p-2 flex items-center justify-between">
                                              <div className="flex items-center gap-2">
                                                <Layers className="h-4 w-4 text-gray-400" />
                                                <span className="text-sm text-gray-500">
                                                  {lesson.name}
                                                </span>
                                              </div>
                                              <span className="text-xs text-gray-400">
                                                {t(
                                                  "dialogs.assignmentDialog.selectContent.noContents",
                                                )}
                                              </span>
                                            </div>
                                          )}

                                          {expandedLessons.has(lesson.id) &&
                                            lesson.contents && (
                                              <div className="ml-6 space-y-1 pb-2 bg-white">
                                                {lesson.contents.map(
                                                  (content) => {
                                                    const isSelected =
                                                      cartItems.some(
                                                        (item) =>
                                                          item.contentId ===
                                                          content.id,
                                                      );
                                                    const isDisabled =
                                                      !isSelected &&
                                                      !isContentSelectable(
                                                        content.type,
                                                      );
                                                    return (
                                                      <button
                                                        key={content.id}
                                                        onClick={() =>
                                                          toggleContent(
                                                            content.id,
                                                            program.name,
                                                            lesson.name,
                                                            content,
                                                          )
                                                        }
                                                        disabled={isDisabled}
                                                        className={cn(
                                                          "w-full p-2 flex items-center gap-2 rounded transition-colors text-left",
                                                          isSelected &&
                                                            "bg-blue-50 hover:bg-blue-100",
                                                          !isSelected &&
                                                            !isDisabled &&
                                                            "hover:bg-gray-50",
                                                          isDisabled &&
                                                            "opacity-40 cursor-not-allowed",
                                                        )}
                                                      >
                                                        {isSelected ? (
                                                          <CheckCircle2 className="h-4 w-4 text-blue-600 flex-shrink-0" />
                                                        ) : (
                                                          <Circle className="h-4 w-4 text-gray-400 flex-shrink-0" />
                                                        )}
                                                        <div className="flex-1">
                                                          <div className="text-sm font-medium">
                                                            {content.title}
                                                          </div>
                                                          <div className="flex items-center gap-2 text-xs text-gray-500">
                                                            <Badge
                                                              variant="outline"
                                                              className="px-1 py-0"
                                                            >
                                                              {getContentTypeLabel(
                                                                content.type,
                                                                t,
                                                              )}
                                                            </Badge>
                                                            {content.items_count && (
                                                              <span>
                                                                {
                                                                  content.items_count
                                                                }{" "}
                                                                {t(
                                                                  "dialogs.assignmentDialog.selectContent.items",
                                                                )}
                                                              </span>
                                                            )}
                                                          </div>
                                                        </div>
                                                      </button>
                                                    );
                                                  },
                                                )}
                                              </div>
                                            )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                              </Card>
                            ))}
                          </div>
                        )}
                      </ScrollArea>
                    </TabsContent>
                  )}

                  {/* 班級課程 Tab */}
                  <TabsContent
                    value="classroom"
                    className="flex-1 mt-0 overflow-hidden min-h-0"
                  >
                    <ScrollArea className="h-full border rounded-lg p-3">
                      {loadingClassroomPrograms ? (
                        <div className="flex flex-col items-center justify-center h-96">
                          <div className="relative">
                            <div className="absolute inset-0 animate-ping">
                              <div className="h-16 w-16 rounded-full border-4 border-blue-200 opacity-75"></div>
                            </div>
                            <Loader2 className="h-16 w-16 animate-spin text-blue-600 mx-auto relative" />
                          </div>
                          <p className="mt-6 text-lg font-medium text-gray-700">
                            載入班級課程中...
                          </p>
                        </div>
                      ) : classroomPrograms.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-96">
                          <Package className="h-16 w-16 text-gray-300 mb-4" />
                          <p className="text-gray-500">此班級尚無課程</p>
                          <p className="text-sm text-gray-400 mt-2">
                            請先在班級中建立課程
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {classroomPrograms.map((program) => (
                            <Card key={program.id} className="overflow-hidden">
                              {program.lessons && program.lessons.length > 0 ? (
                                <button
                                  onClick={() => toggleProgram(program.id)}
                                  className="w-full p-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                                >
                                  <div className="flex items-center gap-2">
                                    {loadingLessons[program.id] ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : expandedPrograms.has(program.id) ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" />
                                    )}
                                    <Package className="h-4 w-4 text-blue-600" />
                                    <span className="font-medium">
                                      {program.name}
                                    </span>
                                    {program.level && (
                                      <Badge variant="outline" className="ml-2">
                                        {program.level}
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm text-gray-500">
                                      {t(
                                        "dialogs.assignmentDialog.selectContent.units",
                                        { count: program.lessons.length },
                                      )}
                                    </span>
                                  </div>
                                </button>
                              ) : (
                                <div className="w-full p-3 flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Package className="h-4 w-4 text-gray-400" />
                                    <span className="font-medium text-gray-500">
                                      {program.name}
                                    </span>
                                    {program.level && (
                                      <Badge variant="outline" className="ml-2">
                                        {program.level}
                                      </Badge>
                                    )}
                                  </div>
                                  <span className="text-sm text-gray-400">
                                    {t(
                                      "dialogs.assignmentDialog.selectContent.noUnits",
                                    )}
                                  </span>
                                </div>
                              )}

                              {expandedPrograms.has(program.id) &&
                                program.lessons && (
                                  <div className="border-t bg-gray-50">
                                    {program.lessons.map((lesson) => (
                                      <div key={lesson.id} className="ml-6">
                                        {lesson.contents &&
                                        lesson.contents.length > 0 ? (
                                          <button
                                            onClick={() =>
                                              toggleLesson(lesson.id)
                                            }
                                            className="w-full p-2 flex items-center justify-between hover:bg-gray-100 transition-colors"
                                          >
                                            <div className="flex items-center gap-2">
                                              {loadingLessons[lesson.id] ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                              ) : expandedLessons.has(
                                                  lesson.id,
                                                ) ? (
                                                <ChevronDown className="h-4 w-4" />
                                              ) : (
                                                <ChevronRight className="h-4 w-4" />
                                              )}
                                              <Layers className="h-4 w-4 text-green-600" />
                                              <span className="text-sm">
                                                {lesson.name}
                                              </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <span className="text-xs text-gray-500">
                                                {t(
                                                  "dialogs.assignmentDialog.selectContent.contents",
                                                  {
                                                    count:
                                                      lesson.contents.length,
                                                  },
                                                )}
                                              </span>
                                              {!loadingLessons[lesson.id] && (
                                                <span
                                                  className="h-6 px-2 text-xs cursor-pointer rounded bg-gray-100 hover:bg-gray-200 transition-colors inline-flex items-center"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleAllInLesson(
                                                      lesson,
                                                      program.name,
                                                      lesson.name,
                                                    );
                                                  }}
                                                >
                                                  {lesson.contents.every((c) =>
                                                    cartItems.some(
                                                      (item) =>
                                                        item.contentId === c.id,
                                                    ),
                                                  )
                                                    ? t(
                                                        "dialogs.assignmentDialog.selectContent.deselectAll",
                                                      )
                                                    : t(
                                                        "dialogs.assignmentDialog.selectContent.selectAll",
                                                      )}
                                                </span>
                                              )}
                                            </div>
                                          </button>
                                        ) : (
                                          <div className="w-full p-2 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                              <Layers className="h-4 w-4 text-gray-400" />
                                              <span className="text-sm text-gray-500">
                                                {lesson.name}
                                              </span>
                                            </div>
                                            <span className="text-xs text-gray-400">
                                              {t(
                                                "dialogs.assignmentDialog.selectContent.noContents",
                                              )}
                                            </span>
                                          </div>
                                        )}

                                        {expandedLessons.has(lesson.id) &&
                                          lesson.contents && (
                                            <div className="ml-6 space-y-1 pb-2 bg-white">
                                              {lesson.contents.map(
                                                (content) => {
                                                  const isSelected =
                                                    cartItems.some(
                                                      (item) =>
                                                        item.contentId ===
                                                        content.id,
                                                    );
                                                  const isDisabled =
                                                    !isSelected &&
                                                    !isContentSelectable(
                                                      content.type,
                                                    );
                                                  return (
                                                    <button
                                                      key={content.id}
                                                      onClick={() =>
                                                        toggleContent(
                                                          content.id,
                                                          program.name,
                                                          lesson.name,
                                                          content,
                                                        )
                                                      }
                                                      disabled={isDisabled}
                                                      className={cn(
                                                        "w-full p-2 flex items-center gap-2 rounded transition-colors text-left",
                                                        isSelected &&
                                                          "bg-blue-50 hover:bg-blue-100",
                                                        !isSelected &&
                                                          !isDisabled &&
                                                          "hover:bg-gray-50",
                                                        isDisabled &&
                                                          "opacity-40 cursor-not-allowed",
                                                      )}
                                                    >
                                                      {isSelected ? (
                                                        <CheckCircle2 className="h-4 w-4 text-blue-600 flex-shrink-0" />
                                                      ) : (
                                                        <Circle className="h-4 w-4 text-gray-400 flex-shrink-0" />
                                                      )}
                                                      <div className="flex-1">
                                                        <div className="text-sm font-medium">
                                                          {content.title}
                                                        </div>
                                                        <div className="flex items-center gap-2 text-xs text-gray-500">
                                                          <Badge
                                                            variant="outline"
                                                            className="px-1 py-0"
                                                          >
                                                            {getContentTypeLabel(
                                                              content.type,
                                                              t,
                                                            )}
                                                          </Badge>
                                                          {content.items_count && (
                                                            <span>
                                                              {
                                                                content.items_count
                                                              }{" "}
                                                              {t(
                                                                "dialogs.assignmentDialog.selectContent.items",
                                                              )}
                                                            </span>
                                                          )}
                                                        </div>
                                                      </div>
                                                    </button>
                                                  );
                                                },
                                              )}
                                            </div>
                                          )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                            </Card>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </div>

              {/* 購物車 - 小螢幕動態高度（隨內容增加），大螢幕在右側 30% */}
              <div className="w-full sm:w-[30%] sm:h-full flex-shrink-0 flex flex-col border rounded-lg bg-gray-50">
                <div className="p-3 border-b bg-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="h-5 w-5 text-blue-600" />
                    <h3 className="font-semibold">已選擇的內容</h3>
                  </div>
                  <Badge
                    variant="secondary"
                    className="bg-blue-50 text-blue-700"
                  >
                    {cartItems.length}
                  </Badge>
                </div>

                <ScrollArea className="flex-1 p-3 max-h-[50vh] sm:max-h-none">
                  {cartItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center py-8">
                      <ShoppingCart className="h-12 w-12 text-gray-300 mb-3" />
                      <p className="text-sm text-gray-500">尚未選擇任何內容</p>
                      <p className="text-xs text-gray-400 mt-1">
                        從左側課程中選擇單元內容
                      </p>
                    </div>
                  ) : (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={cartItems.map((item) => item.contentId)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="space-y-2">
                          {cartItems
                            .sort((a, b) => a.order - b.order)
                            .map((item, index) => (
                              <SortableCartItem
                                key={item.contentId}
                                item={item}
                                index={index}
                                onRemove={removeFromCart}
                                t={t}
                              />
                            ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  )}
                </ScrollArea>
              </div>
            </div>
          )}

          {/* Step 1: Practice Mode Settings (was Step 2) */}
          {currentStep === 1 && (
            <div className="h-full flex flex-col">
              <div className="mb-4">
                <p className="text-sm text-gray-600">
                  {t("dialogs.assignmentDialog.practiceMode.description")}
                </p>
              </div>

              <div className="flex-1 flex flex-col justify-center max-w-2xl mx-auto w-full">
                {/* 作答模式選擇 - 顯示所有練習模式 */}
                <div className="space-y-6">
                  {/* ===== 所有練習模式卡片 (2x2 grid) ===== */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* 例句朗讀 */}
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          practice_mode: "reading",
                          time_limit_per_question:
                            prev.time_limit_per_question === 0
                              ? 30
                              : prev.time_limit_per_question,
                        }))
                      }
                      className={`p-6 rounded-xl border-2 transition-all ${
                        formData.practice_mode === "reading"
                          ? "border-blue-500 bg-blue-50 shadow-md"
                          : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                      }`}
                    >
                      <div className="flex flex-col items-center gap-3">
                        <span className="text-4xl">🎙️</span>
                        <div className="text-center">
                          <div className="font-semibold text-lg">
                            {t("dialogs.assignmentDialog.practiceMode.reading")}
                          </div>
                          <div className="text-sm text-gray-500 mt-1">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.readingDesc",
                            )}
                          </div>
                        </div>
                      </div>
                    </button>

                    {/* 例句重組 */}
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          practice_mode: "rearrangement",
                        }))
                      }
                      className={`p-6 rounded-xl border-2 transition-all ${
                        formData.practice_mode === "rearrangement"
                          ? "border-blue-500 bg-blue-50 shadow-md"
                          : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                      }`}
                    >
                      <div className="flex flex-col items-center gap-3">
                        <span className="text-4xl">🔀</span>
                        <div className="text-center">
                          <div className="font-semibold text-lg">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.rearrangement",
                            )}
                          </div>
                          <div className="text-sm text-gray-500 mt-1">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.rearrangementDesc",
                            )}
                          </div>
                        </div>
                      </div>
                    </button>

                    {/* 單字朗讀 */}
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          practice_mode: "word_reading",
                          time_limit_per_question: 0,
                        }))
                      }
                      className={`p-6 rounded-xl border-2 transition-all ${
                        formData.practice_mode === "word_reading"
                          ? "border-blue-500 bg-blue-50 shadow-md"
                          : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                      }`}
                    >
                      <div className="flex flex-col items-center gap-3">
                        <span className="text-4xl">🎙️</span>
                        <div className="text-center">
                          <div className="font-semibold text-lg">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.wordReading",
                            )}
                          </div>
                          <div className="text-sm text-gray-500 mt-1">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.wordReadingDesc",
                            )}
                          </div>
                        </div>
                      </div>
                    </button>

                    {/* 單字選擇 */}
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          practice_mode: "word_selection",
                          time_limit_per_question: 30,
                        }))
                      }
                      className={`p-6 rounded-xl border-2 transition-all ${
                        formData.practice_mode === "word_selection"
                          ? "border-blue-500 bg-blue-50 shadow-md"
                          : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                      }`}
                    >
                      <div className="flex flex-col items-center gap-3">
                        <span className="text-4xl">🧠</span>
                        <div className="text-center">
                          <div className="font-semibold text-lg">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.wordSelection",
                            )}
                          </div>
                          <div className="text-sm text-gray-500 mt-1">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.wordSelectionDesc",
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>

                  {/* ===== 例句集細節設定 (reading / rearrangement) ===== */}
                  {(formData.practice_mode === "reading" ||
                    formData.practice_mode === "rearrangement") && (
                    <Card className="p-4 border-gray-200">
                      <h4 className="text-sm font-medium mb-3 text-gray-700">
                        {t(
                          "dialogs.assignmentDialog.practiceMode.advancedSettings",
                        )}
                      </h4>
                      <div className="grid grid-cols-2 gap-4">
                        {/* 時間限制 */}
                        <div className="space-y-1.5">
                          <Label className="text-xs text-gray-600">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.timeLimit",
                            )}
                          </Label>
                          <select
                            value={formData.time_limit_per_question}
                            onChange={(e) =>
                              setFormData((prev) => ({
                                ...prev,
                                time_limit_per_question: Number(
                                  e.target.value,
                                ) as 0 | 10 | 20 | 30 | 40,
                              }))
                            }
                            className="w-full h-9 px-3 rounded-md border border-gray-200 text-sm"
                          >
                            {/* Unlimited option only available for rearrangement mode */}
                            {formData.practice_mode === "rearrangement" && (
                              <option value={0}>
                                {t(
                                  "dialogs.assignmentDialog.practiceMode.unlimited",
                                )}
                              </option>
                            )}
                            <option value={10}>
                              10{" "}
                              {t(
                                "dialogs.assignmentDialog.practiceMode.seconds",
                              )}
                            </option>
                            <option value={20}>
                              20{" "}
                              {t(
                                "dialogs.assignmentDialog.practiceMode.seconds",
                              )}
                            </option>
                            <option value={30}>
                              30{" "}
                              {t(
                                "dialogs.assignmentDialog.practiceMode.seconds",
                              )}{" "}
                              (
                              {t(
                                "dialogs.assignmentDialog.practiceMode.default",
                              )}
                              )
                            </option>
                            <option value={40}>
                              40{" "}
                              {t(
                                "dialogs.assignmentDialog.practiceMode.seconds",
                              )}
                            </option>
                          </select>
                        </div>

                        {/* 打亂順序 */}
                        <div className="space-y-1.5">
                          <Label className="text-xs text-gray-600">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.shuffleQuestions",
                            )}
                          </Label>
                          <div className="flex items-center h-9">
                            <input
                              type="checkbox"
                              checked={formData.shuffle_questions}
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  shuffle_questions: e.target.checked,
                                }))
                              }
                              className="h-4 w-4 rounded border-gray-300"
                            />
                            <span className="ml-2 text-sm text-gray-600">
                              {t(
                                "dialogs.assignmentDialog.practiceMode.shuffleQuestionsDesc",
                              )}
                            </span>
                          </div>
                        </div>

                        {/* 例句重組專用選項 - 顯示答案 */}
                        {formData.practice_mode === "rearrangement" && (
                          <div className="space-y-1.5">
                            <Label className="text-xs text-gray-600">
                              {t(
                                "dialogs.assignmentDialog.practiceMode.showAnswer",
                              )}
                            </Label>
                            <div className="flex items-center h-9">
                              <input
                                type="checkbox"
                                checked={formData.show_answer}
                                onChange={(e) =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    show_answer: e.target.checked,
                                  }))
                                }
                                className="h-4 w-4 rounded border-gray-300"
                              />
                              <span className="ml-2 text-sm text-gray-600">
                                {t(
                                  "dialogs.assignmentDialog.practiceMode.showAnswerDesc",
                                )}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 例句重組專用選項 - 播放音檔 */}
                      {formData.practice_mode === "rearrangement" && (
                        <div className="mt-4 pt-4 border-t">
                          <Label className="text-xs text-gray-600 mb-2 block">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.playAudio",
                            )}
                          </Label>
                          <div className="flex gap-3">
                            <button
                              type="button"
                              onClick={() =>
                                setFormData((prev) => ({
                                  ...prev,
                                  play_audio: true,
                                }))
                              }
                              className={`flex-1 p-3 rounded-lg border text-sm ${
                                formData.play_audio
                                  ? "border-blue-500 bg-blue-50 text-blue-700"
                                  : "border-gray-200 hover:border-gray-300"
                              }`}
                            >
                              🔊{" "}
                              {t(
                                "dialogs.assignmentDialog.practiceMode.playAudioYes",
                              )}
                              <span className="block text-xs text-gray-500 mt-0.5">
                                {t(
                                  "dialogs.assignmentDialog.practiceMode.scoreListening",
                                )}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setFormData((prev) => ({
                                  ...prev,
                                  play_audio: false,
                                }))
                              }
                              className={`flex-1 p-3 rounded-lg border text-sm ${
                                !formData.play_audio
                                  ? "border-blue-500 bg-blue-50 text-blue-700"
                                  : "border-gray-200 hover:border-gray-300"
                              }`}
                            >
                              🔇{" "}
                              {t(
                                "dialogs.assignmentDialog.practiceMode.playAudioNo",
                              )}
                              <span className="block text-xs text-gray-500 mt-0.5">
                                {t(
                                  "dialogs.assignmentDialog.practiceMode.scoreWriting",
                                )}
                              </span>
                            </button>
                          </div>
                        </div>
                      )}
                    </Card>
                  )}

                  {/* ===== 單字集細節設定 (word_reading / word_selection) ===== */}
                  {(formData.practice_mode === "word_reading" ||
                    formData.practice_mode === "word_selection") && (
                    <Card className="p-4 border-gray-200">
                      <h4 className="text-sm font-medium mb-3 text-gray-700">
                        {t(
                          "dialogs.assignmentDialog.practiceMode.advancedSettings",
                        )}
                      </h4>

                      {/* 單字選擇專用 - 達標熟悉度 */}
                      {formData.practice_mode === "word_selection" && (
                        <div className="mb-4 pb-4 border-b">
                          <div className="flex items-center justify-between mb-2">
                            <Label className="text-xs text-gray-600">
                              {t(
                                "dialogs.assignmentDialog.practiceMode.targetProficiency",
                              )}
                            </Label>
                            <span className="text-sm font-medium text-blue-600">
                              {formData.target_proficiency}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={50}
                            max={100}
                            step={5}
                            value={formData.target_proficiency}
                            onChange={(e) =>
                              setFormData((prev) => ({
                                ...prev,
                                target_proficiency: Number(e.target.value),
                              }))
                            }
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.targetProficiencyDesc",
                            )}
                          </p>
                        </div>
                      )}

                      {/* 單字選擇專用 - 題目呈現方式 (顯示單字 vs 播放音檔 二擇一) */}
                      {formData.practice_mode === "word_selection" && (
                        <div className="mb-4 pb-4 border-b">
                          <Label className="text-xs text-gray-600 mb-2 block">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.questionDisplay",
                            )}
                          </Label>
                          <div className="flex gap-3">
                            <button
                              type="button"
                              onClick={() =>
                                setFormData((prev) => ({
                                  ...prev,
                                  show_word: true,
                                  play_audio: false,
                                }))
                              }
                              className={`flex-1 p-3 rounded-lg border text-sm ${
                                formData.show_word && !formData.play_audio
                                  ? "border-blue-500 bg-blue-50 text-blue-700"
                                  : "border-gray-200 hover:border-gray-300"
                              }`}
                            >
                              👁️{" "}
                              {t(
                                "dialogs.assignmentDialog.practiceMode.displayWord",
                              )}
                              <span className="block text-xs text-gray-500 mt-0.5">
                                {t(
                                  "dialogs.assignmentDialog.practiceMode.displayWordDesc",
                                )}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setFormData((prev) => ({
                                  ...prev,
                                  show_word: false,
                                  play_audio: true,
                                }))
                              }
                              className={`flex-1 p-3 rounded-lg border text-sm ${
                                !formData.show_word && formData.play_audio
                                  ? "border-blue-500 bg-blue-50 text-blue-700"
                                  : "border-gray-200 hover:border-gray-300"
                              }`}
                            >
                              🔊{" "}
                              {t(
                                "dialogs.assignmentDialog.practiceMode.playAudioWord",
                              )}
                              <span className="block text-xs text-gray-500 mt-0.5">
                                {t(
                                  "dialogs.assignmentDialog.practiceMode.playAudioWordDesc",
                                )}
                              </span>
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        {/* 時間限制 */}
                        <div className="space-y-1.5">
                          <Label className="text-xs text-gray-600">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.timeLimit",
                            )}
                          </Label>
                          <select
                            value={formData.time_limit_per_question}
                            onChange={(e) =>
                              setFormData((prev) => ({
                                ...prev,
                                time_limit_per_question: Number(
                                  e.target.value,
                                ) as 0 | 20 | 30 | 40,
                              }))
                            }
                            className="w-full h-9 px-3 rounded-md border border-gray-200 text-sm"
                          >
                            <option value={0}>
                              {t(
                                "dialogs.assignmentDialog.practiceMode.unlimited",
                              )}
                              {formData.practice_mode === "word_reading" &&
                                ` (${t("dialogs.assignmentDialog.practiceMode.default")})`}
                            </option>
                            <option value={20}>
                              20{" "}
                              {t(
                                "dialogs.assignmentDialog.practiceMode.seconds",
                              )}
                            </option>
                            <option value={30}>
                              30{" "}
                              {t(
                                "dialogs.assignmentDialog.practiceMode.seconds",
                              )}
                              {formData.practice_mode === "word_selection" &&
                                ` (${t("dialogs.assignmentDialog.practiceMode.default")})`}
                            </option>
                            <option value={40}>
                              40{" "}
                              {t(
                                "dialogs.assignmentDialog.practiceMode.seconds",
                              )}
                            </option>
                          </select>
                        </div>

                        {/* 打亂順序 */}
                        <div className="space-y-1.5">
                          <Label className="text-xs text-gray-600">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.shuffleQuestions",
                            )}
                          </Label>
                          <div className="flex items-center h-9">
                            <input
                              type="checkbox"
                              checked={formData.shuffle_questions}
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  shuffle_questions: e.target.checked,
                                }))
                              }
                              className="h-4 w-4 rounded border-gray-300"
                            />
                            <span className="ml-2 text-sm text-gray-600">
                              {t(
                                "dialogs.assignmentDialog.practiceMode.shuffleQuestionsDesc",
                              )}
                            </span>
                          </div>
                        </div>

                        {/* 單字朗讀專用 - 顯示翻譯 */}
                        {formData.practice_mode === "word_reading" && (
                          <div className="space-y-1.5">
                            <Label className="text-xs text-gray-600">
                              {t(
                                "dialogs.assignmentDialog.practiceMode.showTranslation",
                              )}
                            </Label>
                            <div className="flex items-center h-9">
                              <input
                                type="checkbox"
                                checked={formData.show_translation}
                                onChange={(e) =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    show_translation: e.target.checked,
                                  }))
                                }
                                className="h-4 w-4 rounded border-gray-300"
                              />
                              <span className="ml-2 text-sm text-gray-600">
                                {t(
                                  "dialogs.assignmentDialog.practiceMode.showTranslationDesc",
                                )}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* 顯示圖片 */}
                        <div className="space-y-1.5">
                          <Label className="text-xs text-gray-600">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.showImage",
                            )}
                          </Label>
                          <div className="flex items-center h-9">
                            <input
                              type="checkbox"
                              checked={formData.show_image}
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  show_image: e.target.checked,
                                }))
                              }
                              className="h-4 w-4 rounded border-gray-300"
                            />
                            <span className="ml-2 text-sm text-gray-600">
                              {t(
                                "dialogs.assignmentDialog.practiceMode.showImageDesc",
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    </Card>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Select Students */}
          {currentStep === 3 && (
            <div className="h-full flex flex-col">
              {loadingStudents ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                  <span className="ml-2 text-sm text-gray-500">
                    載入學生列表...
                  </span>
                </div>
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm text-gray-600">
                      {t("dialogs.assignmentDialog.selectStudents.description")}
                    </p>
                    <Badge
                      variant="secondary"
                      className="bg-blue-50 text-blue-700"
                    >
                      {t("dialogs.assignmentDialog.selectStudents.selected", {
                        selected: formData.student_ids.length,
                        total: effectiveStudents.length,
                      })}
                    </Badge>
                  </div>

                  {/* Quick Select All */}
                  <Card className="p-2 mb-2 bg-blue-50 border-blue-200">
                    <div
                      onClick={toggleAllStudents}
                      className="flex items-center gap-3 w-full cursor-pointer"
                    >
                      <Checkbox
                        checked={formData.assign_to_all}
                        className="data-[state=checked]:bg-blue-600 h-5 w-5"
                      />
                      <div className="flex-1 text-left">
                        <p className="text-sm font-semibold text-blue-900">
                          {t(
                            "dialogs.assignmentDialog.selectStudents.assignAll",
                          )}
                        </p>
                        <p className="text-xs text-blue-700">
                          {t(
                            "dialogs.assignmentDialog.selectStudents.totalStudents",
                            { count: effectiveStudents.length },
                          )}
                        </p>
                      </div>
                      {formData.assign_to_all && (
                        <Badge className="bg-blue-600 text-white">
                          {t(
                            "dialogs.assignmentDialog.selectStudents.allSelected",
                          )}
                        </Badge>
                      )}
                    </div>
                  </Card>

                  {/* Student Grid - Maximum use of space */}
                  <div className="flex-1 border rounded-lg bg-gray-50 p-2 overflow-hidden">
                    <ScrollArea className="h-full">
                      <div className="grid grid-cols-3 gap-1.5 p-1">
                        {[...effectiveStudents]
                          .sort((a, b) => {
                            // Sort by student_number: students without number go to the end
                            if (!a.student_number && !b.student_number)
                              return 0;
                            if (!a.student_number) return 1;
                            if (!b.student_number) return -1;
                            return a.student_number.localeCompare(
                              b.student_number,
                              undefined,
                              { numeric: true },
                            );
                          })
                          .map((student) => (
                            <div
                              key={student.id}
                              onClick={() => toggleStudent(student.id)}
                              className={cn(
                                "p-2 rounded-md border transition-all text-left relative cursor-pointer",
                                formData.student_ids.includes(student.id)
                                  ? "bg-blue-50 border-blue-300 shadow-sm"
                                  : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm",
                              )}
                            >
                              <div className="flex items-start gap-2">
                                <Checkbox
                                  checked={formData.student_ids.includes(
                                    student.id,
                                  )}
                                  className="data-[state=checked]:bg-blue-600 mt-0.5 h-4 w-4 pointer-events-none"
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-xs truncate">
                                    {student.student_number
                                      ? `${student.student_number}.${student.name}`
                                      : student.name}
                                  </p>
                                  <p className="text-[10px] text-gray-500 truncate">
                                    {student.email}
                                  </p>
                                </div>
                              </div>
                              {formData.student_ids.includes(student.id) && (
                                <div className="absolute top-1 right-1">
                                  <CheckCircle2 className="h-3 w-3 text-blue-600" />
                                </div>
                              )}
                            </div>
                          ))}
                      </div>
                    </ScrollArea>
                  </div>

                  {/* Action Buttons for quick selection */}
                  <div className="flex gap-2 mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          student_ids: effectiveStudents.map((s) => s.id),
                          assign_to_all: true,
                        }))
                      }
                      className="flex-1"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      {t(
                        "dialogs.assignmentDialog.selectStudents.selectAllBtn",
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          student_ids: [],
                          assign_to_all: false,
                        }))
                      }
                      className="flex-1"
                    >
                      <Circle className="h-4 w-4 mr-1" />
                      {t(
                        "dialogs.assignmentDialog.selectStudents.deselectAllBtn",
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const currentIds = formData.student_ids;
                        const allIds = effectiveStudents.map((s) => s.id);
                        const newIds = allIds.filter(
                          (id) => !currentIds.includes(id),
                        );
                        setFormData((prev) => ({
                          ...prev,
                          student_ids: newIds,
                          assign_to_all: false,
                        }));
                      }}
                      className="flex-1"
                    >
                      <ArrowRight className="h-4 w-4 mr-1" />
                      {t(
                        "dialogs.assignmentDialog.selectStudents.invertSelection",
                      )}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 4: Assignment Details */}
          {currentStep === 4 && (
            <div className="h-full flex flex-col">
              <div className="mb-2">
                <p className="text-sm text-gray-600">
                  {t("dialogs.assignmentDialog.details.description")}
                </p>
              </div>

              <ScrollArea className="flex-1">
                <div className="space-y-4 pr-4">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="title"
                      className="flex items-center gap-1 text-sm"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      {t("dialogs.assignmentDialog.details.title")}{" "}
                      {t("dialogs.assignmentDialog.details.titleRequired")}
                    </Label>
                    <Input
                      id="title"
                      value={formData.title}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          title: e.target.value,
                        }))
                      }
                      placeholder={t(
                        "dialogs.assignmentDialog.details.titlePlaceholder",
                      )}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label
                      htmlFor="instructions"
                      className="flex items-center gap-1 text-sm"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      {t("dialogs.assignmentDialog.details.instructions")}
                    </Label>
                    <Textarea
                      id="instructions"
                      value={formData.instructions}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          instructions: e.target.value,
                        }))
                      }
                      placeholder={t(
                        "dialogs.assignmentDialog.details.instructionsPlaceholder",
                      )}
                      rows={2}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="flex items-center gap-1 text-sm">
                        <CalendarIconAlt className="h-3.5 w-3.5" />
                        {t("dialogs.assignmentDialog.details.startDate")}
                      </Label>
                      <Input
                        type="date"
                        value={
                          formData.start_date
                            ? formData.start_date.toISOString().split("T")[0]
                            : ""
                        }
                        onChange={(e) => {
                          const dateValue = e.target.value
                            ? new Date(e.target.value)
                            : undefined;
                          setFormData((prev) => ({
                            ...prev,
                            start_date: dateValue,
                          }));
                        }}
                        className="text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="flex items-center gap-1 text-sm">
                        <Clock className="h-3.5 w-3.5" />
                        {t("dialogs.assignmentDialog.details.dueDate")}
                      </Label>
                      <Input
                        type="date"
                        value={
                          formData.due_date
                            ? formData.due_date.toISOString().split("T")[0]
                            : ""
                        }
                        onChange={(e) => {
                          const dateValue = e.target.value
                            ? new Date(e.target.value)
                            : undefined;
                          setFormData((prev) => ({
                            ...prev,
                            due_date: dateValue,
                          }));
                        }}
                        className="text-sm"
                      />
                    </div>
                  </div>

                  {/* Assignment Summary */}
                  <Card className="p-3 bg-blue-50 border-blue-200">
                    <h4 className="text-xs font-medium mb-2 text-blue-900">
                      {t("dialogs.assignmentDialog.details.summary")}
                    </h4>
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center gap-2">
                        <BookOpen className="h-3 w-3 text-blue-600" />
                        <span className="text-gray-700">
                          {t("dialogs.assignmentDialog.details.contentCount")}
                        </span>
                        <span className="font-medium text-blue-900">
                          {t(
                            "dialogs.assignmentDialog.details.contentCountValue",
                            { count: cartItems.length },
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Users className="h-3 w-3 text-blue-600" />
                        <span className="text-gray-700">
                          {t("dialogs.assignmentDialog.details.assignTo")}
                        </span>
                        <span className="font-medium text-blue-900">
                          {formData.assign_to_all
                            ? t("dialogs.assignmentDialog.details.assignToAll")
                            : t(
                                "dialogs.assignmentDialog.details.assignToSelected",
                                { count: formData.student_ids.length },
                              )}
                        </span>
                      </div>
                      {cartItems.length > 0 && (
                        <div className="flex items-center gap-2">
                          <Layers className="h-3 w-3 text-blue-600" />
                          <span className="text-gray-700">作業類型：</span>
                          <span className="font-medium text-blue-900">
                            {getContentTypeLabel(cartItems[0].contentType, t)}
                          </span>
                        </div>
                      )}
                      {formData.due_date && (
                        <div className="flex items-center gap-2">
                          <Clock className="h-3 w-3 text-blue-600" />
                          <span className="text-gray-700">
                            {t("dialogs.assignmentDialog.details.dueDateLabel")}
                          </span>
                          <span className="font-medium text-blue-900">
                            {format(formData.due_date, "yyyy年MM月dd日", {
                              locale: zhTW,
                            })}
                          </span>
                        </div>
                      )}
                    </div>
                  </Card>
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        {/* Footer with Navigation */}
        <SheetFooter className="flex-row px-6 py-3 border-t sm:flex-row sm:justify-between sm:space-x-0">
          <div className="flex items-center justify-between w-full">
            {/* 左側：返回按鈕 */}
            <Button
              variant="outline"
              onClick={
                currentStep === 1
                  ? handleClose
                  : () => setCurrentStep(currentStep - 1)
              }
              disabled={loading}
            >
              {currentStep === 1 ? (
                <>{t("dialogs.assignmentDialog.buttons.cancel")}</>
              ) : (
                <>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  {t("dialogs.assignmentDialog.buttons.previous")}
                </>
              )}
            </Button>

            {/* 右側：下一步/建立按鈕 */}
            <div className="flex items-center gap-2">
              {currentStep < 4 ? (
                <Button onClick={handleNextStep} disabled={!canProceed()}>
                  {t("dialogs.assignmentDialog.buttons.next")}
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={loading || loadingStudents || !canProceed()}
                  className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                >
                  {loading ? (
                    <>{t("dialogs.assignmentDialog.buttons.creating")}</>
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-1" />
                      {t("dialogs.assignmentDialog.buttons.create")}
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
