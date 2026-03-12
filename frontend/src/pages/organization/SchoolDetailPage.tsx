import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { useOrganization } from "@/contexts/OrganizationContext";
import { API_URL } from "@/config/api";
import { Breadcrumb } from "@/components/organization/Breadcrumb";
import { LoadingSpinner } from "@/components/organization/LoadingSpinner";
import { ErrorMessage } from "@/components/organization/ErrorMessage";
import { SchoolEditDialog } from "@/components/organization/SchoolEditDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, GraduationCap, UserCheck, Settings } from "lucide-react";

interface School {
  id: string;
  organization_id: string;
  name: string;
  display_name?: string;
  description?: string;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

interface Organization {
  id: string;
  name: string;
}

interface Teacher {
  id: number;
  email: string;
  name: string;
  roles: string[];
  is_active: boolean;
  created_at: string;
}

interface Classroom {
  id: string;
  name: string;
  program_level: string;
  is_active: boolean;
  created_at: string;
  teacher_name: string | null;
  teacher_email: string | null;
  student_count: number;
  assignment_count: number;
}

export default function SchoolDetailPage() {
  const { schoolId } = useParams<{ schoolId: string }>();
  const navigate = useNavigate();
  const token = useTeacherAuthStore((state) => state.token);
  const { setSelectedNode, setExpandedOrgs } = useOrganization();
  const [school, setSchool] = useState<School | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  useEffect(() => {
    if (schoolId) {
      fetchSchool();
    }
  }, [schoolId]);

  const fetchSchool = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${API_URL}/api/schools/${schoolId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setSchool(data);

        // Set selected node in sidebar tree
        setSelectedNode({ type: "school", id: data.id, data });

        // Expand parent organization in sidebar tree
        setExpandedOrgs((prev) => {
          const newExpanded = new Set([...prev, data.organization_id]);
          return Array.from(newExpanded);
        });

        // Fetch organization info, teachers, and classrooms
        fetchOrganization(data.organization_id);
        fetchTeachers();
        fetchClassrooms();
      } else {
        setError(`載入學校失敗：${response.status}`);
      }
    } catch (error) {
      console.error("Failed to fetch school:", error);
      setError("網路連線錯誤");
    } finally {
      setLoading(false);
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
      console.error("Failed to fetch organization:", error);
    }
  };

  const fetchTeachers = async () => {
    try {
      const response = await fetch(
        `${API_URL}/api/schools/${schoolId}/teachers`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (response.ok) {
        const data = await response.json();

        // Sort teachers by role priority: school_admin > school_director > teacher
        const sortedTeachers = data.sort((a: Teacher, b: Teacher) => {
          const getRolePriority = (roles: string[]) => {
            if (roles.includes("school_admin")) return 1;
            if (roles.includes("school_director")) return 2;
            if (roles.includes("teacher")) return 3;
            return 4;
          };

          return getRolePriority(a.roles) - getRolePriority(b.roles);
        });

        setTeachers(sortedTeachers);
      }
    } catch (error) {
      console.error("Failed to fetch teachers:", error);
    }
  };

  const fetchClassrooms = async () => {
    try {
      const response = await fetch(
        `${API_URL}/api/schools/${schoolId}/classrooms`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (response.ok) {
        const data = await response.json();
        setClassrooms(data);
      }
    } catch (error) {
      console.error("Failed to fetch classrooms:", error);
    }
  };

  const handleEditSuccess = () => {
    fetchSchool();
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
        <ErrorMessage message={error || "找不到學校"} onRetry={fetchSchool} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb with Settings Button */}
      <div className="flex items-center justify-between">
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
            { label: school.name },
          ]}
        />
        <Button
          onClick={() => setEditDialogOpen(true)}
          variant="ghost"
          size="icon"
          title="編輯學校"
        >
          <Settings className="h-5 w-5" />
        </Button>
      </div>

      {/* Quick Actions Cards */}
      <div className="flex flex-wrap gap-4">
        <Card className="w-[200px] h-[200px] hover:shadow-md transition-shadow cursor-pointer">
          <CardContent
            className="h-full p-4 flex flex-col justify-center"
            onClick={() =>
              navigate(`/organization/schools/${schoolId}/classrooms`)
            }
          >
            <div className="flex flex-col items-center text-center gap-3">
              <div className="p-3 bg-amber-100 rounded-lg">
                <GraduationCap className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">班級管理</h3>
                <p className="text-sm text-gray-500">
                  {classrooms.length} 個班級
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="w-[200px] h-[200px] hover:shadow-md transition-shadow cursor-pointer">
          <CardContent
            className="h-full p-4 flex flex-col justify-center"
            onClick={() =>
              navigate(`/organization/schools/${schoolId}/teachers`)
            }
          >
            <div className="flex flex-col items-center text-center gap-3">
              <div className="p-3 bg-purple-100 rounded-lg">
                <Users className="h-6 w-6 text-purple-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">教師管理</h3>
                <p className="text-sm text-gray-500">
                  {teachers.length} 位教師
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="w-[200px] h-[200px] hover:shadow-md transition-shadow cursor-pointer">
          <CardContent
            className="h-full p-4 flex flex-col justify-center"
            onClick={() =>
              navigate(`/organization/schools/${schoolId}/students`)
            }
          >
            <div className="flex flex-col items-center text-center gap-3">
              <div className="p-3 bg-green-100 rounded-lg">
                <UserCheck className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">學生管理</h3>
                <p className="text-sm text-gray-500">學生名冊</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Edit School Dialog */}
      <SchoolEditDialog
        school={school}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSuccess={handleEditSuccess}
      />
    </div>
  );
}
