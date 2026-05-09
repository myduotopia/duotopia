import React, { useState, useEffect, useCallback, useMemo } from "react";
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
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ClipboardList,
  Search,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api";
import { AssignmentDialog } from "@/components/AssignmentDialog";
import { toast } from "sonner";
import { CloudDownload } from "lucide-react";

interface ClassroomDetail {
  id: number;
  name: string;
  description?: string;
  level?: string;
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

type SortField = "name" | "student_count" | "created_at";
type SortDirection = "asc" | "desc";

export default function TeacherClassrooms() {
  const { t } = useTranslation();
  const { selectedSchool, selectedOrganization, mode } = useWorkspace();
  const [classrooms, setClassrooms] = useState<ClassroomDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingClassroom, setEditingClassroom] =
    useState<ClassroomDetail | null>(null);
  const [editFormData, setEditFormData] = useState({
    name: "",
    description: "",
    level: "",
  });
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createFormData, setCreateFormData] = useState({
    name: "",
    description: "",
    level: "A1",
  });

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");

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

  const handleSyncOneCampusClasses = async () => {
    if (syncingOneCampus) return;
    setSyncingOneCampus(true);
    try {
      const res = await apiClient.syncOneCampusClasses();
      if (res.synced && res.schools.length > 0) {
        const added = res.classrooms_added + res.students_added;
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
        } else if (added === 0) {
          toast.info(
            t("teacherClassrooms.oneCampusSync.noChanges", {
              defaultValue: "Already up to date — no new classrooms or students.",
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

  const fetchClassrooms = useCallback(async () => {
    try {
      setLoading(true);

      // Build API params based on workspace context
      const apiParams: {
        mode?: string;
        school_id?: string;
        organization_id?: string;
      } = {};

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
      setClassrooms(data);
    } catch (err) {
      console.error("Fetch classrooms error:", err);
    } finally {
      setLoading(false);
    }
  }, [mode, selectedSchool, selectedOrganization]);

  useEffect(() => {
    fetchClassrooms();
  }, [fetchClassrooms]);

  const handleEdit = (classroom: ClassroomDetail) => {
    setEditingClassroom(classroom);
    setEditFormData({
      name: classroom.name,
      description: classroom.description || "",
      level: classroom.level || "A1",
    });
  };

  const handleSaveEdit = async () => {
    if (!editingClassroom) return;

    try {
      // API call to update classroom
      await apiClient.updateClassroom(editingClassroom.id, editFormData);

      // Refresh classrooms list
      await fetchClassrooms();
      setEditingClassroom(null);
    } catch (err) {
      console.error("Failed to update classroom:", err);
      alert(t("teacherClassrooms.messages.updateFailed"));
    }
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

    try {
      await apiClient.createClassroom(createFormData);

      // Refresh the list after creation
      await fetchClassrooms();
      setShowCreateDialog(false);
      setCreateFormData({ name: "", description: "", level: "A1" });
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

  const formatDate = (dateString?: string) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    return date.toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  const getLevelBadge = (level?: string) => {
    const levelColors: Record<string, string> = {
      PREA: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
      A1: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
      A2: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
      B1: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
      B2: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
      C1: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
      C2: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    };
    const color =
      levelColors[level?.toUpperCase() || "A1"] ||
      "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}
      >
        {level || "A1"}
      </span>
    );
  };

  // Sort toggle handler
  const handleSort = (field: SortField) => {
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
  };

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

  // Sortable header component
  const SortableHeader = ({
    field,
    children,
    className,
  }: {
    field: SortField;
    children: React.ReactNode;
    className?: string;
  }) => {
    const isActive = sortField === field;
    const icon = isActive ? (
      sortDirection === "asc" ? (
        <ArrowUp className="h-3 w-3" />
      ) : (
        <ArrowDown className="h-3 w-3" />
      )
    ) : (
      <ArrowUpDown className="h-3 w-3 opacity-50" />
    );

    return (
      <TableHead className={className}>
        <button
          onClick={() => handleSort(field)}
          className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-100 transition-colors text-xs sm:text-sm"
        >
          {children}
          {icon}
        </button>
      </TableHead>
    );
  };

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
        (c) => (c.level || "A1").toUpperCase() === levelFilter.toUpperCase(),
      );
    }

    // Sorting
    if (sortField) {
      result = [...result].sort((a, b) => {
        let comparison = 0;
        switch (sortField) {
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
    sortField,
    sortDirection,
  ]);

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
            onClick={fetchClassrooms}
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
            onClick={handleSyncOneCampusClasses}
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
                {processedClassrooms.length}
              </p>
            </div>
            <BookOpen className="h-6 w-6 sm:h-8 sm:w-8 text-purple-500 dark:text-purple-400" />
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          className="px-3 py-2 border dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md text-sm"
        >
          <option value="all">
            {t("teacherClassrooms.filters.allLevels")}
          </option>
          <option value="preA">Pre-A</option>
          <option value="A1">A1</option>
          <option value="A2">A2</option>
          <option value="B1">B1</option>
          <option value="B2">B2</option>
          <option value="C1">C1</option>
          <option value="C2">C2</option>
        </select>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder={t("teacherClassrooms.placeholders.searchName")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md text-sm"
          />
        </div>
      </div>

      {/* Classrooms Table */}
      <>
        {/* Mobile Sort + Card View */}
        <div className="md:hidden">
          {/* Mobile sort control */}
          <div className="flex items-center gap-2 mb-3">
            <ArrowUpDown className="h-4 w-4 text-gray-500" />
            <select
              value={sortField ? `${sortField}_${sortDirection}` : "default"}
              onChange={(e) => {
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
              }}
              className="px-2 py-1 border dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md text-sm"
            >
              <option value="default">
                {t("teacherClassrooms.sort.default")}
              </option>
              <option value="name_asc">
                {t("teacherClassrooms.sort.nameAsc")}
              </option>
              <option value="name_desc">
                {t("teacherClassrooms.sort.nameDesc")}
              </option>
              <option value="student_count_desc">
                {t("teacherClassrooms.sort.studentCountDesc")}
              </option>
              <option value="created_at_desc">
                {t("teacherClassrooms.sort.createdAtDesc")}
              </option>
              <option value="created_at_asc">
                {t("teacherClassrooms.sort.createdAtAsc")}
              </option>
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
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center flex-shrink-0">
                      <GraduationCap className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          ID: {classroom.id}
                        </span>
                        {getLevelBadge(classroom.level)}
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
                    disabled={classroom.student_count === 0}
                  >
                    <ClipboardList className="h-4 w-4 mr-2" />
                    {t("teacherClassrooms.buttons.dispatchAssignment")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(classroom)}
                    className="flex-1"
                    disabled={
                      mode === "organization" || selectedSchool !== null
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
                      mode === "organization" || selectedSchool !== null
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
                  <TableHead className="w-[50px] text-left text-xs sm:text-sm">
                    ID
                  </TableHead>
                  <SortableHeader
                    field="name"
                    className="text-left text-xs sm:text-sm min-w-[200px]"
                  >
                    {t("teacherClassrooms.labels.classroomName")}
                  </SortableHeader>
                  <TableHead className="text-left text-xs sm:text-sm min-w-[60px]">
                    {t("teacherClassrooms.labels.level")}
                  </TableHead>
                  <SortableHeader
                    field="created_at"
                    className="text-left text-xs sm:text-sm min-w-[100px]"
                  >
                    {t("teacherClassrooms.labels.createdAt")}
                  </SortableHeader>
                  <TableHead className="text-left text-xs sm:text-sm min-w-[120px]">
                    {t("teacherClassrooms.labels.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {processedClassrooms.map((classroom) => {
                  const isExpanded = expandedRows.has(classroom.id);
                  return (
                    <React.Fragment key={classroom.id}>
                      {/* Main Row */}
                      <TableRow
                        className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                        onClick={() => toggleRowExpanded(classroom.id)}
                      >
                        <TableCell className="font-medium text-xs sm:text-sm">
                          {classroom.id}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                            )}
                            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center flex-shrink-0">
                              <GraduationCap className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                              <Link
                                to={`/teacher/classroom/${classroom.id}`}
                                className="font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline text-sm"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {classroom.name}
                              </Link>
                              {/* Sub-info */}
                              <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                <span className="flex items-center gap-1">
                                  <Users className="h-3 w-3" />
                                  {classroom.student_count}
                                </span>
                                <span className="flex items-center gap-1">
                                  <BookOpen className="h-3 w-3" />
                                  {classroom.program_count || 0}
                                </span>
                                {classroom.description && (
                                  <span className="truncate max-w-[200px]">
                                    {classroom.description}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{getLevelBadge(classroom.level)}</TableCell>
                        <TableCell className="text-xs sm:text-sm dark:text-gray-200">
                          {formatDate(classroom.created_at)}
                        </TableCell>
                        <TableCell>
                          <div
                            className="flex items-center space-x-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {/* Dispatch Assignment */}
                            <Button
                              variant="ghost"
                              size="sm"
                              title={t(
                                "teacherClassrooms.buttons.dispatchAssignment",
                              )}
                              onClick={() => setAssignmentClassroom(classroom)}
                              className="p-1 sm:p-2"
                              disabled={classroom.student_count === 0}
                            >
                              <ClipboardList className="h-3 w-3 sm:h-4 sm:w-4" />
                              <span className="hidden sm:inline ml-1 text-xs">
                                {t(
                                  "teacherClassrooms.buttons.dispatchAssignment",
                                )}
                              </span>
                            </Button>
                            {/* Edit */}
                            <Button
                              variant="ghost"
                              size="sm"
                              title={t("common.edit")}
                              onClick={() => handleEdit(classroom)}
                              className="p-1 sm:p-2"
                              disabled={
                                mode === "organization" ||
                                selectedSchool !== null
                              }
                            >
                              <Edit className="h-3 w-3 sm:h-4 sm:w-4" />
                            </Button>
                            {/* Delete */}
                            <Button
                              variant="ghost"
                              size="sm"
                              title={t("common.delete")}
                              onClick={() => setDeleteConfirmId(classroom.id)}
                              className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 p-1 sm:p-2"
                              disabled={
                                mode === "organization" ||
                                selectedSchool !== null
                              }
                            >
                              <Trash2 className="h-3 w-3 sm:h-4 sm:w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>

                      {/* Expanded Detail Row */}
                      {isExpanded && (
                        <TableRow className="bg-gray-50 dark:bg-gray-700/30">
                          <TableCell colSpan={5} className="py-3 px-6">
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
      </>

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

      {/* Edit Dialog */}
      <Dialog
        open={!!editingClassroom}
        onOpenChange={(open) => !open && setEditingClassroom(null)}
      >
        <DialogContent
          className="bg-white"
          style={{ backgroundColor: "white" }}
        >
          <DialogHeader>
            <DialogTitle>
              {t("teacherClassrooms.dialogs.editTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("teacherClassrooms.dialogs.editDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 items-start sm:items-center gap-2 sm:gap-4">
              <label
                htmlFor="name"
                className="text-left sm:text-right text-sm font-medium"
              >
                {t("teacherClassrooms.labels.classroomName")}
              </label>
              <input
                id="name"
                value={editFormData.name}
                onChange={(e) =>
                  setEditFormData({ ...editFormData, name: e.target.value })
                }
                className="col-span-1 sm:col-span-3 px-3 py-2 border rounded-md text-sm"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 items-start gap-2 sm:gap-4">
              <label
                htmlFor="description"
                className="text-left sm:text-right text-sm font-medium"
              >
                {t("teacherClassrooms.labels.description")}
              </label>
              <textarea
                id="description"
                value={editFormData.description}
                onChange={(e) =>
                  setEditFormData({
                    ...editFormData,
                    description: e.target.value,
                  })
                }
                className="col-span-1 sm:col-span-3 px-3 py-2 border rounded-md text-sm"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 items-start sm:items-center gap-2 sm:gap-4">
              <label
                htmlFor="level"
                className="text-left sm:text-right text-sm font-medium"
              >
                {t("teacherClassrooms.labels.level")}
              </label>
              <select
                id="level"
                value={editFormData.level}
                onChange={(e) =>
                  setEditFormData({ ...editFormData, level: e.target.value })
                }
                className="col-span-1 sm:col-span-3 px-3 py-2 border rounded-md text-sm"
              >
                <option value="preA">Pre-A</option>
                <option value="A1">A1</option>
                <option value="A2">A2</option>
                <option value="B1">B1</option>
                <option value="B2">B2</option>
                <option value="C1">C1</option>
                <option value="C2">C2</option>
              </select>
            </div>
          </div>
          <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setEditingClassroom(null)}
              className="w-full sm:w-auto"
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleSaveEdit} className="w-full sm:w-auto">
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
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
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium block mb-1">
                {t("teacherClassrooms.labels.classroomName")}
              </label>
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-md text-sm"
                value={createFormData.name}
                onChange={(e) =>
                  setCreateFormData({
                    ...createFormData,
                    name: e.target.value,
                  })
                }
                placeholder={t("teacherClassrooms.placeholders.classroomName")}
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">
                {t("teacherClassrooms.labels.description")}
              </label>
              <textarea
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
            <div>
              <label className="text-sm font-medium block mb-1">
                {t("teacherClassrooms.labels.grade")}
              </label>
              <select
                className="w-full px-3 py-2 border rounded-md text-sm"
                value={createFormData.level}
                onChange={(e) =>
                  setCreateFormData({
                    ...createFormData,
                    level: e.target.value,
                  })
                }
              >
                <option value="A1">
                  {t("dialogs.createProgramDialog.custom.levels.A1")}
                </option>
                <option value="A2">
                  {t("dialogs.createProgramDialog.custom.levels.A2")}
                </option>
                <option value="B1">
                  {t("dialogs.createProgramDialog.custom.levels.B1")}
                </option>
                <option value="B2">
                  {t("dialogs.createProgramDialog.custom.levels.B2")}
                </option>
                <option value="C1">
                  {t("dialogs.createProgramDialog.custom.levels.C1")}
                </option>
                <option value="C2">
                  {t("dialogs.createProgramDialog.custom.levels.C2")}
                </option>
              </select>
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
