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
import { toast } from "sonner";

interface CreateStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  onSuccess: () => void | Promise<void>;
}

export function CreateStudentDialog({
  open,
  onOpenChange,
  schoolId,
  onSuccess,
}: CreateStudentDialogProps) {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    student_number: "",
    birthdate: "",
    phone: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const handleClose = () => {
    setFormData({
      name: "",
      email: "",
      student_number: "",
      birthdate: "",
      phone: "",
    });
    onOpenChange(false);
  };

  const handleSubmit = async () => {
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
      // 確保空字串被轉換為 undefined，避免 422 錯誤
      const requestData: {
        name: string;
        email?: string;
        student_number?: string;
        birthdate?: string;
        phone?: string;
      } = {
        name: trimmedName,
      };

      // 只添加非空的生日
      if (formData.birthdate && formData.birthdate.trim()) {
        requestData.birthdate = formData.birthdate.trim();
      }

      // 只添加非空欄位
      if (formData.email && formData.email.trim()) {
        requestData.email = formData.email.trim();
      }
      if (formData.student_number && formData.student_number.trim()) {
        requestData.student_number = formData.student_number.trim();
      }
      if (formData.phone && formData.phone.trim()) {
        requestData.phone = formData.phone.trim();
      }

      const result = (await apiClient.createSchoolStudent(
        schoolId,
        requestData,
      )) as { default_password?: string };

      toast.success("學生建立成功", {
        description: result.default_password
          ? `預設密碼：${result.default_password}`
          : undefined,
      });
      // 等待 onSuccess 完成（包含資料重新整理）後再關閉對話框
      await onSuccess();
      handleClose();
    } catch (error) {
      logError("Failed to create student", error, { schoolId, formData });
      toast.error("建立學生失敗，請稍後再試");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>建立學生</DialogTitle>
          <DialogDescription>在學校中建立新學生</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">
              姓名 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder="請輸入學生姓名"
              disabled={isSubmitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="student_number">學號</Label>
            <Input
              id="student_number"
              value={formData.student_number}
              onChange={(e) =>
                setFormData({ ...formData, student_number: e.target.value })
              }
              placeholder="選填"
              disabled={isSubmitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
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
            <Label htmlFor="birthdate">
              出生日期{" "}
              <span className="text-xs text-gray-500 font-normal">
                (選填)
              </span>
            </Label>
            <Input
              id="birthdate"
              type="date"
              value={formData.birthdate}
              onChange={(e) =>
                setFormData({ ...formData, birthdate: e.target.value })
              }
              disabled={isSubmitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="phone">電話</Label>
            <Input
              id="phone"
              value={formData.phone}
              onChange={(e) =>
                setFormData({ ...formData, phone: e.target.value })
              }
              placeholder="選填"
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
