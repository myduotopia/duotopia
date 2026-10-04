import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import {
  GRADE_FILTER_ALL,
  batchGradeErrorMessageKey,
  isValidGrade,
  matchesGradeFilter,
  type GradeUpdateItem,
} from "@/components/classroom/classroomGrade";
import { GradeFilterSelect } from "@/components/classroom/GradeFilterSelect";
import { MissingGradeBanner } from "@/components/classroom/MissingGradeBanner";
import { MissingGradeDialog } from "@/components/classroom/MissingGradeDialog";
import { AdjustGradeDialog } from "@/components/classroom/AdjustGradeDialog";
import { GradeBulkBar } from "@/components/classroom/GradeBulkBar";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { API_URL } from "@/config/api";
import { logError } from "@/utils/errorLogger";
import { Breadcrumb } from "@/components/organization/Breadcrumb";
import { LoadingSpinner } from "@/components/organization/LoadingSpinner";
import { ErrorMessage } from "@/components/organization/ErrorMessage";
import { ClassroomListTable } from "@/components/organization/ClassroomListTable";
import { CreateClassroomDialog } from "@/components/organization/CreateClassroomDialog";
import { EditClassroomDialog } from "@/components/organization/EditClassroomDialog";
import { AssignTeacherDialog } from "@/components/organization/AssignTeacherDialog";
import { ClassroomStudentsSidebar } from "@/components/organization/ClassroomStudentsSidebar";
import { AssignmentDialog } from "@/components/AssignmentDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GraduationCap, Plus } from "lucide-react";

