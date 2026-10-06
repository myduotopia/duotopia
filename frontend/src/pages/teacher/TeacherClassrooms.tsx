import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Users,
  BookOpen,
  Plus,
  Edit,
  RefreshCw,
  GraduationCap,
  Trash2,
  AlertTriangle,
  ArrowUpDown,
  ClipboardList,
  Search,
  Signal,
  Power,
  PowerOff,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api";
import { AssignmentDialog } from "@/components/AssignmentDialog";
import { toast } from "sonner";
import { CloudDownload } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  GRADE_FILTER_ALL,
  formatGradeLabel,
  isValidGrade,
  matchesGradeFilter,
  type GradeUpdateItem,
} from "@/components/classroom/classroomGrade";
import {
  CEFR_LEVELS,
  getLevelSortValue,
  normalizeLevel,
} from "@/components/classroom/classroomLevel";
import { GradeSelect } from "@/components/classroom/GradeSelect";
import { LevelSelect } from "@/components/classroom/LevelSelect";
import { GradeFilterSelect } from "@/components/classroom/GradeFilterSelect";
import { MissingGradeBanner } from "@/components/classroom/MissingGradeBanner";
import { MissingGradeDialog } from "@/components/classroom/MissingGradeDialog";
import { AdjustGradeDialog } from "@/components/classroom/AdjustGradeDialog";
import {
  AdjustLevelDialog,
  type LevelUpdateItem,
} from "@/components/classroom/AdjustLevelDialog";
import { GradeBulkBar } from "@/components/classroom/GradeBulkBar";
import { LevelBadge } from "@/components/classroom/LevelBadge";
import {
  ClassroomDraftForm,
  ClassroomStatusBadge,
  ClassroomTableRow,
  isClassroomInactive,
} from "@/components/classroom/ClassroomTableRow";
import {
  useClassroomInlineEdit,
  useClassroomStatusActions,
  type ClassroomPatches,
} from "@/components/classroom/useClassroomListActions";
import { ConfirmDialog } from "@/components/organization/ConfirmDialog";
import { SortableTableHead } from "@/components/classroom/SortableTableHead";

interface ClassroomDetail {
  id: number;
  name: string;
  description?: string;
  level?: string;
  grade?: number | null; // 年級 1–12；null = 尚未設定（#1097）
  is_active?: boolean; // false = 停用（列表帶 include_inactive 才會出現）（#1097）
  student_count: number;
  students: Array<{
    id: number;
    name: string;
    email: string;
  }>;
  program_count?: number;
  created_at?: string;
  school_id?: string;
  school_name?: string;
  organization_id?: string;
  // 1Campus sync metadata (#635); only populated for synced classrooms.
  one_campus_class_id?: string | null;
  last_synced_at?: string | null;
}

type SortField = "grade" | "name" | "level" | "student_count" | "created_at";
type SortDirection = "asc" | "desc";
type StatusFilter = "all" | "active" | "inactive";

const SELECT_CLASS =
  "px-3 py-2 border dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md text-sm";

