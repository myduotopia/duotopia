import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { toast } from "sonner";

interface Lesson {
  id?: number;
  name: string;
  description?: string;
  order_index?: number;
  estimated_minutes?: number;
  program_id?: number;
}

interface LessonDialogProps {
  lesson: Lesson | null;
  dialogType: "create" | "edit" | "delete" | null;
  programId?: number;
  currentLessonCount?: number; // For auto-setting order
  onClose: () => void;
  onSave: (lesson: Lesson) => void;
  onDelete?: (lessonId: number) => void;
  /** Custom API base path for school-level materials (e.g., `/api/schools/{schoolId}`) */
  apiBasePath?: string;
  /** Auth token for API calls (required when using apiBasePath) */
  authToken?: string;
}

export function LessonDialog({
  lesson,
  dialogType,
  programId,
  currentLessonCount = 0,
  onClose,
  onSave,
  onDelete,
  apiBasePath,
  authToken,
}: LessonDialogProps) {
  const { t } = useTranslation();
  const token = useTeacherAuthStore((state) => state.token);
  const [formData, setFormData] = useState<Lesson>({
    name: "",
    description: "",
    order_index: 1,
    program_id: programId,
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submittingRef = useRef(false);

  useEffect(() => {
    if (lesson && (dialogType === "edit" || dialogType === "delete")) {
      setFormData({
        name: lesson.name,
        description: lesson.description || "",
        order_index: lesson.order_index || 1,
        program_id: lesson.program_id || programId,
      });
    } else if (dialogType === "create") {
      setFormData({
        name: "",
        description: "",
        order_index: currentLessonCount + 1, // Auto-set to last position
        program_id: programId,
      });
    }
  }, [lesson, dialogType, programId, currentLessonCount]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name?.trim()) {
      newErrors.name = t("dialogs.lessonDialog.form.nameError");
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
      if (dialogType === "create" && programId) {
        let newLesson: Lesson;
        if (apiBasePath) {
          // Use custom API path for school-level materials
          const response = await fetch(
            `${apiBasePath}/programs/${programId}/lessons`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken || token}`,
              },
              body: JSON.stringify({
                name: formData.name,
                description: formData.description,
                order_index: formData.order_index,
              }),
            },
          );
          if (!response.ok) throw new Error("Failed to create lesson");
          newLesson = await response.json();
        } else {
          newLesson = (await apiClient.createLesson(programId, {
            name: formData.name,
            description: formData.description,
            order_index: formData.order_index,
          })) as Lesson;
        }
        toast.success(
          t("dialogs.lessonDialog.success.created", { name: formData.name }),
        );
        onSave(newLesson);
      } else if (dialogType === "edit" && lesson?.id && programId) {
        if (apiBasePath) {
          // Use custom API path for school-level materials
          const response = await fetch(
            `${apiBasePath}/programs/lessons/${lesson.id}`,
            {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken || token}`,
              },
              body: JSON.stringify({
                name: formData.name,
                description: formData.description,
                order_index: formData.order_index,
              }),
            },
          );
          if (!response.ok) throw new Error("Failed to update lesson");
        } else {
          await apiClient.updateLesson(lesson.id, {
            name: formData.name,
            description: formData.description,
            order_index: formData.order_index,
          });
        }
        toast.success(
          t("dialogs.lessonDialog.success.updated", { name: formData.name }),
        );
        onSave({ ...lesson, ...formData });
      }
      onClose();
    } catch (error) {
      console.error("Failed to save lesson:", error);
      toast.error(t("dialogs.lessonDialog.errors.saveFailed"));
      setErrors({ submit: t("dialogs.lessonDialog.errors.saveFailed") });
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!lesson?.id || !onDelete) return;

    // Directly call the callback, letting the parent component handle the actual deletion logic
    // Parent component will use different APIs depending on whether it's in template mode
    onDelete(lesson.id);
    onClose();
  };

  if (!dialogType) return null;

  // Create/Edit Dialog
  if (dialogType === "create" || dialogType === "edit") {
    return (
      <Dialog open={true} onOpenChange={() => onClose()}>
        <DialogContent
          className="bg-white"
          style={{ backgroundColor: "white" }}
        >
          <DialogHeader>
            <DialogTitle>
              {dialogType === "create"
                ? t("dialogs.lessonDialog.create.title")
                : t("dialogs.lessonDialog.edit.title")}
            </DialogTitle>
            <DialogDescription>
              {dialogType === "create"
                ? t("dialogs.lessonDialog.create.description")
                : t("dialogs.lessonDialog.edit.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div>
              <label htmlFor="name" className="text-sm font-medium">
                {t("dialogs.lessonDialog.form.nameLabel")}{" "}
                <span className="text-red-500">
                  {t("dialogs.lessonDialog.form.nameRequired")}
                </span>
              </label>
              <input
                id="name"
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className={`w-full mt-1 px-3 py-2 border rounded-md ${errors.name ? "border-red-500" : ""}`}
                placeholder={t("dialogs.lessonDialog.form.namePlaceholder")}
              />
              {errors.name && (
                <p className="text-xs text-red-500 mt-1">{errors.name}</p>
              )}
            </div>

            <div>
              <label htmlFor="description" className="text-sm font-medium">
                {t("dialogs.lessonDialog.form.descLabel")}
              </label>
              <textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                className="w-full mt-1 px-3 py-2 border rounded-md"
                placeholder={t("dialogs.lessonDialog.form.descPlaceholder")}
                rows={3}
              />
            </div>

            {dialogType === "create" && (
              <div className="text-sm text-gray-500 bg-gray-50 p-2 rounded">
                {t("dialogs.lessonDialog.form.autoOrderNote")}
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
              {t("dialogs.lessonDialog.buttons.cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading
                ? t("dialogs.lessonDialog.buttons.processing")
                : dialogType === "create"
                  ? t("dialogs.lessonDialog.buttons.create")
                  : t("dialogs.lessonDialog.buttons.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Delete Confirmation Dialog
  if (dialogType === "delete" && lesson) {
    return (
      <Dialog open={true} onOpenChange={() => onClose()}>
        <DialogContent
          className="bg-white"
          style={{ backgroundColor: "white" }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <span>{t("dialogs.lessonDialog.delete.title")}</span>
            </DialogTitle>
            <DialogDescription>
              {t("dialogs.lessonDialog.delete.description", {
                name: lesson.name,
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">
                {t("dialogs.lessonDialog.delete.dataLabel")}
              </p>
              <p className="font-medium mt-1">{lesson.name}</p>
              {lesson.description && (
                <p className="text-sm text-gray-500 mt-1">
                  {lesson.description}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={loading}>
              {t("dialogs.lessonDialog.buttons.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={loading}
            >
              {loading
                ? t("dialogs.lessonDialog.buttons.deleting")
                : t("dialogs.lessonDialog.buttons.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return null;
}
