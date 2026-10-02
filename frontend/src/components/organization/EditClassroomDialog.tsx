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

  useEffect(() => {
    if (classroom) {
      setFormData({
        name: classroom.name,
        description: "", // API response may not include description
        level: classroom.program_level || "A1",
        grade: isValidGrade(classroom.grade) ? classroom.grade : null,
        is_active: classroom.is_active,
      });
    }
  }, [classroom]);

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!classroom) return;
    if (submittingRef.current) return;

    // Validation
    const trimmedName = formData.name.trim();
    if (!trimmedName) {
      toast.error("請輸入班級名稱");
      return;
    }

    if (trimmedName.length > 100) {
      toast.error("班級名稱不能超過 100 個字元");
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

      toast.success("班級更新成功");
      onSuccess();
      handleClose();
    } catch (error) {
      logError("Failed to update classroom", error, {
        classroomId: classroom.id,
        formData,
      });
      toast.error("更新班級失敗，請稍後再試");
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
          <DialogTitle>編輯班級</DialogTitle>
          <DialogDescription>更新 {classroom.name} 的資訊</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">班級名稱 *</Label>
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
            <Label htmlFor="edit-description">描述</Label>
            <Input
              id="edit-description"
              placeholder="班級描述（選填）"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              disabled={isSubmitting}
              maxLength={500}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-level">語言程度 *</Label>
            <Select
              value={formData.level}
              onValueChange={(value) =>
                setFormData({ ...formData, level: value })
              }
              disabled={isSubmitting}
            >
              <SelectTrigger id="edit-level">
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
            <Label htmlFor="edit-active">啟用班級</Label>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "儲存中..." : "儲存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
