/**
 * StudentStatusPanel - 學生完成狀況面板
 *
 * 功能：
 * - Grid（便利貼）/ List（條列）雙檢視模式切換
 * - 三個 Tab：全部 / 已派發 / 未派發
 * - 紅綠燈狀態圓（TrafficLightDot）
 * - 排序：成績 / 座號 / 姓名 / 狀態
 * - Checkbox 批次派發 / 取消派發（僅點 checkbox 本身才會 toggle）
 * - 點擊卡片/行其他區域 → gradable modes (reading / word_reading) 且狀態非 unassigned/NOT_STARTED 才開新分頁批改，不會影響 checkbox
 * - 狀態圖例說明
 */
import { useState, useMemo, useEffect, useCallback, forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGrid, List, Loader2, Save, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StudentProgress {
  student_id: number;
  student_number: string | number;
  student_name: string;
  status:
    | "NOT_STARTED"
    | "IN_PROGRESS"
    | "SUBMITTED"
    | "GRADED"
    | "RETURNED"
    | "RESUBMITTED"
    | "unassigned";
  score?: number;
  is_assigned?: boolean;
  is_interim_score?: boolean;
}

export interface StudentStatusPanelProps {
  students: StudentProgress[];
  assignmentId: number;
  classroomId: string | number;
  practiceMode?: string;
  isEditingStudents: boolean;
  onEditingStudentsChange: (editing: boolean) => void;
  onStudentIdsChanged: (studentIds: number[]) => void;
  onSave?: () => void;
  saving?: boolean;
  loading: boolean;
  /** When true, data area scrolls internally. When false, expands naturally (parent handles scroll). */
  scrollable?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type ViewMode = "grid" | "list";
type TabValue = "all" | "assigned" | "unassigned";
type SortMode = "number" | "name" | "score" | "status";

const GRADABLE_MODES = new Set(["reading", "word_reading", "rearrangement"]);

const STATUS_ORDER: Record<string, number> = {
  NOT_STARTED: 0,
  IN_PROGRESS: 1,
  SUBMITTED: 2,
  RETURNED: 3,
  RESUBMITTED: 4,
  GRADED: 5,
  unassigned: -1,
};

// ---------------------------------------------------------------------------
// TrafficLightDot - 紅綠燈狀態圓
// ---------------------------------------------------------------------------

export function TrafficLightDot({
  status,
  size = 14,
}: {
  status: string;
  size?: number;
}) {
  const r = size / 2;
  const strokeW = 1.5;

  switch (status) {
    // 黃色虛線空心圓 — 已派發，未開始
    case "NOT_STARTED":
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={r}
            cy={r}
            r={r - strokeW / 2}
            fill="none"
            stroke="#F59E0B"
            strokeWidth={strokeW}
            strokeDasharray="3 2"
          />
        </svg>
      );

    // 黃色 1/4 填滿圓 — 已開始，未完成
    case "IN_PROGRESS":
      return (
        <div
          className="rounded-full border-[1.5px] border-yellow-400"
          style={{
            width: size,
            height: size,
            boxSizing: "border-box",
            background: `conic-gradient(#F59E0B 0deg 90deg, transparent 90deg 360deg)`,
          }}
        />
      );

    // 紅色實心圓 — 已完成，待批改
    case "SUBMITTED":
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={r} cy={r} r={r} fill="#EF4444" />
        </svg>
      );

    // 黃色實心圓 + ✗ — 已退回，學生需訂正
    case "RETURNED":
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={r} cy={r} r={r} fill="#F59E0B" />
          <text
            x={r}
            y={r}
            textAnchor="middle"
            dominantBaseline="central"
            fill="white"
            fontSize={size * 0.55}
            fontWeight="bold"
          >
            ✗
          </text>
        </svg>
      );

    // 綠色實心圓 — 已訂正
    case "RESUBMITTED":
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={r} cy={r} r={r} fill="#22C55E" />
        </svg>
      );

    // 綠色實心圓 + ✓ — 已批改完成
    case "GRADED":
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={r} cy={r} r={r} fill="#22C55E" />
          <text
            x={r}
            y={r}
            textAnchor="middle"
            dominantBaseline="central"
            fill="white"
            fontSize={size * 0.55}
            fontWeight="bold"
          >
            ✓
          </text>
        </svg>
      );

    // 灰色空心圓 — 未派發
    case "unassigned":
    default:
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={r}
            cy={r}
            r={r - strokeW / 2}
            fill="none"
            stroke="#D1D5DB"
            strokeWidth={strokeW}
          />
        </svg>
      );
  }
}

