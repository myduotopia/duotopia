import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { useOrganization } from "@/contexts/OrganizationContext";
import { API_URL } from "@/config/api";
import { Breadcrumb } from "@/components/organization/Breadcrumb";
import { LoadingSpinner } from "@/components/organization/LoadingSpinner";
import { ErrorMessage } from "@/components/organization/ErrorMessage";
import { OrganizationEditDialog } from "@/components/organization/OrganizationEditDialog";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import {
  Organization,
  School,
  QuickActionsCards,
  SchoolGridSection,
} from "@/pages/organization/OrganizationEditSections";
import { StaffMember } from "@/components/organization/StaffTable";

export default function OrganizationEditPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const token = useTeacherAuthStore((state) => state.token);
  const { setSelectedNode, setExpandedOrgs, refreshOrganizations } =
    useOrganization();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [teachers, setTeachers] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (orgId) {
      fetchOrganization();
      fetchSchools();
      fetchTeachers();
    }
  }, [orgId]);

  const fetchOrganization = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${API_URL}/api/organizations/${orgId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setOrganization(data);

        // Set selected node in sidebar tree
        setSelectedNode({ type: "organization", id: data.id, data });

        // Expand this organization in sidebar tree
        setExpandedOrgs((prev) => {
          const newExpanded = new Set([...prev, data.id]);
          return Array.from(newExpanded);
        });
      } else {
        setError(`載入機構失敗：${response.status}`);
      }
    } catch (error) {
      console.error("Failed to fetch organization:", error);
      setError("網路連線錯誤");
    } finally {
      setLoading(false);
    }
  };

  const fetchSchools = async () => {
    try {
      const response = await fetch(
        `${API_URL}/api/schools?organization_id=${orgId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (response.ok) {
        const data = await response.json();
        const mappedSchools = data.map((school: School) => ({
          ...school,
          principal_name: school.principal_name ?? school.admin_name,
          principal_email: school.principal_email ?? school.admin_email,
        }));
        setSchools(mappedSchools);
      }
    } catch (error) {
      console.error("Failed to fetch schools:", error);
    }
  };

  const fetchTeachers = async () => {
    try {
      const response = await fetch(
        `${API_URL}/api/organizations/${orgId}/teachers`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (response.ok) {
        const data = await response.json();
        setTeachers(data);
      }
    } catch (error) {
      console.error("Failed to fetch teachers:", error);
    }
  };

  const handleEditSuccess = useCallback(() => {
    fetchOrganization();
    // Sync sidebar organization data in OrganizationContext
    if (token) {
      refreshOrganizations(token);
    }
  }, [token, refreshOrganizations]);

  if (loading) {
    return (
      <div className="space-y-6">
        <LoadingSpinner />
      </div>
    );
  }

  if (error || !organization) {
    return (
      <div className="space-y-6">
        <ErrorMessage
          message={error || "找不到機構"}
          onRetry={fetchOrganization}
        />
      </div>
    );
  }

  // Pagination logic
  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.ceil(schools.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const currentSchools = schools.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  return (
    <div className="space-y-4">
      {/* Breadcrumb with Settings Button */}
      <div className="flex items-center justify-between">
        <Breadcrumb
          items={[
            {
              label: organization.name,
              href: `/organization/${organization.id}`,
            },
          ]}
        />
        <Button
          onClick={() => setEditDialogOpen(true)}
          variant="ghost"
          size="icon"
          title="編輯機構"
        >
          <Settings className="h-5 w-5" />
        </Button>
      </div>

      <QuickActionsCards
        orgId={orgId!}
        schoolsCount={schools.length}
        teachersCount={teachers.length}
      />

      <SchoolGridSection
        schools={currentSchools}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={handlePageChange}
      />

      {/* Edit Organization Dialog */}
      <OrganizationEditDialog
        organization={organization}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSuccess={handleEditSuccess}
      />
    </div>
  );
}
