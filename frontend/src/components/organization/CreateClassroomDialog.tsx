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
      toast.error("請輸入班級名稱");
      return;
    }

    if (trimmedName.length > 100) {
      toast.error("班級名稱不能超過 100 個字元");
      return;
    }

    // 年級必填（#1097）
    const { grade } = formData;
    if (grade === null) {
      toast.error(t("classroomGrade.required"));
      return;
    }

    if (!schoolId) {
      toast.error("找不到學校 ID");
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

      toast.success("班級建立成功");
      onSuccess();
      handleClose();
    } catch (error) {
      logError("Failed to create classroom", error, { schoolId, formData });
      toast.error("建立班級失敗，請稍後再試");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>建立新班級</DialogTitle>
          <DialogDescription>
            為 {schoolName || "學校"} 建立一個新的班級
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">班級名稱 *</Label>
            <Input
              id="name"
              placeholder="例如：一年級 A 班"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              disabled={isSubmitting}
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">描述</Label>
            <Input
              id="description"
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
            <Label htmlFor="level">語言程度 *</Label>
            <Select
              value={formData.level}
              onValueChange={(value) =>
                setFormData({ ...formData, level: value })
              }
              disabled={isSubmitting}
            >
              <SelectTrigger id="level">
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
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "建立中..." : "建立"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
