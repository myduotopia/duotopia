import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import { toast } from "sonner";
import {
  BookOpen,
  Clock,
  Calendar,
  CheckCircle,
  AlertCircle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Mic,
  Shuffle,
  MousePointerClick,
  Volume2,
  ArrowUpDown,
} from "lucide-react";
import { StudentAssignmentCard, AssignmentStatusEnum } from "@/types";
import { useTranslation } from "react-i18next";

// Practice mode icon mapping
const PRACTICE_MODE_ICONS: Record<string, React.ReactNode> = {
  reading: <Mic className="h-7 w-7 sm:h-8 sm:w-8" />,
  rearrangement: <Shuffle className="h-7 w-7 sm:h-8 sm:w-8" />,
  word_selection: <MousePointerClick className="h-7 w-7 sm:h-8 sm:w-8" />,
  word_reading: <Volume2 className="h-7 w-7 sm:h-8 sm:w-8" />,
};

// Score category colors
const SCORE_CATEGORY_COLORS: Record<string, string> = {
  speaking: "bg-orange-100 text-orange-700 border-orange-200",
  listening: "bg-purple-100 text-purple-700 border-purple-200",
  writing: "bg-blue-100 text-blue-700 border-blue-200",
  vocabulary: "bg-emerald-100 text-emerald-700 border-emerald-200",
  reading: "bg-pink-100 text-pink-700 border-pink-200",
};

// Practice mode background colors for left icon area (crayon style)
const PRACTICE_MODE_BG: Record<string, string> = {
  reading:
    "crayon-texture bg-gradient-to-b from-orange-100 to-orange-200 text-orange-600",
  rearrangement:
    "crayon-texture bg-gradient-to-b from-blue-100 to-blue-200 text-blue-600",
  word_selection:
    "crayon-texture bg-gradient-to-b from-emerald-100 to-emerald-200 text-emerald-600",
  word_reading:
    "crayon-texture bg-gradient-to-b from-purple-100 to-purple-200 text-purple-600",
};

