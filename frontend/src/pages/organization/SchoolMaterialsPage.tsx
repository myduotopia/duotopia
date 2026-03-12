import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { API_URL } from "@/config/api";
import { Breadcrumb } from "@/components/organization/Breadcrumb";
import { LoadingSpinner } from "@/components/organization/LoadingSpinner";
import { ErrorMessage } from "@/components/organization/ErrorMessage";
import { ProgramTreeView } from "@/components/shared/ProgramTreeView";
import { ProgramTreeProgram, ProgramTreeLesson } from "@/hooks/useProgramTree";
import { SchoolProgramCreateDialog } from "@/components/shared/SchoolProgramCreateDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen } from "lucide-react";
import { toast } from "sonner";

interface School {
  id: string;
  name: string;
  organization_id: string;
}

interface Organization {
  id: string;
  name: string;
}

interface Program {
  id: number;
  name: string;
  description?: string;
  is_active: boolean;
  total_hours?: number;
  lessons?: ProgramTreeLesson[];
}

/**
 * SchoolMaterialsPage - Manage school-level materials
 */
export default function SchoolMaterialsPage() {
  const { schoolId } = useParams<{ schoolId: string }>();
  const token = useTeacherAuthStore((state) => state.token);
  const user = useTeacherAuthStore((state) => state.user);

  const [school, setSchool] = useState<School | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Memoized callback to prevent infinite loop
  const handleProgramsChange = useCallback(
    (updatedPrograms: ProgramTreeProgram[]) => {
      setPrograms(updatedPrograms as Program[]);
    },
    [],
  );

  useEffect(() => {
    if (schoolId) {
      fetchData();
    }
  }, [schoolId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch school info
      const schoolRes = await fetch(`${API_URL}/api/schools/${schoolId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!schoolRes.ok) {
        setError("載入學校資訊失敗");
        return;
      }

      const schoolData = await schoolRes.json();
      setSchool(schoolData);

      // Fetch organization info
      const orgRes = await fetch(
        `${API_URL}/api/organizations/${schoolData.organization_id}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (orgRes.ok) {
        const orgData = await orgRes.json();
        setOrganization(orgData);
      }

      // Fetch school programs
      const programsRes = await fetch(
        `${API_URL}/api/schools/${schoolId}/programs`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (programsRes.ok) {
        const programsData = await programsRes.json();
        setPrograms(programsData);
      } else {
        setPrograms([]);
      }
    } catch (err) {
      console.error("Failed to fetch data:", err);
      setError("網路連線錯誤");
      toast.error("載入失敗");
    } finally {
      setLoading(false);
    }
  };

  // Check if current user can manage materials
  const canManageMaterials =
    user?.role === "org_owner" ||
    user?.role === "org_admin" ||
    user?.role === "school_admin" ||
    user?.role === "school_director";

  const handleCreateClick = () => {
    setShowCreateDialog(true);
  };

  const handleCreateSuccess = () => {
    fetchData();
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <LoadingSpinner />
      </div>
    );
  }

  if (error || !school) {
    return (
      <div className="space-y-6">
        <ErrorMessage message={error || "找不到學校"} onRetry={fetchData} />
      </div>
    );
  }

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
          {
            label: school.name,
            href: `/organization/schools/${school.id}`,
          },
          { label: "學校教材" },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">學校教材</h1>
          <p className="text-gray-600 mt-2">{school.name} 的教學教材與課程</p>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">
              總教材數
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{programs.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">
              啟用中
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {programs.filter((p) => p.is_active).length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">
              總時數
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {programs.reduce((sum, p) => sum + (p.total_hours || 0), 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Programs List */}
      <Card>
        <CardHeader>
          <CardTitle>教材列表</CardTitle>
        </CardHeader>
        <CardContent>
          {programs.length === 0 && !canManageMaterials ? (
            <div className="text-center py-12">
              <BookOpen className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500 mb-2">此學校尚無教材</p>
            </div>
          ) : (
            <div className="mt-4">
              <ProgramTreeView
                programs={programs}
                onProgramsChange={handleProgramsChange}
                onRefresh={fetchData}
                showCreateButton={canManageMaterials}
                createButtonText="新增教材"
                scope="school"
                schoolId={schoolId}
                onCreateClick={handleCreateClick}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Program Dialog */}
      {school && schoolId && (
        <SchoolProgramCreateDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          schoolId={schoolId}
          schoolName={school.name}
          organizationId={school.organization_id}
          onSuccess={handleCreateSuccess}
        />
      )}
    </div>
  );
}
