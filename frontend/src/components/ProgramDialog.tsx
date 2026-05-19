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
import { AlertTriangle } from "lucide-react";
import { apiClient } from "@/lib/api";
import { Program } from "@/types";
import { useTranslation } from "react-i18next";

interface ProgramDialogProps {
  program: Program | null;
  dialogType: "create" | "edit" | "delete" | null;
  classroomId?: number;
  isTemplate?: boolean;
  organizationId?: string;
  onClose: () => void;
  onSave: (program: Program) => void;
  onDelete?: (programId: number) => void;
}

// Local form data type that makes id optional for creation
interface ProgramFormData {
  id?: number;
  name: string;
  description?: string;
  level?: string;
  estimated_hours?: number;
  classroom_id?: number;
  tags?: string[];
}

export function ProgramDialog({
  program,
  dialogType,
  classroomId,
  isTemplate = false,
  organizationId,
  onClose,
  onSave,
  onDelete,
}: ProgramDialogProps) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<ProgramFormData>({
    name: "",
    description: "",
    level: "A1",
    classroom_id: classroomId,
    tags: [],
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tagInput, setTagInput] = useState("");
  const submittingRef = useRef(false);

  useEffect(() => {
    if (program && (dialogType === "edit" || dialogType === "delete")) {
      setFormData({
        name: program.name,
        description: program.description || "",
        level: program.level || "A1",
        classroom_id: program.classroom_id || classroomId,
        tags: program.tags || [],
      });
    } else if (dialogType === "create") {
      setFormData({
        name: "",
        description: "",
        level: "A1",
        classroom_id: classroomId,
        tags: [],
      });
    }
  }, [program, dialogType, classroomId]);

  const handleAddTag = () => {
    if (!tagInput) return;

    if ((formData.tags?.length || 0) >= 5) {
      setErrors({ ...errors, tags: t("dialogs.programDialog.form.tagsError") });
      return;
    }

    if (formData.tags?.includes(tagInput)) {
      setErrors({
        ...errors,
        tags: t("dialogs.programDialog.form.tagsDuplicate"),
      });
      return;
    }

    setFormData({
      ...formData,
      tags: [...(formData.tags || []), tagInput],
    });
    setTagInput("");
    setErrors({ ...errors, tags: "" });
  };

  const handleRemoveTag = (tag: string) => {
    setFormData({
      ...formData,
      tags: formData.tags?.filter((t) => t !== tag) || [],
    });
    if (errors.tags) {
      setErrors({ ...errors, tags: "" });
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name?.trim()) {
      newErrors.name = t("dialogs.programDialog.form.nameError");
    }

    if (!formData.level) {
      newErrors.level = t("dialogs.programDialog.form.levelError");
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
        const newProgram = organizationId
          ? await apiClient.post(
              `/api/organizations/${organizationId}/programs`,
              {
                name: formData.name,
                description: formData.description,
                level: formData.level,
                tags: formData.tags,
              },
            )
          : await apiClient.createProgram({
              name: formData.name,
              description: formData.description,
              level: formData.level,
              classroom_id: isTemplate
                ? undefined
                : formData.classroom_id || classroomId,
              tags: formData.tags,
              is_template: isTemplate,
            });
        // Ensure the new program has all required Program properties
        const completeProgram: Program = {
          ...(newProgram as Program),
          id: (newProgram as Program)?.id || 0, // Default ID if not provided
        };
        onSave(completeProgram);
      } else if (dialogType === "edit" && program?.id) {
        if (organizationId) {
          await apiClient.put(
            `/api/organizations/${organizationId}/programs/${program.id}`,
            {
              name: formData.name,
              description: formData.description,
              level: formData.level,
              tags: formData.tags,
            },
          );
        } else {
          await apiClient.updateProgram(program.id!, {
            name: formData.name,
            description: formData.description,
            level: formData.level,
            tags: formData.tags,
          });
        }
        // Ensure the updated program has all required Program properties
        const updatedProgram: Program = {
          ...program,
          ...formData,
          id: program.id,
        };
        onSave(updatedProgram);
      }
      onClose();
    } catch (error) {
      console.error("Failed to save program:", error);
      setErrors({ submit: t("dialogs.programDialog.errors.saveFailed") });
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!program?.id || !onDelete) return;
    if (submittingRef.current) return;

    submittingRef.current = true;
    setLoading(true);
    try {
      if (organizationId) {
        await apiClient.delete(
          `/api/organizations/${organizationId}/programs/${program.id}`,
        );
      } else {
        await apiClient.deleteProgram(program.id);
      }
      onDelete(program.id);
      onClose();
    } catch (error) {
      console.error("Failed to delete program:", error);
      alert(t("dialogs.programDialog.errors.deleteFailed"));
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
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
              {t(`dialogs.programDialog.${dialogType}.title`)}
            </DialogTitle>
            <DialogDescription>
              {t(`dialogs.programDialog.${dialogType}.description`)}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div>
              <label htmlFor="name" className="text-sm font-medium">
                {t("dialogs.programDialog.form.nameLabel")}{" "}
                <span className="text-red-500">
                  {t("dialogs.programDialog.form.nameRequired")}
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
                placeholder={t("dialogs.programDialog.form.namePlaceholder")}
              />
              {errors.name && (
                <p className="text-xs text-red-500 mt-1">{errors.name}</p>
              )}
            </div>

            <div>
              <label htmlFor="description" className="text-sm font-medium">
                {t("dialogs.programDialog.form.descLabel")}
              </label>
              <textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                className="w-full mt-1 px-3 py-2 border rounded-md"
                placeholder={t("dialogs.programDialog.form.descPlaceholder")}
                rows={3}
              />
            </div>

            <div>
              <label htmlFor="level" className="text-sm font-medium">
                {t("dialogs.programDialog.form.levelLabel")}{" "}
                <span className="text-red-500">
                  {t("dialogs.programDialog.form.levelRequired")}
                </span>
              </label>
              <select
                id="level"
                value={formData.level}
                onChange={(e) =>
                  setFormData({ ...formData, level: e.target.value })
                }
                className={`w-full mt-1 px-3 py-2 border rounded-md ${errors.level ? "border-red-500" : ""}`}
              >
                <option value="preA">
                  {t("dialogs.programDialog.form.levels.PREA")}
                </option>
                <option value="A1">
                  {t("dialogs.programDialog.form.levels.A1")}
                </option>
                <option value="A2">
                  {t("dialogs.programDialog.form.levels.A2")}
                </option>
                <option value="B1">
                  {t("dialogs.programDialog.form.levels.B1")}
                </option>
                <option value="B2">
                  {t("dialogs.programDialog.form.levels.B2")}
                </option>
                <option value="C1">
                  {t("dialogs.programDialog.form.levels.C1")}
                </option>
                <option value="C2">
                  {t("dialogs.programDialog.form.levels.C2")}
                </option>
              </select>
              {errors.level && (
                <p className="text-xs text-red-500 mt-1">{errors.level}</p>
              )}
            </div>

            {/* Tags Input */}
            <div>
              <label htmlFor="tags" className="text-sm font-medium">
                {t("dialogs.programDialog.form.tagsLabel")}{" "}
                <span className="text-gray-500 text-xs">
                  {t("dialogs.programDialog.form.tagsNote")}
                </span>
              </label>
              <input
                id="tags"
                type="text"
                value={tagInput}
                onChange={(e) => {
                  setTagInput(e.target.value);
                  if (errors.tags) {
                    setErrors({ ...errors, tags: "" });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                className={`w-full mt-1 px-3 py-2 border rounded-md ${errors.tags ? "border-red-500" : ""}`}
                placeholder={t("dialogs.programDialog.form.tagsPlaceholder")}
                disabled={(formData.tags?.length || 0) >= 5}
              />
              {errors.tags && (
                <p className="text-xs text-red-500 mt-1">{errors.tags}</p>
              )}

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
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {errors.submit && (
              <p className="text-sm text-red-500 bg-red-50 p-2 rounded">
                {errors.submit}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={loading}>
              {t("dialogs.programDialog.buttons.cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading
                ? t("dialogs.programDialog.buttons.processing")
                : t(
                    `dialogs.programDialog.buttons.${dialogType === "create" ? "create" : "save"}`,
                  )}
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
              <span>{t("dialogs.programDialog.delete.title")}</span>
            </DialogTitle>
            <DialogDescription>
              {t("dialogs.programDialog.delete.description", {
                name: program.name,
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">
                {t("dialogs.programDialog.delete.dataLabel")}
              </p>
              <p className="font-medium mt-1">{program.name}</p>
              {program.description && (
                <p className="text-sm text-gray-500 mt-1">
                  {program.description}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={loading}>
              {t("dialogs.programDialog.buttons.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={loading}
            >
              {loading
                ? t("dialogs.programDialog.delete.deleting")
                : t("dialogs.programDialog.delete.confirmBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return null;
}
