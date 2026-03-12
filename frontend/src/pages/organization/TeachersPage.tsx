import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { useOrganization } from "@/contexts/OrganizationContext";
import { API_URL } from "@/config/api";
import { Breadcrumb } from "@/components/organization/Breadcrumb";
import { LoadingSpinner } from "@/components/organization/LoadingSpinner";
import { ErrorMessage } from "@/components/organization/ErrorMessage";
import {
  StaffTable,
  StaffMember,
  StaffSortField,
  SortDirection,
} from "@/components/organization/StaffTable";
import { InviteTeacherDialog } from "@/components/organization/InviteTeacherDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users,
  UserPlus,
  Search,
  ChevronLeft,
  ChevronRight,
  Filter,
} from "lucide-react";
import { toast } from "sonner";

interface SchoolOption {
  id: string;
  name: string;
  display_name?: string;
}

// Use StaffMember from StaffTable component

/**
 * TeachersPage - Manage teachers within the organization portal
 */
export default function TeachersPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const token = useTeacherAuthStore((state) => state.token);
  const { selectedNode } = useOrganization();

  const [teachers, setTeachers] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [organization, setOrganization] = useState<{
    name: string;
    teacher_license_count?: number;
  } | null>(null);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [schoolOptions, setSchoolOptions] = useState<SchoolOption[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>("all");

  // Search, sort, pagination state
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<StaffSortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const effectiveOrgId =
    orgId ||
    (selectedNode?.type === "organization" ? selectedNode.id : undefined);

  useEffect(() => {
    const fetchOrg = async () => {
      if (!effectiveOrgId || !token) return;
      try {
        const res = await fetch(
          `${API_URL}/api/organizations/${effectiveOrgId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (res.ok) {
          const data = await res.json();
          setOrganization(data);
        }
      } catch (error) {
        console.error("Failed to fetch organization:", error);
      }
    };
    if (effectiveOrgId && token) {
      fetchOrg();
    }
  }, [effectiveOrgId, token]);

  useEffect(() => {
    const fetchSchools = async () => {
      if (!effectiveOrgId || !token) return;
      try {
        const res = await fetch(
          `${API_URL}/api/schools?organization_id=${effectiveOrgId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (res.ok) {
          const data = await res.json();
          setSchoolOptions(data);
        }
      } catch (error) {
        console.error("Failed to fetch schools:", error);
      }
    };
    if (effectiveOrgId && token) {
      fetchSchools();
    }
  }, [effectiveOrgId, token]);

  useEffect(() => {
    if (effectiveOrgId) {
      fetchTeachers();
    }
  }, [effectiveOrgId, selectedSchoolId]);

  const fetchTeachers = async () => {
    if (!effectiveOrgId) return;

    try {
      setLoading(true);
      setError(null);

      const headers = { Authorization: `Bearer ${token}` };

      // Always fetch org-level teachers (for correct org roles)
      const orgResponse = await fetch(
        `${API_URL}/api/organizations/${effectiveOrgId}/teachers`,
        { headers },
      );

      if (!orgResponse.ok) {
        setError(`載入教師列表失敗：${orgResponse.status}`);
        toast.error("載入教師列表失敗");
        return;
      }

      const orgTeachers = await orgResponse.json();

      // If a school is selected, fetch school teacher IDs to filter
      if (selectedSchoolId && selectedSchoolId !== "all") {
        const schoolResponse = await fetch(
          `${API_URL}/api/schools/${selectedSchoolId}/teachers`,
          { headers },
        );
        if (schoolResponse.ok) {
          const schoolTeachers = await schoolResponse.json();
          const schoolTeacherIds = new Set(
            schoolTeachers.map((t: { id: number }) => t.id),
          );
          setTeachers(
            orgTeachers.filter((t: StaffMember) => schoolTeacherIds.has(t.id)),
          );
        } else {
          setError(`載入分校教師失敗：${schoolResponse.status}`);
        }
      } else {
        setTeachers(orgTeachers);
      }
    } catch (error) {
      console.error("Failed to fetch teachers:", error);
      setError("網路連線錯誤，請檢查您的網路連線");
      toast.error("網路錯誤");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (
    teacher: StaffMember,
    isActive: boolean,
  ) => {
    try {
      // Always use org-level endpoint (we always display org-level roles)
      const response = await fetch(
        `${API_URL}/api/organizations/${effectiveOrgId}/teachers/${teacher.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ role: teacher.role, is_active: isActive }),
        },
      );

      if (response.ok) {
        toast.success(isActive ? "教師已啟用" : "教師已停用");
        fetchTeachers();
      } else {
        toast.error("更新狀態失敗");
      }
    } catch (error) {
      console.error("Failed to toggle teacher status:", error);
      toast.error("網路錯誤");
    }
  };

  const handleSort = (field: StaffSortField) => {
    if (sortField === field) {
      // Cycle through: asc -> desc -> null
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortField(null);
        setSortDirection(null);
      }
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
    setCurrentPage(1);
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setCurrentPage(1);
  };

  // Filter, sort, and paginate teachers
  const filteredTeachers = teachers.filter((teacher) => {
    const searchLower = searchQuery.toLowerCase();
    return (
      teacher.name.toLowerCase().includes(searchLower) ||
      teacher.email.toLowerCase().includes(searchLower)
    );
  });

  const sortedTeachers = [...filteredTeachers].sort((a, b) => {
    if (!sortField || !sortDirection) return 0;

    let aValue: string | number | undefined;
    let bValue: string | number | undefined;

    switch (sortField) {
      case "name":
        aValue = a.name;
        bValue = b.name;
        break;
      case "email":
        aValue = a.email;
        bValue = b.email;
        break;
      case "role":
        aValue = a.role;
        bValue = b.role;
        break;
      case "created_at":
        aValue = new Date(a.created_at).getTime();
        bValue = new Date(b.created_at).getTime();
        break;
    }

    if (typeof aValue === "string" && typeof bValue === "string") {
      return sortDirection === "asc"
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    } else {
      const numA = Number(aValue);
      const numB = Number(bValue);
      return sortDirection === "asc" ? numA - numB : numB - numA;
    }
  });

  const totalPages = Math.ceil(sortedTeachers.length / itemsPerPage);
  const paginatedTeachers = sortedTeachers.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  // Role management is now handled by StaffTable component

  if (!effectiveOrgId) {
    return (
      <div className="p-8 text-center">
        <Users className="w-16 h-16 mx-auto mb-4 text-gray-300" />
        <p className="text-gray-500">請先選擇組織</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          {
            label: organization?.name || "...",
            href: `/organization/${orgId}`,
          },
          { label: "人員管理" },
        ]}
      />

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">人員管理</h1>
        <p className="text-gray-600 mt-2">管理組織內的教師成員</p>
      </div>

      {/* Teachers Table */}
      <Card>
        <CardHeader className="space-y-3 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle>教師列表</CardTitle>
              {organization?.teacher_license_count !== undefined &&
                (() => {
                  const activeCount = teachers.filter(
                    (t) => t.is_active,
                  ).length;
                  const licenseCount = organization.teacher_license_count;
                  const usageRate =
                    licenseCount > 0 ? (activeCount / licenseCount) * 100 : 0;
                  let color = "text-gray-500";
                  if (usageRate >= 95) color = "text-red-600";
                  else if (usageRate >= 80) color = "text-orange-600";
                  return (
                    <span className={`text-sm font-normal ${color}`}>
                      啟用 {activeCount} / {licenseCount} 授權
                    </span>
                  );
                })()}
            </div>
            <Button className="gap-2" onClick={() => setInviteDialogOpen(true)}>
              <UserPlus className="h-4 w-4" />
              邀請教師
            </Button>
          </div>
          <div className="flex items-center gap-4">
            {/* School Filter */}
            {schoolOptions.length > 0 && (
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-400" />
                <Select
                  value={selectedSchoolId}
                  onValueChange={(val) => {
                    setSelectedSchoolId(val);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="篩選分校" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部分校</SelectItem>
                    {schoolOptions.map((school) => (
                      <SelectItem key={school.id} value={school.id}>
                        {school.display_name || school.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {/* Search */}
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="搜尋姓名或 Email..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingSpinner />
          ) : error ? (
            <ErrorMessage message={error} onRetry={fetchTeachers} />
          ) : teachers.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500 mb-2">此組織尚無教師</p>
              <Button
                variant="outline"
                onClick={() => setInviteDialogOpen(true)}
                className="mt-4 gap-2"
              >
                <UserPlus className="h-4 w-4" />
                邀請第一位教師
              </Button>
            </div>
          ) : (
            <>
              <StaffTable
                staff={paginatedTeachers}
                organizationId={effectiveOrgId}
                onRoleUpdated={fetchTeachers}
                onToggleStatus={handleToggleStatus}
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
                showEmail={true}
              />

              {/* Pagination Controls */}
              {totalPages > 1 && (
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
                    {filteredTeachers.length} 位教師）
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                    }
                    disabled={currentPage === totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Invite Teacher Dialog */}
      {effectiveOrgId && (
        <InviteTeacherDialog
          organizationId={effectiveOrgId}
          open={inviteDialogOpen}
          onOpenChange={setInviteDialogOpen}
          onSuccess={fetchTeachers}
        />
      )}
    </div>
  );
}