// ---------------------------------------------------------------------------
// StatusLegend - 狀態圖例
// ---------------------------------------------------------------------------

export function StatusLegend({ columns = 2 }: { columns?: 1 | 2 } = {}) {
  const { t } = useTranslation();
  const items = [
    {
      status: "NOT_STARTED",
      label: t("assignmentDetail.sheet.statusNotStarted", "學生尚未開始寫作業"),
    },
    {
      status: "RETURNED",
      label: t("assignmentDetail.sheet.statusReturned", "學生未開始訂正"),
    },
    {
      status: "IN_PROGRESS",
      label: t("assignmentDetail.sheet.statusInProgress", "學生未完成作業"),
    },
    {
      status: "RESUBMITTED",
      label: t(
        "assignmentDetail.sheet.statusResubmitted",
        "學生已訂正，待老師批改",
      ),
    },
    {
      status: "SUBMITTED",
      label: t(
        "assignmentDetail.sheet.statusSubmitted",
        "學生已完成，待老師批改",
      ),
    },
    {
      status: "GRADED",
      label: t("assignmentDetail.sheet.statusGraded", "老師已批改完畢"),
    },
  ];

  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-md p-3 mt-2">
      <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">
        {t("assignmentDetail.sheet.legendTitle", "狀態圖示說明")}
      </p>
      <div
        className={`grid gap-x-6 gap-y-1.5 ${
          columns === 1 ? "grid-cols-1" : "grid-cols-2"
        }`}
      >
        {items.map((item) => (
          <div key={item.status} className="flex items-center gap-2">
            <TrafficLightDot status={item.status} size={12} />
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StudentCard - Grid view 卡片
// ---------------------------------------------------------------------------

function StudentCard({
  student,
  isSelected,
  isDisabled,
  onToggle,
  onClick,
  tooltip,
}: {
  student: StudentProgress;
  isSelected: boolean;
  isDisabled: boolean;
  onToggle: () => void;
  onClick: () => void;
  tooltip?: string;
}) {
  const isUnassigned = student.status === "unassigned";
  const cardTooltip = tooltip && !isUnassigned ? tooltip : undefined;
  const isClickable = !!cardTooltip;
  const hasScore =
    student.score != null &&
    ["GRADED", "RETURNED", "RESUBMITTED"].includes(student.status);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      title={cardTooltip}
      className={`relative flex flex-col items-center justify-center p-2 rounded-lg text-center transition-all aspect-square overflow-hidden min-w-0 ${
        isClickable ? "cursor-pointer hover:shadow-md" : "cursor-default"
      } ${
        isUnassigned
          ? "border border-dashed border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-800/50"
          : "border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800"
      }`}
    >
      {/* Checkbox (always visible) — clicking only here toggles */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!isDisabled) onToggle();
        }}
        disabled={isDisabled}
        aria-label="toggle"
        className="absolute top-1 left-1 p-0.5 -m-0.5 leading-none"
      >
        {isDisabled ? (
          <span className="inline-block w-3.5 h-3.5 rounded-sm bg-gray-300 dark:bg-gray-600" />
        ) : isSelected ? (
          <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm bg-blue-500 text-white text-[8px] font-bold">
            ✓
          </span>
        ) : (
          <span className="inline-block w-3.5 h-3.5 rounded-sm border-[1.5px] border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700" />
        )}
      </button>

      {/* Status dot (top-right) */}
      <span className="absolute top-1 right-1">
        <TrafficLightDot status={student.status} size={12} />
      </span>

      {/* Seat number */}
      {Number(student.student_number) > 0 && (
        <span className="text-xs text-gray-700 dark:text-gray-300 leading-tight">
          {student.student_number}
        </span>
      )}

      {/* Name */}
      <span className="text-xs truncate w-full text-gray-600 dark:text-gray-400 leading-tight">
        {student.student_name}
      </span>

      {/* Score */}
      <span
        className={`text-base font-bold leading-tight ${
          hasScore
            ? "text-gray-800 dark:text-gray-100"
            : "text-gray-300 dark:text-gray-600"
        }`}
      >
        {hasScore
          ? `${student.is_interim_score ? "~" : ""}${Number(student.score).toFixed(1)}`
          : "-"}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StudentRow - List view 行
// ---------------------------------------------------------------------------

function StudentRow({
  student,
  isEditing,
  isSelected,
  isDisabled,
  onToggle,
  onClick,
  tooltip,
}: {
  student: StudentProgress;
  isEditing: boolean;
  isSelected: boolean;
  isDisabled: boolean;
  onToggle: () => void;
  onClick: () => void;
  tooltip?: string;
}) {
  const isUnassigned = student.status === "unassigned";
  const rowTooltip = tooltip && !isUnassigned ? tooltip : undefined;
  const isClickable = !!rowTooltip;
  const hasScore =
    student.score != null &&
    ["GRADED", "RETURNED", "RESUBMITTED"].includes(student.status);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      title={rowTooltip}
      className={`flex items-center w-full gap-3 py-2 px-3 rounded transition-colors ${
        isClickable
          ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
          : "cursor-default"
      }`}
    >
      {/* Checkbox (edit mode) — clicking only here toggles */}
      {isEditing && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!isDisabled) onToggle();
          }}
          disabled={isDisabled}
          aria-label="toggle"
          className="shrink-0 p-0.5 -m-0.5 leading-none"
        >
          {isDisabled ? (
            <span className="inline-block w-4 h-4 rounded-sm bg-gray-300 dark:bg-gray-600" />
          ) : isSelected ? (
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-sm bg-blue-500 text-white text-[9px] font-bold">
              ✓
            </span>
          ) : (
            <span className="inline-block w-4 h-4 rounded-sm border-[1.5px] border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700" />
          )}
        </button>
      )}

      {/* Status dot */}
      <span className="shrink-0">
        <TrafficLightDot status={student.status} size={12} />
      </span>

      {/* Seat number */}
      {Number(student.student_number) > 0 && (
        <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 w-6 shrink-0">
          {student.student_number}
        </span>
      )}

      {/* Name */}
      <span className="text-sm text-gray-800 dark:text-gray-200 flex-1 text-left truncate">
        {student.student_name}
      </span>

      {/* Score */}
      <span
        className={`text-sm font-bold shrink-0 ${
          hasScore
            ? "text-gray-800 dark:text-gray-100"
            : "text-gray-300 dark:text-gray-600"
        }`}
      >
        {hasScore
          ? `${student.is_interim_score ? "~" : ""}${Number(student.score).toFixed(1)}`
          : "-"}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const StudentStatusPanel = forwardRef<HTMLDivElement, StudentStatusPanelProps>(
  function StudentStatusPanel(
    {
      students,
      assignmentId,
      classroomId,
      practiceMode,
      isEditingStudents,
      onEditingStudentsChange,
      onStudentIdsChanged,
      onSave,
      saving = false,
      loading,
      scrollable = false,
    },
    ref,
  ) {
    const { t } = useTranslation();

    const [viewMode, setViewMode] = useState<ViewMode>("list");
    const [activeTab, setActiveTab] = useState<TabValue>("assigned");
    const [sortMode, setSortMode] = useState<SortMode>("number");
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

    const isGradable = practiceMode ? GRADABLE_MODES.has(practiceMode) : false;

    // Clear selection when parent resets editing state (e.g. after save)
    useEffect(() => {
      if (!isEditingStudents) {
        setSelectedIds(new Set());
      }
    }, [isEditingStudents]);

    // Reset marked students when switching tabs
    useEffect(() => {
      setSelectedIds(new Set());
    }, [activeTab, students]);

    // The initial set of assigned student IDs (source of truth)
    const initialAssignedIds = useMemo(
      () =>
        new Set(
          students
            .filter((s) => s.status !== "unassigned" && s.is_assigned !== false)
            .map((s) => s.student_id),
        ),
      [students],
    );

    // selectedIds = students marked for action (add or remove)
    // hasChanges = any student marked
    const hasChanges = selectedIds.size > 0;

    // Sync editing state to parent
    useEffect(() => {
      onEditingStudentsChange(hasChanges);
    }, [hasChanges, onEditingStudentsChange]);

    // Compute final student_ids list based on active tab + marked students
    // Assigned tab: marked = to remove → final = initial minus marked
    // Unassigned tab: marked = to add → final = initial plus marked
    useEffect(() => {
      if (!hasChanges) {
        return;
      }
      let finalIds: Set<number>;
      if (activeTab === "assigned") {
        finalIds = new Set(initialAssignedIds);
        selectedIds.forEach((id) => finalIds.delete(id));
      } else if (activeTab === "unassigned") {
        finalIds = new Set(initialAssignedIds);
        selectedIds.forEach((id) => finalIds.add(id));
      } else {
        finalIds = new Set(initialAssignedIds);
      }
      onStudentIdsChanged(Array.from(finalIds));
    }, [
      selectedIds,
      activeTab,
      initialAssignedIds,
      hasChanges,
      onStudentIdsChanged,
    ]);

    // Cancel = clear all marks
    const handleCancel = useCallback(() => {
      setSelectedIds(new Set());
    }, []);

    // ---- Filtering by tab ----
    const filteredStudents = useMemo(() => {
      switch (activeTab) {
        case "assigned":
          return students.filter(
            (s) => s.status !== "unassigned" && s.is_assigned !== false,
          );
        case "unassigned":
          return students.filter(
            (s) => s.status === "unassigned" || s.is_assigned === false,
          );
        default:
          return students;
      }
    }, [students, activeTab]);

    // ---- Sorting ----
    const sortedStudents = useMemo(() => {
      const dir = sortDirection === "asc" ? 1 : -1;
      return [...filteredStudents].sort((a, b) => {
        let cmp = 0;
        switch (sortMode) {
          case "number":
            cmp = Number(a.student_number) - Number(b.student_number);
            break;
          case "name":
            cmp = a.student_name.localeCompare(b.student_name, "zh-TW");
            break;
          case "score":
            cmp = (a.score ?? -1) - (b.score ?? -1);
            break;
          case "status":
            cmp =
              (STATUS_ORDER[a.status] ?? -1) - (STATUS_ORDER[b.status] ?? -1);
            break;
        }
        return cmp * dir;
      });
    }, [filteredStudents, sortMode, sortDirection]);

    // ---- Checkbox helpers ----
    // All tab: all disabled (display only)
    // Assigned tab: only NOT_STARTED can be toggled
    // Unassigned tab: all can be toggled
    const isCheckboxDisabled = useCallback(
      (s: StudentProgress) => {
        if (activeTab === "all") return true;
        if (activeTab === "unassigned") return false;
        // assigned tab: only NOT_STARTED can be unchecked
        return s.status !== "NOT_STARTED";
      },
      [activeTab],
    );

    const toggleStudent = useCallback((studentId: number) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(studentId)) {
          next.delete(studentId);
        } else {
          next.add(studentId);
        }
        return next;
      });
    }, []);

    const handleSelectAll = useCallback(() => {
      const toggleableInTab = filteredStudents.filter(
        (s) => !isCheckboxDisabled(s),
      );
      const allSelected = toggleableInTab.every((s) =>
        selectedIds.has(s.student_id),
      );
      setSelectedIds((prev) => {
        const next = new Set(prev);
        toggleableInTab.forEach((s) => {
          if (allSelected) {
            next.delete(s.student_id);
          } else {
            next.add(s.student_id);
          }
        });
        return next;
      });
    }, [filteredStudents, selectedIds, isCheckboxDisabled]);

    // ---- Navigation ----
    // Gradable modes (see GRADABLE_MODES): open grading page for this student in a new tab.
    // Skip unassigned and NOT_STARTED — nothing to grade yet.
    const isGradableStudent = useCallback(
      (s: StudentProgress) =>
        isGradable && s.status !== "unassigned" && s.status !== "NOT_STARTED",
      [isGradable],
    );

    const handleStudentClick = useCallback(
      (student: StudentProgress) => {
        if (!isGradableStudent(student)) return;
        window.open(
          `/teacher/classroom/${classroomId}/assignment/${assignmentId}/grading?studentId=${student.student_id}`,
          "_blank",
        );
      },
      [isGradableStudent, classroomId, assignmentId],
    );

    // ---- Tab counts ----
    const assignedCount = useMemo(
      () =>
        students.filter(
          (s) => s.status !== "unassigned" && s.is_assigned !== false,
        ).length,
      [students],
    );
    const unassignedCount = useMemo(
      () =>
        students.filter(
          (s) => s.status === "unassigned" || s.is_assigned === false,
        ).length,
      [students],
    );

    // ---- Sort buttons config ----
    const sortOptions: { value: SortMode; label: string }[] = [
      {
        value: "score",
        label: t("assignmentDetail.sheet.sortByScore", "成績"),
      },
      {
        value: "number",
        label: t("assignmentDetail.sheet.sortByNumber", "座號"),
      },
      {
        value: "name",
        label: t("assignmentDetail.sheet.sortByName", "姓名"),
      },
      {
        value: "status",
        label: t("assignmentDetail.sheet.sortByStatus", "狀態"),
      },
    ];

    // ---- Tab config ----
    const tabs: { value: TabValue; label: string; count?: number }[] = [
      {
        value: "all",
        label: t("assignmentDetail.sheet.tabAll", "全部"),
        count: students.length,
      },
      {
        value: "assigned",
        label: t("assignmentDetail.sheet.tabAssigned", "已派發"),
        count: assignedCount,
      },
      {
        value: "unassigned",
        label: t("assignmentDetail.sheet.tabUnassigned", "未派發"),
        count: unassignedCount,
      },
    ];

    // Whether checkboxes are interactive on current tab
    const isCheckboxActive = activeTab !== "all";

    // ---- Select all checkbox state ----
    const selectAllState = useMemo(() => {
      if (!isCheckboxActive) return "hidden";
      const toggleable = filteredStudents.filter((s) => !isCheckboxDisabled(s));
      if (toggleable.length === 0) return "disabled";
      const allSelected = toggleable.every((s) =>
        selectedIds.has(s.student_id),
      );
      return allSelected ? "checked" : "unchecked";
    }, [isCheckboxActive, filteredStudents, selectedIds, isCheckboxDisabled]);

    return (
      <div
        className={`border-t dark:border-gray-700 pt-4 ${scrollable ? "flex flex-col h-full" : ""}`}
      >
        {/* Header: title + sort + view toggle */}
        <div className="flex items-center justify-between mb-3 gap-2">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 shrink-0">
            {t("assignmentDetail.sheet.studentProgress", "學生完成狀況")}
          </h4>

          {/* Sort segmented buttons */}
          <div className="flex items-center rounded-md overflow-hidden border border-gray-200 dark:border-gray-600">
            {sortOptions.map((opt, i) => {
              const isActive = sortMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    if (isActive) {
                      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
                    } else {
                      setSortMode(opt.value);
                      setSortDirection("asc");
                    }
                  }}
                  className={`px-2 py-1 text-[10px] font-medium transition-colors ${
                    isActive
                      ? "bg-blue-500 text-white"
                      : "bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                  } ${i > 0 ? "border-l border-gray-200 dark:border-gray-600" : ""}`}
                >
                  {opt.label}
                  {isActive && (
                    <span className="ml-0.5">
                      {sortDirection === "asc" ? "↑" : "↓"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* View mode toggle */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`p-1 rounded transition-colors ${
                viewMode === "grid"
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`p-1 rounded transition-colors ${
                viewMode === "list"
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
              }`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Tabs + Select All */}
        <div className="flex items-center border-b border-gray-200 dark:border-gray-700 mb-3">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActiveTab(tab.value)}
              className={`flex-1 text-center py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.value
                  ? "border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/20"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              {tab.label}
              {tab.count != null && (
                <span className="ml-1 text-[10px] text-gray-400">
                  {tab.count}
                </span>
              )}
            </button>
          ))}

          {/* Select All */}
          {selectAllState !== "hidden" && (
            <button
              type="button"
              onClick={handleSelectAll}
              disabled={selectAllState === "disabled"}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 shrink-0 hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-40"
            >
              {selectAllState === "checked" ? (
                <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm bg-blue-500 text-white text-[8px] font-bold">
                  ✓
                </span>
              ) : (
                <span className="inline-block w-3.5 h-3.5 rounded-sm border-[1.5px] border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700" />
              )}
              {t("assignmentDetail.sheet.selectAll", "全選")}
            </button>
          )}
        </div>

        {/* Content: loading / empty / grid / list */}
        {/* Data + legend area */}
        <div
          ref={ref}
          className={scrollable ? "flex-1 min-h-0 overflow-y-auto" : ""}
        >
          {loading ? (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : sortedStudents.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">
              {t("assignmentDetail.sheet.noStudents", "尚無學生資料")}
            </p>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-5 gap-2 py-1 items-start">
              {sortedStudents.map((student) => (
                <StudentCard
                  key={student.student_id}
                  student={student}
                  isSelected={selectedIds.has(student.student_id)}
                  isDisabled={isCheckboxDisabled(student)}
                  onToggle={() => toggleStudent(student.student_id)}
                  onClick={() => handleStudentClick(student)}
                  tooltip={
                    isGradableStudent(student)
                      ? t("assignmentDetail.sheet.checkHomework", "批改作業")
                      : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <div className="space-y-0.5">
              {sortedStudents.map((student) => (
                <StudentRow
                  key={student.student_id}
                  student={student}
                  isEditing={isCheckboxActive}
                  isSelected={selectedIds.has(student.student_id)}
                  isDisabled={isCheckboxDisabled(student)}
                  onToggle={() => toggleStudent(student.student_id)}
                  onClick={() => handleStudentClick(student)}
                  tooltip={
                    isGradableStudent(student)
                      ? t("assignmentDetail.sheet.checkHomework", "批改作業")
                      : undefined
                  }
                />
              ))}
            </div>
          )}

          {/* Save / Cancel bar (after student list, before legend) */}
          {hasChanges && (
            <div className="flex items-center justify-between mt-3 mb-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {activeTab === "assigned"
                  ? t(
                      "assignmentDetail.sheet.removedCount",
                      "移除 {{count}} 位",
                      { count: selectedIds.size },
                    )
                  : t(
                      "assignmentDetail.sheet.addedCount",
                      "新增 {{count}} 位",
                      { count: selectedIds.size },
                    )}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={saving}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                  {t("common.cancel", "取消")}
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-500 rounded-md hover:bg-blue-600 transition-colors disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {t("assignmentDetail.sheet.saveStudents", "儲存派發")}
                </button>
              </div>
            </div>
          )}

          {/* Status legend */}
          <StatusLegend />
        </div>
      </div>
    );
  },
);

export default StudentStatusPanel;
