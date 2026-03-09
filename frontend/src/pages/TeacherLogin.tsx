import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
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
import { Loader2, User, Lock, Zap, Home } from "lucide-react";
import { apiClient } from "../lib/api";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { getTeacherDashboardRoute } from "@/utils/authNavigation";

export default function TeacherLogin() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isAuthenticated = useTeacherAuthStore((state) => state.isAuthenticated);
  const user = useTeacherAuthStore((state) => state.user);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  // Redirect authenticated users to dashboard
  useEffect(() => {
    if (isAuthenticated && user) {
      navigate(getTeacherDashboardRoute(user), { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  // 檢查是否為 demo 模式 (通過 URL 參數 ?is_demo=true)
  const searchParams = new URLSearchParams(window.location.search);
  const isDemoMode = searchParams.get("is_demo") === "true";

  // 檢查環境
  const isProduction = import.meta.env.VITE_ENVIRONMENT === "production";
  const showDemoBlocks = !isProduction || isDemoMode;

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

      // 登入成功後，一律導向個人教師 dashboard
      navigate("/teacher/dashboard");
    } catch (err) {
      console.error("🔑 [ERROR] 登入失敗:", err);
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
      const result = await apiClient.teacherLogin({
        email,
        password,
      });

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

      // 快速登入成功後，一律導向個人教師 dashboard
      navigate("/teacher/dashboard");
    } catch (err) {
      console.error("🔑 [ERROR] 快速登入失敗:", err);
      setError(t("teacherLogin.errors.quickLoginFailed", { email }));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      {/* Home link */}
      <div className="absolute top-4 left-4">
        <Link to="/">
          <Button
            variant="ghost"
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 h-12 min-h-12"
          >
            <Home className="h-4 w-4" />
            <span>{t("teacherLogin.header.home")}</span>
          </Button>
        </Link>
      </div>

      {/* Language Switcher */}
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>

      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            {t("teacherLogin.header.title")}
          </h1>
          <p className="text-gray-600">{t("teacherLogin.header.subtitle")}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("teacherLogin.header.cardTitle")}</CardTitle>
            <CardDescription>
              {t("teacherLogin.header.cardDescription")}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t("teacherLogin.form.email")}</Label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="email"
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
                <Label htmlFor="password">
                  {t("teacherLogin.form.password")}
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="password"
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

              <Button
                type="submit"
                className="w-full h-12 min-h-12"
                disabled={isLoading}
              >
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
                >
                  {t("teacherLogin.form.forgotPassword")}
                </Link>
              </div>
            </form>

            {/* Quick Login Buttons - 只在非 production 或有 ?is_demo=true 時顯示 */}
            {showDemoBlocks && (
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
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start h-14 min-h-14 py-3"
                    onClick={() => handleQuickLogin("demo@duotopia.com")}
                    disabled={isLoading}
                  >
                    <Zap className="mr-2 h-4 w-4 text-green-600 flex-shrink-0" />
                    <div className="flex-1 text-left">
                      <div className="font-medium">
                        {t("teacherLogin.demo.demoTeacher")}
                      </div>
                      <div className="text-xs text-gray-500">
                        {t("teacherLogin.demo.demoEmail")}
                      </div>
                    </div>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start h-14 min-h-14 py-3"
                    onClick={() => handleQuickLogin("trial@duotopia.com")}
                    disabled={isLoading}
                  >
                    <Zap className="mr-2 h-4 w-4 text-blue-600 flex-shrink-0" />
                    <div className="flex-1 text-left">
                      <div className="font-medium text-xs sm:text-sm truncate">
                        {t("teacherLogin.demo.trialTeacher")}
                      </div>
                      <div className="text-xs text-gray-500">
                        {t("teacherLogin.demo.trialEmail")}
                      </div>
                    </div>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start h-14 min-h-14 py-3"
                    onClick={() => handleQuickLogin("expired@duotopia.com")}
                    disabled={isLoading}
                  >
                    <Zap className="mr-2 h-4 w-4 text-red-600 flex-shrink-0" />
                    <div className="flex-1 text-left">
                      <div className="font-medium">
                        {t("teacherLogin.demo.expiredTeacher")}
                      </div>
                      <div className="text-xs text-gray-500">
                        {t("teacherLogin.demo.expiredEmail")}
                      </div>
                    </div>
                  </Button>

                  {/* 機構測試帳號分隔線 */}
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

                  {/* 機構擁有者 */}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start h-14 min-h-14 py-3"
                    onClick={() =>
                      handleQuickLogin("owner@duotopia.com", "demo123")
                    }
                    disabled={isLoading}
                  >
                    <Zap className="mr-2 h-4 w-4 text-purple-600 flex-shrink-0" />
                    <div className="flex-1 text-left">
                      <div className="font-medium">張機構（機構擁有者）</div>
                      <div className="text-xs text-gray-500">
                        owner@duotopia.com
                      </div>
                    </div>
                  </Button>

                  {/* 機構管理員 */}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start h-14 min-h-14 py-3"
                    onClick={() =>
                      handleQuickLogin("chen@duotopia.com", "demo123")
                    }
                    disabled={isLoading}
                  >
                    <Zap className="mr-2 h-4 w-4 text-indigo-600 flex-shrink-0" />
                    <div className="flex-1 text-left">
                      <div className="font-medium">陳美玲（機構管理員）</div>
                      <div className="text-xs text-gray-500">
                        chen@duotopia.com
                      </div>
                    </div>
                  </Button>

                  {/* 學校管理員 */}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start h-14 min-h-14 py-3"
                    onClick={() =>
                      handleQuickLogin("wang@duotopia.com", "demo123")
                    }
                    disabled={isLoading}
                  >
                    <Zap className="mr-2 h-4 w-4 text-orange-600 flex-shrink-0" />
                    <div className="flex-1 text-left">
                      <div className="font-medium">王建國（學校管理員）</div>
                      <div className="text-xs text-gray-500">
                        wang@duotopia.com
                      </div>
                    </div>
                  </Button>

                  {/* 教師 - 劉芳華 */}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start h-14 min-h-14 py-3"
                    onClick={() =>
                      handleQuickLogin("liu@duotopia.com", "demo123")
                    }
                    disabled={isLoading}
                  >
                    <Zap className="mr-2 h-4 w-4 text-purple-600 flex-shrink-0" />
                    <div className="flex-1 text-left">
                      <div className="font-medium">劉芳華（教師）</div>
                      <div className="text-xs text-gray-500">
                        liu@duotopia.com
                      </div>
                    </div>
                  </Button>

                  {/* 教師 - 張志明 */}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start h-14 min-h-14 py-3"
                    onClick={() =>
                      handleQuickLogin("zhang@duotopia.com", "demo123")
                    }
                    disabled={isLoading}
                  >
                    <Zap className="mr-2 h-4 w-4 text-amber-600 flex-shrink-0" />
                    <div className="flex-1 text-left">
                      <div className="font-medium">張志明（教師）</div>
                      <div className="text-xs text-gray-500">
                        zhang@duotopia.com
                      </div>
                    </div>
                  </Button>

                  {/* 教師 - 李雅婷 */}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start h-14 min-h-14 py-3"
                    onClick={() =>
                      handleQuickLogin("lee@duotopia.com", "demo123")
                    }
                    disabled={isLoading}
                  >
                    <Zap className="mr-2 h-4 w-4 text-teal-600 flex-shrink-0" />
                    <div className="flex-1 text-left">
                      <div className="font-medium">李雅婷（教師）</div>
                      <div className="text-xs text-gray-500">
                        lee@duotopia.com
                      </div>
                    </div>
                  </Button>
                </div>
              </>
            )}
          </CardContent>

          <CardFooter className="flex flex-col space-y-2">
            <div className="text-sm text-center text-gray-600">
              {t("teacherLogin.footer.noAccount")}
              <Link
                to="/teacher/register"
                className="text-blue-600 hover:underline ml-1"
              >
                {t("teacherLogin.footer.register")}
              </Link>
            </div>
            <div className="text-sm text-center text-gray-600">
              <Link
                to="/student/login"
                className="text-blue-600 hover:underline"
              >
                {t("teacherLogin.footer.studentLogin")}
              </Link>
            </div>
          </CardFooter>
        </Card>

        {/* 測試帳號說明 - 只在非 production 或有 ?is_demo=true 時顯示 */}
        {showDemoBlocks && (
          <div className="mt-4 space-y-3">
            <div className="p-3 bg-blue-50 rounded-lg text-xs text-gray-600">
              <div className="font-semibold mb-1">
                🔒 {t("teacherLogin.demo.passwordHint")}
              </div>
              <div className="space-y-1">
                <div>✅ {t("teacherLogin.demo.demoDescription")}</div>
                <div>🎁 {t("teacherLogin.demo.trialDescription")}</div>
                <div>❌ {t("teacherLogin.demo.expiredDescription")}</div>
              </div>
            </div>

            <div className="p-3 bg-green-50 rounded-lg text-xs text-gray-600">
              <div className="font-semibold mb-1">🔑 個人測試帳號密碼</div>
              <div className="space-y-1">
                <div>💚 demo@duotopia.com - demo123（Demo 教師）</div>
                <div>💙 trial@duotopia.com - demo123（試用教師）</div>
                <div>❤️ expired@duotopia.com - demo123（過期教師）</div>
              </div>
            </div>

            <div className="p-3 bg-purple-50 rounded-lg text-xs text-gray-600">
              <div className="font-semibold mb-1">🏢 機構測試帳號密碼</div>
              <div className="space-y-1">
                <div>💜 owner@duotopia.com - demo123（機構擁有者）</div>
                <div>💙 chen@duotopia.com - demo123（機構管理員）</div>
                <div>🧡 wang@duotopia.com - demo123（學校管理員）</div>
                <div>💚 liu@duotopia.com - demo123（教師）</div>
                <div>💚 zhang@duotopia.com - demo123（教師）</div>
                <div>💚 lee@duotopia.com - demo123（教師）</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
