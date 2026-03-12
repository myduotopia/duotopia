import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { useOrganization } from "@/contexts/OrganizationContext";
import { API_URL } from "@/config/api";
import { Breadcrumb } from "@/components/organization/Breadcrumb";
import { LoadingSpinner } from "@/components/organization/LoadingSpinner";
import { ErrorMessage } from "@/components/organization/ErrorMessage";
import { SchoolEditDialog } from "@/components/organization/SchoolEditDialog";
import { AssignPrincipalDialog } from "@/components/organization/AssignPrincipalDialog";
import { SchoolListTable } from "@/components/organization/SchoolListTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { School, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface SchoolData {
  id: string;
  organization_id: string;
  name: string;
  display_name?: string;
  description?: string;
  contact_email?: string;
  is_active: boolean;
  created_at: string;
  principal_name?: string;
  principal_email?: string;
  admin_name?: string;
  admin_email?: string;
}

interface FormData {
  name: string;
  display_name: string;
  description: string;
  contact_email: string;
}

/**
 * SchoolsPage - Manage schools within the organization portal
 */
export default function SchoolsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const token = useTeacherAuthStore((state) => state.token);
  const { selectedNode, refreshSchools } = useOrganization();

  const [schools, setSchools] = useState<SchoolData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showAssignPrincipalDialog, setShowAssignPrincipalDialog] =
    useState(false);
  const [editingSchool, setEditingSchool] = useState<SchoolData | null>(null);
  const [selectedSchool, setSelectedSchool] = useState<SchoolData | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [organization, setOrganization] = useState<{ name: string } | null>(
    null,
  );

  const [formData, setFormData] = useState<FormData>({
    name: "",
    display_name: "",
    description: "",
    contact_email: "",
  });

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
    if (effectiveOrgId) {
      fetchSchools();
    }
  }, [effectiveOrgId]);

  const fetchSchools = async () => {
    if (!effectiveOrgId) return;

    try {
      setLoading(true);
      setError(null);
      const response = await fetch(
        `${API_URL}/api/schools?organization_id=${effectiveOrgId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (response.ok) {
        const data = await response.json();
        const mappedSchools = data.map((school: SchoolData) => ({
          ...school,
          principal_name: school.principal_name ?? school.admin_name,
          principal_email: school.principal_email ?? school.admin_email,
        }));
        setSchools(mappedSchools);
      } else {
        setError(`載入學校列表失敗：${response.status}`);
        toast.error("載入學校列表失敗");
      }
    } catch (error) {
      console.error("Failed to fetch schools:", error);
      setError("網路連線錯誤，請檢查您的網路連線");
      toast.error("網路錯誤");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      display_name: "",
      description: "",
      contact_email: "",
    });
  };

  const handleCreate = () => {
    resetForm();
    setShowCreateDialog(true);
  };

  const handleEdit = (school: SchoolData) => {
    setEditingSchool(school);
    setShowEditDialog(true);
  };

  const handleAssignPrincipal = (school: SchoolData) => {
    setSelectedSchool(school);
    setShowAssignPrincipalDialog(true);
  };

  const handleAssignPrincipalSuccess = useCallback(() => {
    fetchSchools();
    // Also refresh the sidebar's schools data in OrganizationContext
    if (effectiveOrgId && token) {
      refreshSchools(token, effectiveOrgId);
    }
  }, [effectiveOrgId, token, refreshSchools]);

  const handleEditSuccess = useCallback(() => {
    // Refetch local state for this page
    fetchSchools();
    // Also refresh the sidebar's schools data in OrganizationContext
    if (effectiveOrgId && token) {
      refreshSchools(token, effectiveOrgId);
    }
  }, [effectiveOrgId, token, refreshSchools]);

  const handleSaveCreate = async () => {
    if (!effectiveOrgId || !formData.name.trim()) {
      toast.error("請填寫必填欄位");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`${API_URL}/api/schools`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          organization_id: effectiveOrgId,
          ...formData,
        }),
      });

      if (response.ok) {
        toast.success("學校建立成功");
        setShowCreateDialog(false);
        resetForm();
        fetchSchools();
        // Also refresh the sidebar's schools data in OrganizationContext
        if (effectiveOrgId && token) {
          refreshSchools(token, effectiveOrgId);
        }
      } else {
        const error = await response.json();
        toast.error(error.detail || "建立失敗");
      }
    } catch (error) {
      console.error("Failed to create school:", error);
      toast.error("網路錯誤");
    } finally {
      setSaving(false);
    }
  };

  if (!effectiveOrgId) {
    return (
      <div className="p-8 text-center">
        <School className="w-16 h-16 mx-auto mb-4 text-gray-300" />
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
          { label: "學校管理" },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">學校管理</h1>
          <p className="text-gray-600 mt-2">管理組織內的所有學校</p>
        </div>
        <Button onClick={handleCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          新增學校
        </Button>
      </div>

      {/* Schools Table */}
      <Card>
        <CardHeader>
          <CardTitle>學校列表</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingSpinner />
          ) : error ? (
            <ErrorMessage message={error} onRetry={fetchSchools} />
          ) : schools.length === 0 ? (
            <div className="text-center py-8">
              <School className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-gray-500">尚無學校資料</p>
              <Button
                variant="outline"
                onClick={handleCreate}
                className="mt-4 gap-2"
              >
                <Plus className="h-4 w-4" />
                新增第一所學校
              </Button>
            </div>
          ) : (
            <SchoolListTable
              schools={schools}
              onEdit={handleEdit}
              onAssignPrincipal={handleAssignPrincipal}
            />
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增學校</DialogTitle>
            <DialogDescription>建立新的學校資料</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">學校名稱 *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="例如：台北分校"
              />
            </div>
            <div>
              <Label htmlFor="display_name">顯示名稱</Label>
              <Input
                id="display_name"
                value={formData.display_name}
                onChange={(e) =>
                  setFormData({ ...formData, display_name: e.target.value })
                }
                placeholder="選填"
              />
            </div>
            <div>
              <Label htmlFor="description">描述</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="選填"
                rows={3}
              />
            </div>
            <div>
              <Label htmlFor="contact_email">聯絡信箱</Label>
              <Input
                id="contact_email"
                type="email"
                value={formData.contact_email}
                onChange={(e) =>
                  setFormData({ ...formData, contact_email: e.target.value })
                }
                placeholder="選填"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCreateDialog(false);
                resetForm();
              }}
            >
              取消
            </Button>
            <Button onClick={handleSaveCreate} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              建立
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <SchoolEditDialog
        school={editingSchool}
        open={showEditDialog}
        onOpenChange={(open) => {
          setShowEditDialog(open);
          if (!open) {
            setEditingSchool(null);
          }
        }}
        onSuccess={handleEditSuccess}
      />

      {/* Assign Principal Dialog */}
      {selectedSchool && effectiveOrgId && (
        <AssignPrincipalDialog
          schoolId={selectedSchool.id}
          organizationId={effectiveOrgId}
          open={showAssignPrincipalDialog}
          onOpenChange={setShowAssignPrincipalDialog}
          onSuccess={handleAssignPrincipalSuccess}
        />
      )}
    </div>
  );
}