export default function StudentAssignmentList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token, user } = useStudentAuthStore();
  const [searchParams] = useSearchParams();

  const [assignments, setAssignments] = useState<StudentAssignmentCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "todo");
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setCurrentPage(1);
  };
  const [sortBy, setSortBy] = useState("assigned_at_desc");
  const [filterMode, setFilterMode] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 8;
  const [stats, setStats] = useState({
    totalAssignments: 0,
    todo: 0,
    submitted: 0,
    graded: 0,
    returned: 0,
    resubmitted: 0,
  });

  const loadAssignments = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      const apiUrl = import.meta.env.VITE_API_URL || "";

      const params = new URLSearchParams({ sort_by: sortBy });
      if (filterMode) {
        params.set("practice_mode", filterMode);
      }

      const response = await fetch(
        `${apiUrl}/api/students/assignments?${params}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `HTTP error! status: ${response.status}, body: ${errorText}`,
        );
      }

      const data = await response.json();

      interface AssignmentData {
        id: number;
        title: string;
        status?: string;
        due_date?: string;
        assigned_at?: string;
        submitted_at?: string;
        score?: number;
        feedback?: string;
        classroom_id: number;
        content_type?: string;
        practice_mode?: string;
        score_category?: string;
        content_count?: number;
      }

      const assignmentCards: StudentAssignmentCard[] = data.map(
        (a: AssignmentData) => ({
          id: a.id,
          title: a.title,
          status: a.status || "NOT_STARTED",
          due_date: a.due_date,
          score: a.score,
          content_type: a.content_type,
          practice_mode: a.practice_mode,
          score_category: a.score_category,
          content_count: a.content_count || 0,
          completed_count:
            a.status === "GRADED" || a.status === "SUBMITTED"
              ? a.content_count || 0
              : 0,
          progress_percentage: 0,
        }),
      );

      setAssignments(assignmentCards);

      // Calculate stats
      const todo = assignmentCards.filter(
        (a) => a.status === "NOT_STARTED" || a.status === "IN_PROGRESS",
      ).length;
      const submitted = assignmentCards.filter(
        (a) => a.status === "SUBMITTED",
      ).length;
      const graded = assignmentCards.filter(
        (a) => a.status === "GRADED",
      ).length;
      const returned = assignmentCards.filter(
        (a) => a.status === "RETURNED",
      ).length;
      const resubmitted = assignmentCards.filter(
        (a) => a.status === "RESUBMITTED",
      ).length;

      setStats({
        totalAssignments: assignmentCards.length,
        todo,
        submitted,
        graded,
        returned,
        resubmitted,
      });
    } catch (error) {
      console.error("Failed to load assignments:", error);
      toast.error(t("studentAssignmentList.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [token, sortBy, filterMode, t]);

  useEffect(() => {
    if (!user || !token) {
      navigate("/student/login");
      return;
    }
    loadAssignments();
  }, [user, token, navigate, loadAssignments]);

  const getStatusDisplay = (status: AssignmentStatusEnum) => {
    switch (status) {
      case "NOT_STARTED":
      case "IN_PROGRESS":
        return {
          text: t("studentAssignmentList.status.inProgress"),
          color: "bg-blue-100 text-blue-700 border-blue-200",
        };
      case "SUBMITTED":
        return {
          text: t("studentAssignmentList.status.submitted"),
          color: "bg-yellow-100 text-yellow-700 border-yellow-200",
        };
      case "GRADED":
        return {
          text: t("studentAssignmentList.status.graded"),
          color: "bg-green-100 text-green-700 border-green-200",
        };
      case "RETURNED":
        return {
          text: t("studentAssignmentList.status.returned"),
          color: "bg-orange-100 text-orange-700 border-orange-200",
        };
      case "RESUBMITTED":
        return {
          text: t("studentAssignmentList.status.resubmitted"),
          color: "bg-purple-100 text-purple-700 border-purple-200",
        };
      default:
        return { text: status, color: "bg-gray-100 text-gray-700" };
    }
  };

  const formatDueDate = (dueDate?: string) => {
    if (!dueDate) return null;

    const due = new Date(dueDate);
    const now = new Date();
    const diffTime = due.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return {
        text: t("studentAssignmentList.dueDate.overdue", {
          days: Math.abs(diffDays),
        }),
        isOverdue: true,
      };
    } else if (diffDays === 0) {
      return {
        text: t("studentAssignmentList.dueDate.today"),
        isOverdue: false,
      };
    } else if (diffDays <= 3) {
      return {
        text: t("studentAssignmentList.dueDate.remaining", { days: diffDays }),
        isOverdue: false,
      };
    } else {
      return { text: due.toLocaleDateString("zh-TW"), isOverdue: false };
    }
  };

  const handleStartAssignment = (assignmentId: number) => {
    navigate(`/student/assignment/${assignmentId}/activity`);
  };

  const getActionButton = (assignment: StudentAssignmentCard) => {
    const canStart =
      assignment.status === "NOT_STARTED" ||
      assignment.status === "IN_PROGRESS";

    // Issue #460: Show "Practice" button for GRADED word_selection instead of hiding
    const isGradedWordSelection =
      assignment.status === "GRADED" &&
      assignment.practice_mode === "word_selection";

    const buttonText = (() => {
      if (isGradedWordSelection) {
        return t("studentAssignmentList.buttons.practice") || "Practice";
      }
      switch (assignment.status) {
        case "NOT_STARTED":
          return t("studentAssignmentList.buttons.start");
        case "IN_PROGRESS":
          return t("studentAssignmentList.buttons.continue");
        case "SUBMITTED":
          return t("studentAssignmentList.buttons.view");
        case "GRADED":
          return t("studentAssignmentList.buttons.viewResults");
        case "RETURNED":
          return t("studentAssignmentList.buttons.resubmit");
        case "RESUBMITTED":
          return t("studentAssignmentList.buttons.view");
        default:
          return t("studentAssignmentList.buttons.start");
      }
    })();

    return (
      <Button
        onClick={() => handleStartAssignment(assignment.id)}
        disabled={
          !canStart &&
          assignment.status !== "GRADED" &&
          assignment.status !== "SUBMITTED" &&
          assignment.status !== "RETURNED" &&
          assignment.status !== "RESUBMITTED"
        }
        size="sm"
        className={`crayon-texture text-xs sm:text-sm font-medium ${
          canStart || assignment.status === "RETURNED"
            ? "bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white"
            : "bg-gradient-to-r from-gray-100 to-gray-200 hover:from-gray-200 hover:to-gray-300 text-gray-700"
        }`}
        data-testid="assignment-action-button"
      >
        {buttonText}
        {(canStart || assignment.status === "RETURNED") && (
          <ChevronRight className="ml-1 h-3.5 w-3.5" />
        )}
      </Button>
    );
  };

  // --- New horizontal card design ---
  const renderAssignmentCard = (assignment: StudentAssignmentCard) => {
    const statusDisplay = getStatusDisplay(assignment.status);
    const dueDateInfo = formatDueDate(assignment.due_date);
    const practiceMode = assignment.practice_mode || "reading";
    const scoreCategory = assignment.score_category;
    const modeIcon = PRACTICE_MODE_ICONS[practiceMode] || (
      <BookOpen className="h-5 w-5" />
    );
    const modeBg = PRACTICE_MODE_BG[practiceMode] || "bg-gray-50 text-gray-600";
    const categoryColor = scoreCategory
      ? SCORE_CATEGORY_COLORS[scoreCategory] || "bg-gray-100 text-gray-600"
      : null;

    return (
      <Card
        key={assignment.id}
        className="hover:shadow-md transition-all duration-200 border-gray-200"
        data-testid="assignment-card"
      >
        <CardContent className="p-0">
          <div className="flex items-stretch">
            {/* Left: Practice mode icon */}
            <div
              className={`flex items-center justify-center w-16 sm:w-20 flex-shrink-0 rounded-l-lg ${modeBg}`}
            >
              {modeIcon}
            </div>

            {/* Right: Content */}
            <div className="flex-1 p-3 sm:p-4 min-w-0">
              {/* Top row: Badges */}
              <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 flex-wrap">
                <Badge
                  variant="outline"
                  className={`${statusDisplay.color} text-[10px] sm:text-xs px-1.5 sm:px-2 py-0 sm:py-0.5 border`}
                >
                  {statusDisplay.text}
                </Badge>
                {categoryColor && (
                  <Badge
                    variant="outline"
                    className={`${categoryColor} text-[10px] sm:text-xs px-1.5 sm:px-2 py-0 sm:py-0.5 border`}
                  >
                    {t(`studentAssignmentList.scoreCategory.${scoreCategory}`)}
                  </Badge>
                )}
              </div>

              {/* Title */}
              <h3 className="text-sm sm:text-base font-semibold text-gray-900 leading-snug truncate">
                {assignment.title}
              </h3>

              {/* Practice mode label */}
              <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5">
                {t(`studentAssignmentList.practiceMode.${practiceMode}`)}
              </p>

              {/* Bottom row: due date + score + action */}
              <div className="flex items-center justify-between mt-2 gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Due date / Overdue */}
                  {dueDateInfo && (
                    <span
                      className={`flex items-center gap-1 text-[10px] sm:text-xs font-medium whitespace-nowrap ${
                        dueDateInfo.isOverdue ? "text-red-600" : "text-gray-500"
                      }`}
                    >
                      <Calendar className="h-3 w-3 flex-shrink-0" />
                      {dueDateInfo.text}
                    </span>
                  )}

                  {/* Score */}
                  {assignment.score != null &&
                    assignment.status === "GRADED" && (
                      <span className="flex items-center gap-1 text-[10px] sm:text-xs font-medium text-green-600 whitespace-nowrap">
                        <BarChart3 className="h-3 w-3 flex-shrink-0" />
                        {assignment.practice_mode === "word_selection"
                          ? t("studentAssignmentList.proficiency.label", {
                              proficiency: assignment.score.toFixed(1),
                            })
                          : t("studentAssignmentList.score.label", {
                              score: assignment.score.toFixed(1),
                            })}
                      </span>
                    )}
                </div>

                {/* Action button */}
                {getActionButton(assignment)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const filterAssignments = (statusFilter: string) => {
    switch (statusFilter) {
      case "todo":
        return assignments.filter(
          (a) => a.status === "NOT_STARTED" || a.status === "IN_PROGRESS",
        );
      case "submitted":
        return assignments.filter((a) => a.status === "SUBMITTED");
      case "graded":
        return assignments.filter((a) => a.status === "GRADED");
      case "returned":
        return assignments.filter((a) => a.status === "RETURNED");
      case "resubmitted":
        return assignments.filter((a) => a.status === "RESUBMITTED");
      default:
        return assignments;
    }
  };

  const renderEmptyState = (tab: string) => {
    const iconMap: Record<string, React.ReactNode> = {
      todo: <Clock className="h-12 w-12 text-gray-300 mx-auto mb-3" />,
      submitted: (
        <CheckCircle className="h-12 w-12 text-gray-300 mx-auto mb-3" />
      ),
      graded: <BarChart3 className="h-12 w-12 text-gray-300 mx-auto mb-3" />,
      returned: (
        <AlertCircle className="h-12 w-12 text-gray-300 mx-auto mb-3" />
      ),
      resubmitted: (
        <CheckCircle className="h-12 w-12 text-gray-300 mx-auto mb-3" />
      ),
    };

    return (
      <div className="text-center py-12">
        {iconMap[tab]}
        <h3 className="text-base font-medium text-gray-500 mb-1">
          {t(`studentAssignmentList.emptyStates.${tab}.title`)}
        </h3>
        <p className="text-sm text-gray-400">
          {t(`studentAssignmentList.emptyStates.${tab}.description`)}
        </p>
      </div>
    );
  };

  const renderTabContent = (tab: string) => {
    const filtered = filterAssignments(tab);
    if (filtered.length === 0) return renderEmptyState(tab);

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const safeCurrentPage = Math.min(currentPage, totalPages);
    const startIdx = (safeCurrentPage - 1) * PAGE_SIZE;
    const paged = filtered.slice(startIdx, startIdx + PAGE_SIZE);

    return (
      <>
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3 sm:gap-4">
          {paged.map(renderAssignmentCard)}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-6">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safeCurrentPage <= 1}
              className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label={t(
                "studentAssignmentList.pagination.previous",
                "Previous page",
              )}
            >
              <ChevronLeft className="h-5 w-5 text-gray-600" />
            </button>
            <span className="text-sm text-gray-700 font-medium">
              {t("studentAssignmentList.pagination.label", {
                current: safeCurrentPage,
                total: totalPages,
              })}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safeCurrentPage >= totalPages}
              className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label={t(
                "studentAssignmentList.pagination.next",
                "Next page",
              )}
            >
              <ChevronRight className="h-5 w-5 text-gray-600" />
            </button>
          </div>
        )}
      </>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">
            {t("studentAssignmentList.loading")}
          </p>
        </div>
      </div>
    );
  }

  const practiceModes = [
    "reading",
    "rearrangement",
    "word_selection",
    "word_reading",
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Assignment Flow Status — full width */}
      <div className="mx-auto mb-6">
        <Card className="overflow-visible">
          <CardContent className="p-4 sm:p-6 overflow-visible">
            <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto pb-2 pt-2 justify-start sm:justify-center flex-nowrap">
              {/* Flow status buttons */}
              {(
                [
                  {
                    key: "todo",
                    icon: (
                      <Clock className="h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6" />
                    ),
                    count: stats.todo,
                    activeColor: "bg-blue-600 border-blue-600 text-white",
                    inactiveColor: "bg-white border-gray-300 text-blue-600",
                    badgeColor: "bg-red-500",
                  },
                  {
                    key: "submitted",
                    icon: (
                      <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6" />
                    ),
                    count: stats.submitted,
                    activeColor: "bg-yellow-600 border-yellow-600 text-white",
                    inactiveColor: "bg-white border-gray-300 text-yellow-600",
                    badgeColor: "bg-red-500",
                  },
                  {
                    key: "returned",
                    icon: (
                      <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6" />
                    ),
                    count: stats.returned,
                    activeColor: "bg-orange-600 border-orange-600 text-white",
                    inactiveColor: "bg-white border-gray-300 text-orange-600",
                    badgeColor: "bg-orange-500",
                  },
                  {
                    key: "resubmitted",
                    icon: (
                      <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6" />
                    ),
                    count: stats.resubmitted,
                    activeColor: "bg-purple-600 border-purple-600 text-white",
                    inactiveColor: "bg-white border-gray-300 text-purple-600",
                    badgeColor: "bg-purple-500",
                  },
                  {
                    key: "graded",
                    icon: (
                      <BarChart3 className="h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6" />
                    ),
                    count: stats.graded,
                    activeColor: "bg-green-600 border-green-600 text-white",
                    inactiveColor: "bg-white border-gray-300 text-green-600",
                    badgeColor: "bg-green-500",
                  },
                ] as const
              ).map((item, idx, arr) => (
                <div key={item.key} className="flex items-center">
                  <button
                    onClick={() => handleTabChange(item.key)}
                    className={`flex flex-col items-center min-w-[60px] sm:min-w-[80px] transition-all ${
                      activeTab === item.key
                        ? "scale-105"
                        : "opacity-70 hover:opacity-100"
                    }`}
                  >
                    <div className="relative">
                      <div
                        className={`w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center border-2 sm:border-3 ${
                          activeTab === item.key
                            ? item.activeColor
                            : item.inactiveColor
                        }`}
                      >
                        {item.icon}
                      </div>
                      {item.count > 0 && (
                        <div
                          className={`absolute -top-1 -right-1 ${item.badgeColor} text-white text-[10px] sm:text-xs rounded-full w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center font-bold z-10`}
                        >
                          {item.count}
                        </div>
                      )}
                    </div>
                    <span
                      className={`mt-0.5 sm:mt-1 text-[10px] sm:text-xs md:text-sm font-medium ${
                        activeTab === item.key
                          ? "text-gray-900"
                          : "text-gray-600"
                      }`}
                    >
                      {t(`studentAssignmentList.flowStatus.${item.key}`)}
                    </span>
                  </button>
                  {idx < arr.length - 1 && (
                    <ArrowRight className="text-gray-400 mx-0.5 sm:mx-1 flex-shrink-0 h-3 w-3 sm:h-4 sm:w-4" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cards area — same width as flow status */}
      <div className="mx-auto">
        {/* Sort + Filter controls */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
          {/* Sort dropdown */}
          <div className="flex items-center gap-2">
            <ArrowUpDown className="h-4 w-4 text-gray-500" />
            <Select
              value={sortBy}
              onValueChange={(v) => {
                setSortBy(v);
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="w-[200px] h-8 text-xs sm:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="due_date_asc">
                  {t("studentAssignmentList.sort.due_date_asc")}
                </SelectItem>
                <SelectItem value="due_date_desc">
                  {t("studentAssignmentList.sort.due_date_desc")}
                </SelectItem>
                <SelectItem value="assigned_at_desc">
                  {t("studentAssignmentList.sort.assigned_at_desc")}
                </SelectItem>
                <SelectItem value="status">
                  {t("studentAssignmentList.sort.status")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Practice mode filter */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              variant={filterMode === null ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs px-2.5"
              onClick={() => {
                setFilterMode(null);
                setCurrentPage(1);
              }}
            >
              {t("studentAssignmentList.practiceMode.all")}
            </Button>
            {practiceModes.map((mode) => (
              <Button
                key={mode}
                variant={filterMode === mode ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={() => {
                  setFilterMode(filterMode === mode ? null : mode);
                  setCurrentPage(1);
                }}
              >
                {t(`studentAssignmentList.practiceMode.${mode}`)}
              </Button>
            ))}
          </div>
        </div>

        {/* Assignment Lists by Status */}
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="space-y-4"
        >
          <TabsList className="hidden">
            <TabsTrigger value="todo" />
            <TabsTrigger value="submitted" />
            <TabsTrigger value="returned" />
            <TabsTrigger value="resubmitted" />
            <TabsTrigger value="graded" />
          </TabsList>

          <TabsContent value="todo">{renderTabContent("todo")}</TabsContent>
          <TabsContent value="submitted">
            {renderTabContent("submitted")}
          </TabsContent>
          <TabsContent value="returned">
            {renderTabContent("returned")}
          </TabsContent>
          <TabsContent value="resubmitted">
            {renderTabContent("resubmitted")}
          </TabsContent>
          <TabsContent value="graded">{renderTabContent("graded")}</TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
