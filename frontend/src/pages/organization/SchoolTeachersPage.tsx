import { useState, useEffect } from "react";
import { useParams, useLocation } from "react-router-dom";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { API_URL } from "@/config/api";
import { Breadcrumb } from "@/components/organization/Breadcrumb";
import { LoadingSpinner } from "@/components/organization/LoadingSpinner";
import { ErrorMessage } from "@/components/organization/ErrorMessage";
import { InviteTeacherToSchoolDialog } from "@/components/organization/InviteTeacherToSchoolDialog";
import {
  TeacherListTable,
  Teacher,
  ClassroomInfo,
} from "@/components/organization/TeacherListTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, UserPlus, ChevronLeft, ChevronRight } from "lucide-react";

interface School {
  id: string;
  name: string;
  organization_id: string;
}

interface Organization {
  id: string;
  name: string;
}

export default function SchoolTeachersPage() {
  const { schoolId } = useParams<{ schoolId: string }>();
  const location = useLocation();
  const token = useTeacherAuthStore((state) => state.token);

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [school, setSchool] = useState<School | null>(
    location.state?.school ?? null,
  );
  const [organization, setOrganization] = useState<Organization | null>(
    location.state?.organization ?? null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [teacherClassrooms, setTeacherClassrooms] = useState<
    Record<number, ClassroomInfo[]>
  >({});

  useEffect(() => {
    if (schoolId && token) {
      loadAll();
    }
  }, [schoolId]);

  const loadAll = async () => {
    setLoading(true);
    setError(null);

    const headers = { Authorization: `Bearer ${token}` };

    try {
      // Parallel: fetch school + teachers + classrooms all at once
      const [schoolRes, teachersRes, classroomsRes] = await Promise.all([
        school
          ? Promise.resolve(null)
          : fetch(`${API_URL}/api/schools/${schoolId}`, { headers }),
        fetch(`${API_URL}/api/schools/${schoolId}/teachers`, { headers }),
        fetch(`${API_URL}/api/schools/${schoolId}/classrooms`, { headers }),
      ]);

      // Process school
      if (schoolRes?.ok) {
        const schoolData = await schoolRes.json();
        setSchool(schoolData);
        // Fetch org in background (non-blocking)
        if (!organization) {
          fetch(`${API_URL}/api/organizations/${schoolData.organization_id}`, {
            headers,
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => data && setOrganization(data))
            .catch(() => {});
        }
      }

      // Process teachers
      if (teachersRes.ok) {
        const teachersData = await teachersRes.json();
        const sortedTeachers = teachersData.sort(
          (a: Teacher, b: Teacher) => {
            const getRolePriority = (roles: string[]) => {
              if (roles.includes("school_admin")) return 1;
              if (roles.includes("school_director")) return 2;
              if (roles.includes("teacher")) return 3;
              return 4;
            };
            return getRolePriority(a.roles) - getRolePriority(b.roles);
          },
        );
        setTeachers(sortedTeachers);

        // Process classrooms (already fetched in parallel)
        if (classroomsRes.ok) {
          const classrooms = await classroomsRes.json();
          const emailToId: Record<string, number> = {};
          sortedTeachers.forEach((t: Teacher) => {
            emailToId[t.email] = t.id;
          });
          const map: Record<number, ClassroomInfo[]> = {};
          classrooms.forEach(
            (c: { id: string; name: string; teacher_email?: string }) => {
              if (c.teacher_email && emailToId[c.teacher_email]) {
                const tid = emailToId[c.teacher_email];
                if (!map[tid]) map[tid] = [];
                map[tid].push({ id: c.id, name: c.name });
              }
            },
          );
          setTeacherClassrooms(map);
        }
      } else {
        setError(`載入教師列表失敗：${teachersRes.status}`);
      }
    } catch (error) {
      console.error("Failed to load data:", error);
      setError("網路連線錯誤");
    } finally {
      setLoading(false);
    }
  };

  const handleInviteSuccess = () => {
    loadAll();
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
          { label: "教師管理" },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">教師管理</h1>
          <p className="text-gray-600 mt-2">
            {school?.name} - 管理學校內的所有教師
          </p>
        </div>
      </div>

      {/* Teachers Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-purple-100 rounded-lg">
              <Users className="h-4 w-4 text-purple-600" />
            </div>
            <CardTitle className="text-base">教師團隊</CardTitle>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setInviteDialogOpen(true)}
          >
            <UserPlus className="h-4 w-4" />
            邀請教師
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <LoadingSpinner />
          ) : error ? (
            <ErrorMessage message={error} onRetry={loadAll} />
          ) : teachers.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500 mb-2">尚無教師</p>
              <p className="text-sm text-gray-400">點擊上方按鈕邀請教師加入</p>
            </div>
          ) : (
            <>
              <TeacherListTable
                teachers={teachers.slice(
                  (currentPage - 1) * itemsPerPage,
                  currentPage * itemsPerPage,
                )}
                schoolId={schoolId || ""}
                onRoleUpdated={loadAll}
                teacherClassrooms={teacherClassrooms}
              />
              {teachers.length > itemsPerPage && (() => {
                const totalPages = Math.ceil(teachers.length / itemsPerPage);
                return (
                  <div className="flex items-center justify-center gap-3 mt-6">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCurrentPage((prev) => Math.max(1, prev - 1))
                      }
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-gray-600">
                      第 {currentPage} 頁 / 共 {totalPages} 頁（共{" "}
                      {teachers.length} 位教師）
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCurrentPage((prev) =>
                          Math.min(totalPages, prev + 1),
                        )
                      }
                      disabled={currentPage === totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })()}
            </>
          )}
        </CardContent>
      </Card>

      {/* Invite Teacher Dialog */}
      {school?.organization_id && (
        <InviteTeacherToSchoolDialog
          schoolId={school.id}
          organizationId={school.organization_id}
          open={inviteDialogOpen}
          onOpenChange={setInviteDialogOpen}
          onSuccess={handleInviteSuccess}
        />
      )}
    </div>
  );
}
