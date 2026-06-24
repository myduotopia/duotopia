import React, { useState, useEffect, useMemo, useRef } from "react";
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
  Brain,
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
import { apiClient, ApiError } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { PracticeMode } from "@/lib/practiceMode";
import {
  listModesForDataset,
  applyModeDefaults,
  getModeConfig,
} from "@/lib/practiceMode";
import { PracticeModeSettingsPanel } from "./assignment/PracticeModeSettingsPanel";
import { useTranslation } from "react-i18next";
import { useWorkspaceSafe } from "@/contexts/WorkspaceContext";
import { getScoreCategory, type ScoreCategory } from "@/utils/scoreCategory";
import WordReadingPreview from "@/components/activities/WordReadingPreview";
import WordSelectionPreview from "@/components/activities/WordSelectionPreview";
import WordSpellingPreview from "@/components/activities/WordSpellingPreview";
import WordClozeContextPreview from "@/components/activities/WordClozeContextPreview";
import WordSelectionQuizPreview from "@/components/activities/WordSelectionQuizPreview";
import WordSpellingQuizPreview from "@/components/activities/WordSpellingQuizPreview";
import WordClozeQuizPreview from "@/components/activities/WordClozeQuizPreview";
import RearrangementPreview from "@/components/activities/RearrangementPreview";
import ReadingPreview from "@/components/activities/ReadingPreview";

// Issue #752 PoC: 預覽固定使用 contact@duotopia.co 的官方公開單字集
// production 用 id 2212（"RPG" VOCABULARY_SET）；其他環境（staging / develop /
// per-issue / local）沿用舊預覽教材 id 282（翰林佳音 第二冊 Warm up）
const PREVIEW_VOCAB_CONTENT_ID =
  import.meta.env.VITE_ENVIRONMENT === "production" ? 2212 : 282;

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
  image_url?: string | null;
  // Issue #757: 聽力模式（reading / rearrangement+audio / word_cloze+audio）
  // 需要的是例句音檔，不是單字音檔；單字集用 example_sentence_audio_url，
  // 例句集則用 audio_url 本身。
  example_sentence?: string | null;
  example_sentence_audio_url?: string | null;
}

interface Content {
  id: number;
  title: string;
  type: string;
  // Issue #587: lesson_id may be null when content lives directly under a program
  lesson_id?: number | null;
  program_id?: number | null;
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
  // Issue #587: contents directly under a program (no lesson)
  contents?: Content[];
  teacher_id?: number;
  organization_id?: string;
  school_id?: string;
  is_template?: boolean;
}

interface AssignmentDialogProps {
  open: boolean;
  onClose: () => void;
  classroomId?: number;
  students?: Student[];
  onSuccess?: () => void;
  /** Override organization context (for use outside WorkspaceProvider, e.g. org admin module) */
  organizationId?: string;
  /** Override school context (for use outside WorkspaceProvider, e.g. org admin module) */
  schoolId?: string;
  /** Pre-selected contents from content pages (e.g. 我的教材) */
  preSelectedContents?: CartItem[];
}

// 多班級選擇時，每個班級的學生選擇狀態
interface SelectedClassroom {
  id: number;
  name: string;
  school_id: string;
  students: Student[];
  selectedStudentIds: number[];
  assignToAll: boolean;
}

