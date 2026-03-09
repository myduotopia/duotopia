import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, User, Lock, Mail, Phone } from "lucide-react";
import { apiClient } from "../lib/api";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { validatePasswordStrength } from "@/utils/passwordValidation";
import { getTeacherDashboardRoute } from "@/utils/authNavigation";

export default function TeacherRegister() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isAuthenticated = useTeacherAuthStore((state) => state.isAuthenticated);
  const user = useTeacherAuthStore((state) => state.user);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Redirect authenticated users to dashboard
  useEffect(() => {
    if (isAuthenticated && user) {
      navigate(getTeacherDashboardRoute(user), {
        replace: true,
      });
    }
  }, [isAuthenticated, user, navigate]);
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

    // Validate password match
    if (formData.password !== formData.confirmPassword) {
      setError(t("teacherRegister.errors.passwordMismatch"));
      return;
    }

    // Validate password strength (frontend validation only, backend will also validate)
    const validation = validatePasswordStrength(formData.password);
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
        password: formData.password,
        name: formData.name,
        phone: formData.phone || undefined,
      })) as RegisterResponse;

      // 🔴 不要自動登入！顯示驗證提示
      if (response.verification_required) {
        // 導向到驗證提示頁面或顯示成功訊息
        navigate("/teacher/verify-email-prompt", {
          state: {
            email: formData.email,
            message:
              response.message ||
              "註冊成功！請檢查您的 Email 信箱並點擊驗證連結。",
          },
        });
      } else {
        // 舊的邏輯（不應該發生）
        navigate("/teacher/dashboard");
      }
    } catch (err) {
      console.error("Registration error:", err);
      // Bug1 Fix: Always use i18n translation, don't show backend error message directly
      setError(t("teacherRegister.errors.registerFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      {/* Language Switcher */}
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>

      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            {t("teacherRegister.header.title")}
          </h1>
          <p className="text-gray-600">
            {t("teacherRegister.header.subtitle")}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("teacherRegister.header.cardTitle")}</CardTitle>
            <CardDescription>
              {t("teacherRegister.header.cardDescription")}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">
                  {t("teacherRegister.form.name")}{" "}
                  {t("teacherRegister.form.nameRequired")}
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="name"
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
                <Label htmlFor="email">
                  {t("teacherRegister.form.email")}{" "}
                  {t("teacherRegister.form.emailRequired")}
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="email"
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
                <Label htmlFor="phone">{t("teacherRegister.form.phone")}</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="phone"
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
                <Label htmlFor="password">
                  {t("teacherRegister.form.password")}{" "}
                  {t("teacherRegister.form.passwordRequired")}
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="password"
                    type="password"
                    placeholder={t("teacherRegister.form.passwordPlaceholder")}
                    value={formData.password}
                    onChange={(e) =>
                      setFormData({ ...formData, password: e.target.value })
                    }
                    className="pl-10"
                    required
                    disabled={isLoading}
                  />
                </div>
                <p className="text-xs text-gray-500">
                  {t("teacherRegister.form.passwordHint")}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">
                  {t("teacherRegister.form.confirmPassword")}{" "}
                  {t("teacherRegister.form.confirmPasswordRequired")}
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder={t("teacherRegister.form.passwordPlaceholder")}
                    value={formData.confirmPassword}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        confirmPassword: e.target.value,
                      })
                    }
                    className="pl-10"
                    required
                    disabled={isLoading}
                  />
                </div>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={isLoading}>
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
          </CardContent>

          <CardFooter className="flex flex-col space-y-2">
            <div className="text-sm text-center text-gray-600">
              {t("teacherRegister.footer.hasAccount")}
              <Link
                to="/teacher/login"
                className="text-blue-600 hover:underline ml-1"
              >
                {t("teacherRegister.footer.login")}
              </Link>
            </div>
            <div className="text-sm text-center text-gray-600">
              <Link
                to="/student/login"
                className="text-blue-600 hover:underline"
              >
                {t("teacherRegister.footer.studentLogin")}
              </Link>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
