import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  User,
  Lock,
  Mail,
  Phone,
  ArrowLeft,
  Eye,
  EyeOff,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { validatePasswordStrength } from "@/utils/passwordValidation";

interface TeacherRegisterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchToLogin?: () => void;
}

export default function TeacherRegisterSheet({
  isOpen,
  onClose,
  onSwitchToLogin,
}: TeacherRegisterSheetProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    name: "",
    phone: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // 先 trim 再驗證，確保驗證的是實際儲存的值
    const trimmedPassword = formData.password.trim();
    const trimmedConfirm = formData.confirmPassword.trim();

    if (trimmedPassword !== trimmedConfirm) {
      setError(t("teacherRegister.errors.passwordMismatch"));
      return;
    }

    const validation = validatePasswordStrength(trimmedPassword);
    if (!validation.valid && validation.errorKey) {
      setError(t(`teacherRegister.errors.${validation.errorKey}`));
      return;
    }

    setIsLoading(true);

    try {
      interface RegisterResponse {
        verification_required?: boolean;
        message?: string;
        email?: string;
      }
      const response = (await apiClient.teacherRegister({
        email: formData.email,
        password: trimmedPassword,
        name: formData.name,
        phone: formData.phone || undefined,
      })) as RegisterResponse;

      onClose();

      if (response.verification_required) {
        navigate("/teacher/verify-email-prompt", {
          state: {
            email: formData.email,
            message: response.message || t("teacherRegister.successMessage"),
          },
        });
      } else {
        navigate("/teacher/dashboard");
      }
    } catch (err) {
      console.error("Registration error:", err);
      setError(t("teacherRegister.errors.registerFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setError("");
    setFormData({
      email: "",
      password: "",
      confirmPassword: "",
      name: "",
      phone: "",
    });
    onClose();
  };

  return (
    <Sheet open={isOpen} onOpenChange={handleClose}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl p-0 flex flex-col data-[state=open]:duration-500 data-[state=closed]:duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-right data-[state=open]:fade-in-0 data-[state=open]:ease-out"
      >
        {/* Custom Header with back arrow for mobile */}
        <div className="flex items-center gap-3 p-4 border-b sm:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="h-8 w-8"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <span className="font-semibold">
            {t("teacherRegister.header.cardTitle")}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <SheetHeader className="hidden sm:block mb-6">
            <SheetTitle className="text-2xl">
              {t("teacherRegister.header.title")}
            </SheetTitle>
            <SheetDescription>
              {t("teacherRegister.header.subtitle")}
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sheet-reg-name">
                {t("teacherRegister.form.name")}{" "}
                {t("teacherRegister.form.nameRequired")}
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="sheet-reg-name"
                  type="text"
                  placeholder={t("teacherRegister.form.namePlaceholder")}
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="pl-10"
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sheet-reg-email">
                {t("teacherRegister.form.email")}{" "}
                {t("teacherRegister.form.emailRequired")}
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="sheet-reg-email"
                  type="email"
                  placeholder={t("teacherRegister.form.emailPlaceholder")}
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  className="pl-10"
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sheet-reg-phone">
                {t("teacherRegister.form.phone")}
              </Label>
              <div className="relative">
                <Phone className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="sheet-reg-phone"
                  type="tel"
                  placeholder={t("teacherRegister.form.phonePlaceholder")}
                  value={formData.phone}
                  onChange={(e) =>
                    setFormData({ ...formData, phone: e.target.value })
                  }
                  className="pl-10"
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sheet-reg-password">
                {t("teacherRegister.form.password")}{" "}
                {t("teacherRegister.form.passwordRequired")}
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="sheet-reg-password"
                  type={showPassword ? "text" : "password"}
                  placeholder={t("teacherRegister.form.passwordPlaceholder")}
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
                  className="pl-10 pr-10"
                  required
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-500">
                {t("teacherRegister.form.passwordHint")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sheet-reg-confirm">
                {t("teacherRegister.form.confirmPassword")}{" "}
                {t("teacherRegister.form.confirmPasswordRequired")}
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="sheet-reg-confirm"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder={t("teacherRegister.form.passwordPlaceholder")}
                  value={formData.confirmPassword}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      confirmPassword: e.target.value,
                    })
                  }
                  className="pl-10 pr-10"
                  required
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={
                    showConfirmPassword ? "Hide password" : "Show password"
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="w-full h-12" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("teacherRegister.form.registering")}
                </>
              ) : (
                t("teacherRegister.form.register")
              )}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t space-y-3">
            <p className="text-sm text-center text-gray-600">
              {t("teacherRegister.footer.hasAccount")}
              <button
                type="button"
                className="text-blue-600 hover:underline ml-1"
                onClick={() => {
                  handleClose();
                  onSwitchToLogin?.();
                }}
              >
                {t("teacherRegister.footer.login")}
              </button>
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
