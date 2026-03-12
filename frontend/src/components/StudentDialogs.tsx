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
  Trash2,
  Plus,
  Mail,
  Phone,
  Calendar,
  School,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export interface Student {
  id: number;
  name: string;
  email?: string; // Make email optional to match global Student type
  student_number?: string;
  birthdate?: string;
  password_changed?: boolean;
  last_login?: string | null;
  status?: string;
  classroom_id?: number;
  classroom_name?: string;
  phone?: string;
  enrollment_date?: string;
}

interface StudentDialogsProps {
  student: Student | null;
  dialogType: "view" | "create" | "edit" | "delete" | null;
  onClose: () => void;
  onSave: (student: Student) => void | Promise<void>;
  onDelete: (studentId: number) => void | Promise<void>;
  onSwitchToEdit?: () => void;
  classrooms?: Array<{ id: number; name: string }>;
}

export function StudentDialogs({
  student,
  dialogType,
  onClose,
  onSave,
  onDelete,
  onSwitchToEdit,
  classrooms = [],
}: StudentDialogsProps) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<Partial<Student>>({
    name: "",
    email: "",
    student_number: "",
    birthdate: "",
    phone: "",
    // 如果只有一個班級（從班級頁面新增），自動設定為該班級
    classroom_id: classrooms.length === 1 ? classrooms[0].id : undefined,
    status: "active",
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submittingRef = useRef(false);

  useEffect(() => {
    if (student && (dialogType === "edit" || dialogType === "view")) {
      setFormData({
        name: student.name || "",
        email: student.email || "",
        student_number: student.student_number || "",
        birthdate: student.birthdate || "",
        phone: student.phone || "",
        classroom_id: student.classroom_id,
        status: student.status || "active",
      });
    } else if (dialogType === "create") {
      setFormData({
        name: "",
        email: "",
        student_number: "",
        birthdate: "",
        phone: "",
        // 如果只有一個班級（從班級頁面新增），自動設定為該班級
        classroom_id: classrooms.length === 1 ? classrooms[0].id : undefined,
        status: "active",
      });
    }
  }, [student, dialogType, classrooms]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name?.trim()) {
      newErrors.name = t("dialogs.studentDialogs.form.nameError");
    }

    // Email 是選填，但如果有填寫則檢查格式
    if (
      formData.email?.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)
    ) {
      newErrors.email = t("dialogs.studentDialogs.form.emailError");
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
        // Create new student - ensure required fields are present
        // Normalize empty strings to undefined for optional fields
        const createData = {
          name: formData.name || "",
          email: formData.email?.trim() || undefined,
          birthdate: formData.birthdate || "",
          student_number: formData.student_number?.trim() || undefined,
          phone: formData.phone?.trim() || undefined,
          classroom_id: formData.classroom_id,
        };

        const response = (await apiClient.createStudent(createData)) as Record<
          string,
          unknown
        >;

        const defaultPassword = response.default_password as string;

        // Check for warning message about unassigned students
        if (response.warning) {
          toast.warning(
            <div>
              <p>
                {t("studentDialogs.success.created", { name: formData.name })}
              </p>
              <p className="text-sm mt-1 text-orange-600">
                ⚠️ {response.warning as string}
              </p>
              {defaultPassword ? (
                <p className="text-sm mt-1">
                  {t("studentDialogs.success.createdWithPassword", {
                    password: "",
                  })}
                  <code className="bg-gray-100 px-1 rounded">
                    {defaultPassword}
                  </code>
                </p>
              ) : null}
            </div>,
            { duration: 8000 },
          );
        } else {
          // Show default password from API response
          if (defaultPassword) {
            toast.success(
              <div>
                <p>
                  {t("studentDialogs.success.created", { name: formData.name })}
                </p>
                <p className="text-sm mt-1">
                  {t("studentDialogs.success.createdWithPassword", {
                    password: "",
                  })}
                  <code className="bg-gray-100 px-1 rounded">
                    {defaultPassword}
                  </code>
                </p>
              </div>,
              { duration: 5000 },
            );
          } else {
            toast.success(
              t("studentDialogs.success.created", { name: formData.name }),
            );
          }
        }
        // 只傳遞 Student interface 需要的字段
        const newStudent: Student = {
          id: response.id as number,
          name: response.name as string,
          email: response.email as string,
          student_number: response.student_number as string | undefined,
          birthdate: response.birthdate as string | undefined,
          password_changed: response.password_changed as boolean | undefined,
          classroom_id: response.classroom_id as number | undefined,
          status: "active",
        };
        // 等待 onSave 完成（包含資料重新整理）後再關閉對話框
        await onSave(newStudent);
      } else if (dialogType === "edit" && student) {
        // Update existing student
        const response = (await apiClient.updateStudent(
          student.id,
          formData,
        )) as Record<string, unknown>;
        toast.success(
          t("dialogs.studentDialogs.success.updated", { name: student.name }),
        );
        // 等待 onSave 完成（包含資料重新整理）後再關閉對話框
        await onSave({ ...student, ...(response as Partial<Student>) });
      }
      onClose();
    } catch (error) {
      console.error("Error saving student:", error);

      // Parse error message
      let errorMessage = t("studentDialogs.errors.saveFailed");

      if (error && typeof error === "object" && "message" in error) {
        try {
          // Try to parse JSON error response
          const errorData = JSON.parse((error as Error).message);

          // Handle Pydantic validation errors
          if (Array.isArray(errorData.detail)) {
            const validationErrors = errorData.detail;
            const fieldErrors: Record<string, string> = {};

            validationErrors.forEach((err: { loc?: string[]; msg: string }) => {
              const field = err.loc?.[1]; // Get field name from location
              const msg = err.msg;

              if (field === "classroom_id") {
                // classroom_id is optional, skip this error
                return;
              } else if (field === "name") {
                fieldErrors.name = t("studentDialogs.errors.nameRequired");
              } else if (field === "birthdate") {
                fieldErrors.birthdate = t(
                  "studentDialogs.errors.birthdateRequired",
                );
              } else if (field === "email") {
                fieldErrors.email =
                  err.msg || t("studentDialogs.form.emailError");
              } else {
                errorMessage =
                  msg || t("studentDialogs.errors.validationFailed");
              }
            });

            if (Object.keys(fieldErrors).length > 0) {
              setErrors(fieldErrors);
              errorMessage = t("studentDialogs.errors.fixErrors");
            }
          } else if (typeof errorData.detail === "string") {
            errorMessage = errorData.detail;
          } else {
            errorMessage = errorData.detail || errorMessage;
          }
        } catch {
          // If not JSON, use the message directly
          errorMessage = (error as Error).message;
        }
      }

      // Handle specific error cases - ensure errorMessage is always a string
      const finalErrorMessage =
        typeof errorMessage === "string"
          ? errorMessage
          : t("studentDialogs.errors.saveFailed");

      if (finalErrorMessage.includes("already registered")) {
        const emailError = t("studentDialogs.errors.emailInUse");
        setErrors({ email: emailError });
        toast.error(emailError);
      } else if (finalErrorMessage.includes("Invalid birthdate format")) {
        const birthdateError = t("studentDialogs.errors.invalidBirthdate");
        setErrors({ birthdate: birthdateError });
        toast.error(birthdateError);
      } else if (finalErrorMessage.includes("Field required")) {
        const requiredError = t("studentDialogs.errors.requiredFields");
        toast.error(requiredError);
      } else if (
        finalErrorMessage.includes("在班級中已存在") ||
        finalErrorMessage.includes("在此班級中已存在")
      ) {
        // Handle duplicate student number error (updated error message)
        setErrors({ student_number: finalErrorMessage });
        toast.error(finalErrorMessage);
      } else {
        // Default error message
        toast.error(finalErrorMessage);
      }
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!student) return;
    if (submittingRef.current) return;

    submittingRef.current = true;
    setLoading(true);
    try {
      await apiClient.deleteStudent(student.id);
      toast.success(
        t("dialogs.studentDialogs.success.deleted", { name: student.name }),
      );
      // 等待 onDelete 完成（包含資料重新整理）後再關閉對話框
      await onDelete(student.id);
      onClose();
    } catch (error) {
      console.error("Error deleting student:", error);
      toast.error(t("studentDialogs.errors.deleteFailed"));
      setErrors({ submit: t("studentDialogs.errors.deleteRetry") });
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    return date.toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case "active":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            {t("studentDialogs.view.badges.active")}
          </span>
        );
      case "inactive":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            {t("studentDialogs.view.badges.inactive")}
          </span>
        );
      case "suspended":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
            {t("studentDialogs.view.badges.suspended")}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            {t("studentDialogs.view.badges.unknown")}
          </span>
        );
    }
  };

  // View Dialog
  if (dialogType === "view" && student) {
    return (
      <Dialog open={true} onOpenChange={() => onClose()}>
        <DialogContent
          className="bg-white max-w-2xl"
          style={{ backgroundColor: "white" }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Eye className="h-5 w-5" />
              <span>{t("studentDialogs.view.title")}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Student Avatar and Basic Info */}
            <div className="flex items-start space-x-4">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
                <span className="text-2xl font-medium text-blue-600">
                  {student.name.charAt(0)}
                </span>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold">{student.name}</h3>
                <p className="text-sm text-gray-500">
                  {t("studentDialogs.view.fields.studentNumber")}:{" "}
                  {student.student_number || "-"}
                </p>
              </div>
              <div>{getStatusBadge(student.status)}</div>
            </div>

            {/* Detailed Information */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Mail className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-xs text-gray-500">
                      {t("studentDialogs.view.fields.email")}
                    </p>
                    <p className="text-sm font-medium">{student.email}</p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Phone className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-xs text-gray-500">
                      {t("studentDialogs.view.fields.phone")}
                    </p>
                    <p className="text-sm font-medium">
                      {student.phone || "-"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-xs text-gray-500">
                      {t("studentDialogs.view.fields.birthdate")}
                    </p>
                    <p className="text-sm font-medium">
                      {formatDate(student.birthdate)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <School className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-xs text-gray-500">
                      {t("studentDialogs.view.fields.classroom")}
                    </p>
                    <p className="text-sm font-medium">
                      {student.classroom_name || "-"}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-gray-500">
                    {t("studentDialogs.view.fields.passwordStatus")}
                  </p>
                  <p className="text-sm font-medium">
                    {student.password_changed ? (
                      <span className="text-green-600">
                        {t("studentDialogs.view.status.changed")}
                      </span>
                    ) : (
                      <span className="text-yellow-600">
                        {t("studentDialogs.view.status.usingDefault")}
                      </span>
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500">
                    {t("studentDialogs.view.fields.lastLogin")}
                  </p>
                  <p className="text-sm font-medium">
                    {student.last_login
                      ? formatDate(student.last_login)
                      : t("studentDialogs.view.status.neverLoggedIn")}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("studentDialogs.view.buttons.close")}
            </Button>
            <Button
              onClick={() => {
                if (onSwitchToEdit) {
                  onSwitchToEdit();
                }
              }}
            >
              <Edit className="h-4 w-4 mr-2" />
              {t("studentDialogs.view.buttons.edit")}
            </Button>
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
                  <span>{t("studentDialogs.create.title")}</span>
                </>
              ) : (
                <>
                  <Edit className="h-5 w-5" />
                  <span>{t("studentDialogs.edit.title")}</span>
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {dialogType === "create"
                ? t("studentDialogs.create.description")
                : t("studentDialogs.edit.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="name" className="text-sm font-medium">
                  {t("studentDialogs.form.nameLabel")}{" "}
                  <span className="text-red-500">*</span>
                </label>
                <input
                  id="name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className={`w-full mt-1 px-3 py-2 border rounded-md ${errors.name ? "border-red-500" : ""}`}
                  placeholder={t("studentDialogs.form.namePlaceholder")}
                />
                {errors.name && (
                  <p className="text-xs text-red-500 mt-1">{errors.name}</p>
                )}
              </div>

              <div>
                <label htmlFor="student_id" className="text-sm font-medium">
                  {t("studentDialogs.form.studentNumberLabel")}
                </label>
                <input
                  id="student_id"
                  value={formData.student_number}
                  onChange={(e) =>
                    setFormData({ ...formData, student_number: e.target.value })
                  }
                  className={`w-full mt-1 px-3 py-2 border rounded-md ${errors.student_number ? "border-red-500" : ""}`}
                  placeholder={t(
                    "studentDialogs.form.studentNumberPlaceholder",
                  )}
                />
                {errors.student_number && (
                  <p className="text-xs text-red-500 mt-1">
                    {errors.student_number}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="email" className="text-sm font-medium">
                  {t("studentDialogs.form.emailLabel")}
                </label>
                <input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  className={`w-full mt-1 px-3 py-2 border rounded-md ${errors.email ? "border-red-500" : ""}`}
                  placeholder={t("studentDialogs.form.emailPlaceholder")}
                />
                {errors.email && (
                  <p className="text-xs text-red-500 mt-1">{errors.email}</p>
                )}
              </div>

              <div>
                <label htmlFor="phone" className="text-sm font-medium">
                  {t("studentDialogs.form.phoneLabel")}
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) =>
                    setFormData({ ...formData, phone: e.target.value })
                  }
                  className="w-full mt-1 px-3 py-2 border rounded-md"
                  placeholder={t("studentDialogs.form.phonePlaceholder")}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="birthdate" className="text-sm font-medium">
                  {t("studentDialogs.form.birthdateLabel")}{" "}
                  <span className="text-xs text-gray-500 font-normal ml-1">
                    {t("studentDialogs.form.emailOptional")}
                  </span>
                </label>
                <input
                  id="birthdate"
                  type="date"
                  value={formData.birthdate}
                  onChange={(e) =>
                    setFormData({ ...formData, birthdate: e.target.value })
                  }
                  className="w-full mt-1 px-3 py-2 border rounded-md"
                  max={new Date().toISOString().split("T")[0]}
                />
              </div>

              <div>
                <label htmlFor="classroom" className="text-sm font-medium">
                  {t("studentDialogs.form.classroomLabel")}
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
                  className="w-full mt-1 px-3 py-2 border rounded-md"
                >
                  <option value="">
                    {t("studentDialogs.form.classroomUnassigned")}
                  </option>
                  {classrooms.map((classroom) => (
                    <option key={classroom.id} value={classroom.id}>
                      {classroom.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {dialogType === "edit" && (
              <div>
                <label htmlFor="status" className="text-sm font-medium">
                  {t("studentDialogs.form.statusLabel")}
                </label>
                <select
                  id="status"
                  value={formData.status}
                  onChange={(e) =>
                    setFormData({ ...formData, status: e.target.value })
                  }
                  className="w-full mt-1 px-3 py-2 border rounded-md"
                >
                  <option value="active">
                    {t("studentDialogs.form.statusActive")}
                  </option>
                  <option value="inactive">
                    {t("studentDialogs.form.statusInactive")}
                  </option>
                  <option value="suspended">
                    {t("studentDialogs.form.statusSuspended")}
                  </option>
                </select>
              </div>
            )}

            {dialogType === "create" && (
              <p className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
                ℹ️ {t("studentDialogs.form.verifiedEmailNote")}
              </p>
            )}

            {errors.submit && (
              <p className="text-sm text-red-500 bg-red-50 p-2 rounded">
                {errors.submit}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={loading}>
              {t("studentDialogs.buttons.cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading
                ? t("studentDialogs.buttons.processing")
                : dialogType === "create"
                  ? t("studentDialogs.buttons.create")
                  : t("studentDialogs.buttons.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Delete Confirmation Dialog
  if (dialogType === "delete" && student) {
    return (
      <Dialog open={true} onOpenChange={() => onClose()}>
        <DialogContent
          className="bg-white"
          style={{ backgroundColor: "white" }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <span>{t("studentDialogs.delete.title")}</span>
            </DialogTitle>
            <DialogDescription>
              {t("studentDialogs.delete.description", { name: student.name })}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">
                {t("studentDialogs.delete.info")}
              </p>
              <p className="font-medium">{student.name}</p>
              <p className="text-sm text-gray-500">{student.email}</p>
              {student.classroom_name && (
                <p className="text-sm text-gray-500">
                  {t("studentDialogs.delete.classroom", {
                    classroom: student.classroom_name,
                  })}
                </p>
              )}
            </div>

            {errors.submit && (
              <p className="text-sm text-red-500 mt-4">{errors.submit}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={loading}>
              {t("studentDialogs.buttons.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={loading}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {loading
                ? t("studentDialogs.buttons.deleting")
                : t("studentDialogs.buttons.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return null;
}
