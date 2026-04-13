/**
 * StudentStatusPanel - 學生完成狀況面板
 *
 * 功能：
 * - Grid（便利貼）/ List（條列）雙檢視模式切換
 * - 三個 Tab：全部 / 已派發 / 未派發
 * - 紅綠燈狀態圓（TrafficLightDot）
 * - 排序：成績 / 座號 / 姓名 / 狀態
 * - Checkbox 批次派發 / 取消派發
 * - 點擊學生進入批改頁面（gradable modes）
 * - 狀態圖例說明
 */
import { useState, useMemo, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGrid, List, Loader2 } from "lucide-react";

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
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type ViewMode = "grid" | "list";
type TabValue = "all" | "assigned" | "unassigned";
type SortMode = "number" | "name" | "score" | "status";

const GRADABLE_MODES = new Set(["reading", "word_reading"]);

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

function TrafficLightDot({
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
            r={r - strokeW}
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
            r={r - strokeW}
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

function StatusLegend() {
  const { t } = useTranslation();
  const items = [
    {
      status: "NOT_STARTED",
      label: t(
        "assignmentDetail.sheet.statusNotStarted",
        "學生尚未開始寫作業",
      ),
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
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
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
  isEditing,
  isSelected,
  isDisabled,
  onToggle,
  onClick,
}: {
  student: StudentProgress;
  isEditing: boolean;
  isSelected: boolean;
  isDisabled: boolean;
  onToggle: () => void;
  onClick: () => void;
}) {
  const isUnassigned = student.status === "unassigned";
  const hasScore =
    student.score != null &&
    ["GRADED", "RETURNED", "RESUBMITTED"].includes(student.status);

  return (
    <button
      type="button"
      onClick={isEditing ? onToggle : onClick}
      disabled={isEditing && isDisabled}
      className={`relative flex flex-col items-center justify-center p-2 rounded-lg text-center transition-all min-h-[4.5rem] overflow-hidden min-w-0 ${
        isUnassigned
          ? "border border-dashed border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-800/50"
          : "border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800"
      } ${
        isEditing && isDisabled
          ? "opacity-60 cursor-not-allowed"
          : isEditing
            ? "cursor-pointer hover:shadow-sm"
            : "cursor-pointer hover:shadow-md hover:scale-[1.03]"
      }`}
    >
      {/* Checkbox overlay (edit mode) */}
      {isEditing && (
        <span className="absolute top-1 left-1">
          {isDisabled ? (
            <span className="inline-block w-3.5 h-3.5 rounded-sm bg-gray-300 dark:bg-gray-600" />
          ) : isSelected ? (
            <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm bg-blue-500 text-white text-[8px] font-bold">
              ✓
            </span>
          ) : (
            <span className="inline-block w-3.5 h-3.5 rounded-sm border-[1.5px] border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700" />
          )}
        </span>
      )}

      {/* Status dot (top-right) */}
      <span className="absolute top-1 right-1">
        <TrafficLightDot status={student.status} size={12} />
      </span>

      {/* Seat number */}
      <span className="text-xs text-gray-700 dark:text-gray-300 leading-tight">
        {student.student_number}
      </span>

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
          ? `${student.is_interim_score ? "~" : ""}${Number(student.score).toFixed(0)}`
          : "-"}
      </span>
    </button>
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
}: {
  student: StudentProgress;
  isEditing: boolean;
  isSelected: boolean;
  isDisabled: boolean;
  onToggle: () => void;
  onClick: () => void;
}) {
  const hasScore =
    student.score != null &&
    ["GRADED", "RETURNED", "RESUBMITTED"].includes(student.status);

  return (
    <button
      type="button"
      onClick={isEditing ? onToggle : onClick}
      disabled={isEditing && isDisabled}
      className={`flex items-center w-full gap-3 py-2 px-3 rounded hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
        isEditing && isDisabled
          ? "opacity-60 cursor-not-allowed"
          : "cursor-pointer"
      }`}
    >
      {/* Checkbox (edit mode) */}
      {isEditing && (
        <span className="shrink-0">
          {isDisabled ? (
            <span className="inline-block w-4 h-4 rounded-sm bg-gray-300 dark:bg-gray-600" />
          ) : isSelected ? (
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-sm bg-blue-500 text-white text-[9px] font-bold">
              ✓
            </span>
          ) : (
            <span className="inline-block w-4 h-4 rounded-sm border-[1.5px] border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700" />
          )}
        </span>
      )}

      {/* Status dot */}
      <span className="shrink-0">
        <TrafficLightDot status={student.status} size={12} />
      </span>

      {/* Seat number */}
      <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 w-6 shrink-0">
        {student.student_number}
      </span>

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
          ? `${student.is_interim_score ? "~" : ""}${Number(student.score).toFixed(0)}`
          : "-"}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function StudentStatusPanel({
  students,
  assignmentId,
  classroomId,
  practiceMode,
  isEditingStudents,
  onEditingStudentsChange: _onEditingStudentsChange,
  onStudentIdsChanged,
  loading,
}: StudentStatusPanelProps) {
  // _onEditingStudentsChange is available for future use (e.g., "編輯派發" button inside panel)
  void _onEditingStudentsChange;
  const { t } = useTranslation();

  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [activeTab, setActiveTab] = useState<TabValue>("all");
  const [sortMode, setSortMode] = useState<SortMode>("number");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const isGradable = practiceMode
    ? GRADABLE_MODES.has(practiceMode)
    : false;

  // Initialize selected IDs when entering edit mode
  useEffect(() => {
    if (isEditingStudents) {
      const assignedIds = new Set(
        students
          .filter(
            (s) => s.status !== "unassigned" && s.is_assigned !== false,
          )
          .map((s) => s.student_id),
      );
      setSelectedIds(assignedIds);
    }
  }, [isEditingStudents, students]);

  // Notify parent of changes
  useEffect(() => {
    if (isEditingStudents) {
      onStudentIdsChanged(Array.from(selectedIds));
    }
  }, [selectedIds, isEditingStudents, onStudentIdsChanged]);

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
    return [...filteredStudents].sort((a, b) => {
      switch (sortMode) {
        case "number":
          return Number(a.student_number) - Number(b.student_number);
        case "name":
          return a.student_name.localeCompare(b.student_name, "zh-TW");
        case "score":
          return (b.score ?? -1) - (a.score ?? -1);
        case "status":
          return (
            (STATUS_ORDER[a.status] ?? -1) - (STATUS_ORDER[b.status] ?? -1)
          );
        default:
          return 0;
      }
    });
  }, [filteredStudents, sortMode]);

  // ---- Checkbox helpers ----
  const isCheckboxDisabled = useCallback((s: StudentProgress) => {
    return (
      s.status !== "NOT_STARTED" && s.status !== "unassigned"
    );
  }, []);

  const toggleStudent = useCallback(
    (studentId: number) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(studentId)) {
          next.delete(studentId);
        } else {
          next.add(studentId);
        }
        return next;
      });
    },
    [],
  );

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
  const handleStudentClick = useCallback(
    (_student: StudentProgress) => {
      if (isEditingStudents || !isGradable) return;
      window.open(
        `/teacher/classroom/${classroomId}/assignment/${assignmentId}/grading`,
        "_blank",
      );
    },
    [isEditingStudents, isGradable, classroomId, assignmentId],
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

  // ---- Select all checkbox state ----
  const selectAllState = useMemo(() => {
    if (!isEditingStudents) return "hidden";
    const toggleable = filteredStudents.filter((s) => !isCheckboxDisabled(s));
    if (toggleable.length === 0) return "disabled";
    const allSelected = toggleable.every((s) =>
      selectedIds.has(s.student_id),
    );
    return allSelected ? "checked" : "unchecked";
  }, [isEditingStudents, filteredStudents, selectedIds, isCheckboxDisabled]);

  return (
    <div className="border-t dark:border-gray-700 pt-4">
      {/* Header: title + sort + view toggle */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 shrink-0">
          {t("assignmentDetail.sheet.studentProgress", "學生完成狀況")}
        </h4>

        {/* Sort segmented buttons */}
        <div className="flex items-center rounded-md overflow-hidden border border-gray-200 dark:border-gray-600">
          {sortOptions.map((opt, i) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSortMode(opt.value)}
              className={`px-2 py-1 text-[10px] font-medium transition-colors ${
                sortMode === opt.value
                  ? "bg-blue-500 text-white"
                  : "bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              } ${i > 0 ? "border-l border-gray-200 dark:border-gray-600" : ""}`}
            >
              {opt.label}
            </button>
          ))}
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
      {loading ? (
        <div className="flex items-center justify-center py-8 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : sortedStudents.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">
          {t("assignmentDetail.sheet.noStudents", "尚無學生資料")}
        </p>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-5 gap-2 max-h-[45vh] overflow-y-auto py-1">
          {sortedStudents.map((student) => (
            <StudentCard
              key={student.student_id}
              student={student}
              isEditing={isEditingStudents}
              isSelected={selectedIds.has(student.student_id)}
              isDisabled={isCheckboxDisabled(student)}
              onToggle={() => toggleStudent(student.student_id)}
              onClick={() => handleStudentClick(student)}
            />
          ))}
        </div>
      ) : (
        <div className="max-h-[45vh] overflow-y-auto space-y-0.5">
          {sortedStudents.map((student) => (
            <StudentRow
              key={student.student_id}
              student={student}
              isEditing={isEditingStudents}
              isSelected={selectedIds.has(student.student_id)}
              isDisabled={isCheckboxDisabled(student)}
              onToggle={() => toggleStudent(student.student_id)}
              onClick={() => handleStudentClick(student)}
            />
          ))}
        </div>
      )}

      {/* Status legend */}
      <StatusLegend />
    </div>
  );
}
