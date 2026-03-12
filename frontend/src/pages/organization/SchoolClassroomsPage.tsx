import { useState, useEffect } from "react";
import { useParams, useLocation } from "react-router-dom";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { API_URL } from "@/config/api";
import { apiClient } from "@/lib/api";
import { logError } from "@/utils/errorLogger";
import { Breadcrumb } from "@/components/organization/Breadcrumb";
import { LoadingSpinner } from "@/components/organization/LoadingSpinner";
import { ErrorMessage } from "@/components/organization/ErrorMessage";
import { ClassroomListTable } from "@/components/organization/ClassroomListTable";
import { CreateClassroomDialog } from "@/components/organization/CreateClassroomDialog";
import { EditClassroomDialog } from "@/components/organization/EditClassroomDialog";
import { AssignTeacherDialog } from "@/components/organization/AssignTeacherDialog";
import { ClassroomStudentsSidebar } from "@/components/organization/ClassroomStudentsSidebar";
import { ClassroomMaterialsSidebar } from "@/components/organization/ClassroomMaterialsSidebar";
import { AssignmentDialog } from "@/components/AssignmentDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GraduationCap, Plus } from "lucide-react";
import { toast } from "sonner";

interface Classroom {
  id: string;
  name: string;
  program_level: string;
  is_active: boolean;
  created_at: string;
  teacher_name: string | null;
  teacher_email: string | null;
  teacher_id?: number | null;
  student_count: number;
  assignment_count: number;
  program_count: number;
}