export default function TeacherClassrooms() {
  const { t } = useTranslation();
  const { selectedSchool, selectedOrganization, mode, organizations } =
    useWorkspace();
  const [classrooms, setClassrooms] = useState<ClassroomDetail[]>([]);
  const [loading, setLoading] = useState(true);
  // 停用／啟用批次確認（#1097）
  const [bulkStatusTarget, setBulkStatusTarget] = useState(false);
  const [showBulkStatus, setShowBulkStatus] = useState(false);
  // 開啟確認時凍結「會變更的班級數」，關閉動畫期間不重算
  const [bulkStatusCount, setBulkStatusCount] = useState(0);
  const [showAdjustLevel, setShowAdjustLevel] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createFormData, setCreateFormData] = useState<{
    name: string;
    description: string;
    level: string;
    grade: number | null;
  }>({
    name: "",
    description: "",
    level: "A1",
    grade: null,
  });

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [gradeFilter, setGradeFilter] = useState<string>(GRADE_FILTER_ALL);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // 年級批次調整／補填（#1097）— 只有個人班級可勾選
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showAdjustGrade, setShowAdjustGrade] = useState(false);
  const [showMissingGrade, setShowMissingGrade] = useState(false);
  // 與編輯／刪除按鈕停用條件相同：機構模式或選了學校時本頁唯讀
  const canEditClassrooms = !(
    mode === "organization" || selectedSchool !== null
  );

  // Sorting
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Expandable rows
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // Assignment dialog
  const [assignmentClassroom, setAssignmentClassroom] =
    useState<ClassroomDetail | null>(null);

  // 1Campus class sync (#635)
  const [syncingOneCampus, setSyncingOneCampus] = useState(false);
  // Foolproof confirmation before syncing into a personal account when the
  // teacher also belongs to an organization (#761). Personal-account syncs
  // deduct AI points from the teacher's personal balance, which is usually
  // not what an org teacher intends for org-owned students.
  const [showSyncConfirm, setShowSyncConfirm] = useState(false);
  const hasOrganization = organizations.length > 0;

  // Gate the Sync button: org teachers see a warning dialog first; personal-
  // only teachers sync immediately (unchanged behavior).
  const handleSyncOneCampusClick = () => {
    if (syncingOneCampus) return;
    if (hasOrganization) {
      setShowSyncConfirm(true);
    } else {
      handleSyncOneCampusClasses();
    }
  };

  const handleConfirmSyncOneCampus = () => {
    setShowSyncConfirm(false);
    handleSyncOneCampusClasses();
  };

  const handleSyncOneCampusClasses = async () => {
    if (syncingOneCampus) return;
    setSyncingOneCampus(true);
    try {
      const res = await apiClient.syncOneCampusClasses();
      if (res.synced && res.schools.length > 0) {
        // Count *all* changes — additions and updates — when deciding whether
        // to show the "no changes" message. A rename of an existing student
        // bumps students_updated but not students_added; we still want the
        // teacher to know something refreshed.
        const changed =
          res.classrooms_added +
          res.classrooms_updated +
          res.students_added +
          res.students_updated;
        const summary = t("teacherClassrooms.oneCampusSync.success", {
          defaultValue: `Synced ${res.schools.length} school(s): ${res.classrooms_added} classroom(s), ${res.students_added} student(s) added.`,
          schools: res.schools.length,
          classrooms_added: res.classrooms_added,
          students_added: res.students_added,
        });
        if (res.errors && res.errors.length > 0) {
          toast.warning(
            `${summary} (${res.errors.length} ${t(
              "teacherClassrooms.oneCampusSync.errorsSuffix",
              { defaultValue: "error(s) — see logs" },
            )})`,
          );
        } else if (changed === 0) {
          toast.info(
            t("teacherClassrooms.oneCampusSync.noChanges", {
              defaultValue:
                "Already up to date — no new classrooms or students.",
            }),
          );
        } else {
          toast.success(summary);
        }
        await fetchClassrooms();
      } else {
        toast.info(
          res.message ||
            t("teacherClassrooms.oneCampusSync.noSchools", {
              defaultValue: "No 1Campus schools found for your account.",
            }),
        );
      }
    } catch (err: unknown) {
      const status = err instanceof ApiError ? err.status : undefined;
      if (status === 403) {
        toast.error(
          t("teacherClassrooms.oneCampusSync.notLinked", {
            defaultValue:
              "Your account is not linked to 1Campus. Log in via 1Campus first.",
          }),
        );
      } else if (status === 429) {
        toast.error(
          t("teacherClassrooms.oneCampusSync.rateLimited", {
            defaultValue:
              "Sync was triggered recently — please wait a minute and try again.",
          }),
        );
      } else {
        toast.error(
          t("teacherClassrooms.oneCampusSync.failed", {
            defaultValue: "Failed to start 1Campus sync. Please try again.",
          }),
        );
      }
    } finally {
      setSyncingOneCampus(false);
    }
  };

  // silent：背景重新載入（批次設定年級後），不切換整頁 loading，
  // 讓提醒、篩選列、操作列與表格保持掛載只更新內容（#1097）。
  // 回傳是否載入成功，讓背景重新載入的呼叫端能提示失敗。
  // 只採用最後一次請求的回應：較早送出、較晚回來的（例如背景重新載入）一律丟棄
  const fetchSeqRef = useRef(0);
  const fetchClassrooms = useCallback(
    async (options?: { silent?: boolean }): Promise<boolean> => {
      const silent = options?.silent ?? false;
      const seq = ++fetchSeqRef.current;
      try {
        if (!silent) setLoading(true);

        // Build API params based on workspace context
        const apiParams: {
          mode?: string;
          school_id?: string;
          organization_id?: string;
          include_inactive?: boolean;
        } = { include_inactive: true };

        if (mode === "personal") {
          apiParams.mode = "personal";
        } else if (selectedSchool) {
          apiParams.mode = "school";
          apiParams.school_id = selectedSchool.id;
        } else if (selectedOrganization) {
          apiParams.mode = "organization";
          apiParams.organization_id = selectedOrganization.id;
        }

        const data = (await apiClient.getTeacherClassrooms(
          apiParams,
        )) as ClassroomDetail[];
        if (seq === fetchSeqRef.current) setClassrooms(data);
        return true;
      } catch (err) {
        console.error("Fetch classrooms error:", err);
        // 已被較新的請求取代時不算失敗
        return seq !== fetchSeqRef.current;
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [mode, selectedSchool, selectedOrganization],
  );

  // 背景重新載入一律用目前工作區的 fetchClassrooms（避免舊 closure 帶到舊參數）
  const fetchClassroomsRef = useRef(fetchClassrooms);
  useEffect(() => {
    fetchClassroomsRef.current = fetchClassrooms;
    fetchClassrooms();
  }, [fetchClassrooms]);

  // 使用者改變列出範圍（篩選、搜尋、工作區）時清空勾選（#1097）
  useEffect(() => {
    setSelectedIds(new Set());
  }, [
    searchQuery,
    levelFilter,
    gradeFilter,
    statusFilter,
    mode,
    selectedSchool,
    selectedOrganization,
  ]);

  // 儲存成功後背景重新載入；失敗只提示重新整理（已儲存的結果仍有效）
  const reloadInBackground = () => {
    void fetchClassroomsRef.current({ silent: true }).then((reloaded) => {
      if (!reloaded) toast.error(t("classroomGrade.messages.reloadFailed"));
    });
  };

  // 行內編輯、停用／啟用與批次更新（#1097）：成功後就地更新再背景重新載入
  // 改到編輯中的班級時結束編輯，舊草稿不會再蓋回去
  const handlePatched = (patches: ClassroomPatches) => {
    setClassrooms((prev) =>
      prev.map((c) => (patches.has(c.id) ? { ...c, ...patches.get(c.id) } : c)),
    );
    if (inlineEdit.editingId !== null && patches.has(inlineEdit.editingId)) {
      inlineEdit.exitEdit();
    }
    reloadInBackground();
  };
  const inlineEdit = useClassroomInlineEdit({
    classrooms,
    onPatched: handlePatched,
    // 工作區由外部切換、無法攔下確認，切換後直接結束行內編輯
    resetKey: `${mode}|${selectedSchool?.id ?? ""}|${selectedOrganization?.id ?? ""}`,
  });
  const { guardEdit } = inlineEdit;
  const statusActions = useClassroomStatusActions({ onPatched: handlePatched });

  // 只計狀態會改變的班級（已停用的不算進「停用 N 個」）
  const openBulkStatus = (active: boolean) => {
    setBulkStatusTarget(active);
    setBulkStatusCount(
      selectedClassrooms.filter((c) => isClassroomInactive(c) === active)
        .length,
    );
    setShowBulkStatus(true);
  };

  const handleBulkStatus = async (active: boolean) => {
    if (await statusActions.bulkSetActive(selectedClassrooms, active)) {
      setSelectedIds(new Set());
    }
  };

  // 批次調整等級成功：先關對話框再清勾選（同 handleAdjustGrades）
  const handleAdjustLevels = async (
    items: LevelUpdateItem<number>[],
  ): Promise<boolean> => {
    const ok = await statusActions.runBatchUpdate(
      items.map(({ id, level }) => ({ classroom_id: id, level })),
      "classroomGrade.level.saveSuccess",
      "classroomGrade.level.saveFailed",
    );
    if (ok) {
      setShowAdjustLevel(false);
      setSelectedIds(new Set());
    }
    return ok;
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;

    try {
      // API call to delete classroom
      await apiClient.deleteClassroom(deleteConfirmId);

      // Refresh classrooms list
      await fetchClassrooms();
      setDeleteConfirmId(null);
    } catch (err) {
      console.error("Failed to delete classroom:", err);
      alert(t("teacherClassrooms.messages.deleteFailed"));
    }
  };

  const handleCreate = async () => {
    // Check if name is provided
    if (!createFormData.name.trim()) {
      alert(t("teacherClassrooms.messages.nameRequired"));
      return;
    }
    const { grade } = createFormData;
    if (grade === null) {
      alert(t("classroomGrade.required"));
      return;
    }

    try {
      await apiClient.createClassroom({ ...createFormData, grade });

      // Refresh the list after creation
      await fetchClassrooms();
      setShowCreateDialog(false);
      setCreateFormData({
        name: "",
        description: "",
        level: "A1",
        grade: null,
      });
    } catch (error) {
      console.error("Error creating classroom:", error);
      // Show error to user
      const errorMessage =
        error instanceof Error
          ? error.message
          : t("teacherClassrooms.messages.createFailed");
      alert(`${t("teacherClassrooms.messages.error")}: ${errorMessage}`);
    }
  };

  // 補填年級與批次升降共用同一個批次端點（#1097）；回傳 true 讓對話框關閉。
  // 不動勾選：補填不應清掉使用者的勾選，只有批次調整成功才清（見 handleAdjustGrades）。
  const handleBatchSetGrades = async (
    items: GradeUpdateItem<number>[],
  ): Promise<boolean> => {
    try {
      const res = await apiClient.batchSetClassroomGrades(
        items.map(({ id, grade }) => ({ classroom_id: id, grade })),
      );
      toast.success(
        t("classroomGrade.messages.saveSuccess", { count: res.count }),
      );
      reloadInBackground();
      return true;
    } catch (err) {
      console.error("Failed to set classroom grades:", err);
      toast.error(t("classroomGrade.messages.saveFailed"));
      return false;
    }
  };

  // 批次調整成功：先關對話框再清勾選（對話框關閉期間沿用原清單，不會閃出空狀態）
  const handleAdjustGrades = async (
    items: GradeUpdateItem<number>[],
  ): Promise<boolean> => {
    const ok = await handleBatchSetGrades(items);
    if (ok) {
      setShowAdjustGrade(false);
      setSelectedIds(new Set());
    }
    return ok;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    return date.toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  // Sort toggle handler
  const handleSort = guardEdit((field: SortField) => {
    if (sortField === field) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else {
        setSortField(null);
        setSortDirection("asc");
      }
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  });

  // Expandable row toggle
  const toggleRowExpanded = (classroomId: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(classroomId)) {
        next.delete(classroomId);
      } else {
        next.add(classroomId);
      }
      return next;
    });
  };

  const SortableHeader = (props: {
    field: SortField;
    children: React.ReactNode;
    className?: string;
  }) => (
    <SortableTableHead
      {...props}
      activeField={sortField}
      direction={sortDirection}
      onSort={handleSort}
    />
  );

  // Filter and sort classrooms
  const processedClassrooms = useMemo(() => {
    // Workspace filter
    let result = classrooms.filter((classroom) => {
      if (mode === "personal") {
        return !classroom.school_id && !classroom.organization_id;
      }
      if (selectedSchool) {
        return classroom.school_id === selectedSchool.id;
      }
      if (selectedOrganization) {
        return classroom.organization_id === selectedOrganization.id;
      }
      return true;
    });

    // Text search by name
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      result = result.filter((c) => c.name.toLowerCase().includes(query));
    }

    // Level filter
    if (levelFilter !== "all") {
      result = result.filter(
        (c) => (normalizeLevel(c.level) ?? "A1") === levelFilter,
      );
    }

    // Grade filter (#1097)
    result = result.filter((c) => matchesGradeFilter(c.grade, gradeFilter));

    // Status filter (#1097)
    if (statusFilter !== "all") {
      const wantInactive = statusFilter === "inactive";
      result = result.filter((c) => isClassroomInactive(c) === wantInactive);
    }

    // Sorting
    if (sortField) {
      // 年級未設定一律排最後（不受升降冪影響）
      const unsetGradeLast = (a: ClassroomDetail, b: ClassroomDetail) =>
        Number(!isValidGrade(a.grade)) - Number(!isValidGrade(b.grade));
      result = [...result].sort((a, b) => {
        let comparison = 0;
        switch (sortField) {
          case "grade": {
            const unset = unsetGradeLast(a, b);
            if (unset !== 0) return unset;
            comparison = (a.grade ?? 0) - (b.grade ?? 0);
            break;
          }
          case "level":
            comparison =
              getLevelSortValue(a.level || "A1") -
              getLevelSortValue(b.level || "A1");
            break;
          case "name":
            comparison = a.name.localeCompare(b.name, "zh-TW");
            break;
          case "student_count":
            comparison = a.student_count - b.student_count;
            break;
          case "created_at":
            comparison =
              new Date(a.created_at || "").getTime() -
              new Date(b.created_at || "").getTime();
            break;
        }
        return sortDirection === "asc" ? comparison : -comparison;
      });
    } else {
      // Default: sort by ID ascending
      result = [...result].sort((a, b) => a.id - b.id);
    }

    return result;
  }, [
    classrooms,
    mode,
    selectedSchool,
    selectedOrganization,
    searchQuery,
    levelFilter,
    gradeFilter,
    statusFilter,
    sortField,
    sortDirection,
  ]);

  // 年級勾選／補填只作用在個人班級（學校班級須在學校後台編輯）
  const isSelectable = (c: ClassroomDetail) =>
    canEditClassrooms && !c.school_id && !c.organization_id;
  // 編輯中：該列不可勾選、不列入全選；操作列與補填入口隱藏（#1097）
  const isEditingAny = inlineEdit.editingId !== null;
  const canSelect = (c: ClassroomDetail) =>
    isSelectable(c) && c.id !== inlineEdit.editingId;
  const selectableVisible = processedClassrooms.filter(canSelect);
  // 只計目前清單上看得到的勾選，篩選掉的班級不會被批次調整
  const selectedClassrooms = selectableVisible.filter((c) =>
    selectedIds.has(c.id),
  );
  const allVisibleSelected =
    selectableVisible.length > 0 &&
    selectedClassrooms.length === selectableVisible.length;
  // 編輯中的班級不在目前清單上（被刪除或重新載入後被篩掉）→ 直接結束編輯
  const { editingId: currentEditingId, exitEdit } = inlineEdit;
  useEffect(() => {
    if (
      currentEditingId !== null &&
      !processedClassrooms.some((c) => c.id === currentEditingId)
    ) {
      exitEdit();
    }
  }, [currentEditingId, processedClassrooms, exitEdit]);
  const missingGradeClassrooms = classrooms.filter(
    (c) => isSelectable(c) && !isValidGrade(c.grade),
  );

  const toggleSelected = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      selectableVisible.forEach((c) =>
        checked ? next.add(c.id) : next.delete(c.id),
      );
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 dark:border-blue-400 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">
            {t("common.loading")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 sm:mb-6 space-y-4 sm:space-y-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
          {t("teacherClassrooms.title")}
        </h2>
        <div className="flex items-center space-x-2 sm:space-x-4 w-full sm:w-auto">
          <Button
            onClick={() => fetchClassrooms()}
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none"
          >
            <RefreshCw className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">
              {t("teacherClassrooms.buttons.reload")}
            </span>
          </Button>
          <Button
            onClick={handleSyncOneCampusClick}
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none"
            disabled={syncingOneCampus}
            title={t("teacherClassrooms.oneCampusSync.tooltip", {
              defaultValue: "Pull latest classes + students from 1Campus",
            })}
          >
            <CloudDownload className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">
              {syncingOneCampus
                ? t("teacherClassrooms.oneCampusSync.buttonSyncing", {
                    defaultValue: "Syncing...",
                  })
                : t("teacherClassrooms.oneCampusSync.buttonIdle", {
                    defaultValue: "Sync 1Campus",
                  })}
            </span>
          </Button>
          <Button
            size="sm"
            onClick={() => setShowCreateDialog(true)}
            className="flex-1 sm:flex-none"
            disabled={mode === "organization" || selectedSchool !== null}
          >
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">
              {t("teacherClassrooms.buttons.addClassroom")}
            </span>
            <span className="sm:hidden">
              {t("teacherClassrooms.buttons.add")}
            </span>
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="bg-white dark:bg-gray-800 p-3 sm:p-4 rounded-lg shadow-sm border dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                {t("teacherClassrooms.stats.totalClassrooms")}
              </p>
              <p className="text-xl sm:text-2xl font-bold dark:text-gray-100">
                {processedClassrooms.length}
              </p>
            </div>
            <GraduationCap className="h-6 w-6 sm:h-8 sm:w-8 text-blue-500 dark:text-blue-400" />
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-3 sm:p-4 rounded-lg shadow-sm border dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                {t("teacherClassrooms.stats.totalStudents")}
              </p>
              <p className="text-xl sm:text-2xl font-bold dark:text-gray-100">
                {processedClassrooms.reduce(
                  (sum, c) => sum + c.student_count,
                  0,
                )}
              </p>
            </div>
            <Users className="h-6 w-6 sm:h-8 sm:w-8 text-green-500 dark:text-green-400" />
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-3 sm:p-4 rounded-lg shadow-sm border dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                {t("teacherClassrooms.stats.activeClassrooms")}
              </p>
              <p className="text-xl sm:text-2xl font-bold dark:text-gray-100">
                {
                  processedClassrooms.filter((c) => !isClassroomInactive(c))
                    .length
                }
              </p>
            </div>
            <BookOpen className="h-6 w-6 sm:h-8 sm:w-8 text-purple-500 dark:text-purple-400" />
          </div>
        </div>
      </div>

      {/* 尚未設定年級提醒（#1097） */}
      <MissingGradeBanner
        count={missingGradeClassrooms.length}
        onAction={() => setShowMissingGrade(true)}
        hideAction={isEditingAny}
      />

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <select
          value={levelFilter}
          onChange={guardEdit((e) => setLevelFilter(e.target.value))}
          className={SELECT_CLASS}
        >
          <option value="all">
            {t("teacherClassrooms.filters.allLevels")}
          </option>
          {CEFR_LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        <GradeFilterSelect
          value={gradeFilter}
          onChange={guardEdit(setGradeFilter)}
        />
        <select
          aria-label={t("classroomGrade.status.filterLabel")}
          value={statusFilter}
          onChange={guardEdit((e) =>
            setStatusFilter(e.target.value as StatusFilter),
          )}
          className={SELECT_CLASS}
        >
          <option value="all">{t("classroomGrade.status.filterAll")}</option>
          <option value="active">{t("classroomGrade.status.active")}</option>
          <option value="inactive">
            {t("classroomGrade.status.inactive")}
          </option>
        </select>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder={t("teacherClassrooms.placeholders.searchName")}
            value={searchQuery}
            onChange={guardEdit((e) => setSearchQuery(e.target.value))}
            className="w-full pl-9 pr-3 py-2 border dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md text-sm"
          />
        </div>
      </div>

      {/* Bulk Actions Bar — 年級／等級／停用／啟用（#1097），底部置中浮動膠囊 */}
      <GradeBulkBar
        selectedCount={isEditingAny ? 0 : selectedClassrooms.length}
        busy={statusActions.bulkBusy}
        actions={[
          {
            key: "adjust-grade",
            label: t("classroomGrade.adjust.button"),
            icon: <GraduationCap className="h-4 w-4" aria-hidden="true" />,
            onClick: () => setShowAdjustGrade(true),
          },
          {
            key: "adjust-level",
            label: t("classroomGrade.level.button"),
            icon: <Signal className="h-4 w-4" aria-hidden="true" />,
            onClick: () => setShowAdjustLevel(true),
          },
          {
            key: "deactivate",
            label: t("classroomGrade.bulk.deactivate"),
            icon: <PowerOff className="h-4 w-4" aria-hidden="true" />,
            variant: "ghost",
            disabled: selectedClassrooms.every(isClassroomInactive),
            onClick: () => openBulkStatus(false),
          },
          {
            key: "activate",
            label: t("classroomGrade.bulk.activate"),
            icon: <Power className="h-4 w-4" aria-hidden="true" />,
            variant: "ghost",
            disabled: !selectedClassrooms.some(isClassroomInactive),
            onClick: () => openBulkStatus(true),
          },
        ]}
        onClear={() => setSelectedIds(new Set())}
      />

      {/* Classrooms Table — 浮動操作列出現時預留底部空間，最後一列不被擋住 */}
      <div
        className={
          !isEditingAny && selectedClassrooms.length > 0 ? "pb-24" : undefined
        }
      >
        {/* Mobile Sort + Card View */}
        <div className="md:hidden">
          {/* Mobile sort control */}
          <div className="flex items-center gap-2 mb-3">
            <ArrowUpDown className="h-4 w-4 text-gray-500" />
            <select
              value={sortField ? `${sortField}_${sortDirection}` : "default"}
              onChange={guardEdit((e) => {
                if (e.target.value === "default") {
                  setSortField(null);
                  setSortDirection("asc");
                } else {
                  const parts = e.target.value.split("_");
                  const dir = parts.pop() as SortDirection;
                  const field = parts.join("_") as SortField;
                  setSortField(field);
                  setSortDirection(dir);
                }
              })}
              className="px-2 py-1 border dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md text-sm"
            >
              {(
                [
                  ["default", "teacherClassrooms.sort.default"],
                  ["grade_asc", "classroomGrade.sort.gradeAsc"],
                  ["grade_desc", "classroomGrade.sort.gradeDesc"],
                  ["name_asc", "teacherClassrooms.sort.nameAsc"],
                  ["name_desc", "teacherClassrooms.sort.nameDesc"],
                  ["level_asc", "classroomGrade.sort.levelAsc"],
                  ["level_desc", "classroomGrade.sort.levelDesc"],
                  ["student_count_asc", "classroomGrade.sort.studentCountAsc"],
                  [
                    "student_count_desc",
                    "teacherClassrooms.sort.studentCountDesc",
                  ],
                  ["created_at_desc", "teacherClassrooms.sort.createdAtDesc"],
                  ["created_at_asc", "teacherClassrooms.sort.createdAtAsc"],
                ] as const
              ).map(([value, key]) => (
                <option key={value} value={value}>
                  {t(key)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-4">
            {processedClassrooms.map((classroom) => (
              <div
                key={classroom.id}
                className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-4 space-y-3"
              >
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    {isSelectable(classroom) && (
                      <Checkbox
                        disabled={inlineEdit.editingId === classroom.id}
                        checked={selectedIds.has(classroom.id)}
                        onCheckedChange={(checked) =>
                          toggleSelected(classroom.id, checked === true)
                        }
                        aria-label={t("classroomGrade.selection.selectRow", {
                          name: classroom.name,
                        })}
                      />
                    )}
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center flex-shrink-0">
                      <GraduationCap className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    {inlineEdit.editingId === classroom.id &&
                    inlineEdit.draft ? (
                      <div className="flex-1">
                        <ClassroomDraftForm
                          draft={inlineEdit.draft}
                          onDraftChange={inlineEdit.setDraft}
                          onSave={inlineEdit.saveEdit}
                          onCancel={inlineEdit.exitEdit}
                          saving={inlineEdit.saving}
                        />
                      </div>
                    ) : (
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <LevelBadge level={classroom.level} />
                          <ClassroomStatusBadge
                            active={!isClassroomInactive(classroom)}
                          />
                        </div>
                        <Link
                          to={`/teacher/classroom/${classroom.id}`}
                          className="font-medium text-lg text-blue-600 dark:text-blue-400 hover:underline block mt-1"
                        >
                          {classroom.name}
                        </Link>
                        {classroom.description && (
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {classroom.description}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Info */}
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                    <span className="text-gray-600 dark:text-gray-400">
                      {t("teacherClassrooms.labels.students")}:
                    </span>
                    <span className="font-medium dark:text-gray-200">
                      {classroom.student_count}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                    <span className="text-gray-600 dark:text-gray-400">
                      {t("teacherClassrooms.labels.programs")}:
                    </span>
                    <span className="font-medium dark:text-gray-200">
                      {classroom.program_count || 0}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <GraduationCap className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                    <span className="text-gray-600 dark:text-gray-400">
                      {t("teacherClassrooms.labels.grade")}:
                    </span>
                    <span className="font-medium dark:text-gray-200">
                      {formatGradeLabel(t, classroom.grade)}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-600 dark:text-gray-400">
                      {t("teacherClassrooms.labels.createdAt")}:{" "}
                    </span>
                    <span className="dark:text-gray-200">
                      {formatDate(classroom.created_at)}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2 border-t dark:border-gray-700">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAssignmentClassroom(classroom)}
                    className="flex-1"
                    disabled={
                      classroom.student_count === 0 ||
                      isClassroomInactive(classroom)
                    }
                    title={
                      isClassroomInactive(classroom)
                        ? t("classroomGrade.status.dispatchDisabled")
                        : undefined
                    }
                  >
                    <ClipboardList className="h-4 w-4 mr-2" />
                    {t("teacherClassrooms.buttons.dispatchAssignment")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => inlineEdit.startEdit(classroom)}
                    className="flex-1"
                    disabled={
                      !canEditClassrooms ||
                      inlineEdit.editingId === classroom.id
                    }
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    {t("common.edit")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeleteConfirmId(classroom.id)}
                    className="flex-1 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400"
                    disabled={
                      !canEditClassrooms ||
                      inlineEdit.editingId === classroom.id
                    }
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t("common.delete")}
                  </Button>
                </div>
              </div>
            ))}
            <div className="text-center py-4 text-sm text-gray-500 dark:text-gray-400">
              {t("teacherClassrooms.messages.totalCount", {
                count: processedClassrooms.length,
              })}
            </div>
          </div>
        </div>

        {/* Desktop Table View */}
        <div className="hidden md:block bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableCaption className="dark:text-gray-400">
                {t("teacherClassrooms.messages.totalCount", {
                  count: processedClassrooms.length,
                })}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  {canEditClassrooms && (
                    <TableHead className="w-[40px]">
                      <Checkbox
                        checked={
                          allVisibleSelected
                            ? true
                            : selectedClassrooms.length > 0
                              ? "indeterminate"
                              : false
                        }
                        disabled={selectableVisible.length === 0}
                        onCheckedChange={(checked) =>
                          toggleSelectAllVisible(checked === true)
                        }
                        aria-label={t("classroomGrade.selection.selectAll")}
                      />
                    </TableHead>
                  )}
                  <SortableHeader
                    field="grade"
                    className="text-left text-xs sm:text-sm min-w-[90px]"
                  >
                    {t("teacherClassrooms.labels.grade")}
                  </SortableHeader>
                  <SortableHeader
                    field="name"
                    className="text-left text-xs sm:text-sm min-w-[200px]"
                  >
                    {t("teacherClassrooms.labels.classroomName")}
                  </SortableHeader>
                  <SortableHeader
                    field="level"
                    className="text-left text-xs sm:text-sm min-w-[80px]"
                  >
                    {t("teacherClassrooms.labels.level")}
                  </SortableHeader>
                  <SortableHeader
                    field="student_count"
                    className="text-left text-xs sm:text-sm min-w-[70px]"
                  >
                    {t("teacherClassrooms.labels.studentCount")}
                  </SortableHeader>
                  <SortableHeader
                    field="created_at"
                    className="text-left text-xs sm:text-sm min-w-[100px]"
                  >
                    {t("teacherClassrooms.labels.createdAt")}
                  </SortableHeader>
                  <TableHead className="text-left text-xs sm:text-sm min-w-[110px]">
                    {t("classroomGrade.status.column")}
                  </TableHead>
                  <TableHead className="text-left text-xs sm:text-sm min-w-[120px]">
                    {t("teacherClassrooms.labels.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {processedClassrooms.map((classroom) => {
                  const isExpanded = expandedRows.has(classroom.id);
                  const isEditing = inlineEdit.editingId === classroom.id;
                  return (
                    <React.Fragment key={classroom.id}>
                      <ClassroomTableRow
                        classroom={classroom}
                        showSelectColumn={canEditClassrooms}
                        selectable={isSelectable(classroom)}
                        selectDisabled={isEditing}
                        selected={selectedIds.has(classroom.id)}
                        onSelectedChange={(checked) =>
                          toggleSelected(classroom.id, checked)
                        }
                        expanded={isExpanded}
                        onToggleExpanded={() => toggleRowExpanded(classroom.id)}
                        createdAtText={formatDate(classroom.created_at)}
                        readOnly={!canEditClassrooms}
                        onDispatch={() => setAssignmentClassroom(classroom)}
                        onEdit={() => inlineEdit.startEdit(classroom)}
                        onDelete={() => setDeleteConfirmId(classroom.id)}
                        canToggleStatus={isSelectable(classroom)}
                        statusBusy={statusActions.statusBusyId !== null}
                        onToggleActive={(active) =>
                          statusActions.toggleActive(classroom, active)
                        }
                        editing={isEditing}
                        draft={isEditing ? inlineEdit.draft : null}
                        onDraftChange={inlineEdit.setDraft}
                        onSave={inlineEdit.saveEdit}
                        onCancel={inlineEdit.exitEdit}
                        saving={inlineEdit.saving}
                      />

                      {/* Expanded Detail Row */}
                      {isExpanded && (
                        <TableRow className="bg-gray-50 dark:bg-gray-700/30">
                          <TableCell
                            colSpan={canEditClassrooms ? 8 : 7}
                            className="py-3 px-6"
                          >
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <span className="text-gray-500 dark:text-gray-400 text-xs">
                                  {t("teacherClassrooms.labels.description")}
                                </span>
                                <p className="dark:text-gray-200 mt-1">
                                  {classroom.description ||
                                    t(
                                      "teacherClassrooms.messages.noDescription",
                                    )}
                                </p>
                              </div>
                              <div>
                                <span className="text-gray-500 dark:text-gray-400 text-xs">
                                  {t("teacherClassrooms.labels.studentCount")}
                                </span>
                                <p className="dark:text-gray-200 mt-1 flex items-center gap-1">
                                  <Users className="h-4 w-4 text-gray-400" />
                                  {classroom.student_count}
                                </p>
                              </div>
                              <div>
                                <span className="text-gray-500 dark:text-gray-400 text-xs">
                                  {t("teacherClassrooms.labels.programCount")}
                                </span>
                                <p className="dark:text-gray-200 mt-1 flex items-center gap-1">
                                  <BookOpen className="h-4 w-4 text-gray-400" />
                                  {classroom.program_count || 0}
                                </p>
                              </div>
                              {classroom.school_name && (
                                <div>
                                  <span className="text-gray-500 dark:text-gray-400 text-xs">
                                    {t("teacherClassrooms.labels.school")}
                                  </span>
                                  <p className="dark:text-gray-200 mt-1">
                                    {classroom.school_name}
                                  </p>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Empty State */}
      {processedClassrooms.length === 0 && (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700">
          <GraduationCap className="h-12 w-12 text-gray-400 dark:text-gray-600 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">
            {t("teacherClassrooms.messages.noClassrooms")}
          </p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
            {t("teacherClassrooms.messages.createFirstDescription")}
          </p>
          <Button
            className="mt-4"
            onClick={() => setShowCreateDialog(true)}
            disabled={mode === "organization" || selectedSchool !== null}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t("teacherClassrooms.buttons.createFirst")}
          </Button>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {/* 1Campus Sync Confirmation Dialog (#761) */}
      <Dialog open={showSyncConfirm} onOpenChange={setShowSyncConfirm}>
        <DialogContent
          className="bg-white"
          style={{ backgroundColor: "white" }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <span>
                {t("teacherClassrooms.oneCampusSync.confirm.title", {
                  defaultValue: "Sync into your personal account?",
                })}
              </span>
            </DialogTitle>
            <DialogDescription>
              {t("teacherClassrooms.oneCampusSync.confirm.message", {
                defaultValue:
                  "AI point usage for classes under your personal account will be deducted from your personal points. If the students belong to an organization, please import the class within the organization instead.",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowSyncConfirm(false)}
              className="w-full sm:w-auto"
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleConfirmSyncOneCampus}
              className="w-full sm:w-auto"
            >
              {t("teacherClassrooms.oneCampusSync.confirm.confirmButton", {
                defaultValue: "Sync anyway",
              })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteConfirmId}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
      >
        <DialogContent
          className="bg-white"
          style={{ backgroundColor: "white" }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <span>{t("teacherClassrooms.dialogs.deleteTitle")}</span>
            </DialogTitle>
            <DialogDescription>
              {t("teacherClassrooms.dialogs.deleteDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmId(null)}
              className="w-full sm:w-auto"
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              className="w-full sm:w-auto"
            >
              {t("teacherClassrooms.buttons.confirmDelete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Classroom Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent
          className="bg-white"
          style={{ backgroundColor: "white" }}
        >
          <DialogHeader>
            <DialogTitle>
              {t("teacherClassrooms.dialogs.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("teacherClassrooms.dialogs.createDescription")}
            </DialogDescription>
          </DialogHeader>
          {/* 老師習慣先定年級再定班級（#1097）：年級＋名稱並排，其次等級、描述 */}
          <div className="space-y-4">
            <div className="grid grid-cols-[auto_1fr] gap-3">
              <div>
                <label
                  htmlFor="create-grade"
                  className="text-sm font-medium block mb-1"
                >
                  {t("teacherClassrooms.labels.grade")}
                </label>
                <GradeSelect
                  id="create-grade"
                  value={createFormData.grade}
                  onChange={(grade) =>
                    setCreateFormData({ ...createFormData, grade })
                  }
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="create-name"
                  className="text-sm font-medium block mb-1"
                >
                  {t("teacherClassrooms.labels.classroomName")}
                </label>
                <input
                  id="create-name"
                  type="text"
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  value={createFormData.name}
                  onChange={(e) =>
                    setCreateFormData({
                      ...createFormData,
                      name: e.target.value,
                    })
                  }
                  placeholder={t(
                    "teacherClassrooms.placeholders.classroomName",
                  )}
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="create-level"
                className="text-sm font-medium block mb-1"
              >
                {t("teacherClassrooms.labels.level")}
              </label>
              <LevelSelect
                id="create-level"
                value={createFormData.level}
                onChange={(level) =>
                  setCreateFormData({ ...createFormData, level })
                }
                className="w-full px-3 py-2 border rounded-md text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="create-description"
                className="text-sm font-medium block mb-1"
              >
                {t("teacherClassrooms.labels.description")}
              </label>
              <textarea
                id="create-description"
                className="w-full px-3 py-2 border rounded-md text-sm"
                value={createFormData.description}
                onChange={(e) =>
                  setCreateFormData({
                    ...createFormData,
                    description: e.target.value,
                  })
                }
                placeholder={t("teacherClassrooms.placeholders.description")}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              className="w-full sm:w-auto"
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleCreate} className="w-full sm:w-auto">
              {t("teacherClassrooms.buttons.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 年級補填／批次調整（#1097） */}
      <MissingGradeDialog
        open={showMissingGrade}
        onOpenChange={setShowMissingGrade}
        classrooms={missingGradeClassrooms}
        onSave={handleBatchSetGrades}
      />
      <AdjustGradeDialog
        open={showAdjustGrade}
        onOpenChange={setShowAdjustGrade}
        classrooms={selectedClassrooms}
        onConfirm={handleAdjustGrades}
      />
      <AdjustLevelDialog
        open={showAdjustLevel}
        onOpenChange={setShowAdjustLevel}
        classrooms={selectedClassrooms}
        onConfirm={handleAdjustLevels}
      />
      {/* 批次停用／啟用確認（#1097） */}
      <ConfirmDialog
        open={showBulkStatus}
        onOpenChange={setShowBulkStatus}
        title={t(
          bulkStatusTarget
            ? "classroomGrade.bulk.activateTitle"
            : "classroomGrade.bulk.deactivateTitle",
          { count: bulkStatusCount },
        )}
        description={t(
          bulkStatusTarget
            ? "classroomGrade.bulk.activateDescription"
            : "classroomGrade.bulk.deactivateDescription",
        )}
        confirmText={t(
          bulkStatusTarget
            ? "classroomGrade.bulk.activate"
            : "classroomGrade.bulk.deactivate",
        )}
        cancelText={t("common.cancel")}
        variant={bulkStatusTarget ? "default" : "destructive"}
        onConfirm={() => void handleBulkStatus(bulkStatusTarget)}
      />

      {/* Assignment Dialog */}
      {assignmentClassroom && (
        <AssignmentDialog
          open={!!assignmentClassroom}
          onClose={() => setAssignmentClassroom(null)}
          classroomId={assignmentClassroom.id}
          students={assignmentClassroom.students}
          onSuccess={() => setAssignmentClassroom(null)}
        />
      )}
    </div>
  );
}