interface Classroom {
  id: string;
  name: string;
  program_level: string;
  grade?: number | null; // 年級 1–12；null = 尚未設定（#1097）
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
  const { t } = useTranslation();
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
  // 年級篩選／勾選／補填／批次調整（#1097）
  const [gradeFilter, setGradeFilter] = useState<string>(GRADE_FILTER_ALL);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAdjustGrade, setShowAdjustGrade] = useState(false);
  const [showMissingGrade, setShowMissingGrade] = useState(false);

  // Guard: prevent StrictMode double-mount from triggering duplicate fetches
  const fetchedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (schoolId && token) {
      if (fetchedForRef.current === schoolId) return;
      fetchedForRef.current = schoolId;
      fetchSchool();
    }
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

  // silent：背景重新載入（批次設定年級後，#1097），不切換 loading／error，
  // 讓提醒、篩選列、操作列與表格保持掛載只更新內容。
  // 回傳是否載入成功，讓背景重新載入的呼叫端能提示失敗。
  const loadClassrooms = async ({ silent = false } = {}): Promise<boolean> => {
    try {
      if (!silent) {
        setLoading(true);
        setError(null);
      }

      const response = await fetch(
        `${API_URL}/api/schools/${schoolId}/classrooms`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (response.ok) {
        const data = await response.json();
        setClassrooms(data);
        return true;
      }
      if (silent) {
        logError(
          "Failed to reload classrooms",
          new Error(`HTTP ${response.status}`),
          { schoolId },
        );
      } else {
        setError(`載入班級列表失敗：${response.status}`);
      }
      return false;
    } catch (error) {
      logError("Failed to fetch classrooms", error, { schoolId });
      if (!silent) setError("網路連線錯誤");
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchClassrooms = () => loadClassrooms();

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

  const handleAssignHomework = (classroom: Classroom) => {
    setAssignmentClassroom(classroom);
    setAssignmentStudents([]);
    setShowAssignmentDialog(true);
  };

  // ---- 年級（#1097）----
  // 本頁的建立／編輯控制項沒有額外權限條件（後端驗權限），勾選與補填比照辦理。
  // 停用班級會被批次端點拒絕，不可勾選、不列入補填（與 ClassroomListTable 同條件）。
  const visibleClassrooms = classrooms.filter((c) =>
    matchesGradeFilter(c.grade, gradeFilter),
  );
  const selectableVisible = visibleClassrooms.filter((c) => c.is_active);
  // 只計目前列出的勾選，篩選掉的班級不會被批次調整
  const selectedClassrooms = selectableVisible.filter((c) =>
    selectedIds.has(c.id),
  );
  const missingGradeClassrooms = classrooms.filter(
    (c) => c.is_active && !isValidGrade(c.grade),
  );

  const toggleSelected = (id: string, checked: boolean) => {
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

  // 使用者改變篩選時清空勾選
  const handleGradeFilterChange = (value: string) => {
    setGradeFilter(value);
    setSelectedIds(new Set());
  };

  // 補填與升降共用批次端點；回傳 true 讓對話框關閉。
  // 不動勾選：只有批次調整成功才清（見 handleAdjustGrades）。
  const handleBatchSetGrades = async (
    items: GradeUpdateItem<string>[],
  ): Promise<boolean> => {
    if (!schoolId) return false;
    try {
      const res = await apiClient.batchSetSchoolClassroomGrades(
        schoolId,
        items.map((i) => ({ classroom_id: Number(i.id), grade: i.grade })),
      );
      toast.success(
        t("classroomGrade.messages.saveSuccess", { count: res.count }),
      );
      // 背景重新載入；失敗時已儲存的結果仍有效，只提示重新整理
      void loadClassrooms({ silent: true }).then((reloaded) => {
        if (!reloaded) toast.error(t("classroomGrade.messages.reloadFailed"));
      });
      return true;
    } catch (error) {
      logError("Failed to batch set classroom grades", error, { schoolId });
      // 403 → 權限專屬提示，其餘 → 一般失敗（對應見 batchGradeErrorMessageKey）
      toast.error(t(batchGradeErrorMessageKey(error)));
      return false;
    }
  };

  // 批次調整成功：先關對話框再清勾選（對話框關閉期間沿用原清單，不會閃出空狀態）
  const handleAdjustGrades = async (
    items: GradeUpdateItem<string>[],
  ): Promise<boolean> => {
    const ok = await handleBatchSetGrades(items);
    if (ok) {
      setShowAdjustGrade(false);
      setSelectedIds(new Set());
    }
    return ok;
  };

  return (
    // 浮動操作列出現時預留底部空間，最後一列不被擋住（#1097）
    <div
      className={`space-y-6 ${selectedClassrooms.length > 0 ? "pb-24" : ""}`}
    >
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

      {/* 尚未設定年級提醒（#1097） */}
      {!loading && !error && (
        <MissingGradeBanner
          count={missingGradeClassrooms.length}
          onAction={() => setShowMissingGrade(true)}
        />
      )}

      {/* Classrooms Table */}
      <Card>
        <CardHeader>
          <CardTitle>班級列表</CardTitle>
        </CardHeader>
        <CardContent>
          {!loading && !error && classrooms.length > 0 && (
            <div className="mb-4">
              <GradeFilterSelect
                value={gradeFilter}
                onChange={handleGradeFilterChange}
              />
            </div>
          )}
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
          ) : visibleClassrooms.length === 0 ? (
            <p className="text-center py-8 text-gray-500">
              {t("classroomGrade.filter.noMatch")}
            </p>
          ) : (
            <ClassroomListTable
              classrooms={visibleClassrooms}
              onEdit={handleEdit}
              onAssignTeacher={handleAssignTeacher}
              onViewStudents={handleViewStudents}
              onAssignHomework={handleAssignHomework}
              selectedIds={selectedIds}
              onToggle={toggleSelected}
              onToggleAll={toggleSelectAllVisible}
            />
          )}
        </CardContent>
      </Card>

      {/* 年級批次調整浮動操作列（#1097） */}
      <GradeBulkBar
        selectedCount={selectedClassrooms.length}
        onAdjust={() => setShowAdjustGrade(true)}
        onClear={() => setSelectedIds(new Set())}
      />

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
