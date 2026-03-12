import { useState, useEffect } from "react";
import { useParams, useLocation } from "react-router-dom";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { apiClient } from "@/lib/api";
import { API_URL } from "@/config/api";
import { logError } from "@/utils/errorLogger";
import { Breadcrumb } from "@/components/organization/Breadcrumb";
import { LoadingSpinner } from "@/components/organization/LoadingSpinner";
import { ErrorMessage } from "@/components/organization/ErrorMessage";
import {
  StudentListTable,
  Student,
} from "@/components/organization/StudentListTable";
import { CreateStudentDialog } from "@/components/organization/CreateStudentDialog";
import { EditStudentDialog } from "@/components/organization/EditStudentDialog";
import { AssignClassroomDialog } from "@/components/organization/AssignClassroomDialog";
import { ImportStudentsDialog } from "@/components/organization/ImportStudentsDialog";
import { ConfirmDialog } from "@/components/organization/ConfirmDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, Plus, Search, Upload } from "lucide-react";
import { toast } from "sonner";

interface Classroom {
  id: number;
  name: string;
  student_count: number;
  is_active: boolean;
}

interface School {
  id: string;
  name: string;
  organization_id: string;
}

interface Organization {
  id: string;
  name: string;
}

export default function SchoolStudentsPage() {
  const { schoolId } = useParams<{ schoolId: string }>();
  const location = useLocation();
  const token = useTeacherAuthStore((state) => state.token);

  const [students, setStudents] = useState<Student[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [selectedTab, setSelectedTab] = useState("all");
  const [school, setSchool] = useState<School | null>(
    location.state?.school ?? null,
  );
  const [organization, setOrganization] = useState<Organization | null>(
    location.state?.organization ?? null,
  );
  const [loading, setLoading] = useState(true);
  const [isFilterLoading, setIsFilterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [showRemoveFromClassroomConfirm, setShowRemoveFromClassroomConfirm] =
    useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [pendingRemoveStudentId, setPendingRemoveStudentId] = useState<
    number | null
  >(null);
  const [pendingRemoveFromClassroom, setPendingRemoveFromClassroom] = useState<{
    studentId: number;
    classroomId: number;
  } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (schoolId && token) {
      fetchSchool();
      fetchClassrooms();
    }
  }, [schoolId, token]);

  const fetchSchool = async () => {
    if (!schoolId) return;

    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/schools/${schoolId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setSchool(data);
        // 確保立即獲取組織信息
        if (data.organization_id) {
          await fetchOrganization(data.organization_id);
        }
        await fetchStudents();
      } else {
        setError(`載入學校失敗：${response.status}`);
      }
    } catch (error) {
      logError("Failed to fetch school", error, { schoolId });
      setError("網路連線錯誤");
    } finally {
      setLoading(false);
    }
  };

  const fetchOrganization = async (orgId: string) => {
    if (!orgId) return;

    try {
      const response = await fetch(`${API_URL}/api/organizations/${orgId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setOrganization(data);
      } else {
        logError(
          "Failed to fetch organization",
          new Error(response.statusText),
          { orgId },
        );
      }
    } catch (error) {
      logError("Failed to fetch organization", error, { orgId });
    }
  };

  const fetchClassrooms = async () => {
    if (!schoolId) return;
    try {
      const response = await fetch(
        `${API_URL}/api/schools/${schoolId}/classrooms`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (response.ok) {
        const data = await response.json();
        setClassrooms(data.filter((c: Classroom) => c.is_active));
      }
    } catch (error) {
      logError("Failed to fetch classrooms", error, { schoolId });
    }
  };

  const fetchStudents = async () => {
    if (!schoolId) return;

    try {
      setError(null);
      setIsFilterLoading(true);

      const params: {
        search?: string;
        classroom_id?: number;
        unassigned?: boolean;
        limit?: number;
      } = { limit: 200 };

      if (searchTerm) {
        // 有搜尋詞時跨班搜尋，不帶 classroom 限制
        params.search = searchTerm;
      } else if (selectedTab === "unassigned") {
        params.unassigned = true;
      } else if (selectedTab !== "all") {
        const id = Number(selectedTab);
        if (!Number.isNaN(id)) {
          params.classroom_id = id;
        }
      }

      const data = (await apiClient.getSchoolStudents(
        schoolId,
        params,
      )) as Student[];
      setStudents(data);
    } catch (error) {
      logError("Failed to fetch students", error, { schoolId });
      setError("載入學生列表失敗");
    } finally {
      setIsFilterLoading(false);
    }
  };

  useEffect(() => {
    if (schoolId) {
      const debounceTimer = setTimeout(() => {
        fetchStudents();
      }, 300);

      return () => clearTimeout(debounceTimer);
    }
  }, [searchTerm, selectedTab, schoolId]);

  const handleCreateSuccess = async () => {
    await fetchStudents();
  };

  const handleEdit = (student: Student) => {
    setSelectedStudent(student);
    setShowEditDialog(true);
  };

  const handleAssignClassroom = (student: Student) => {
    setSelectedStudent(student);
    setShowAssignDialog(true);
  };

  const handleRemove = (studentId: number) => {
    setPendingRemoveStudentId(studentId);
    setShowRemoveConfirm(true);
  };

  const confirmRemove = async () => {
    if (!schoolId || !pendingRemoveStudentId) return;

    try {
      await apiClient.removeStudentFromSchool(schoolId, pendingRemoveStudentId);
      toast.success("學生已從學校移除");
      fetchStudents();
    } catch (error) {
      logError("Failed to remove student from school", error, {
        schoolId,
        studentId: pendingRemoveStudentId,
      });
      toast.error("移除學生失敗，請稍後再試");
    } finally {
      setPendingRemoveStudentId(null);
    }
  };

  const handleRemoveFromClassroom = (
    studentId: number,
    classroomId: number,
  ) => {
    setPendingRemoveFromClassroom({ studentId, classroomId });
    setShowRemoveFromClassroomConfirm(true);
  };

  const confirmRemoveFromClassroom = async () => {
    if (!schoolId || !pendingRemoveFromClassroom) return;

    const { studentId, classroomId } = pendingRemoveFromClassroom;

    try {
      await apiClient.removeStudentFromClassroom(
        schoolId,
        studentId,
        classroomId,
      );
      toast.success("學生已從班級移除");
      fetchStudents();
    } catch (error) {
      logError("Failed to remove student from classroom", error, {
        schoolId,
        studentId,
        classroomId,
      });
      toast.error("移除失敗，請稍後再試");
    } finally {
      setPendingRemoveFromClassroom(null);
    }
  };

  if (loading && !students.length) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: "組織管理" },
          ...(organization
            ? [
                {
                  label: organization.name,
                  href: `/organization/${organization.id}`,
                },
              ]
            : school?.organization_id
              ? [
                  {
                    label: "...",
                    href: `/organization/${school.organization_id}`,
                  },
                ]
              : []),
          ...(school
            ? [
                {
                  label: school.name,
                  href: `/organization/schools/${school.id}`,
                },
              ]
            : []),
          { label: "學生管理" },
        ]}
      />

      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Users className="h-6 w-6 text-blue-600" />
              <CardTitle>
                {school?.name ? `${school.name} 的學生名冊` : "學生管理"}
              </CardTitle>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowImportDialog(true)}
              >
                <Upload className="h-4 w-4 mr-2" />
                批量匯入
              </Button>
              <Button onClick={() => setShowCreateDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                建立學生
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Classroom Selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 whitespace-nowrap">
              選擇班級
            </span>
            <Select
              value={selectedTab}
              onValueChange={setSelectedTab}
              disabled={!!searchTerm}
            >
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="選擇班級" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部學生</SelectItem>
                <SelectItem value="unassigned">未分配</SelectItem>
                {classrooms.map((classroom) => (
                  <SelectItem key={classroom.id} value={String(classroom.id)}>
                    {classroom.name}（{classroom.student_count}）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Search */}
          <div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="搜尋學生（姓名、學號、Email）"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            {searchTerm && (
              <p className="text-xs text-blue-500 mt-1 ml-1">
                正在搜尋全校學生
              </p>
            )}
          </div>

          {/* Error Message */}
          {error && <ErrorMessage message={error} />}

          {/* Student List */}
          {isFilterLoading ? (
            <LoadingSpinner />
          ) : (
            <StudentListTable
              students={students}
              onEdit={handleEdit}
              onAssignClassroom={handleAssignClassroom}
              onRemove={handleRemove}
              onRemoveFromClassroom={handleRemoveFromClassroom}
            />
          )}
        </CardContent>
      </Card>

      {/* Create Student Dialog */}
      <CreateStudentDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        schoolId={schoolId || ""}
        onSuccess={handleCreateSuccess}
      />

      {/* Edit Student Dialog */}
      {selectedStudent && schoolId && (
        <EditStudentDialog
          open={showEditDialog}
          onOpenChange={setShowEditDialog}
          student={selectedStudent}
          schoolId={schoolId}
          onSuccess={handleCreateSuccess}
        />
      )}

      {/* Assign Classroom Dialog */}
      {selectedStudent && schoolId && (
        <AssignClassroomDialog
          open={showAssignDialog}
          onOpenChange={setShowAssignDialog}
          student={selectedStudent}
          schoolId={schoolId}
          onSuccess={handleCreateSuccess}
        />
      )}

      {/* Import Students Dialog */}
      {schoolId && (
        <ImportStudentsDialog
          open={showImportDialog}
          onOpenChange={setShowImportDialog}
          schoolId={schoolId}
          onSuccess={handleCreateSuccess}
        />
      )}

      {/* Remove Student Confirmation Dialog */}
      <ConfirmDialog
        open={showRemoveConfirm}
        onOpenChange={setShowRemoveConfirm}
        title="移除學生"
        description="確定要將此學生從學校移除嗎？"
        confirmText="確定移除"
        cancelText="取消"
        variant="destructive"
        onConfirm={confirmRemove}
      />

      {/* Remove From Classroom Confirmation Dialog */}
      {pendingRemoveFromClassroom && (
        <ConfirmDialog
          open={showRemoveFromClassroomConfirm}
          onOpenChange={setShowRemoveFromClassroomConfirm}
          title="從班級移除學生"
          description={`確定要將 ${
            students.find((s) => s.id === pendingRemoveFromClassroom.studentId)
              ?.name || "此學生"
          } 從 ${
            students
              .find((s) => s.id === pendingRemoveFromClassroom.studentId)
              ?.classrooms?.find(
                (c) => c.id === pendingRemoveFromClassroom.classroomId,
              )?.name || "此班級"
          } 移除嗎？`}
          confirmText="確定移除"
          cancelText="取消"
          variant="default"
          onConfirm={confirmRemoveFromClassroom}
        />
      )}
    </div>
  );
}
