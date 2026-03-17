import { useState, useEffect, useRef } from "react";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { API_URL } from "@/config/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { OrganizationProgram } from "@/types/organizationPrograms";

interface MaterialEditDialogProps {
  program: OrganizationProgram | null;
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (program: OrganizationProgram) => void;
}

const CEFR_LEVELS = [
  { value: "PreA", label: "Pre-A" },
  { value: "A1", label: "A1" },
  { value: "A2", label: "A2" },
  { value: "B1", label: "B1" },
  { value: "B2", label: "B2" },
  { value: "C1", label: "C1" },
  { value: "C2", label: "C2" },
];

const MAX_TAGS = 5;

export function MaterialEditDialog({
  program,
  organizationId,
  open,
  onOpenChange,
  onSuccess,
}: MaterialEditDialogProps) {
  const token = useTeacherAuthStore((state) => state.token);
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  const [tagInput, setTagInput] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    level: "",
    tags: [] as string[],
    is_active: true,
  });

  // Reset form when program changes
  useEffect(() => {
    if (program) {
      setFormData({
        name: program.name || "",
        description: program.description || "",
        level: program.level || "",
        tags: program.tags || [],
        is_active: program.is_active,
      });
      setTagInput("");
    }
  }, [program]);

  const handleAddTag = () => {
    const tag = tagInput.trim();
    if (!tag) return;
    if (formData.tags.length >= MAX_TAGS) return;
    if (formData.tags.includes(tag)) {
      setTagInput("");
      return;
    }
    setFormData({ ...formData, tags: [...formData.tags, tag] });
    setTagInput("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFormData({
      ...formData,
      tags: formData.tags.filter((t) => t !== tagToRemove),
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!program) return;
    if (submittingRef.current) return;

    if (!formData.name.trim()) {
      toast.error("請填寫教材名稱");
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    try {
      const requestData: {
        name: string;
        is_active: boolean;
        description?: string;
        level?: string;
        tags?: string[];
      } = {
        name: formData.name.trim(),
        is_active: formData.is_active,
      };

      if (formData.description.trim()) {
        requestData.description = formData.description.trim();
      }

      if (formData.level) {
        requestData.level = formData.level;
      }

      requestData.tags = formData.tags;

      const response = await fetch(
        `${API_URL}/api/organizations/${organizationId}/programs/${program.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(requestData),
        },
      );

      if (response.ok) {
        const updatedProgram = await response.json();
        toast.success("教材更新成功");
        onSuccess(updatedProgram);
        onOpenChange(false);
      } else {
        const data = await response.json();
        toast.error(data.detail || "更新失敗");
      }
    } catch (error) {
      console.error("Failed to update program:", error);
      toast.error("網路連線錯誤");
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  if (!program) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>編輯教材</DialogTitle>
          <DialogDescription>修改教材的基本資訊</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 教材名稱 */}
          <div className="space-y-2">
            <Label htmlFor="name">
              教材名稱 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              required
              placeholder="輸入教材名稱"
            />
          </div>

          {/* 描述 */}
          <div className="space-y-2">
            <Label htmlFor="description">描述</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              placeholder="輸入教材描述（選填）"
              rows={3}
            />
          </div>

          {/* CEFR 等級 */}
          <div className="space-y-2">
            <Label htmlFor="level">CEFR 等級</Label>
            <Select
              value={formData.level}
              onValueChange={(value) =>
                setFormData({ ...formData, level: value })
              }
            >
              <SelectTrigger id="level">
                <SelectValue placeholder="選擇等級（選填）" />
              </SelectTrigger>
              <SelectContent>
                {CEFR_LEVELS.map((level) => (
                  <SelectItem key={level.value} value={level.value}>
                    {level.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 標籤 */}
          <div className="space-y-2">
            <Label>
              標籤{" "}
              <span className="text-gray-500 text-xs">
                （最多 {MAX_TAGS} 個）
              </span>
            </Label>
            <div className="flex gap-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="輸入標籤後按 Enter"
                disabled={formData.tags.length >= MAX_TAGS}
              />
            </div>
            {formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.tags.map((tag) => (
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

          {/* 啟用狀態 */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="is_active"
              checked={formData.is_active}
              onCheckedChange={(checked: boolean) =>
                setFormData({ ...formData, is_active: checked })
              }
            />
            <Label htmlFor="is_active" className="cursor-pointer">
              {formData.is_active ? "啟用" : "停用"}
            </Label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              取消
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  更新中...
                </>
              ) : (
                "儲存"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
