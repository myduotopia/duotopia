import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { useOrganization } from "@/contexts/OrganizationContext";
import { API_URL } from "@/config/api";
import { useProgramAPI } from "@/hooks/useProgramAPI";
import { Breadcrumb } from "@/components/organization/Breadcrumb";
import { LoadingSpinner } from "@/components/organization/LoadingSpinner";
import { ErrorMessage } from "@/components/organization/ErrorMessage";
import { ProgramTreeView } from "@/components/shared/ProgramTreeView";
import { ProgramTreeProgram } from "@/hooks/useProgramTree";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OrganizationProgram } from "@/types/organizationPrograms";
import { BookOpen, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";

const MAX_TAGS = 5;

/**
 * MaterialsPage - Manage organization-level educational programs/materials
 */
export default function MaterialsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const token = useTeacherAuthStore((state) => state.token);
  const userRoles = useTeacherAuthStore((state) => state.userRoles);
  const { selectedNode } = useOrganization();

  const [programs, setPrograms] = useState<OrganizationProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [organization, setOrganization] = useState<{ name: string } | null>(
    null,
  );
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newProgramName, setNewProgramName] = useState("");
  const [newProgramDescription, setNewProgramDescription] = useState("");
  const [newProgramLevel, setNewProgramLevel] = useState("");
  const [newProgramTags, setNewProgramTags] = useState<string[]>([]);
  const [newProgramTagInput, setNewProgramTagInput] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const creatingRef = useRef(false);

  const effectiveOrgId =
    orgId ||
    (selectedNode?.type === "organization" ? selectedNode.id : undefined);

  // Use unified Programs API
  const api = useProgramAPI({
    scope: "organization",
    organizationId: effectiveOrgId,
  });

  // Memoized callback to prevent infinite loop
  const handleProgramsChange = useCallback(
    (updatedPrograms: ProgramTreeProgram[]) => {
      setPrograms(updatedPrograms as OrganizationProgram[]);
    },
    [],
  );

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

  const fetchPrograms = useCallback(async () => {
    if (!effectiveOrgId) return;

    try {
      setLoading(true);
      setError(null);

      const data = await api.getPrograms();
      setPrograms(data);
    } catch (error) {
      console.error("Failed to fetch programs:", error);
      setError("載入教材列表失敗");
      toast.error("載入教材列表失敗");
    } finally {
      setLoading(false);
    }
  }, [effectiveOrgId, api]);

  useEffect(() => {
    if (effectiveOrgId) {
      fetchPrograms();
    }
  }, [effectiveOrgId, fetchPrograms]);

  // Check if current user can manage materials
  const canManageMaterials =
    userRoles.includes("org_owner") || userRoles.includes("org_admin");

  const handleAddTag = () => {
    const tag = newProgramTagInput.trim();
    if (!tag) return;
    if (newProgramTags.length >= MAX_TAGS) return;
    if (newProgramTags.includes(tag)) {
      setNewProgramTagInput("");
      return;
    }
    setNewProgramTags([...newProgramTags, tag]);
    setNewProgramTagInput("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setNewProgramTags(newProgramTags.filter((t) => t !== tagToRemove));
  };

  // Handle create program
  const handleCreateProgram = async () => {
    if (creatingRef.current) return;
    if (!newProgramName.trim()) {
      toast.error("請輸入教材名稱");
      return;
    }

    creatingRef.current = true;
    try {
      setIsCreating(true);
      await api.createProgram({
        name: newProgramName.trim(),
        description: newProgramDescription.trim() || undefined,
        level: newProgramLevel || undefined,
        tags: newProgramTags.length > 0 ? newProgramTags : undefined,
      });
      toast.success("教材建立成功");
      setCreateDialogOpen(false);
      setNewProgramName("");
      setNewProgramDescription("");
      setNewProgramLevel("");
      setNewProgramTags([]);
      setNewProgramTagInput("");
      fetchPrograms(); // Refresh the list
    } catch (error) {
      console.error("Failed to create program:", error);
      toast.error("建立教材失敗");
    } finally {
      creatingRef.current = false;
      setIsCreating(false);
    }
  };

  if (!effectiveOrgId) {
    return (
      <div className="p-8 text-center">
        <BookOpen className="w-16 h-16 mx-auto mb-4 text-gray-300" />
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
          { label: "組織教材" },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">組織教材</h1>
          <p className="text-gray-600 mt-2">管理組織層級的教學教材與課程</p>
        </div>
        {canManageMaterials && (
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            新增教材
          </Button>
        )}
      </div>

      {/* Programs Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            教材列表 {!loading && `(共 ${programs.length} 個教材)`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingSpinner />
          ) : error ? (
            <ErrorMessage
              message={error}
              onRetry={() => window.location.reload()}
            />
          ) : programs.length === 0 ? (
            <div className="text-center py-12">
              <BookOpen className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500 mb-2">此組織尚無教材</p>
              {canManageMaterials && (
                <p className="text-sm text-gray-400 mt-4">
                  點擊上方「新增教材」按鈕開始建立
                </p>
              )}
            </div>
          ) : (
            <div className="mt-4">
              <ProgramTreeView
                programs={programs}
                onProgramsChange={handleProgramsChange}
                onRefresh={fetchPrograms}
                showCreateButton={canManageMaterials}
                createButtonText="新增教材"
                scope="organization"
                organizationId={effectiveOrgId}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Program Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增教材</DialogTitle>
            <DialogDescription>
              建立新的組織教材，可包含多個課程和教學內容
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="program-name">教材名稱 *</Label>
              <Input
                id="program-name"
                placeholder="輸入教材名稱"
                value={newProgramName}
                onChange={(e) => setNewProgramName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="program-description">教材描述</Label>
              <Textarea
                id="program-description"
                placeholder="輸入教材描述（選填）"
                value={newProgramDescription}
                onChange={(e) => setNewProgramDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="program-level">CEFR 等級</Label>
              <Select
                value={newProgramLevel}
                onValueChange={setNewProgramLevel}
              >
                <SelectTrigger id="program-level">
                  <SelectValue placeholder="選擇等級（選填）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="preA">Pre-A</SelectItem>
                  <SelectItem value="A1">A1</SelectItem>
                  <SelectItem value="A2">A2</SelectItem>
                  <SelectItem value="B1">B1</SelectItem>
                  <SelectItem value="B2">B2</SelectItem>
                  <SelectItem value="C1">C1</SelectItem>
                  <SelectItem value="C2">C2</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>
                標籤{" "}
                <span className="text-gray-500 text-xs">
                  （最多 {MAX_TAGS} 個）
                </span>
              </Label>
              <Input
                value={newProgramTagInput}
                onChange={(e) => setNewProgramTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="輸入標籤後按 Enter"
                disabled={newProgramTags.length >= MAX_TAGS}
              />
              {newProgramTags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {newProgramTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm border border-blue-200"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="ml-2 text-blue-500 hover:text-blue-700"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
              disabled={isCreating}
            >
              取消
            </Button>
            <Button onClick={handleCreateProgram} disabled={isCreating}>
              {isCreating ? "建立中..." : "建立教材"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