interface ClassroomOption {
  id: number;
  name: string;
  student_count: number;
  school_id?: string;
  school_name?: string;
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

// Issue #800: cap vocabulary sets per assignment so students don't end up
// with practice pools that feel endless. Two sets is roomy enough for a
// week-long assignment and aligns with what teachers actually plan. The
// limit is enforced both in the UI (proactive disable + toast) and in
// the backend create endpoint as defence-in-depth.
const MAX_VOCAB_SETS_PER_ASSIGNMENT = 2;

// Issue #757: 聽力派發前置檢查，例句音檔對應的欄位依 content type 不同：
//   VOCABULARY_SET → example_sentence_audio_url
//   EXAMPLE_SENTENCES → audio_url（例句集的 audio_url 本身就是例句音檔）
// 沒填例句的單字集 item 不算「缺音檔」，因為 EXAMPLE_SENTENCE_REQUIRED
// 會在更上層先擋下，這裡只判定「該有音檔但沒有」的真正缺失。
const computeHasMissingExampleAudio = (content: Content): boolean => {
  if (!content.items || content.items.length === 0) return false;
  if (isVocabularySetType(content.type)) {
    return content.items.some(
      (item) =>
        (item.example_sentence || "").trim().length > 0 &&
        !item.example_sentence_audio_url,
    );
  }
  if (isExampleSentencesType(content.type)) {
    return content.items.some((item) => !item.audio_url);
  }
  return false;
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
export interface CartItem {
  contentId: number;
  programName: string;
  // Issue #587: lessonName empty when content lives directly under program
  lessonName: string;
  contentTitle: string;
  contentType: string;
  itemsCount?: number;
  order: number; // 用於排序
  hasMissingAudio: boolean; // 是否有缺少單字音檔的項目
  // Issue #757: 例句音檔（給聽力類派發前置檢查用：reading /
  // rearrangement+play_audio / word_cloze+play_audio）
  hasMissingExampleAudio: boolean;
  hasMissingImage: boolean; // 是否有缺少題目圖片的項目（單字選擇 show_option_images 前置驗證用）
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
            {item.lessonName
              ? `${item.programName} / ${item.lessonName}`
              : item.programName}
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

const EMPTY_STUDENTS: Student[] = [];

interface ExampleSentenceErrorDetail {
  code:
    | "EXAMPLE_SENTENCE_REQUIRED"
    | "EXAMPLE_AUDIO_REQUIRED"
    | "CLOZE_ANSWER_REQUIRED";
  practice_mode?: string | null;
  play_audio?: boolean | null;
  content_titles?: string[];
}

const getExampleSentenceErrorDetail = (
  error: unknown,
): ExampleSentenceErrorDetail | null => {
  // apiClient throws ApiError (fetch-based wrapper); the structured backend
  // detail lives on `error.detail`, not `error.response.data.detail`.
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  const detail = error.detail;
  const code =
    detail && typeof detail === "object" && !Array.isArray(detail)
      ? (detail as { code?: unknown }).code
      : null;
  if (
    code === "EXAMPLE_SENTENCE_REQUIRED" ||
    code === "EXAMPLE_AUDIO_REQUIRED" ||
    code === "CLOZE_ANSWER_REQUIRED"
  ) {
    return detail as unknown as ExampleSentenceErrorDetail;
  }
  return null;
};

const isExampleSentenceRequiredError = (error: unknown): boolean =>
  getExampleSentenceErrorDetail(error) !== null;

const sortByStudentNumber = (a: Student, b: Student) => {
  if (!a.student_number && !b.student_number) return 0;
  if (!a.student_number) return 1;
  if (!b.student_number) return -1;
  return a.student_number.localeCompare(b.student_number, undefined, {
    numeric: true,
  });
};

export function AssignmentDialog({
  open,
  onClose,
  classroomId,
  students = EMPTY_STUDENTS,
  onSuccess,
  organizationId: propOrganizationId,
  schoolId: propSchoolId,
  preSelectedContents,
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

  // 是否需要班級選擇步驟（從教材頁面開啟時無 classroomId）
  const needsClassroomStep = !classroomId;
  // 是否有預選內容（從教材頁面帶入）
  const hasPreSelectedContents =
    preSelectedContents && preSelectedContents.length > 0;

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
  const [currentStep, setCurrentStep] = useState(needsClassroomStep ? 0 : 1);
  // 只在機構模式且有機構 ID 時顯示「機構教材」tab
  const showOrgTab = isOrgMode && effectiveOrganizationId !== null;

  const [activeTab, setActiveTab] = useState<
    "template" | "classroom" | "organization"
  >(showOrgTab ? "organization" : "template");

  // === 多班級選擇 ===
  const [classroomOptions, setClassroomOptions] = useState<ClassroomOption[]>(
    [],
  );
  const [loadingClassrooms, setLoadingClassrooms] = useState(false);
  const [selectedClassrooms, setSelectedClassrooms] = useState<
    SelectedClassroom[]
  >([]);
  const [activeClassroomTab, setActiveClassroomTab] = useState<number>(0);

  // 學生列表：多班級模式用 selectedClassrooms，單班級模式用原有邏輯
  const effectiveStudents = needsClassroomStep
    ? selectedClassrooms[activeClassroomTab]?.students || []
    : students.length > 0
      ? students
      : internalStudents;

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
    // Issue #843: 型別統一由 @/lib/practiceMode 提供（含 tug_of_war 與三種小考）
    practice_mode: "word_selection" as "" | PracticeMode, // 作答模式（預設單字選擇）
    time_limit_per_question: 30 as 0 | 10 | 20 | 30 | 40, // 每題時間限制 (0 = 不限時)
    // Issue #828: 小考整卷限時（秒）；null/0 不限時，預設 0
    quiz_time_limit_seconds: 0 as 0 | 180 | 300 | 600 | 900 | 1200 | 1800,
    // Issue #835: 老師主控 live 考試模式（同步開始/收卷，無倒數）
    is_live_quiz: false,
    shuffle_questions: false, // 是否打亂順序
    show_answer: false, // 答題結束後是否顯示正確答案（例句重組專用）
    play_audio: false, // 是否播放音檔（例句重組/單字集專用）
    // ===== 單字集專用設定 =====
    target_proficiency: 80, // 達標熟悉度 (50-100%)
    show_translation: true, // 顯示翻譯（單字朗讀專用）
    show_word: true, // 顯示單字（單字選擇專用）
    show_image: true, // 顯示題目圖片
    show_option_images: false, // 顯示選項圖片（單字選擇專用，與 show_image 互斥，Issue #631）
  });

  // Issue #752: 練習模式 chip 列橫向滑動 + 箭頭按鈕（內容超寬時才顯示）
  const chipRowRef = useRef<HTMLDivElement>(null);
  const [chipCanScrollLeft, setChipCanScrollLeft] = useState(false);
  const [chipCanScrollRight, setChipCanScrollRight] = useState(false);
  useEffect(() => {
    const el = chipRowRef.current;
    if (!el) return;
    const update = () => {
      setChipCanScrollLeft(el.scrollLeft > 0);
      setChipCanScrollRight(
        el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
      );
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [currentStep]);
  const scrollChips = (dir: "left" | "right") => {
    const el = chipRowRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -200 : 200, behavior: "smooth" });
  };

  // 內部載入學生列表（當外部未傳入時，單班級模式）
  const loadStudents = async () => {
    if (!effectiveSchoolId || !classroomId) return;
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
      toast.error(
        t("dialogs.assignmentDialog.errors.loadStudentsFailed", { name: "" }),
      );
      onClose();
    } finally {
      setLoadingStudents(false);
    }
  };

  // 載入班級列表（多班級選擇模式）
  // Match the workspace context: org mode shows the teacher's classrooms in
  // schools under this org; school mode shows classrooms in this school;
  // personal mode shows classrooms not linked to any school.
  const loadClassroomOptions = async () => {
    setLoadingClassrooms(true);
    try {
      const params = effectiveOrganizationId
        ? { mode: "organization", organization_id: effectiveOrganizationId }
        : effectiveSchoolId
          ? { mode: "school", school_id: effectiveSchoolId }
          : { mode: "personal" };
      const data = (await apiClient.getTeacherClassrooms(
        params,
      )) as ClassroomOption[];
      setClassroomOptions(data || []);
    } catch {
      toast.error(t("dialogs.assignmentDialog.errors.loadClassroomsFailed"));
    } finally {
      setLoadingClassrooms(false);
    }
  };

  // 切換班級選擇（多班級模式）
  const toggleClassroomSelection = async (classroom: ClassroomOption) => {
    const existing = selectedClassrooms.find((c) => c.id === classroom.id);
    if (existing) {
      // 取消選擇
      setSelectedClassrooms((prev) => {
        const newList = prev.filter((c) => c.id !== classroom.id);
        setActiveClassroomTab((t) =>
          Math.min(t, Math.max(0, newList.length - 1)),
        );
        return newList;
      });
    } else {
      // 新增選擇，載入學生
      try {
        const students = (await apiClient.getTeacherClassroomStudents(
          classroom.id,
        )) as Student[];
        setSelectedClassrooms((prev) => {
          // Guard: skip if already added (handles rapid double-click)
          if (prev.some((c) => c.id === classroom.id)) return prev;
          return [
            ...prev,
            {
              id: classroom.id,
              name: classroom.name,
              school_id: classroom.school_id || effectiveSchoolId || "",
              students: students || [],
              selectedStudentIds: (students || []).map((s) => s.id),
              assignToAll: true,
            },
          ];
        });
      } catch {
        toast.error(
          t("dialogs.assignmentDialog.errors.loadStudentsFailed", {
            name: classroom.name,
          }),
        );
      }
    }
  };

  // 多班級模式：切換某班的學生
  const toggleClassroomStudent = (classroomId: number, studentId: number) => {
    setSelectedClassrooms((prev) =>
      prev.map((c) => {
        if (c.id !== classroomId) return c;
        const newIds = c.selectedStudentIds.includes(studentId)
          ? c.selectedStudentIds.filter((id) => id !== studentId)
          : [...c.selectedStudentIds, studentId];
        return {
          ...c,
          selectedStudentIds: newIds,
          assignToAll: newIds.length === c.students.length,
        };
      }),
    );
  };

  // 多班級模式：全選/取消全選某班
  const toggleClassroomAllStudents = (classroomId: number) => {
    setSelectedClassrooms((prev) =>
      prev.map((c) => {
        if (c.id !== classroomId) return c;
        const allSelected = c.assignToAll;
        return {
          ...c,
          selectedStudentIds: allSelected ? [] : c.students.map((s) => s.id),
          assignToAll: !allSelected,
        };
      }),
    );
  };

  useEffect(() => {
    if (open) {
      // 多班級模式：載入班級列表
      if (needsClassroomStep) {
        loadClassroomOptions();
        setSelectedClassrooms([]);
        setActiveClassroomTab(0);
      } else {
        // 單班級模式：載入學生
        if (students.length === 0) {
          setInternalStudents([]);
          loadStudents();
        } else {
          setInternalStudents(students);
        }
      }
      loadTemplatePrograms();
      if (classroomId) {
        loadClassroomPrograms();
      }
      if (showOrgTab) {
        loadOrgPrograms();
      }
      loadQuotaInfo();
      // Reset form when dialog opens
      setCartItems(hasPreSelectedContents ? [...preSelectedContents!] : []);
      setFormData({
        title: "",
        instructions: "",
        student_ids: students.map((s) => s.id),
        assign_to_all: true,
        due_date: undefined,
        start_date: new Date(),
        practice_mode: "word_selection",
        time_limit_per_question: 30 as 0 | 10 | 20 | 30 | 40,
        quiz_time_limit_seconds: 0 as 0 | 180 | 300 | 600 | 900 | 1200 | 1800,
        is_live_quiz: false,
        shuffle_questions: false,
        show_answer: false,
        play_audio: false,
        target_proficiency: 80,
        show_translation: true,
        show_word: true,
        show_image: true,
        show_option_images: false,
      });
      setCurrentStep(needsClassroomStep ? 0 : 1);
      setActiveTab(showOrgTab ? "organization" : "template");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load functions recreated each render; only run on dialog open/context change
  }, [open, classroomId, students, showOrgTab]);

  // 當練習模式改變時，清除不相容的購物車項目
  // 單字模式只能選單字集，需要移除例句集項目
  // 例句模式（朗讀 / 重組）可以選全部，不需要清除
  useEffect(() => {
    if (
      formData.practice_mode === "word_reading" ||
      formData.practice_mode === "word_selection" ||
      formData.practice_mode === "word_spelling" ||
      formData.practice_mode === "word_cloze" ||
      formData.practice_mode === "word_selection_quiz" ||
      formData.practice_mode === "word_spelling_quiz" ||
      formData.practice_mode === "word_cloze_quiz"
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
      // Aggregated balance: subscription period + every active credit package
      // (trial / referral bonus / purchased pack). Using the old
      // /api/teachers/subscription endpoint here would silently understate the
      // teacher's available quota and could block legitimate assignments.
      if (effectiveOrganizationId) {
        const res = await apiClient.get<{
          total_points: number;
          used_points: number;
        }>(`/api/organizations/${effectiveOrganizationId}/points`);
        if (typeof res.total_points === "number" && res.total_points > 0) {
          setQuotaInfo({
            quota_total: res.total_points,
            quota_used: res.used_points ?? 0,
            quota_remaining: Math.max(
              0,
              res.total_points - (res.used_points ?? 0),
            ),
            plan_name: "",
          });
        } else {
          // Reset so a previous workspace's value doesn't linger and let a
          // teacher act on quota they no longer have here.
          setQuotaInfo(null);
        }
        return;
      }

      const res = await apiClient.getSubscriptionStatus();
      if (typeof res.quota_total === "number" && res.quota_total > 0) {
        setQuotaInfo({
          quota_total: res.quota_total,
          quota_used: res.quota_used ?? 0,
          quota_remaining: Math.max(
            0,
            (res.quota_total ?? 0) - (res.quota_used ?? 0),
          ),
          plan_name: res.plan ?? "",
        });
      } else {
        setQuotaInfo(null);
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

    // 例句模式（朗讀 / 重組）：例句集 + 單字集都可選（單字集用 example_sentence 出題）
    if (mode === "reading" || mode === "rearrangement") {
      return true;
    }
    // 單字模式（含克漏字、小考變體）：只能選單字集
    if (
      mode === "word_reading" ||
      mode === "word_selection" ||
      mode === "word_spelling" ||
      mode === "word_cloze" ||
      mode === "word_selection_quiz" ||
      mode === "word_spelling_quiz" ||
      mode === "word_cloze_quiz"
    ) {
      return isVocabularySetType(contentType);
    }
    return true;
  };

  // Issue #800: count currently-selected vocabulary sets so we can cap at
  // MAX_VOCAB_SETS_PER_ASSIGNMENT. Computed inline (not memoised) — cart
  // length is small (<10) so the filter is cheap and avoids stale-closure
  // bugs in the toggle handler.
  const selectedVocabSetCount = cartItems.filter((item) =>
    isVocabularySetType(item.contentType),
  ).length;
  const isVocabLimitReached =
    selectedVocabSetCount >= MAX_VOCAB_SETS_PER_ASSIGNMENT;

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
    // Issue #800: block adding a 3rd vocab set even if mode allows it.
    if (!exists && isVocabularySetType(content.type) && isVocabLimitReached) {
      toast.warning(
        t("dialogs.assignmentDialog.errors.maxVocabSetsReached") ||
          `為避免單次練習量過大，最多選 ${MAX_VOCAB_SETS_PER_ASSIGNMENT} 個單字集`,
      );
      return;
    }

    setCartItems((prev) => {
      const existsInPrev = prev.find((item) => item.contentId === contentId);
      if (existsInPrev) {
        // 移除
        return prev.filter((item) => item.contentId !== contentId);
      } else {
        // 添加 - 檢查是否有缺少音檔/圖片的項目
        const hasMissingAudio = content.items
          ? content.items.some((item) => !item.audio_url)
          : false;
        const hasMissingExampleAudio = computeHasMissingExampleAudio(content);
        const hasMissingImage = content.items
          ? content.items.some((item) => !item.image_url)
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
            hasMissingExampleAudio,
            hasMissingImage,
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
            hasMissingExampleAudio: computeHasMissingExampleAudio(content),
            hasMissingImage: content.items
              ? content.items.some((item) => !item.image_url)
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

    // 多班級模式驗證
    if (needsClassroomStep) {
      const hasStudents = selectedClassrooms.some(
        (c) => c.selectedStudentIds.length > 0,
      );
      if (!hasStudents) {
        toast.error(t("dialogs.assignmentDialog.errors.noStudentSelected"));
        return;
      }
    } else if (formData.student_ids.length === 0) {
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
      let answerMode: "speaking" | "listening" | "writing";
      if (formData.practice_mode === "reading") {
        answerMode = "speaking";
      } else if (formData.play_audio) {
        answerMode = "listening";
      } else {
        answerMode = "writing";
      }

      // 共用的 payload 基礎
      const basePayload = {
        title: formData.title,
        description: formData.instructions || undefined,
        content_ids: sortedContentIds,
        due_date: formData.due_date
          ? formData.due_date.toISOString()
          : undefined,
        start_date: formData.start_date
          ? formData.start_date.toISOString()
          : undefined,
        answer_mode: answerMode,
        practice_mode: formData.practice_mode,
        time_limit_per_question: formData.time_limit_per_question,
        // Issue #835: live 模式無倒數，整卷限時一律送 null
        quiz_time_limit_seconds: formData.is_live_quiz
          ? null
          : formData.quiz_time_limit_seconds || null,
        // 只有小考模式可開 live；其餘類型一律送 false
        is_live_quiz: formData.practice_mode?.endsWith("_quiz")
          ? formData.is_live_quiz
          : false,
        shuffle_questions: formData.shuffle_questions,
        show_answer: formData.show_answer,
        play_audio: formData.play_audio,
        target_proficiency: formData.target_proficiency,
        show_translation: formData.show_translation,
        show_word: formData.show_word,
        show_image: formData.show_image,
        show_option_images: formData.show_option_images,
        ...(effectiveOrganizationId && {
          organization_id: effectiveOrganizationId,
        }),
      };

      if (needsClassroomStep) {
        // 多班級模式：per classroom 建立 assignment
        const classroomsToCreate = selectedClassrooms.filter(
          (c) => c.selectedStudentIds.length > 0,
        );
        let totalStudents = 0;
        let successCount = 0;
        const failedClassroomNames: string[] = [];

        for (const classroom of classroomsToCreate) {
          try {
            const payload = {
              ...basePayload,
              classroom_id: classroom.id,
              student_ids: classroom.assignToAll
                ? []
                : classroom.selectedStudentIds,
              school_id: classroom.school_id,
            };
            const result = await apiClient.post<{ student_count: number }>(
              "/api/teachers/assignments/create",
              payload,
            );
            totalStudents += result.student_count || 0;
            successCount++;
          } catch (err) {
            // Issue #673: example-sentence validation rejects the *payload*,
            // not the per-classroom config. Bubble up so the outer handler
            // shows the specific toast instead of a generic per-class fail.
            if (isExampleSentenceRequiredError(err)) {
              throw err;
            }
            failedClassroomNames.push(classroom.name);
            console.error(
              `Failed to create assignment for ${classroom.name}:`,
              err,
            );
          }
        }

        if (successCount === 0) {
          throw new Error("All classroom assignments failed");
        }

        if (successCount < classroomsToCreate.length) {
          toast.warning(
            t("dialogs.assignmentDialog.success.partialCreated", {
              successCount,
              totalCount: classroomsToCreate.length,
              studentCount: totalStudents,
              failedNames: failedClassroomNames.join(", "),
            }),
          );
        } else {
          toast.success(
            t("dialogs.assignmentDialog.success.multiCreated", {
              classroomCount: classroomsToCreate.length,
              studentCount: totalStudents,
            }),
          );
        }
      } else {
        // 單班級模式：原有邏輯
        const payload = {
          ...basePayload,
          classroom_id: classroomId,
          student_ids: formData.assign_to_all ? [] : formData.student_ids,
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
      }

      onSuccess?.();
      handleClose();
    } catch (error: unknown) {
      console.error("Failed to create assignment:", error);

      // Issue #673 / #757: 422 with structured detail telling us which contents
      // lack either example sentences (text) or example audio for the chosen
      // practice mode. Surface the specific toast so the teacher knows what to
      // fix and where (回單字集編輯頁手動補).
      if (isExampleSentenceRequiredError(error)) {
        const detail = getExampleSentenceErrorDetail(error);
        const modeKey = detail?.practice_mode
          ? `assignment.practiceMode.${detail.practice_mode}`
          : "";
        const modeLabel = modeKey
          ? t(modeKey, { defaultValue: detail?.practice_mode || "" })
          : "";
        const titles = detail?.content_titles?.join("、") || "";
        if (detail?.code === "EXAMPLE_AUDIO_REQUIRED") {
          toast.error(t("dialogs.assignmentDialog.errors.missingAudio"), {
            description: t("dialogs.assignmentDialog.errors.missingAudioDesc", {
              contents: titles,
            }),
          });
        } else if (detail?.code === "CLOZE_ANSWER_REQUIRED") {
          toast.error(t("dialogs.assignmentDialog.errors.missingClozeAnswer"), {
            description: t(
              "dialogs.assignmentDialog.errors.missingClozeAnswerDesc",
              { contents: titles },
            ),
          });
        } else {
          toast.error(
            t("dialogs.assignmentDialog.errors.exampleSentenceRequired", {
              mode: modeLabel,
            }),
            {
              description: t(
                "dialogs.assignmentDialog.errors.exampleSentenceRequiredDesc",
                { contents: titles },
              ),
            },
          );
        }
      } else if (
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
      practice_mode: "word_selection",
      time_limit_per_question: 30 as 0 | 10 | 20 | 30 | 40,
      quiz_time_limit_seconds: 0 as 0 | 180 | 300 | 600 | 900 | 1200 | 1800,
      is_live_quiz: false,
      shuffle_questions: false,
      show_answer: false,
      play_audio: false,
      target_proficiency: 80,
      show_translation: true,
      show_word: true,
      show_image: true,
      show_option_images: false,
    });
    setCartItems([]);
    setExpandedPrograms(new Set());
    setExpandedLessons(new Set());
    setSelectedClassrooms([]);
    setActiveClassroomTab(0);
    setCurrentStep(needsClassroomStep ? 0 : 1);
    setActiveTab(showOrgTab ? "organization" : "template");
    onClose();
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        // 至少選一個班級且該班至少選一個學生
        return (
          selectedClassrooms.length > 0 &&
          selectedClassrooms.some((c) => c.selectedStudentIds.length > 0)
        );
      case 1:
        return !!formData.practice_mode;
      case 2:
        return cartItems.length > 0;
      case 3:
        // 單班級模式：至少選一個學生（多班級模式不會進到 step 3）
        return formData.student_ids.length > 0;
      case 4:
        return formData.title.trim().length > 0;
      default:
        return false;
    }
  };

  // Issue #757: 三種「聽得到」的派發模式必須要有例句音檔
  // （reading / rearrangement+play_audio / word_cloze+play_audio）
  // 缺音檔時擋下派發，並提示老師回單字集編輯頁點 [AI] 補生。
  const checkAudioRequirement = (): boolean => {
    const needsExampleAudio =
      formData.practice_mode === "reading" ||
      (formData.practice_mode === "rearrangement" && formData.play_audio) ||
      (formData.practice_mode === "word_cloze" && formData.play_audio) ||
      (formData.practice_mode === "word_cloze_quiz" && formData.play_audio);

    if (!needsExampleAudio) {
      return true;
    }

    const offending = cartItems.filter((item) => item.hasMissingExampleAudio);
    if (offending.length === 0) return true;

    toast.error(t("dialogs.assignmentDialog.errors.missingAudio"), {
      description: t("dialogs.assignmentDialog.errors.missingAudioDesc", {
        contents: offending.map((c) => c.contentTitle).join("、"),
      }),
    });
    return false;
  };

  // 動態步驟列表
  const steps = [
    ...(needsClassroomStep
      ? [
          {
            number: 0,
            title: t("dialogs.assignmentDialog.steps.selectClassroom"),
            icon: Building2,
          },
        ]
      : []),
    {
      number: 1,
      title: t("dialogs.assignmentDialog.steps.practiceMode"),
      icon: Settings,
    },
    ...(hasPreSelectedContents && needsClassroomStep
      ? []
      : [
          {
            number: 2,
            title: t("dialogs.assignmentDialog.steps.selectContent"),
            icon: BookOpen,
          },
        ]),
    ...(!needsClassroomStep
      ? [
          {
            number: 3,
            title: t("dialogs.assignmentDialog.steps.selectStudents"),
            icon: Users,
          },
        ]
      : []),
    {
      number: 4,
      title: t("dialogs.assignmentDialog.steps.details"),
      icon: FileText,
    },
  ];
  const stepNumbers = steps.map((s) => s.number);
  const lastStepNumber = steps[steps.length - 1].number;
  const firstStepNumber = steps[0].number;

  // 處理下一步按鈕點擊
  const handleNextStep = () => {
    // 從 step 1 移動到 step 2 時，根據內容類型設定預設練習模式（僅在尚未選擇時）
    if (currentStep === 1 && !formData.practice_mode) {
      const contentCategory = getCartContentTypeCategory();
      if (contentCategory === "vocabulary_set") {
        // 單字集預設為單字朗讀模式，不限時
        setFormData((prev) => ({
          ...prev,
          practice_mode: "word_reading",
          time_limit_per_question: 10, // 單字朗讀固定 10 秒
        }));
      } else {
        // 例句集預設為例句重組模式（word_* 模式不適用於例句集）
        setFormData((prev) => ({
          ...prev,
          practice_mode: "rearrangement",
          time_limit_per_question: 30,
        }));
      }
    }

    // 進入作業詳情前，檢查音檔驗證（從 step 2 或從 step 1 跳過時都需要）
    const nextIndex = stepNumbers.indexOf(currentStep) + 1;
    if (nextIndex < stepNumbers.length && stepNumbers[nextIndex] === 4) {
      if (!checkAudioRequirement()) {
        return;
      }
    }
    // 找到 steps 中下一個有效步驟
    const currentIndex = stepNumbers.indexOf(currentStep);
    if (currentIndex < stepNumbers.length - 1) {
      setCurrentStep(stepNumbers[currentIndex + 1]);
    }
  };

  // 處理上一步（跳過被隱藏的步驟）
  const handlePrevStep = () => {
    const currentIndex = stepNumbers.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(stepNumbers[currentIndex - 1]);
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className="!w-full !max-w-full md:!max-w-[calc(100vw-16rem)] h-full flex flex-col p-0"
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
                    className={`grid w-full ${
                      showOrgTab && classroomId
                        ? "grid-cols-3"
                        : showOrgTab || classroomId
                          ? "grid-cols-2"
                          : "grid-cols-1"
                    } mb-2`}
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
                    {classroomId && (
                      <TabsTrigger
                        value="classroom"
                        className="flex items-center gap-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                      >
                        <Users className="h-4 w-4" />
                        班級課程
                      </TabsTrigger>
                    )}
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
                                                  // Issue #800: also disable
                                                  // un-selected vocab sets
                                                  // once the per-assignment
                                                  // cap is reached.
                                                  const isDisabled =
                                                    !isSelected &&
                                                    (!isContentSelectable(
                                                      content.type,
                                                    ) ||
                                                      (isVocabLimitReached &&
                                                        isVocabularySetType(
                                                          content.type,
                                                        )));
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
                                                    // Issue #800: cap vocab sets.
                                                    const isDisabled =
                                                      !isSelected &&
                                                      (!isContentSelectable(
                                                        content.type,
                                                      ) ||
                                                        (isVocabLimitReached &&
                                                          isVocabularySetType(
                                                            content.type,
                                                          )));
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
                                                  // Issue #800: also disable
                                                  // un-selected vocab sets
                                                  // once the per-assignment
                                                  // cap is reached.
                                                  const isDisabled =
                                                    !isSelected &&
                                                    (!isContentSelectable(
                                                      content.type,
                                                    ) ||
                                                      (isVocabLimitReached &&
                                                        isVocabularySetType(
                                                          content.type,
                                                        )));
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
                  <div className="flex items-center gap-2">
                    {/* Issue #800: surface vocab-set count so teachers
                        understand why the 3rd vocab set was disabled. */}
                    {selectedVocabSetCount > 0 && (
                      <Badge
                        variant="secondary"
                        className={
                          isVocabLimitReached
                            ? "bg-amber-50 text-amber-700"
                            : "bg-gray-100 text-gray-600"
                        }
                      >
                        單字集 {selectedVocabSetCount} /{" "}
                        {MAX_VOCAB_SETS_PER_ASSIGNMENT}
                      </Badge>
                    )}
                    <Badge
                      variant="secondary"
                      className="bg-blue-50 text-blue-700"
                    >
                      {cartItems.length}
                    </Badge>
                  </div>
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

          {/* Step 0: Select Classrooms (多班級模式) */}
          {currentStep === 0 && needsClassroomStep && (
            <div className="h-full flex flex-col">
              <div className="mb-2">
                <p className="text-sm text-gray-600">
                  {t("dialogs.assignmentDialog.classroomSelection.description")}
                </p>
                {selectedClassrooms.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="mt-1 bg-blue-50 text-blue-700"
                  >
                    {t(
                      "dialogs.assignmentDialog.classroomSelection.selectedCount",
                      { count: selectedClassrooms.length },
                    )}
                  </Badge>
                )}
              </div>

              <div className="flex-1 border rounded-lg bg-gray-50 p-2 overflow-hidden">
                <ScrollArea className="h-full">
                  {loadingClassrooms ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                      <span className="ml-2 text-sm text-gray-500">
                        {t(
                          "dialogs.assignmentDialog.classroomSelection.loading",
                        )}
                      </span>
                    </div>
                  ) : classroomOptions.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-sm text-gray-500">
                      {t(
                        "dialogs.assignmentDialog.classroomSelection.noClassrooms",
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 p-1">
                      {classroomOptions.map((classroom) => {
                        const selected = selectedClassrooms.find(
                          (c) => c.id === classroom.id,
                        );
                        const isSelected = !!selected;
                        return (
                          <Card
                            key={classroom.id}
                            className={cn(
                              "transition-all overflow-hidden",
                              isSelected
                                ? "bg-blue-50 border-blue-300 shadow-sm"
                                : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm",
                            )}
                          >
                            {/* Classroom header */}
                            <div
                              onClick={() =>
                                toggleClassroomSelection(classroom)
                              }
                              className="p-3 cursor-pointer flex items-center gap-3"
                            >
                              <Checkbox
                                checked={isSelected}
                                className="data-[state=checked]:bg-blue-600 h-5 w-5 pointer-events-none"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm truncate">
                                  {classroom.name}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {t(
                                    "dialogs.assignmentDialog.classroomSelection.studentCount",
                                    {
                                      count: classroom.student_count,
                                    },
                                  )}
                                </p>
                              </div>
                              {isSelected && selected && (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px] px-1.5 bg-blue-100 text-blue-700"
                                >
                                  {selected.selectedStudentIds.length}/
                                  {selected.students.length}
                                </Badge>
                              )}
                            </div>

                            {/* Expanded student list */}
                            {isSelected && selected && (
                              <div className="border-t border-blue-200 px-3 pb-3">
                                {/* Select all toggle */}
                                <div
                                  onClick={() =>
                                    toggleClassroomAllStudents(classroom.id)
                                  }
                                  className="flex items-center gap-2 py-2 cursor-pointer"
                                >
                                  <Checkbox
                                    checked={selected.assignToAll}
                                    className="data-[state=checked]:bg-blue-600 h-4 w-4"
                                  />
                                  <span className="text-xs font-medium text-blue-800">
                                    {t(
                                      "dialogs.assignmentDialog.selectStudents.assignAll",
                                    )}
                                  </span>
                                </div>

                                {/* Student grid */}
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                                  {[...selected.students]
                                    .sort(sortByStudentNumber)
                                    .map((student) => (
                                      <div
                                        key={student.id}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleClassroomStudent(
                                            classroom.id,
                                            student.id,
                                          );
                                        }}
                                        className={cn(
                                          "p-1.5 rounded border text-left cursor-pointer transition-all text-xs",
                                          selected.selectedStudentIds.includes(
                                            student.id,
                                          )
                                            ? "bg-blue-100 border-blue-300"
                                            : "bg-white border-gray-200 hover:border-gray-300",
                                        )}
                                      >
                                        <div className="flex items-center gap-1.5">
                                          <Checkbox
                                            checked={selected.selectedStudentIds.includes(
                                              student.id,
                                            )}
                                            className="data-[state=checked]:bg-blue-600 h-3.5 w-3.5 pointer-events-none"
                                          />
                                          <span className="truncate">
                                            {student.student_number
                                              ? `${student.student_number}.${student.name}`
                                              : student.name}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            )}
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </div>
            </div>
          )}

          {/* Step 1: Practice Mode Settings */}
          {currentStep === 1 &&
            (() => {
              const dataset =
                getCartContentTypeCategory() === "example_sentences"
                  ? "example_sentences"
                  : "vocabulary_set";
              const modeList = listModesForDataset(dataset);
              const currentConfig = formData.practice_mode
                ? getModeConfig(formData.practice_mode)
                : undefined;
              const currentCategory: ScoreCategory = getScoreCategory(
                formData.practice_mode,
                formData.play_audio,
              );
              const badgeStyles: Record<ScoreCategory, string> = {
                speaking: "bg-purple-100 text-purple-700",
                listening: "bg-amber-100 text-amber-700",
                reading: "bg-emerald-100 text-emerald-700",
                writing: "bg-sky-100 text-sky-700",
              };
              return (
                <div className="h-full flex flex-col">
                  {/* 上方 chip 列：橫向卷 + 箭頭永遠顯示 + 邊緣漸層 */}
                  <div className="relative mb-4">
                    <button
                      type="button"
                      onClick={() => scrollChips("left")}
                      className="absolute left-0 top-1/2 -translate-y-1/2 z-20 h-7 w-7 flex items-center justify-center rounded-full bg-white shadow border border-gray-200 hover:bg-gray-50"
                      aria-label="向左滑動"
                    >
                      <ChevronLeft className="h-4 w-4 text-gray-600" />
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollChips("right")}
                      className="absolute right-0 top-1/2 -translate-y-1/2 z-20 h-7 w-7 flex items-center justify-center rounded-full bg-white shadow border border-gray-200 hover:bg-gray-50"
                      aria-label="向右滑動"
                    >
                      <ChevronRight className="h-4 w-4 text-gray-600" />
                    </button>
                    {/* 邊緣漸層：暗示「還有更多」（overflow 才顯示） */}
                    {chipCanScrollLeft && (
                      <div className="pointer-events-none absolute left-7 top-0 bottom-0 z-10 w-6 bg-gradient-to-r from-white to-transparent" />
                    )}
                    {chipCanScrollRight && (
                      <div className="pointer-events-none absolute right-7 top-0 bottom-0 z-10 w-6 bg-gradient-to-l from-white to-transparent" />
                    )}
                    <div
                      ref={chipRowRef}
                      className="flex gap-2 overflow-x-auto px-9 [&::-webkit-scrollbar]:hidden"
                      style={{ scrollbarWidth: "none" }}
                    >
                      {modeList.map((m) => {
                        const cfg = getModeConfig(m);
                        if (!cfg) return null;
                        const ModeIcon = cfg.icon;
                        const selected = formData.practice_mode === m;
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() =>
                              setFormData((prev) => ({
                                ...prev,
                                ...(applyModeDefaults(m) as Partial<
                                  typeof prev
                                >),
                              }))
                            }
                            className={cn(
                              "shrink-0 flex items-center gap-2 px-3 py-2 rounded-full border text-sm transition-all",
                              selected
                                ? cn(
                                    cfg.chipSelectedClass,
                                    "shadow-sm font-semibold",
                                  )
                                : "border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50",
                            )}
                          >
                            <ModeIcon className="h-4 w-4 shrink-0" />
                            <span>{t(cfg.chipTitleKey ?? "")}</span>
                            {cfg.isMemoryBased && (
                              <Brain
                                className="h-3.5 w-3.5 shrink-0 opacity-70"
                                aria-label="採用艾賓浩斯記憶曲線"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex-1 min-h-0 w-full flex flex-col md:flex-row gap-4">
                    {/* 左：設定區（< 960px 全寬 / ≥ 960px 固定 320px） */}
                    <div className="w-full min-[960px]:w-80 min-[960px]:shrink-0 space-y-4 overflow-y-auto pr-1 h-full">
                      {currentConfig && (
                        <div className="p-4 rounded-xl bg-gray-50">
                          <div className="flex items-center gap-3">
                            {(() => {
                              const HeroIcon = currentConfig.icon;
                              return (
                                <HeroIcon
                                  className={cn(
                                    "h-8 w-8 shrink-0",
                                    currentConfig.iconColorClass,
                                  )}
                                />
                              );
                            })()}
                            <div className="text-base font-semibold text-gray-900">
                              {t(currentConfig.chipTitleKey ?? "")}
                            </div>
                            <span
                              className={cn(
                                "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold",
                                badgeStyles[currentCategory],
                              )}
                            >
                              {t(
                                `dialogs.assignmentDialog.practiceMode.scoreCategory.${currentCategory}`,
                              )}
                            </span>
                          </div>
                          <div className="text-sm text-gray-600 mt-2">
                            {t(currentConfig.chipDescKey ?? "")}
                          </div>
                        </div>
                      )}

                      {formData.practice_mode && (
                        <PracticeModeSettingsPanel
                          mode={formData.practice_mode}
                          value={formData}
                          onChange={(next) =>
                            setFormData((prev) => ({ ...prev, ...next }))
                          }
                          context={{
                            // Issue #631：購物車有缺題目圖片的項目時，禁止開啟「顯示選項圖片」
                            hasMissingImage: cartItems.some(
                              (i) => i.hasMissingImage,
                            ),
                          }}
                        />
                      )}
                    </div>

                    {/* 右：學生畫面預覽（viewport ≥ 960px 才顯示；min-w 320 確保可讀） */}
                    <div className="hidden min-[960px]:block flex-1 min-w-[320px] overflow-y-auto pr-1 h-full">
                      {formData.practice_mode && (
                        <div className="mb-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-1.5">
                          {t(
                            "dialogs.assignmentDialog.practiceMode.studentPreviewDisclaimer",
                          )}
                        </div>
                      )}
                      {formData.practice_mode === "word_reading" ? (
                        <Card className="p-3 border-gray-200">
                          <h4 className="text-xs font-semibold mb-2 text-gray-700">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.studentPreview",
                            )}
                          </h4>
                          <WordReadingPreview
                            contentId={
                              cartItems[0]?.contentId ??
                              PREVIEW_VOCAB_CONTENT_ID
                            }
                            settings={{
                              time_limit_per_question:
                                formData.time_limit_per_question,
                              show_image: formData.show_image,
                              show_translation: formData.show_translation,
                              shuffle_questions: formData.shuffle_questions,
                            }}
                          />
                        </Card>
                      ) : formData.practice_mode === "word_selection_quiz" ? (
                        <Card className="p-3 border-gray-200">
                          <h4 className="text-xs font-semibold mb-2 text-gray-700">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.studentPreview",
                            )}
                          </h4>
                          <WordSelectionQuizPreview
                            contentId={
                              cartItems[0]?.contentId ??
                              PREVIEW_VOCAB_CONTENT_ID
                            }
                            settings={{
                              show_word: formData.show_word,
                              show_image: formData.show_image,
                              show_option_images: formData.show_option_images,
                              play_audio: formData.play_audio,
                              show_answer: formData.show_answer,
                              time_limit_per_question:
                                formData.time_limit_per_question,
                              shuffle_questions: formData.shuffle_questions,
                            }}
                          />
                        </Card>
                      ) : formData.practice_mode === "word_selection" ? (
                        <Card className="p-3 border-gray-200">
                          <h4 className="text-xs font-semibold mb-2 text-gray-700">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.studentPreview",
                            )}
                          </h4>
                          <WordSelectionPreview
                            contentId={
                              cartItems[0]?.contentId ??
                              PREVIEW_VOCAB_CONTENT_ID
                            }
                            settings={{
                              show_image: formData.show_image,
                              show_option_images: formData.show_option_images,
                              play_audio: formData.play_audio,
                              target_proficiency: formData.target_proficiency,
                              time_limit_per_question:
                                formData.time_limit_per_question,
                              shuffle_questions: formData.shuffle_questions,
                            }}
                          />
                        </Card>
                      ) : formData.practice_mode === "word_spelling_quiz" ? (
                        <Card className="p-3 border-gray-200">
                          <h4 className="text-xs font-semibold mb-2 text-gray-700">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.studentPreview",
                            )}
                          </h4>
                          <WordSpellingQuizPreview
                            contentId={
                              cartItems[0]?.contentId ??
                              PREVIEW_VOCAB_CONTENT_ID
                            }
                            settings={{
                              show_translation: formData.show_translation,
                              show_image: formData.show_image,
                              play_audio: formData.play_audio,
                              show_answer: formData.show_answer,
                              time_limit_per_question:
                                formData.time_limit_per_question,
                              shuffle_questions: formData.shuffle_questions,
                            }}
                          />
                        </Card>
                      ) : formData.practice_mode === "word_spelling" ? (
                        <Card className="p-3 border-gray-200">
                          <h4 className="text-xs font-semibold mb-2 text-gray-700">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.studentPreview",
                            )}
                          </h4>
                          <WordSpellingPreview
                            contentId={
                              cartItems[0]?.contentId ??
                              PREVIEW_VOCAB_CONTENT_ID
                            }
                            settings={{
                              show_translation: formData.show_translation,
                              show_image: formData.show_image,
                              play_audio: formData.play_audio,
                              show_answer: formData.show_answer,
                              target_proficiency: formData.target_proficiency,
                              time_limit_per_question:
                                formData.time_limit_per_question,
                              shuffle_questions: formData.shuffle_questions,
                            }}
                          />
                        </Card>
                      ) : formData.practice_mode === "word_cloze_quiz" ? (
                        <Card className="p-3 border-gray-200">
                          <h4 className="text-xs font-semibold mb-2 text-gray-700">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.studentPreview",
                            )}
                          </h4>
                          <WordClozeQuizPreview
                            contentId={
                              cartItems[0]?.contentId ??
                              PREVIEW_VOCAB_CONTENT_ID
                            }
                            settings={{
                              show_translation: formData.show_translation,
                              play_audio: formData.play_audio,
                              show_answer: formData.show_answer,
                              time_limit_per_question:
                                formData.time_limit_per_question,
                              shuffle_questions: formData.shuffle_questions,
                            }}
                          />
                        </Card>
                      ) : formData.practice_mode === "word_cloze" ? (
                        <Card className="p-3 border-gray-200">
                          <h4 className="text-xs font-semibold mb-2 text-gray-700">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.studentPreview",
                            )}
                          </h4>
                          <WordClozeContextPreview
                            contentId={
                              cartItems[0]?.contentId ??
                              PREVIEW_VOCAB_CONTENT_ID
                            }
                            settings={{
                              show_translation: formData.show_translation,
                              play_audio: formData.play_audio,
                              show_answer: formData.show_answer,
                              target_proficiency: formData.target_proficiency,
                              time_limit_per_question:
                                formData.time_limit_per_question,
                              shuffle_questions: formData.shuffle_questions,
                            }}
                          />
                        </Card>
                      ) : formData.practice_mode === "rearrangement" ? (
                        <Card className="p-3 border-gray-200">
                          <h4 className="text-xs font-semibold mb-2 text-gray-700">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.studentPreview",
                            )}
                          </h4>
                          <RearrangementPreview
                            contentId={cartItems[0]?.contentId}
                            shuffleQuestions={formData.shuffle_questions}
                            timeLimitPerQuestion={
                              formData.time_limit_per_question
                            }
                            playAudio={formData.play_audio}
                          />
                        </Card>
                      ) : formData.practice_mode === "reading" ? (
                        <Card className="p-3 border-gray-200">
                          <h4 className="text-xs font-semibold mb-2 text-gray-700">
                            {t(
                              "dialogs.assignmentDialog.practiceMode.studentPreview",
                            )}
                          </h4>
                          <ReadingPreview
                            contentId={cartItems[0]?.contentId}
                            shuffleQuestions={formData.shuffle_questions}
                            timeLimitPerQuestion={
                              formData.time_limit_per_question
                            }
                          />
                        </Card>
                      ) : (
                        <div className="h-full flex items-center justify-center text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg">
                          {currentConfig
                            ? "此模式預覽尚未實作"
                            : "選擇一個模式查看預覽"}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

          {/* Step 3: Select Students */}
          {currentStep === 3 && (
            <div className="h-full flex flex-col">
              {needsClassroomStep ? (
                /* === 多班級模式：Tabs 切換班級 === */
                <>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm text-gray-600">
                      {t(
                        "dialogs.assignmentDialog.selectStudents.multiDescription",
                      )}
                    </p>
                    <Badge
                      variant="secondary"
                      className="bg-blue-50 text-blue-700"
                    >
                      {t("dialogs.assignmentDialog.selectStudents.willCreate", {
                        count: selectedClassrooms.filter(
                          (c) => c.selectedStudentIds.length > 0,
                        ).length,
                      })}
                    </Badge>
                  </div>

                  {/* Classroom Tabs */}
                  <Tabs
                    value={String(activeClassroomTab)}
                    onValueChange={(v) => setActiveClassroomTab(Number(v))}
                    className="flex-1 flex flex-col overflow-hidden"
                  >
                    <TabsList className="w-full justify-start overflow-x-auto">
                      {selectedClassrooms.map((classroom, idx) => (
                        <TabsTrigger
                          key={classroom.id}
                          value={String(idx)}
                          className="text-xs"
                        >
                          {classroom.name}
                          <Badge
                            variant="secondary"
                            className="ml-1 text-[10px] px-1"
                          >
                            {classroom.selectedStudentIds.length}/
                            {classroom.students.length}
                          </Badge>
                        </TabsTrigger>
                      ))}
                    </TabsList>

                    {selectedClassrooms.map((classroom, idx) => (
                      <TabsContent
                        key={classroom.id}
                        value={String(idx)}
                        className="flex-1 flex flex-col overflow-hidden mt-2"
                      >
                        {/* Quick Select All for this classroom */}
                        <Card className="p-2 mb-2 bg-blue-50 border-blue-200">
                          <div
                            onClick={() =>
                              toggleClassroomAllStudents(classroom.id)
                            }
                            className="flex items-center gap-3 w-full cursor-pointer"
                          >
                            <Checkbox
                              checked={classroom.assignToAll}
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
                                  {
                                    count: classroom.students.length,
                                  },
                                )}
                              </p>
                            </div>
                            {classroom.assignToAll && (
                              <Badge className="bg-blue-600 text-white">
                                {t(
                                  "dialogs.assignmentDialog.selectStudents.allSelected",
                                )}
                              </Badge>
                            )}
                          </div>
                        </Card>

                        {/* Student Grid */}
                        <div className="flex-1 border rounded-lg bg-gray-50 p-2 overflow-hidden">
                          <ScrollArea className="h-full">
                            <div className="grid grid-cols-3 gap-1.5 p-1">
                              {[...classroom.students]
                                .sort(sortByStudentNumber)
                                .map((student) => (
                                  <div
                                    key={student.id}
                                    onClick={() =>
                                      toggleClassroomStudent(
                                        classroom.id,
                                        student.id,
                                      )
                                    }
                                    className={cn(
                                      "p-2 rounded-md border transition-all text-left relative cursor-pointer",
                                      classroom.selectedStudentIds.includes(
                                        student.id,
                                      )
                                        ? "bg-blue-50 border-blue-300 shadow-sm"
                                        : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm",
                                    )}
                                  >
                                    <div className="flex items-start gap-2">
                                      <Checkbox
                                        checked={classroom.selectedStudentIds.includes(
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
                                    {classroom.selectedStudentIds.includes(
                                      student.id,
                                    ) && (
                                      <div className="absolute top-1 right-1">
                                        <CheckCircle2 className="h-3 w-3 text-blue-600" />
                                      </div>
                                    )}
                                  </div>
                                ))}
                            </div>
                          </ScrollArea>
                        </div>
                      </TabsContent>
                    ))}
                  </Tabs>
                </>
              ) : loadingStudents ? (
                /* === 單班級模式：載入中 === */
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                  <span className="ml-2 text-sm text-gray-500">
                    載入學生列表...
                  </span>
                </div>
              ) : (
                /* === 單班級模式：原有邏輯 === */
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

                  {/* Student Grid */}
                  <div className="flex-1 border rounded-lg bg-gray-50 p-2 overflow-hidden">
                    <ScrollArea className="h-full">
                      <div className="grid grid-cols-3 gap-1.5 p-1">
                        {[...effectiveStudents]
                          .sort(sortByStudentNumber)
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
                currentStep === firstStepNumber ? handleClose : handlePrevStep
              }
              disabled={loading}
            >
              {currentStep === firstStepNumber ? (
                <>{t("dialogs.assignmentDialog.buttons.cancel")}</>
              ) : (
                <>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  {t("dialogs.assignmentDialog.buttons.previous")}
                </>
              )}
            </Button>

            {/* 右側：提示 + 下一步/建立按鈕 */}
            <div className="flex items-center gap-2">
              {needsClassroomStep &&
                selectedClassrooms.length > 1 &&
                currentStep === lastStepNumber && (
                  <span className="text-xs text-gray-500">
                    {t("dialogs.assignmentDialog.multiClass.willCreate", {
                      count: selectedClassrooms.length,
                    })}
                  </span>
                )}
              {currentStep < lastStepNumber ? (
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
