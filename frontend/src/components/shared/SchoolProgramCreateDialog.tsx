import { useEffect, useMemo, useState } from "react";
import { API_URL } from "@/config/api";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { useProgramCopy } from "@/hooks/useProgramCopy";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";

interface OrganizationProgram {
  id: number;
  name: string;
  description?: string;
  level?: string;
  estimated_hours?: number;
}

const MAX_TAGS = 5;

interface SchoolProgramCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  schoolName: string;
  organizationId?: string | null;
  onSuccess: () => void;
}

export function SchoolProgramCreateDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
  organizationId,
  onSuccess,
}: SchoolProgramCreateDialogProps) {
  const token = useTeacherAuthStore((state) => state.token);
  const { copyProgram } = useProgramCopy();

  const [tab, setTab] = useState("organization");
  const [loadingPrograms, setLoadingPrograms] = useState(false);
  const [programs, setPrograms] = useState<OrganizationProgram[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customLevel, setCustomLevel] = useState("A1");
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState("");

  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelected(new Set());
      setCustomName("");
      setCustomDescription("");
      setCustomLevel("A1");
      setCustomTags([]);
      setCustomTagInput("");
    }
  }, [open]);

  useEffect(() => {
    if (!open || !organizationId) return;

    const fetchPrograms = async () => {
      setLoadingPrograms(true);
      try {
        const response = await fetch(
          `${API_URL}/api/programs?scope=organization&organization_id=${organizationId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (!response.ok) {
          throw new Error("Failed to load organization programs");
        }
        const data = await response.json();
        setPrograms(data);
      } catch (error) {
        console.error("Failed to load organization programs:", error);
        toast.error("載入組織教材失敗");
      } finally {
        setLoadingPrograms(false);
      }
    };

    fetchPrograms();
  }, [open, organizationId, token]);

  const filteredPrograms = useMemo(() => {
    if (!search.trim()) return programs;
    const keyword = search.toLowerCase();
    return programs.filter((program) =>
      program.name.toLowerCase().includes(keyword),
    );
  }, [programs, search]);

  const toggleSelection = (programId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(programId)) {
        next.delete(programId);
      } else {
        next.add(programId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelected(new Set(filteredPrograms.map((program) => program.id)));
  };

  const handleClear = () => {
    setSelected(new Set());
  };

  const handleCopy = async () => {
    if (!selected.size) {
      toast.error("請選擇至少一個組織教材");
      return;
    }

    setSaving(true);
    try {
      for (const programId of selected) {
        await copyProgram({
          programId,
          targetScope: "school",
          targetId: schoolId,
        });
      }
      toast.success("已複製至機構教材");
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error("Failed to copy programs:", error);
      toast.error("複製失敗");
    } finally {
      setSaving(false);
    }
  };

  const handleAddCustomTag = () => {
    const tag = customTagInput.trim();
    if (!tag) return;
    if (customTags.length >= MAX_TAGS) return;
    if (customTags.includes(tag)) {
      setCustomTagInput("");
      return;
    }
    setCustomTags([...customTags, tag]);
    setCustomTagInput("");
  };

  const handleRemoveCustomTag = (tagToRemove: string) => {
    setCustomTags(customTags.filter((t) => t !== tagToRemove));
  };

  const handleCreateCustom = async () => {
    if (!customName.trim()) {
      toast.error("請填寫教材名稱");
      return;
    }

    setSaving(true);
    try {
      // 創建學校層級的教材（僅供此學校使用）
      const response = await fetch(
        `${API_URL}/api/schools/${schoolId}/programs`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: customName.trim(),
            description: customDescription.trim() || undefined,
            level: customLevel,
            tags: customTags.length > 0 ? customTags : undefined,
          }),
        },
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "建立失敗");
      }

      toast.success("機構教材建立成功");
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error("Failed to create program:", error);
      toast.error("建立失敗");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>建立課程到「{schoolName}」</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="organization">從組織複製</TabsTrigger>
            <TabsTrigger value="custom">自建學校課程</TabsTrigger>
          </TabsList>

          <TabsContent value="organization" className="space-y-4">
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg mb-4">
              <p className="text-sm text-green-800">
                ✅ 從組織教材複製到學校，所有組織教材都可以在此選擇並複製。
              </p>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                className="pl-9"
                placeholder="搜尋組織教材..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>
                已選擇 {selected.size} / {filteredPrograms.length} 個教材
              </span>
              <div className="space-x-3">
                <button
                  type="button"
                  className="text-blue-600"
                  onClick={handleSelectAll}
                >
                  全選
                </button>
                <button
                  type="button"
                  className="text-gray-500"
                  onClick={handleClear}
                >
                  清除
                </button>
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-3 border rounded-lg p-3">
              {loadingPrograms ? (
                <div className="flex items-center justify-center py-10 text-gray-500">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  載入中...
                </div>
              ) : filteredPrograms.length === 0 ? (
                <div className="text-center py-10 text-gray-500">
                  沒有可用的組織教材
                </div>
              ) : (
                filteredPrograms.map((program) => (
                  <label
                    key={program.id}
                    className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-gray-50"
                  >
                    <Checkbox
                      checked={selected.has(program.id)}
                      onCheckedChange={() => toggleSelection(program.id)}
                    />
                    <div className="space-y-1">
                      <div className="font-medium text-gray-900">
                        {program.name}
                      </div>
                      {program.description && (
                        <div className="text-sm text-gray-500">
                          {program.description}
                        </div>
                      )}
                    </div>
                  </label>
                ))
              )}
            </div>

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                取消
              </Button>
              <Button onClick={handleCopy} disabled={saving || !selected.size}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    複製中...
                  </>
                ) : (
                  "建立課程"
                )}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="custom" className="space-y-4">
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg mb-4">
              <p className="text-sm text-blue-800">
                💡 <strong>提示</strong>：此處創建的課程僅供此學校使用。
                <br />
                若要創建所有分校都可使用的組織教材，請前往「組織教材」頁面。
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="school-program-name">
                課程名稱 <span className="text-red-500">*</span>
              </Label>
              <Input
                id="school-program-name"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="輸入課程名稱"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="school-program-desc">描述</Label>
              <Textarea
                id="school-program-desc"
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
                placeholder="輸入課程描述（選填）"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="school-program-level">程度</Label>
              <Select value={customLevel} onValueChange={setCustomLevel}>
                <SelectTrigger id="school-program-level">
                  <SelectValue placeholder="選擇程度" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PREA">PRE-A</SelectItem>
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
                value={customTagInput}
                onChange={(e) => setCustomTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddCustomTag();
                  }
                }}
                placeholder="輸入標籤後按 Enter"
                disabled={customTags.length >= MAX_TAGS}
              />
              {customTags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {customTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm border border-blue-200"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveCustomTag(tag)}
                        className="ml-2 text-blue-500 hover:text-blue-700"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                取消
              </Button>
              <Button onClick={handleCreateCustom} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    建立中...
                  </>
                ) : (
                  "建立課程"
                )}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
