import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  Eye,
  Edit,
  Plus,
  BookOpen,
  Clock,
  Users,
  Layers,
  X,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export interface Program {
  id: number;
  name: string;
  description?: string;
  classroom_id: number;
  classroom_name: string;
  estimated_hours?: number;
  level: string;
  status?: "active" | "draft" | "archived";
  lesson_count?: number;
  student_count?: number;
  created_at?: string;
  updated_at?: string;
  tags?: string[];
}

interface ProgramDialogsProps {
  program: Program | null;
  dialogType: "view" | "create" | "edit" | "delete" | null;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  onSwitchToEdit?: () => void;
  classrooms?: Array<{ id: number; name: string }>;
}

export function ProgramDialogs({
  program,
  dialogType,
  onClose,
  onSave,
  onDelete,
  onSwitchToEdit,
  classrooms = [],
}: ProgramDialogsProps) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<Partial<Program>>({
    name: "",
    description: "",
    classroom_id: undefined,
    level: "beginner",
    status: "draft",
    tags: [],
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tagInput, setTagInput] = useState("");
  const submittingRef = useRef(false);

  useEffect(() => {
    if (program && (dialogType === "edit" || dialogType === "view")) {
      setFormData({
        name: program.name,
        description: program.description || "",
        classroom_id: program.classroom_id,
        level: program.level,
        status: program.status || "draft",
        tags: program.tags || [],
      });
      setTagInput("");
    } else if (dialogType === "create") {
      setFormData({
        name: "",
        description: "",
        classroom_id: classrooms.length === 1 ? classrooms[0].id : undefined,
        level: "beginner",
        status: "draft",
        tags: [],
      });
      setTagInput("");
    }
  }, [program, dialogType, classrooms]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name?.trim()) {
      newErrors.name = "課程名稱為必填";
    }

    if (!formData.classroom_id) {
      newErrors.classroom_id = "請選擇班級";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    if (!validateForm()) return;

    submittingRef.current = true;
    setLoading(true);
    try {
      if (dialogType === "create") {
        await apiClient.createProgram({
          name: formData.name!,
          description: formData.description,
          classroom_id: formData.classroom_id!,
          level: formData.level || "beginner",
          tags: formData.tags,
        });
        toast.success(
          t("dialogs.programDialogs.success.created", { name: formData.name }),
        );
        onSave();
      } else if (dialogType === "edit" && program) {
        await apiClient.updateProgram(program.id, formData);
        toast.success(
          t("dialogs.programDialogs.success.updated", { name: formData.name }),
        );
        onSave();
      }
      onClose();
    } catch (error) {
      console.error("Error saving program:", error);
      toast.error(t("dialogs.programDialogs.errors.saveFailed"));
      setErrors({ submit: "儲存失敗，請稍後再試" });
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!program) return;
    if (submittingRef.current) return;

    submittingRef.current = true;
    setLoading(true);
    try {
      await apiClient.deleteProgram(program.id);
      toast.success(
        t("dialogs.programDialogs.success.deleted", { name: program.name }),
      );
      onDelete();
      onClose();
    } catch (error) {
      console.error("Error deleting program:", error);
      toast.error(t("dialogs.programDialogs.errors.deleteFailed"));
      setErrors({ submit: "刪除失敗，請稍後再試" });
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const MAX_TAGS = 5;

  const handleAddTag = () => {
    const tag = tagInput.trim();
    if (!tag) return;
    if ((formData.tags?.length || 0) >= MAX_TAGS) return;
    if (formData.tags?.includes(tag)) {
      setTagInput("");
      return;
    }
    setFormData({ ...formData, tags: [...(formData.tags || []), tag] });
    setTagInput("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFormData({
      ...formData,
      tags: formData.tags?.filter((t) => t !== tagToRemove) || [],
    });
  };

  const getLevelLabel = (level: string) => {
    const levels: Record<string, string> = {
      beginner: "初級",
      intermediate: "中級",
      advanced: "高級",
      expert: "專家",
    };
    return levels[level] || level;
  };

  const getStatusLabel = (status?: string) => {
    const statuses: Record<string, string> = {
      active: "進行中",
      draft: "草稿",
      archived: "已封存",
    };
    return statuses[status || ""] || "未知";
  };

  // View Dialog
  if (dialogType === "view" && program) {
    return (
      <Dialog open={true} onOpenChange={() => onClose()}>
        <DialogContent
          className="bg-white max-w-2xl"
          style={{ backgroundColor: "white" }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Eye className="h-5 w-5" />
              <span>課程詳情</span>
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="flex items-start space-x-4">
              <div className="w-16 h-16 bg-blue-100 rounded-lg flex items-center justify-center">
                <BookOpen className="h-8 w-8 text-blue-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold">{program.name}</h3>
                <p className="text-sm text-gray-500">ID: {program.id}</p>
                {program.description && (
                  <p className="text-sm text-gray-600 mt-2">
                    {program.description}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    program.status === "active"
                      ? "bg-green-100 text-green-800"
                      : program.status === "draft"
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {getStatusLabel(program.status)}
                </span>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    program.level === "beginner"
                      ? "bg-green-100 text-green-800"
                      : program.level === "intermediate"
                        ? "bg-blue-100 text-blue-800"
                        : program.level === "advanced"
                          ? "bg-purple-100 text-purple-800"
                          : "bg-red-100 text-red-800"
                  }`}
                >
                  {getLevelLabel(program.level)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Layers className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-xs text-gray-500">所屬班級</p>
                    <p className="text-sm font-medium">
                      {program.classroom_name}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-xs text-gray-500">預計時數</p>
                    <p className="text-sm font-medium">
                      {program.estimated_hours || "-"} 小時
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <BookOpen className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-xs text-gray-500">課程單元</p>
                    <p className="text-sm font-medium">
                      {program.lesson_count || 0} 個課程單元
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Users className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-xs text-gray-500">學生人數</p>
                    <p className="text-sm font-medium">
                      {program.student_count || 0} 位學生
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              關閉
            </Button>
            {onSwitchToEdit && (
              <Button onClick={onSwitchToEdit}>
                <Edit className="h-4 w-4 mr-2" />
                編輯
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Create/Edit Dialog
  if (dialogType === "create" || dialogType === "edit") {
    return (
      <Dialog open={true} onOpenChange={() => onClose()}>
        <DialogContent
          className="bg-white max-w-2xl"
          style={{ backgroundColor: "white" }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              {dialogType === "create" ? (
                <>
                  <Plus className="h-5 w-5" />
                  <span>新增課程</span>
                </>
              ) : (
                <>
                  <Edit className="h-5 w-5" />
                  <span>編輯課程</span>
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {dialogType === "create" ? "建立新的課程計畫" : "更新課程資訊"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div>
              <label htmlFor="name" className="text-sm font-medium">
                課程名稱 <span className="text-red-500">*</span>
              </label>
              <input
                id="name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className={`w-full mt-1 px-3 py-2 border rounded-md ${errors.name ? "border-red-500" : ""}`}
                placeholder="請輸入課程名稱"
                aria-label="課程名稱"
              />
              {errors.name && (
                <p className="text-xs text-red-500 mt-1">{errors.name}</p>
              )}
            </div>

            <div>
              <label htmlFor="description" className="text-sm font-medium">
                課程描述
              </label>
              <textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                className="w-full mt-1 px-3 py-2 border rounded-md"
                placeholder="請輸入課程描述（選填）"
                rows={3}
                aria-label="課程描述"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="classroom" className="text-sm font-medium">
                  所屬班級 <span className="text-red-500">*</span>
                </label>
                <select
                  id="classroom"
                  value={formData.classroom_id || ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      classroom_id: e.target.value
                        ? Number(e.target.value)
                        : undefined,
                    })
                  }
                  className={`w-full mt-1 px-3 py-2 border rounded-md ${errors.classroom_id ? "border-red-500" : ""}`}
                  aria-label="所屬班級"
                >
                  <option value="">請選擇班級</option>
                  {classrooms.map((classroom) => (
                    <option key={classroom.id} value={classroom.id}>
                      {classroom.name}
                    </option>
                  ))}
                </select>
                {errors.classroom_id && (
                  <p className="text-xs text-red-500 mt-1">
                    {errors.classroom_id}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="level" className="text-sm font-medium">
                  課程等級
                </label>
                <select
                  id="level"
                  value={formData.level}
                  onChange={(e) =>
                    setFormData({ ...formData, level: e.target.value })
                  }
                  className="w-full mt-1 px-3 py-2 border rounded-md"
                  aria-label="課程等級"
                >
                  <option value="beginner">初級</option>
                  <option value="intermediate">中級</option>
                  <option value="advanced">高級</option>
                  <option value="expert">專家</option>
                </select>
              </div>
            </div>

            {/* 標籤 */}
            <div>
              <label className="text-sm font-medium">
                標籤{" "}
                <span className="text-gray-500 text-xs">
                  （最多 {MAX_TAGS} 個）
                </span>
              </label>
              <div className="flex gap-2 mt-1">
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  className="w-full px-3 py-2 border rounded-md"
                  placeholder="輸入標籤後按 Enter"
                  disabled={(formData.tags?.length || 0) >= MAX_TAGS}
                />
              </div>
              {formData.tags && formData.tags.length > 0 && (
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

            {dialogType === "edit" && (
              <div>
                <label htmlFor="status" className="text-sm font-medium">
                  狀態
                </label>
                <select
                  id="status"
                  value={formData.status}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      status: e.target.value as
                        | "active"
                        | "draft"
                        | "archived",
                    })
                  }
                  className="w-full mt-1 px-3 py-2 border rounded-md"
                >
                  <option value="draft">草稿</option>
                  <option value="active">進行中</option>
                  <option value="archived">已封存</option>
                </select>
              </div>
            )}

            {errors.submit && (
              <p className="text-sm text-red-500 bg-red-50 p-2 rounded">
                {errors.submit}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={loading}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading
                ? "處理中..."
                : dialogType === "create"
                  ? "確定新增"
                  : "儲存變更"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Delete Confirmation Dialog
  if (dialogType === "delete" && program) {
    return (
      <Dialog open={true} onOpenChange={() => onClose()}>
        <DialogContent
          className="bg-white"
          style={{ backgroundColor: "white" }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <span>確認刪除課程</span>
            </DialogTitle>
            <DialogDescription>
              確定要刪除課程「{program.name}」嗎？此操作無法復原。
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">課程資料：</p>
              <p className="font-medium">{program.name}</p>
              <p className="text-sm text-gray-500">
                班級：{program.classroom_name}
              </p>
              {program.lesson_count && program.lesson_count > 0 && (
                <p className="text-sm text-red-500 mt-2">
                  ⚠️ 此課程包含 {program.lesson_count} 個課程單元
                </p>
              )}
            </div>

            {errors.submit && (
              <p className="text-sm text-red-500 mt-4">{errors.submit}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={loading}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={loading}
            >
              {loading ? "刪除中..." : "確認刪除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return null;
}
