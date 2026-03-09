import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
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
import { Loader2, User, Lock, ArrowLeft, Zap } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { useTranslation } from "react-i18next";

interface TeacherLoginSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TeacherLoginSheet({
  isOpen,
  onClose,
}: TeacherLoginSheetProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  // 檢查是否為非 production 環境
  const isProduction = import.meta.env.VITE_ENVIRONMENT === "production";
  const showDemoSection = !isProduction;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const result = await apiClient.teacherLogin(formData);

      useTeacherAuthStore.getState().login(result.access_token, {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
        organization_id: result.user.organization_id,
        school_id: result.user.school_id,
        is_demo: result.user.is_demo,
        is_admin: result.user.is_admin,
      });

      onClose();

      // 登入成功後，一律導向個人教師 dashboard
      navigate("/teacher/dashboard");
    } catch (err) {
      console.error("Login failed:", err);
      setError(t("teacherLogin.errors.loginFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickLogin = async (
    email: string,
    password: string = "demo123",
  ) => {
    setIsLoading(true);
    setError("");

    try {
      const result = await apiClient.teacherLogin({ email, password });

      useTeacherAuthStore.getState().login(result.access_token, {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
        organization_id: result.user.organization_id,
        school_id: result.user.school_id,
        is_demo: result.user.is_demo,
        is_admin: result.user.is_admin,
      });

      onClose();

      // 登入成功後，一律導向個人教師 dashboard
      navigate("/teacher/dashboard");
    } catch (err) {
      console.error("Quick login failed:", err);
      setError(t("teacherLogin.errors.quickLoginFailed", { email }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setError("");
    setFormData({ email: "", password: "" });
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
            {t("teacherLogin.header.cardTitle")}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <SheetHeader className="hidden sm:block mb-6">
            <SheetTitle className="text-2xl">
              {t("teacherLogin.header.title")}
            </SheetTitle>
            <SheetDescription>
              {t("teacherLogin.header.subtitle")}
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sheet-email">
                {t("teacherLogin.form.email")}
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="sheet-email"
                  type="email"
                  placeholder={t("teacherLogin.form.emailPlaceholder")}
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
              <Label htmlFor="sheet-password">
                {t("teacherLogin.form.password")}
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="sheet-password"
                  type="password"
                  placeholder={t("teacherLogin.form.passwordPlaceholder")}
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
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

            <Button type="submit" className="w-full h-12" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("teacherLogin.form.loggingIn")}
                </>
              ) : (
                t("teacherLogin.form.login")
              )}
            </Button>

            <div className="text-center">
              <Link
                to="/teacher/forgot-password"
                className="text-sm text-blue-600 hover:underline"
                onClick={handleClose}
              >
                {t("teacherLogin.form.forgotPassword")}
              </Link>
            </div>
          </form>

          {/* Quick Login Section - Only show in non-production */}
          {showDemoSection && (
            <>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white text-gray-500">
                    {t("teacherLogin.demo.separator")}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {/* Demo Teacher */}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start h-12 py-2"
                  onClick={() => handleQuickLogin("demo@duotopia.com")}
                  disabled={isLoading}
                >
                  <Zap className="mr-2 h-4 w-4 text-green-600 flex-shrink-0" />
                  <div className="flex-1 text-left">
                    <div className="font-medium text-sm">
                      {t("teacherLogin.demo.demoTeacher")}
                    </div>
                    <div className="text-xs text-gray-500">
                      {t("teacherLogin.demo.demoEmail")}
                    </div>
                  </div>
                </Button>

                {/* Trial Teacher */}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start h-12 py-2"
                  onClick={() => handleQuickLogin("trial@duotopia.com")}
                  disabled={isLoading}
                >
                  <Zap className="mr-2 h-4 w-4 text-blue-600 flex-shrink-0" />
                  <div className="flex-1 text-left">
                    <div className="font-medium text-sm">
                      {t("teacherLogin.demo.trialTeacher")}
                    </div>
                    <div className="text-xs text-gray-500">
                      {t("teacherLogin.demo.trialEmail")}
                    </div>
                  </div>
                </Button>

                {/* Expired Teacher */}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start h-12 py-2"
                  onClick={() => handleQuickLogin("expired@duotopia.com")}
                  disabled={isLoading}
                >
                  <Zap className="mr-2 h-4 w-4 text-red-600 flex-shrink-0" />
                  <div className="flex-1 text-left">
                    <div className="font-medium text-sm">
                      {t("teacherLogin.demo.expiredTeacher")}
                    </div>
                    <div className="text-xs text-gray-500">
                      {t("teacherLogin.demo.expiredEmail")}
                    </div>
                  </div>
                </Button>

                {/* Organization Test Accounts */}
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-2 bg-white text-gray-500">
                      機構測試帳號
                    </span>
                  </div>
                </div>

                {/* Org Owner */}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start h-12 py-2"
                  onClick={() =>
                    handleQuickLogin("owner@duotopia.com", "demo123")
                  }
                  disabled={isLoading}
                >
                  <Zap className="mr-2 h-4 w-4 text-purple-600 flex-shrink-0" />
                  <div className="flex-1 text-left">
                    <div className="font-medium text-sm">
                      張機構（機構擁有者）
                    </div>
                    <div className="text-xs text-gray-500">
                      owner@duotopia.com
                    </div>
                  </div>
                </Button>

                {/* Org Admin */}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start h-12 py-2"
                  onClick={() =>
                    handleQuickLogin("chen@duotopia.com", "demo123")
                  }
                  disabled={isLoading}
                >
                  <Zap className="mr-2 h-4 w-4 text-indigo-600 flex-shrink-0" />
                  <div className="flex-1 text-left">
                    <div className="font-medium text-sm">
                      陳美玲（機構管理員）
                    </div>
                    <div className="text-xs text-gray-500">
                      chen@duotopia.com
                    </div>
                  </div>
                </Button>

                {/* School Admin */}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start h-12 py-2"
                  onClick={() =>
                    handleQuickLogin("wang@duotopia.com", "demo123")
                  }
                  disabled={isLoading}
                >
                  <Zap className="mr-2 h-4 w-4 text-orange-600 flex-shrink-0" />
                  <div className="flex-1 text-left">
                    <div className="font-medium text-sm">
                      王建國（學校管理員）
                    </div>
                    <div className="text-xs text-gray-500">
                      wang@duotopia.com
                    </div>
                  </div>
                </Button>
              </div>

              {/* Password Hint */}
              <div className="mt-4 p-3 bg-blue-50 rounded-lg text-xs text-gray-600">
                <div className="font-semibold mb-1">
                  🔒 {t("teacherLogin.demo.passwordHint")}
                </div>
                <div className="space-y-1">
                  <div>✅ {t("teacherLogin.demo.demoDescription")}</div>
                  <div>🎁 {t("teacherLogin.demo.trialDescription")}</div>
                  <div>❌ {t("teacherLogin.demo.expiredDescription")}</div>
                </div>
              </div>
            </>
          )}

          <div className="mt-6 pt-6 border-t space-y-3">
            <p className="text-sm text-center text-gray-600">
              {t("teacherLogin.footer.noAccount")}
              <Link
                to="/teacher/register"
                className="text-blue-600 hover:underline ml-1"
                onClick={handleClose}
              >
                {t("teacherLogin.footer.register")}
              </Link>
            </p>
            <p className="text-sm text-center text-gray-600">
              <Link
                to="/student/login"
                className="text-blue-600 hover:underline"
                onClick={handleClose}
              >
                {t("teacherLogin.footer.studentLogin")}
              </Link>
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