interface Teacher {
  id: number;
  name: string;
  email: string;
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

export default function SchoolClassroomsPage() {
  const { schoolId } = useParams<{ schoolId: string }>();
  const location = useLocation();
  const token = useTeacherAuthStore((state) => state.token);

  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [school, setSchool] = useState<School | null>(
    location.state?.school ?? null,
  );
  const [organization, setOrganization] = useState<Organization | null>(
    location.state?.organization ?? null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showStudentsSidebar, setShowStudentsSidebar] = useState(false);
  const [showMaterialsSidebar, setShowMaterialsSidebar] = useState(false);
  const [editingClassroom, setEditingClassroom] = useState<Classroom | null>(
    null,
  );
  const [assigningClassroom, setAssigningClassroom] =
    useState<Classroom | null>(null);
  const [viewingClassroom, setViewingClassroom] = useState<Classroom | null>(
    null,
  );
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  // 派發作業
  const [showAssignmentDialog, setShowAssignmentDialog] = useState(false);
  const [assignmentClassroom, setAssignmentClassroom] =
    useState<Classroom | null>(null);
  const [assignmentStudents, setAssignmentStudents] = useState<
    { id: number; name: string; student_number?: string }[]
  >([]);

  useEffect(() => {
    if (schoolId && token) {
      fetchSchool();
    }
    // Note: token is stable from store, no need to include in deps
  }, [schoolId]);

  const fetchSchool = async () => {
    try {
      const response = await fetch(`${API_URL}/api/schools/${schoolId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setSchool(data);
        fetchOrganization(data.organization_id);
        fetchClassrooms();
        fetchTeachers();
      } else {
        setError(`載入學校失敗：${response.status}`);
      }
    } catch (error) {
      logError("Failed to fetch school", error, { schoolId });
      setError("網路連線錯誤");
    }
  };

  const fetchOrganization = async (orgId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/organizations/${orgId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setOrganization(data);
      }
    } catch (error) {
      logError("Failed to fetch organization", error, { orgId });
    }
  };

  const fetchClassrooms = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `${API_URL}/api/schools/${schoolId}/classrooms`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (response.ok) {
        const data = await response.json();
        setClassrooms(data);
      } else {
        setError(`載入班級列表失敗：${response.status}`);
      }
    } catch (error) {
      logError("Failed to fetch classrooms", error, { schoolId });
      setError("網路連線錯誤");
    } finally {
      setLoading(false);
    }
  };

  const fetchTeachers = async () => {
    if (!schoolId) return;

    try {
      const response = await fetch(
        `${API_URL}/api/schools/${schoolId}/teachers`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (response.ok) {
        const data = await response.json();
        setTeachers(data);
      }
    } catch (error) {
      logError("Failed to fetch teachers", error, { schoolId });
    }
  };

  const handleEdit = (classroom: Classroom) => {
    setEditingClassroom(classroom);
    setShowEditDialog(true);
  };

  const handleAssignTeacher = (classroom: Classroom) => {
    setAssigningClassroom(classroom);
    setShowAssignDialog(true);
  };

  const handleViewStudents = (classroom: Classroom) => {
    setViewingClassroom(classroom);
    setShowStudentsSidebar(true);
  };

  const handleViewMaterials = (classroom: Classroom) => {
    setViewingClassroom(classroom);
    setShowMaterialsSidebar(true);
  };

  const handleAssignHomework = async (classroom: Classroom) => {
    try {
      // 取得班級學生列表
      const students = (await apiClient.getClassroomStudents(
        schoolId || "",
        parseInt(classroom.id),
      )) as { id: number; name: string; student_number?: string }[];
      if (!students || students.length === 0) {
        toast.error("此班級尚無學生，無法派發作業");
        return;
      }
      setAssignmentClassroom(classroom);
      setAssignmentStudents(students);
      setShowAssignmentDialog(true);
    } catch (error) {
      logError("Failed to fetch classroom students for assignment", error, {
        schoolId,
        classroomId: classroom.id,
      });
      toast.error("載入學生列表失敗");
    }
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          ...(organization
            ? [
                {
                  label: organization.name,
                  href: `/organization/${organization.id}`,
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
          { label: "班級管理" },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">班級管理</h1>
          <p className="text-gray-600 mt-2">
            {school?.name} - 管理學校內的所有班級
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          建立班級
        </Button>
      </div>

      {/* Classrooms Table */}
      <Card>
        <CardHeader>
          <CardTitle>班級列表</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingSpinner />
          ) : error ? (
            <ErrorMessage message={error} onRetry={fetchClassrooms} />
          ) : classrooms.length === 0 ? (
            <div className="text-center py-8">
              <GraduationCap className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-gray-500">尚無班級資料</p>
              <p className="text-sm text-gray-400 mt-2">
                點擊「建立班級」按鈕來建立新的班級
              </p>
            </div>
          ) : (
            <ClassroomListTable
              classrooms={classrooms}
              onEdit={handleEdit}
              onAssignTeacher={handleAssignTeacher}
              onViewStudents={handleViewStudents}
              onViewMaterials={handleViewMaterials}
              onAssignHomework={handleAssignHomework}
            />
          )}
        </CardContent>
      </Card>

      {/* Create Classroom Dialog */}
      <CreateClassroomDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        schoolId={schoolId || ""}
        schoolName={school?.name}
        onSuccess={fetchClassrooms}
      />

      {/* Edit Classroom Dialog */}
      <EditClassroomDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        classroom={editingClassroom}
        onSuccess={fetchClassrooms}
      />

      {/* Assign Teacher Dialog */}
      <AssignTeacherDialog
        open={showAssignDialog}
        onOpenChange={setShowAssignDialog}
        classroom={assigningClassroom}
        teachers={teachers}
        organizationId={school?.organization_id || ""}
        schoolId={schoolId || ""}
        onSuccess={() => {
          fetchClassrooms();
          fetchTeachers();
        }}
      />

      {/* Classroom Students Sidebar */}
      {viewingClassroom && (
        <ClassroomStudentsSidebar
          open={showStudentsSidebar}
          onOpenChange={setShowStudentsSidebar}
          classroomId={parseInt(viewingClassroom.id)}
          classroomName={viewingClassroom.name}
          schoolId={schoolId || ""}
          onSuccess={fetchClassrooms}
        />
      )}

      {/* Classroom Materials Sidebar */}
      {viewingClassroom && school && (
        <ClassroomMaterialsSidebar
          open={showMaterialsSidebar}
          onOpenChange={setShowMaterialsSidebar}
          classroomId={parseInt(viewingClassroom.id)}
          classroomName={viewingClassroom.name}
          schoolId={schoolId || ""}
          organizationId={school.organization_id}
          onSuccess={fetchClassrooms}
        />
      )}

      {/* Assignment Dialog - 機構模式派發作業 */}
      {assignmentClassroom && (
        <AssignmentDialog
          open={showAssignmentDialog}
          onClose={() => {
            setShowAssignmentDialog(false);
            setAssignmentClassroom(null);
            setAssignmentStudents([]);
          }}
          classroomId={parseInt(assignmentClassroom.id)}
          students={assignmentStudents}
          organizationId={school?.organization_id}
          schoolId={schoolId}
          onSuccess={fetchClassrooms}
        />
      )}
    </div>
  );
}
