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
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Student } from "./StudentListTable";

interface EditStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: Student | null;
  schoolId: string;
  onSuccess: () => void;
}

export function EditStudentDialog({
  open,
  onOpenChange,
  student,
  schoolId,
  onSuccess,
}: EditStudentDialogProps) {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    student_number: "",
    birthdate: "",
    phone: "",
    is_active: true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (student) {
      setFormData({
        name: student.name || "",
        email: student.email || "",
        student_number: student.student_number || "",
        birthdate: student.birthdate || "",
        phone: "", // phone 不在 Student 介面中，但後端支援
        is_active: student.is_active ?? true,
      });
    }
  }, [student, open]);

  const handleClose = () => {
    if (student) {
      setFormData({
        name: student.name || "",
        email: student.email || "",
        student_number: student.student_number || "",
        birthdate: student.birthdate || "",
        phone: "",
        is_active: student.is_active ?? true,
      });
    }
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!student) return;
    if (submittingRef.current) return;

    const trimmedName = formData.name.trim();
    if (!trimmedName) {
      toast.error("請輸入學生姓名");
      return;
    }

    if (trimmedName.length > 100) {
      toast.error("學生姓名不能超過 100 個字元");
      return;
    }

    if (!schoolId) {
      toast.error("找不到學校 ID");
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await apiClient.updateSchoolStudent(schoolId, student.id, {
        name: trimmedName !== student.name ? trimmedName : undefined,
        email:
          formData.email !== (student.email || "")
            ? formData.email || undefined
            : undefined,
        student_number:
          formData.student_number !== (student.student_number || "")
            ? formData.student_number || undefined
            : undefined,
        birthdate:
          formData.birthdate !== student.birthdate
            ? formData.birthdate
            : undefined,
        phone: formData.phone || undefined,
        is_active:
          formData.is_active !== student.is_active
            ? formData.is_active
            : undefined,
      });

      toast.success("學生資訊更新成功");
      onSuccess();
      handleClose();
    } catch (error: unknown) {
      logError("Failed to update student", error, {
        schoolId,
        studentId: student.id,
        formData,
      });

      // Handle specific error messages
      const errorDetail = (error as { detail?: string })?.detail;
      if (errorDetail) {
        toast.error(errorDetail);
      } else {
        toast.error("更新學生失敗，請稍後再試");
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  if (!student) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>編輯學生</DialogTitle>
          <DialogDescription>更新學生資訊</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-name">
              姓名 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="edit-name"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder="請輸入學生姓名"
              disabled={isSubmitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-student_number">學號</Label>
            <Input
              id="edit-student_number"
              value={formData.student_number}
              onChange={(e) =>
                setFormData({ ...formData, student_number: e.target.value })
              }
              placeholder="選填"
              disabled={isSubmitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-email">Email</Label>
            <Input
              id="edit-email"
              type="email"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
              placeholder="選填"
              disabled={isSubmitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-birthdate">
              出生日期{" "}
              <span className="text-xs text-gray-500 font-normal">(選填)</span>
            </Label>
            <Input
              id="edit-birthdate"
              type="date"
              value={formData.birthdate}
              onChange={(e) =>
                setFormData({ ...formData, birthdate: e.target.value })
              }
              disabled={isSubmitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-phone">電話</Label>
            <Input
              id="edit-phone"
              value={formData.phone}
              onChange={(e) =>
                setFormData({ ...formData, phone: e.target.value })
              }
              placeholder="選填"
              disabled={isSubmitting}
            />
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="edit-is_active"
              checked={formData.is_active}
              onCheckedChange={(checked: boolean) =>
                setFormData({ ...formData, is_active: checked })
              }
              disabled={isSubmitting}
            />
            <Label htmlFor="edit-is_active" className="cursor-pointer">
              {formData.is_active ? "啟用" : "停用"}
            </Label>
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
