/**
 * AssignmentManagementPage - 作業管理頁面
 *
 * 跨班級的作業總覽，包含一般作業和即刻練習。
 * 支援篩選：班級、類型（一般/即刻練習）、練習模式、日期。
 * 管理操作：查看詳情、封存/取消封存、刪除。
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ClipboardList,
  Search,
  Archive,
  ArchiveRestore,
  Trash2,
  MoreHorizontal,
  Eye,
  Zap,
  RefreshCw,
  X,
  Loader2,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";

interface Assignment {
  id: number;
  title: string;
  description?: string;
  classroom_id?: number;
  classroom_name?: string;
  is_instant_practice: boolean;
  content_count: number;
  student_count: number;
  due_date?: string;
  start_date?: string;
  created_at?: string;
  completion_rate: number;
  status_distribution: Record<string, number>;
  content_type?: string;
  practice_mode?: string;
  answer_mode?: string;
  is_archived: boolean;
  archived_at?: string;
}

interface Classroom {
  id: number;
  name: string;
}

export default function AssignmentManagementPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Data
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [archivedAssignments, setArchivedAssignments] = useState<Assignment[]>(
    [],
  );
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);

  // View toggle
  const [showArchived, setShowArchived] = useState(false);

  // Filters
  const [filterClassroom, setFilterClassroom] = useState<string>("");
  const [filterType, setFilterType] = useState<string>(""); // "" | "regular" | "instant"
  const [filterPracticeMode, setFilterPracticeMode] = useState<string>("");
  const [filterKeyword, setFilterKeyword] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    try {
      const [activeRes, archivedRes] = await Promise.all([
        apiClient.get<Assignment[]>("/api/teachers/assignments/"),
        apiClient.get<Assignment[]>(
          "/api/teachers/assignments/?is_archived=true",
        ),
      ]);
      setAssignments(activeRes);
      setArchivedAssignments(archivedRes);
    } catch (error) {
      console.error("Failed to fetch assignments:", error);
      toast.error(t("assignmentManagement.fetchError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const fetchClassrooms = useCallback(async () => {
    try {
      const res = await apiClient.get<Classroom[]>("/api/classrooms/");
      setClassrooms(res);
    } catch {
      // Non-critical, silently fail
    }
  }, []);

  useEffect(() => {
    fetchAssignments();
    fetchClassrooms();
  }, [fetchAssignments, fetchClassrooms]);

  // Derive unique classrooms from assignments for filter
  const classroomOptions = useMemo(() => {
    const all = [...assignments, ...archivedAssignments];
    const map = new Map<number, string>();
    for (const a of all) {
      if (a.classroom_id && a.classroom_name) {
        map.set(a.classroom_id, a.classroom_name);
      }
    }
    // Merge with fetched classrooms
    for (const c of classrooms) {
      if (!map.has(c.id)) map.set(c.id, c.name);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [assignments, archivedAssignments, classrooms]);

  // Filter logic
  const filteredAssignments = useMemo(() => {
    const source = showArchived ? archivedAssignments : assignments;
    return source.filter((a) => {
      if (filterClassroom) {
        if (filterClassroom === "none") {
          if (a.classroom_id) return false;
        } else if (a.classroom_id !== Number(filterClassroom)) {
          return false;
        }
      }
      if (filterType === "regular" && a.is_instant_practice) return false;
      if (filterType === "instant" && !a.is_instant_practice) return false;
      if (
        filterPracticeMode &&
        a.practice_mode !== filterPracticeMode
      )
        return false;
      if (
        filterKeyword &&
        !a.title.toLowerCase().includes(filterKeyword.toLowerCase())
      )
        return false;
      if (filterDateFrom && a.created_at) {
        if (a.created_at.slice(0, 10) < filterDateFrom) return false;
      }
      if (filterDateTo && a.created_at) {
        if (a.created_at.slice(0, 10) > filterDateTo) return false;
      }
      return true;
    });
  }, [
    showArchived,
    assignments,
    archivedAssignments,
    filterClassroom,
    filterType,
    filterPracticeMode,
    filterKeyword,
    filterDateFrom,
    filterDateTo,
  ]);

  const hasActiveFilters =
    filterClassroom ||
    filterType ||
    filterPracticeMode ||
    filterKeyword ||
    filterDateFrom ||
    filterDateTo;

  const clearFilters = () => {
    setFilterClassroom("");
    setFilterType("");
    setFilterPracticeMode("");
    setFilterKeyword("");
    setFilterDateFrom("");
    setFilterDateTo("");
  };

  // Actions
  const handleArchive = async (assignment: Assignment) => {
    if (
      !confirm(
        t("assignmentManagement.confirm.archiveDescription", {
          title: assignment.title,
        }),
      )
    )
      return;
    try {
      await apiClient.patch(
        `/api/teachers/assignments/${assignment.id}/archive`,
      );
      toast.success(t("assignmentManagement.archiveSuccess"));
      fetchAssignments();
    } catch {
      toast.error(t("assignmentManagement.archiveError"));
    }
  };

  const handleUnarchive = async (assignment: Assignment) => {
    if (
      !confirm(
        t("assignmentManagement.confirm.unarchiveDescription", {
          title: assignment.title,
        }),
      )
    )
      return;
    try {
      await apiClient.patch(
        `/api/teachers/assignments/${assignment.id}/unarchive`,
      );
      toast.success(t("assignmentManagement.unarchiveSuccess"));
      fetchAssignments();
    } catch {
      toast.error(t("assignmentManagement.unarchiveError"));
    }
  };

  const handleDelete = async (assignment: Assignment) => {
    if (
      !confirm(
        t("assignmentManagement.confirm.deleteDescription", {
          title: assignment.title,
        }),
      )
    )
      return;
    try {
      await apiClient.delete(`/api/teachers/assignments/${assignment.id}`);
      toast.success(t("assignmentManagement.deleteSuccess"));
      fetchAssignments();
    } catch {
      toast.error(t("assignmentManagement.deleteError"));
    }
  };

  const handleViewDetails = (assignment: Assignment) => {
    if (assignment.classroom_id) {
      navigate(
        `/teacher/classroom/${assignment.classroom_id}/assignment/${assignment.id}/preview`,
      );
    } else {
      navigate(`/teacher/assignment/${assignment.id}/preview`);
    }
  };

  const getPracticeModeLabel = (mode?: string) => {
    switch (mode) {
      case "reading":
        return t("classroomDetail.contentTypes.SPEAKING");
      case "rearrangement":
        return t("classroomDetail.contentTypes.REARRANGEMENT");
      case "word_reading":
        return t("classroomDetail.contentTypes.WORD_READING");
      case "word_selection":
        return t("classroomDetail.contentTypes.WORD_SELECTION");
      default:
        return mode || "—";
    }
  };

  const getPracticeModeBadgeColor = (mode?: string) => {
    switch (mode) {
      case "reading":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
      case "rearrangement":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
      case "word_reading":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
      case "word_selection":
        return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-blue-500" />
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("assignmentManagement.title")}
          </h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchAssignments}
          disabled={loading}
        >
          <RefreshCw
            className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`}
          />
          {t("common.refresh")}
        </Button>
      </div>

      {/* Active/Archived Toggle */}
      <div className="flex">
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
            <span className="ml-1.5 text-xs">({assignments.length})</span>
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

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={filterClassroom}
          onChange={(e) => setFilterClassroom(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200"
        >
          <option value="">{t("assignmentManagement.filters.allClassrooms")}</option>
          <option value="none">{t("assignmentManagement.filters.noClassroom")}</option>
          {classroomOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200"
        >
          <option value="">{t("assignmentManagement.filters.allTypes")}</option>
          <option value="regular">{t("assignmentManagement.filters.regularOnly")}</option>
          <option value="instant">{t("assignmentManagement.filters.instantOnly")}</option>
        </select>

        <select
          value={filterPracticeMode}
          onChange={(e) => setFilterPracticeMode(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200"
        >
          <option value="">{t("classroomDetail.filters.allTypes")}</option>
          <option value="reading">
            {t("classroomDetail.contentTypes.SPEAKING")}
          </option>
          <option value="rearrangement">
            {t("classroomDetail.contentTypes.REARRANGEMENT")}
          </option>
          <option value="word_reading">
            {t("classroomDetail.contentTypes.WORD_READING")}
          </option>
          <option value="word_selection">
            {t("classroomDetail.contentTypes.WORD_SELECTION")}
          </option>
        </select>

        <div className="relative w-full md:w-[250px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder={t("classroomDetail.filters.searchPlaceholder")}
            value={filterKeyword}
            onChange={(e) => setFilterKeyword(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200"
          />
          <span className="text-gray-400 text-sm">~</span>
          <input
            type="date"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200"
          />
        </div>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-gray-500"
            onClick={clearFilters}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            {t("classroomDetail.filters.clearAll")}
          </Button>
        )}
      </div>

      {/* Assignment Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : filteredAssignments.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>{t("assignmentManagement.empty")}</p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("assignmentManagement.columns.title")}</TableHead>
                  <TableHead>{t("assignmentManagement.columns.classroom")}</TableHead>
                  <TableHead>{t("assignmentManagement.columns.type")}</TableHead>
                  <TableHead>{t("assignmentManagement.columns.mode")}</TableHead>
                  <TableHead>{t("assignmentManagement.columns.students")}</TableHead>
                  <TableHead>{t("assignmentManagement.columns.completion")}</TableHead>
                  <TableHead>{t("assignmentManagement.columns.createdAt")}</TableHead>
                  <TableHead>{t("assignmentManagement.columns.dueDate")}</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAssignments.map((assignment) => (
                  <TableRow
                    key={assignment.id}
                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    onClick={() => handleViewDetails(assignment)}
                  >
                    <TableCell className="font-medium max-w-[200px] truncate">
                      {assignment.title}
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {assignment.classroom_name || "—"}
                    </TableCell>
                    <TableCell>
                      {assignment.is_instant_practice ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                          <Zap className="h-3 w-3" />
                          {t("assignmentManagement.labels.instantPractice")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                          {t("assignmentManagement.labels.regular")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getPracticeModeBadgeColor(assignment.practice_mode)}`}
                      >
                        {getPracticeModeLabel(assignment.practice_mode)}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {assignment.is_instant_practice
                        ? "—"
                        : assignment.student_count}
                    </TableCell>
                    <TableCell>
                      {assignment.is_instant_practice ? (
                        "—"
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-500 rounded-full"
                              style={{
                                width: `${assignment.completion_rate}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs text-gray-500">
                            {assignment.completion_rate}%
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {formatDate(assignment.created_at)}
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {formatDate(assignment.due_date)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleViewDetails(assignment);
                            }}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            {t("assignmentManagement.actions.view")}
                          </DropdownMenuItem>
                          {showArchived ? (
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUnarchive(assignment);
                              }}
                            >
                              <ArchiveRestore className="h-4 w-4 mr-2" />
                              {t("assignmentManagement.actions.unarchive")}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleArchive(assignment);
                              }}
                            >
                              <Archive className="h-4 w-4 mr-2" />
                              {t("assignmentManagement.actions.archive")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(assignment);
                            }}
                            className="text-red-600 dark:text-red-400"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            {t("assignmentManagement.actions.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Card Layout */}
          <div className="md:hidden space-y-3">
            {filteredAssignments.map((assignment) => (
              <div
                key={assignment.id}
                className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-4 space-y-2 cursor-pointer"
                onClick={() => handleViewDetails(assignment)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {assignment.title}
                    </h4>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {assignment.is_instant_practice && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                          <Zap className="h-3 w-3" />
                          {t("assignmentManagement.labels.instantPractice")}
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getPracticeModeBadgeColor(assignment.practice_mode)}`}
                      >
                        {getPracticeModeLabel(assignment.practice_mode)}
                      </span>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewDetails(assignment);
                        }}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        {t("assignmentManagement.actions.view")}
                      </DropdownMenuItem>
                      {showArchived ? (
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUnarchive(assignment);
                          }}
                        >
                          <ArchiveRestore className="h-4 w-4 mr-2" />
                          {t("assignmentManagement.actions.unarchive")}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleArchive(assignment);
                          }}
                        >
                          <Archive className="h-4 w-4 mr-2" />
                          {t("assignmentManagement.actions.archive")}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(assignment);
                        }}
                        className="text-red-600 dark:text-red-400"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        {t("assignmentManagement.actions.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>
                    {assignment.classroom_name ||
                      t("assignmentManagement.labels.noClassroom")}
                  </span>
                  <span>{formatDate(assignment.created_at)}</span>
                </div>
                {!assignment.is_instant_practice && (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full"
                        style={{
                          width: `${assignment.completion_rate}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-gray-500">
                      {assignment.completion_rate}%
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

    </div>
  );
}
