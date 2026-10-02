import { useState, useRef } from "react";
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

interface CreateClassroomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  schoolName?: string;
  onSuccess: () => void;
}

export function CreateClassroomDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
  onSuccess,
}: CreateClassroomDialogProps) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    level: string;
    grade: number | null;
  }>({
    name: "",
    description: "",
    level: "A1",
    grade: null,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const handleClose = () => {
    setFormData({ name: "", description: "", level: "A1", grade: null });
    onOpenChange(false);
  };

  const handleSubmit = async () => {
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

    // 年級必填（#1097）
    const { grade } = formData;
    if (grade === null) {
      toast.error(t("classroomGrade.required"));
      return;
    }

    if (!schoolId) {
      toast.error(t("schoolClassrooms.messages.schoolIdMissing"));
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await apiClient.createSchoolClassroom(schoolId, {
        name: trimmedName,
        description: formData.description || undefined,
        level: formData.level,
        grade,
      });

      toast.success(t("schoolClassrooms.messages.createSuccess"));
      onSuccess();
      handleClose();
    } catch (error) {
      logError("Failed to create classroom", error, { schoolId, formData });
      toast.error(t("schoolClassrooms.messages.createFailed"));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("schoolClassrooms.dialogs.createTitle")}</DialogTitle>
          <DialogDescription>
            {t("schoolClassrooms.dialogs.createDescription", {
              school:
                schoolName || t("schoolClassrooms.dialogs.schoolFallback"),
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">
              {t("teacherClassrooms.labels.classroomName")} *
            </Label>
            <Input
              id="name"
              placeholder={t("schoolClassrooms.placeholders.name")}
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              disabled={isSubmitting}
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">
              {t("teacherClassrooms.labels.description")}
            </Label>
            <Input
              id="description"
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
            <Label htmlFor="level">
              {t("schoolClassrooms.labels.level")} *
            </Label>
            <Select
              value={formData.level}
              onValueChange={(value) =>
                setFormData({ ...formData, level: value })
              }
              disabled={isSubmitting}
            >
              <SelectTrigger id="level">
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
            <Label htmlFor="grade">
              {t("teacherClassrooms.labels.grade")} *
            </Label>
            <GradeSelect
              id="grade"
              value={formData.grade}
              onChange={(grade) => setFormData({ ...formData, grade })}
              disabled={isSubmitting}
            />
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
              ? t("schoolClassrooms.buttons.creating")
              : t("teacherClassrooms.buttons.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
