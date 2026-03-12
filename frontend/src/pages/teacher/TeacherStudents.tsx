import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";
import StudentTable, { Student } from "@/components/StudentTable";
import { StudentDialogs } from "@/components/StudentDialogs";
import { ClassroomAssignDialog } from "@/components/ClassroomAssignDialog";
import { StudentImportDialog } from "@/components/StudentImportDialog";
import {
  Users,
  RefreshCw,
  Filter,
  Plus,
  UserCheck,
  UserX,
  Download,
  School,
  Trash2,
  Upload,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import { Classroom } from "@/types";

// Extended classroom interface for this page (if needed in future)
// interface ClassroomWithStudents extends Classroom {
//   students: Student[];
// }

export default function TeacherStudents() {
  const { t } = useTranslation();
  const { selectedSchool, selectedOrganization, mode } = useWorkspace();

  // 在機構學校內的老師只能查看，不能編輯或刪除學生
  const isInOrganizationSchool =
    mode === "organization" && selectedSchool !== null;
  const disableStudentActions = isInOrganizationSchool;
  const disableReason = isInOrganizationSchool ? "只能在學校後台更改" : "";
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [selectedClassroom, setSelectedClassroom] = useState<number | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [dialogType, setDialogType] = useState<
    "view" | "create" | "edit" | "delete" | null
  >(null);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);

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

      // Fetch classrooms for the dropdown (with workspace filtering)
      const classroomData = (await apiClient.getTeacherClassrooms(
        apiParams,
      )) as Classroom[];
      setClassrooms(classroomData);

      // Fetch students with workspace filtering (server-side)
      const studentsData = (await apiClient.getAllStudents(
        apiParams,
      )) as Array<{
        id: number;
        name: string;
        email: string;
        student_id?: string;
        classroom?: { id: number; name: string };
        classroom_id?: number;
      }>;

      // Define extended student API response type
      interface ExtendedStudentResponse {
        id: number;
        name: string;
        email: string;
        student_number?: string;
        classroom?: { id: number; name: string };
        classroom_id?: number;
        birthdate?: string;
        phone?: string;
        password_changed?: boolean;
        enrollment_date?: string;
        status?: "active" | "inactive" | "suspended";
        last_login?: string | null;
        classroom_name?: string;
        created_at?: string;
      }

      // Format students data
      const studentsWithDetails = studentsData.map(
        (student: ExtendedStudentResponse) => {
          return {
            id: student.id,
            name: student.name,
            email: student.email,
            student_number: student.student_number || "",
            birthdate: student.birthdate || "",
            phone: student.phone || "",
            password_changed: student.password_changed || false,
            enrollment_date: student.enrollment_date || "",
            status: student.status || ("active" as const),
            last_login: student.last_login || null,
            classroom_id: student.classroom_id,
            classroom_name:
              student.classroom_name || t("teacherStudents.filters.unassigned"),
            created_at: student.created_at,
          };
        },
      );

      setAllStudents(studentsWithDetails);
    } catch (err) {
      console.error("Fetch classrooms error:", err);
      // Don't use mock data - show real error
      setAllStudents([]);
    } finally {
      setLoading(false);
    }
  }, [mode, selectedSchool, selectedOrganization, t]);

  useEffect(() => {
    fetchClassrooms();
  }, [fetchClassrooms]);

  // 過濾並排序學生（workspace filtering 已在後端完成）
  const filteredStudents = allStudents
    .filter((student) => {
      // 班級篩選邏輯
      let matchesClassroom = true;
      if (selectedClassroom === null) {
        // 顯示所有學生
        matchesClassroom = true;
      } else if (selectedClassroom === 0) {
        // 只顯示未分配班級的學生
        matchesClassroom = !student.classroom_id;
      } else {
        // 顯示特定班級的學生
        matchesClassroom = student.classroom_id === selectedClassroom;
      }

      const matchesSearch =
        !searchTerm ||
        student.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (student.email || "").toLowerCase().includes(searchTerm.toLowerCase());
      return matchesClassroom && matchesSearch;
    })
    .sort((a, b) => {
      // 按學號排序，沒有學號的放在後面
      if (!a.student_number && !b.student_number) return 0;
      if (!a.student_number) return 1;
      if (!b.student_number) return -1;
      return a.student_number.localeCompare(b.student_number, undefined, {
        numeric: true,
      });
    });

  const handleCreateStudent = () => {
    setSelectedStudent(null);
    setDialogType("create");
  };

  const handleViewStudent = (student: Student) => {
    setSelectedStudent(student);
    setDialogType("view");
  };

  const handleEditStudent = (student: Student) => {
    setSelectedStudent(student);
    setDialogType("edit");
  };

  const handleResetPassword = async (student: Student) => {
    if (
      !confirm(
        t("teacherStudents.messages.confirmResetPassword", {
          name: student.name,
        }),
      )
    ) {
      return;
    }

    try {
      await apiClient.resetStudentPassword(student.id);
      toast.success(
        `${t("teacherStudents.messages.passwordReset", { name: student.name })}`,
      );
      // Refresh data
      fetchClassrooms();
    } catch (error) {
      console.error("Failed to reset password:", error);
      toast.error(t("teacherStudents.messages.resetPasswordFailed"));
    }
  };

  const handleSaveStudent = () => {
    // Refresh data after save
    fetchClassrooms();
  };

  const handleDeleteStudent = async (student: Student) => {
    try {
      await apiClient.deleteStudent(student.id);
      toast.success(
        `${t("teacherStudents.messages.studentDeleted", { name: student.name })}`,
      );
      // Refresh data after delete
      fetchClassrooms();
    } catch (error) {
      console.error("Failed to delete student:", error);
      toast.error(t("teacherStudents.messages.deleteStudentFailed"));
    }
  };

  const handleCloseDialog = () => {
    setSelectedStudent(null);
    setDialogType(null);
  };

  const handleSwitchToEdit = () => {
    // Switch from view to edit mode
    setDialogType("edit");
  };

  const handleExportStudents = () => {
    const headers = [
      t("teacherStudents.csvHeaders.name"),
      t("teacherStudents.csvHeaders.email"),
      t("teacherStudents.csvHeaders.studentNumber"),
      t("teacherStudents.csvHeaders.birthdate"),
      t("teacherStudents.csvHeaders.classroom"),
      t("teacherStudents.csvHeaders.passwordStatus"),
      t("teacherStudents.csvHeaders.lastLogin"),
    ];
    const rows = filteredStudents.map((student) => [
      student.name,
      student.email || "-",
      student.student_number || "-",
      student.birthdate || "-",
      student.classroom_name || t("teacherStudents.filters.unassigned"),
      student.password_changed
        ? t("teacherStudents.csvHeaders.passwordChanged")
        : t("teacherStudents.csvHeaders.defaultPassword"),
      student.last_login || t("teacherStudents.csvHeaders.neverLoggedIn"),
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `${t("teacherStudents.csvHeaders.name")}_${new Date().toISOString().split("T")[0]}.csv`,
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.success(
      `${t("teacherStudents.messages.exportSuccess", { count: filteredStudents.length })}`,
    );
  };

  const handleBulkAction = async (action: string, studentIds: number[]) => {
    // Handle selection update
    if (action === "selection") {
      setSelectedStudentIds(studentIds);
      return;
    }

    setSelectedStudentIds(studentIds);

    if (action === "assign") {
      // Show classroom selection dialog
      setShowAssignDialog(true);
    } else if (action === "delete") {
      if (
        confirm(
          t("teacherStudents.messages.confirmBulkDelete", {
            count: studentIds.length,
          }),
        )
      ) {
        try {
          for (const studentId of studentIds) {
            await apiClient.deleteStudent(studentId);
          }
          toast.success(
            `${t("teacherStudents.messages.bulkDeleteSuccess", { count: studentIds.length })}`,
          );
          fetchClassrooms();
        } catch (error) {
          console.error("Failed to delete students:", error);
          toast.error(t("teacherStudents.messages.deleteFailed"));
        }
      }
    }
  };

  if (loading) {
    return (
      <>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">{t("common.loading")}</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div>
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            {t("teacherStudents.title")}
          </h2>

          {/* Bulk Actions Bar */}
          {selectedStudentIds.length > 0 && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md">
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                {t("teacherStudents.messages.selectedCount", {
                  count: selectedStudentIds.length,
                })}
              </span>
              <div className="flex gap-2 w-full sm:w-auto">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleBulkAction("assign", selectedStudentIds)}
                  className="flex-1 sm:flex-none"
                >
                  <School className="h-4 w-4 mr-2" />
                  {t("teacherStudents.buttons.bulkAssign")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex-1 sm:flex-none"
                  onClick={() => handleBulkAction("delete", selectedStudentIds)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t("teacherStudents.buttons.bulkDelete")}
                </Button>
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="flex flex-col lg:flex-row gap-3">
            {/* Search & Filter Group */}
            <div className="flex flex-col sm:flex-row gap-2 flex-1">
              <input
                type="text"
                placeholder={t("teacherStudents.placeholders.search")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="px-3 py-2 border dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md text-sm flex-1 sm:max-w-xs"
              />
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <select
                  value={
                    selectedClassroom === null
                      ? ""
                      : selectedClassroom === 0
                        ? "0"
                        : selectedClassroom.toString()
                  }
                  onChange={(e) => {
                    if (e.target.value === "") {
                      setSelectedClassroom(null);
                    } else if (e.target.value === "0") {
                      setSelectedClassroom(0);
                    } else {
                      setSelectedClassroom(Number(e.target.value));
                    }
                  }}
                  className="px-3 py-2 border dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md text-sm flex-1 sm:flex-none"
                >
                  <option value="">
                    {t("teacherStudents.filters.allClassrooms")}
                  </option>
                  <option value="0">
                    {t("teacherStudents.filters.unassigned")}
                  </option>
                  {classrooms.map((classroom) => (
                    <option key={classroom.id} value={classroom.id}>
                      {classroom.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={fetchClassrooms}
                variant="outline"
                size="sm"
                className="flex-1 sm:flex-none"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">
                  {t("teacherStudents.buttons.reload")}
                </span>
                <span className="sm:hidden">
                  {t("teacherStudents.buttons.load")}
                </span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportStudents}
                className="flex-1 sm:flex-none"
                disabled={disableStudentActions}
              >
                <Download className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">
                  {t("teacherStudents.buttons.exportList")}
                </span>
                <span className="sm:hidden">
                  {t("teacherStudents.buttons.export")}
                </span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowImportDialog(true)}
                className="flex-1 sm:flex-none"
                disabled={disableStudentActions}
              >
                <Upload className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">
                  {t("teacherStudents.buttons.batchImport")}
                </span>
                <span className="sm:hidden">
                  {t("teacherStudents.buttons.import")}
                </span>
              </Button>
              <Button
                size="sm"
                onClick={handleCreateStudent}
                className="flex-1 sm:flex-none"
                disabled={disableStudentActions}
              >
                <Plus className="h-4 w-4 mr-2" />
                {t("teacherStudents.buttons.addStudent")}
              </Button>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t("teacherStudents.stats.totalStudents")}
                </p>
                <p className="text-2xl font-bold dark:text-gray-100">
                  {filteredStudents.length}
                </p>
              </div>
              <Users className="h-8 w-8 text-blue-500 dark:text-blue-400" />
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t("teacherStudents.stats.activeStudents")}
                </p>
                <p className="text-2xl font-bold dark:text-gray-100">
                  {filteredStudents.filter((s) => s.status === "active").length}
                </p>
              </div>
              <UserCheck className="h-8 w-8 text-green-500 dark:text-green-400" />
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t("teacherStudents.stats.inactive")}
                </p>
                <p className="text-2xl font-bold dark:text-gray-100">
                  {
                    filteredStudents.filter((s) => s.status === "inactive")
                      .length
                  }
                </p>
              </div>
              <UserX className="h-8 w-8 text-yellow-500 dark:text-yellow-400" />
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t("teacherStudents.stats.suspended")}
                </p>
                <p className="text-2xl font-bold dark:text-gray-100">
                  {
                    filteredStudents.filter((s) => s.status === "suspended")
                      .length
                  }
                </p>
              </div>
              <div className="h-8 w-8 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                <span className="text-red-600 dark:text-red-400 font-bold">
                  !
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Students Table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700">
          <StudentTable
            students={filteredStudents}
            showClassroom={true}
            onViewStudent={handleViewStudent}
            onEditStudent={handleEditStudent}
            onResetPassword={handleResetPassword}
            onDeleteStudent={handleDeleteStudent}
            onAddStudent={handleCreateStudent}
            onBulkAction={handleBulkAction}
            disableActions={disableStudentActions}
            disableReason={disableReason}
            emptyMessage={
              searchTerm
                ? t("teacherStudents.messages.noStudentsFound")
                : selectedClassroom
                  ? t("teacherStudents.messages.noStudentsInClassroom")
                  : t("teacherStudents.messages.noStudents")
            }
          />
        </div>
      </div>

      {/* Student Dialogs */}
      <StudentDialogs
        student={selectedStudent}
        dialogType={dialogType}
        onClose={handleCloseDialog}
        onSave={handleSaveStudent}
        onDelete={() => {}} // 保留但不使用，因為刪除現在直接在列表處理
        onSwitchToEdit={handleSwitchToEdit}
        classrooms={classrooms}
      />

      {/* Classroom Assignment Dialog */}
      <ClassroomAssignDialog
        open={showAssignDialog}
        onClose={() => setShowAssignDialog(false)}
        onConfirm={(classroomId) => {
          // Handle classroom assignment
          (async () => {
            try {
              for (const studentId of selectedStudentIds) {
                await apiClient.updateStudent(studentId, {
                  classroom_id: classroomId,
                });
              }
              const classroom = classrooms.find((c) => c.id === classroomId);
              toast.success(
                `${t("teacherStudents.messages.bulkAssignSuccess", { count: selectedStudentIds.length, classroom: classroom?.name })}`,
              );
              setSelectedStudentIds([]);
              setShowAssignDialog(false);
              fetchClassrooms();
            } catch (error) {
              console.error("Failed to assign students:", error);
              toast.error(t("teacherStudents.messages.assignFailed"));
            }
          })();
        }}
        classrooms={classrooms}
        studentCount={selectedStudentIds.length}
      />

      {/* Student Import Dialog */}
      <StudentImportDialog
        open={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        onSuccess={() => {
          fetchClassrooms();
          setShowImportDialog(false);
        }}
        classrooms={classrooms}
      />
    </>
  );
}
