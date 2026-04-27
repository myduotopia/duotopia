import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Search, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface StudentStatus {
  student_number: number;
  student_name: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "GRADED";
  submitted_at?: string;
  score?: number;
  completion_rate?: number;
  time_spent?: number;
}

interface StudentCompletionDashboardProps {
  assignmentId: number;
  classroomId?: number;
  onRefresh?: () => void;
}

export function StudentCompletionDashboard({
  assignmentId,
}: StudentCompletionDashboardProps) {
  const { t } = useTranslation();
  const [studentStatuses, setStudentStatuses] = useState<StudentStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy] = useState<"name" | "status" | "score">("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    fetchStudentStatuses();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchStudentStatuses recreated each render; only re-fetch on assignmentId change
  }, [assignmentId]);

  const fetchStudentStatuses = async () => {
    try {
      setLoading(true);
      // Mock data for now - should be replaced with actual API call
      const mockData: StudentStatus[] = [
        {
          student_number: 1,
          student_name: "Alysa",
          status: "GRADED",
          score: 95,
          completion_rate: 100,
          submitted_at: "2024-03-15T10:30:00Z",
          time_spent: 25,
        },
        {
          student_number: 2,
          student_name: "Angela",
          status: "GRADED",
          score: 88,
          completion_rate: 100,
          submitted_at: "2024-03-15T11:15:00Z",
          time_spent: 30,
        },
        {
          student_number: 3,
          student_name: "Cindy",
          status: "SUBMITTED",
          completion_rate: 100,
          submitted_at: "2024-03-16T09:00:00Z",
          time_spent: 20,
        },
        {
          student_number: 4,
          student_name: "Dennis",
          status: "IN_PROGRESS",
          completion_rate: 60,
          time_spent: 15,
        },
        {
          student_number: 5,
          student_name: "Eastre",
          status: "IN_PROGRESS",
          completion_rate: 40,
          time_spent: 10,
        },
        {
          student_number: 6,
          student_name: "Eddy",
          status: "NOT_STARTED",
          completion_rate: 0,
        },
      ];

      // In production, replace with:
      // const response = await apiClient.get(`/api/assignments/${assignmentId}/student-statuses`);
      // setStudentStatuses(response.data);

      setStudentStatuses(mockData);
    } catch (error) {
      console.error("Failed to fetch student statuses:", error);
      toast.error(t("studentCompletionDashboard.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  const filteredAndSortedStudents = studentStatuses
    .filter((student) => {
      const matchesSearch = student.student_name
        .toLowerCase()
        .includes(searchTerm.toLowerCase());
      const matchesStatus =
        statusFilter === "all" || student.status === statusFilter;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      let comparison = 0;
      if (sortBy === "name") {
        comparison = a.student_name.localeCompare(b.student_name);
      } else if (sortBy === "status") {
        comparison = a.status.localeCompare(b.status);
      } else if (sortBy === "score") {
        comparison = (a.score || 0) - (b.score || 0);
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

  const statusCounts = {
    total: studentStatuses.length,
    notStarted: studentStatuses.filter((s) => s.status === "NOT_STARTED")
      .length,
    inProgress: studentStatuses.filter((s) => s.status === "IN_PROGRESS")
      .length,
    submitted: studentStatuses.filter((s) => s.status === "SUBMITTED").length,
    graded: studentStatuses.filter((s) => s.status === "GRADED").length,
  };

  const averageScore =
    studentStatuses
      .filter((s) => s.score !== undefined)
      .reduce((sum, s) => sum + (s.score || 0), 0) /
    (studentStatuses.filter((s) => s.score !== undefined).length || 1);

  const handleGradeStudent = (student: StudentStatus) => {
    // TODO: Open grading dialog/modal
    toast.info(
      t("studentCompletionDashboard.actions.openGrading", {
        name: student.student_name,
      }),
    );
    // In production: navigate to grading page or open modal
    // window.location.href = `/teacher/grade/${assignmentId}/${student.student_number}`;
  };

  const handleViewGrade = (student: StudentStatus) => {
    toast.info(
      t("studentCompletionDashboard.actions.viewGrade", {
        name: student.student_name,
        score: student.score,
      }),
    );
    // In production: open grade details modal
  };

  const handleRemindStudent = (student: StudentStatus) => {
    toast.success(
      t("studentCompletionDashboard.actions.remindSent", {
        name: student.student_name,
      }),
    );
    // In production: call API to send reminder
    // apiClient.post(`/api/assignments/${assignmentId}/remind/${student.student_number}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Statistics */}
      <div className="grid grid-cols-5 gap-3">
        <Card className="p-3 bg-gray-50">
          <div className="text-xs text-gray-600">
            {t("studentCompletionDashboard.stats.total")}
          </div>
          <div className="text-xl font-bold">{statusCounts.total}</div>
        </Card>
        <Card className="p-3 bg-red-50">
          <div className="text-xs text-gray-600">
            {t("studentCompletionDashboard.stats.notStarted")}
          </div>
          <div className="text-xl font-bold text-red-600">
            {statusCounts.notStarted}
          </div>
        </Card>
        <Card className="p-3 bg-yellow-50">
          <div className="text-xs text-gray-600">
            {t("studentCompletionDashboard.stats.inProgress")}
          </div>
          <div className="text-xl font-bold text-yellow-600">
            {statusCounts.inProgress}
          </div>
        </Card>
        <Card className="p-3 bg-blue-50">
          <div className="text-xs text-gray-600">
            {t("studentCompletionDashboard.stats.submitted")}
          </div>
          <div className="text-xl font-bold text-blue-600">
            {statusCounts.submitted}
          </div>
        </Card>
        <Card className="p-3 bg-green-50">
          <div className="text-xs text-gray-600">
            {t("studentCompletionDashboard.stats.graded")}
          </div>
          <div className="text-xl font-bold text-green-600">
            {statusCounts.graded}
          </div>
        </Card>
      </div>

      {/* Overall Progress */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">
            {t("studentCompletionDashboard.progress.overall")}
          </span>
          <span className="text-lg font-bold text-blue-600">
            {statusCounts.total > 0
              ? Math.round(
                  ((statusCounts.submitted + statusCounts.graded) /
                    statusCounts.total) *
                    100,
                )
              : 0}
            %
          </span>
        </div>
        <Progress
          value={
            statusCounts.total > 0
              ? ((statusCounts.submitted + statusCounts.graded) /
                  statusCounts.total) *
                100
              : 0
          }
          className="h-3"
        />
        {statusCounts.graded > 0 && (
          <div className="mt-2 text-sm text-gray-600">
            {t("studentCompletionDashboard.progress.averageScore")}
            <span className="font-bold text-blue-600">
              {averageScore.toFixed(1)}{" "}
              {t("studentCompletionDashboard.progress.points")}
            </span>
          </div>
        )}
      </Card>

      {/* Filters and Search */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder={t(
              "studentCompletionDashboard.filters.searchPlaceholder",
            )}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">
            {t("studentCompletionDashboard.filters.allStatus")}
          </option>
          <option value="NOT_STARTED">
            {t("studentCompletionDashboard.filters.notStarted")}
          </option>
          <option value="IN_PROGRESS">
            {t("studentCompletionDashboard.filters.inProgress")}
          </option>
          <option value="SUBMITTED">
            {t("studentCompletionDashboard.filters.submitted")}
          </option>
          <option value="GRADED">
            {t("studentCompletionDashboard.filters.graded")}
          </option>
        </select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setSortOrder(sortOrder === "asc" ? "desc" : "asc");
          }}
        >
          {sortOrder === "asc" ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Student List Table */}
      <Card className="overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-700">
                {t("studentCompletionDashboard.table.studentName")}
              </th>
              <th className="text-center px-4 py-3 text-sm font-medium text-gray-700">
                {t("studentCompletionDashboard.table.pendingGrading")}
              </th>
              <th className="text-center px-4 py-3 text-sm font-medium text-gray-700">
                {t("studentCompletionDashboard.table.graded")}
              </th>
              <th className="text-center px-4 py-3 text-sm font-medium text-gray-700">
                {t("studentCompletionDashboard.table.pendingCorrection")}
              </th>
              <th className="text-center px-4 py-3 text-sm font-medium text-gray-700">
                {t("studentCompletionDashboard.table.pendingCompletion")}
              </th>
              <th className="text-center px-4 py-3 text-sm font-medium text-gray-700">
                {t("studentCompletionDashboard.table.completed")}
              </th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-700">
                {t("studentCompletionDashboard.table.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedStudents.map((student) => (
              <tr
                key={student.student_number}
                className="border-b hover:bg-gray-50 transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-medium text-blue-700">
                      {student.student_name.charAt(0)}
                    </div>
                    <span className="font-medium">{student.student_name}</span>
                  </div>
                </td>
                <td className="text-center px-4 py-3">
                  <span className="text-gray-600">
                    {student.status === "SUBMITTED" ? 1 : 0}
                  </span>
                </td>
                <td className="text-center px-4 py-3">
                  <span className="text-gray-600">0</span>
                </td>
                <td className="text-center px-4 py-3">
                  <span className="text-gray-600">0</span>
                </td>
                <td className="text-center px-4 py-3">
                  <span className="text-gray-600">
                    {student.status === "NOT_STARTED" ||
                    student.status === "IN_PROGRESS"
                      ? 9
                      : 0}
                  </span>
                </td>
                <td className="text-center px-4 py-3">
                  <span className="text-blue-600 font-bold">
                    {student.status === "GRADED" ? 9 : 0}
                  </span>
                </td>
                <td className="text-right px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {student.status === "SUBMITTED" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleGradeStudent(student)}
                        className="text-blue-600 hover:bg-blue-50"
                      >
                        {t("studentCompletionDashboard.buttons.grade")}
                      </Button>
                    )}
                    {student.status === "GRADED" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewGrade(student)}
                        className="text-green-600 hover:bg-green-50"
                      >
                        {t("studentCompletionDashboard.buttons.view")}
                      </Button>
                    )}
                    {(student.status === "NOT_STARTED" ||
                      student.status === "IN_PROGRESS") && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRemindStudent(student)}
                        className="text-yellow-600 hover:bg-yellow-50"
                      >
                        {t("studentCompletionDashboard.buttons.remind")}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredAndSortedStudents.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            {t("studentCompletionDashboard.empty")}
          </div>
        )}
      </Card>
    </div>
  );
}
