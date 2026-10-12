import { useState, useEffect, useRef } from "react";
import { apiClient } from "@/lib/api";
import { logError } from "@/utils/errorLogger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { GradeSelect } from "@/components/classroom/GradeSelect";
import { isValidGrade } from "@/components/classroom/classroomGrade";

interface Classroom {
  id: string;
  name: string;
  program_level: string;
  grade?: number | null;
  is_active: boolean;
}

interface EditClassroomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classroom: Classroom | null;
  onSuccess: () => void;
}

export function EditClassroomDialog({
  open,
  onOpenChange,
  classroom,
  onSuccess,
}: EditClassroomDialogProps) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    level: string;
    grade: number | null;
    is_active: boolean;
  }>({
    name: "",
    description: "",
    level: "A1",
    grade: null,
    is_active: true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  // 每次打開都從班級資料重新帶入，取消後再開不會殘留上次未儲存的修改（#1097）
  useEffect(() => {
    if (open && classroom) {
      setFormData({
        name: classroom.name,
        description: "", // API response may not include description
        level: classroom.program_level || "A1",
        grade: isValidGrade(classroom.grade) ? classroom.grade : null,
        is_active: classroom.is_active,
      });
    }
  }, [classroom, open]);

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!classroom) return;
    if (submittingRef.current) return;

    // Validation
    const trimmedName = formData.name.trim();
    if (!trimmedName) {
      toast.error(t("teacherClassrooms.messages.nameRequired"));
      return;
    }

    if (trimmedName.length > 100) {
      toast.error(t("schoolClassrooms.messages.nameTooLong"));
      return;
    }

    // 年級必填（#1097）：尚未設定年級的班級編輯時也要補選
    const { grade } = formData;
    if (grade === null) {
      toast.error(t("classroomGrade.required"));
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await apiClient.updateSchoolClassroom(parseInt(classroom.id), {
        name: trimmedName,
        description: formData.description || undefined,
        level: formData.level,
        grade,
        is_active: formData.is_active,
      });

      toast.success(t("schoolClassrooms.messages.updateSuccess"));
      onSuccess();
      handleClose();
    } catch (error) {
      logError("Failed to update classroom", error, {
        classroomId: classroom.id,
        formData,
      });
      toast.error(t("teacherClassrooms.messages.updateFailed"));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  if (!classroom) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("teacherClassrooms.dialogs.editTitle")}</DialogTitle>
          <DialogDescription>
            {t("schoolClassrooms.dialogs.editDescription", {
              name: classroom.name,
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">
              {t("teacherClassrooms.labels.classroomName")} *
            </Label>
            <Input
              id="edit-name"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              disabled={isSubmitting}
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-description">
              {t("teacherClassrooms.labels.description")}
            </Label>
            <Input
              id="edit-description"
              placeholder={t("teacherClassrooms.placeholders.description")}
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              disabled={isSubmitting}
              maxLength={500}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-level">
              {t("schoolClassrooms.labels.level")} *
            </Label>
            <Select
              value={formData.level}
              onValueChange={(value) =>
                setFormData({ ...formData, level: value })
              }
              disabled={isSubmitting}
            >
              <SelectTrigger id="edit-level">
                <SelectValue
                  placeholder={t("schoolClassrooms.placeholders.level")}
                />
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
            <Label htmlFor="edit-grade">
              {t("teacherClassrooms.labels.grade")} *
            </Label>
            <GradeSelect
              id="edit-grade"
              value={formData.grade}
              onChange={(grade) => setFormData({ ...formData, grade })}
              disabled={isSubmitting}
            />
          </div>
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="edit-active"
              checked={formData.is_active}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  is_active: e.target.checked,
                })
              }
              disabled={isSubmitting}
              className="h-4 w-4"
            />
            <Label htmlFor="edit-active">
              {t("schoolClassrooms.labels.activeToggle")}
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting
              ? t("schoolClassrooms.buttons.saving")
              : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
