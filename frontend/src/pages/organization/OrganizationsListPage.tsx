import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { useOrganization } from "@/contexts/OrganizationContext";
import { API_URL } from "@/config/api";
import { Breadcrumb } from "@/components/organization/Breadcrumb";
import { LoadingSpinner } from "@/components/organization/LoadingSpinner";
import { ErrorMessage } from "@/components/organization/ErrorMessage";
import { OrganizationEditDialog } from "@/components/organization/OrganizationEditDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Building2, Plus, Edit2 } from "lucide-react";

interface Organization {
  id: string;
  name: string;
  display_name?: string;
  description?: string;
  contact_email?: string;
  is_active: boolean;
  created_at: string;
  owner_name?: string;
  owner_email?: string;
}

export default function OrganizationsListPage() {
  const navigate = useNavigate();
  const token = useTeacherAuthStore((state) => state.token);
  const { refreshOrganizations } = useOrganization();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  useEffect(() => {
    fetchOrganizations();
  }, []);

  const fetchOrganizations = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${API_URL}/api/organizations`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setOrganizations(data);
      } else {
        setError(`載入機構列表失敗：${response.status}`);
      }
    } catch (error) {
      console.error("Failed to fetch organizations:", error);
      setError("網路連線錯誤，請檢查您的網路連線");
    } finally {
      setLoading(false);
    }
  };

  const handleEditClick = (org: Organization) => {
    setEditingOrg(org);
    setEditDialogOpen(true);
  };

  const handleEditSuccess = useCallback(() => {
    fetchOrganizations(); // Refresh list after successful edit
    // Sync sidebar organization data in OrganizationContext
    if (token) {
      refreshOrganizations(token);
    }
  }, [token, refreshOrganizations]);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb items={[{ label: "所有機構" }]} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">所有機構</h1>
          <p className="text-gray-600 mt-2">管理系統內的所有機構</p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          新增機構
        </Button>
      </div>

      {/* Organizations Table */}
      <Card>
        <CardHeader>
          <CardTitle>機構列表</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingSpinner />
          ) : error ? (
            <ErrorMessage message={error} onRetry={fetchOrganizations} />
          ) : organizations.length === 0 ? (
            <div className="text-center py-12">
              <Building2 className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500 mb-2">目前沒有機構</p>
              <Button variant="outline" className="mt-4 gap-2">
                <Plus className="h-4 w-4" />
                新增第一個機構
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>機構名稱</TableHead>
                  <TableHead>Owner 名稱</TableHead>
                  <TableHead>Owner Email</TableHead>
                  <TableHead>描述</TableHead>
                  <TableHead>聯絡信箱</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead>建立時間</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {organizations.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium">
                      <button
                        onClick={() => navigate(`/organization/${org.id}`)}
                        className="text-blue-600 hover:text-blue-800 hover:underline text-left"
                      >
                        {org.name}
                      </button>
                    </TableCell>
                    <TableCell>{org.owner_name || "-"}</TableCell>
                    <TableCell>{org.owner_email || "-"}</TableCell>
                    <TableCell className="max-w-xs truncate">
                      {org.description || "-"}
                    </TableCell>
                    <TableCell>{org.contact_email || "-"}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          org.is_active
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {org.is_active ? "啟用" : "停用"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {new Date(org.created_at).toLocaleDateString("zh-TW")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditClick(org)}
                      >
                        <Edit2 className="h-4 w-4" />
                        編輯
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <OrganizationEditDialog
        organization={editingOrg}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSuccess={handleEditSuccess}
      />
    </div>
  );
}
