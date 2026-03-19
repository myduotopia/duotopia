import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  Lock,
  CheckCircle,
  XCircle,
  Eye,
  EyeOff,
  Building2,
} from "lucide-react";
import { apiClient } from "../lib/api";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTranslation } from "react-i18next";
import { validatePasswordStrength } from "@/utils/passwordValidation";

export default function TeacherSetupPassword() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [tokenValid, setTokenValid] = useState(false);
  const [userInfo, setUserInfo] = useState<{
    email: string;
    name: string;
    organization_name?: string;
  } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [formData, setFormData] = useState({
    newPassword: "",
    confirmPassword: "",
  });

  const token = searchParams.get("token");

  useEffect(() => {
    if (!token) {
      setError(t("teacherSetupPassword.errors.invalidLink"));
      setIsVerifying(false);
      return;
    }

    // 驗證 token 是否有效（重用密碼重設的驗證 endpoint）
    const verifyToken = async () => {
      try {
        const response = await apiClient.get(
          `/api/auth/teacher/verify-reset-token?token=${encodeURIComponent(token)}`,
        );
        if (
          response &&
          typeof response === "object" &&
          "valid" in response &&
          response.valid
        ) {
          setTokenValid(true);
          if ("email" in response && "name" in response) {
            setUserInfo({
              email: response.email as string,
              name: response.name as string,
              organization_name:
                "organization_name" in response
                  ? (response.organization_name as string | undefined)
                  : undefined,
            });
          }
        }
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message || t("teacherSetupPassword.errors.linkExpired"));
        } else {
          setError(t("teacherSetupPassword.errors.linkExpired"));
        }
        setTokenValid(false);
      } finally {
        setIsVerifying(false);
      }
    };

    verifyToken();
  }, [token, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // 驗證密碼
    if (formData.newPassword !== formData.confirmPassword) {
      setError(t("teacherSetupPassword.errors.passwordMismatch"));
      return;
    }

    const validation = validatePasswordStrength(formData.newPassword);
    if (!validation.valid && validation.errorKey) {
      setError(t(`teacherSetupPassword.errors.${validation.errorKey}`));
      return;
    }

    setIsLoading(true);

    try {
      // 重用密碼重設的 endpoint（Token 機制相同）
      const response = await apiClient.post(
        "/api/auth/teacher/reset-password",
        {
          token,
          new_password: formData.newPassword.trim(),
        },
      );

      if (
        response &&
        typeof response === "object" &&
        "success" in response &&
        response.success
      ) {
        setSuccess(true);
      }
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message || t("teacherSetupPassword.errors.setupFailed"));
      } else {
        setError(t("teacherSetupPassword.errors.setupFailed"));
      }
    } finally {
      setIsLoading(false);
    }
  };

  // 載入中
  if (isVerifying) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 flex items-center justify-center p-4">
        {/* Language Switcher */}
        <div className="absolute top-4 right-4">
          <LanguageSwitcher />
        </div>

        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-purple-600 mb-4" />
            <p className="text-gray-600">
              {t("teacherSetupPassword.verifying")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 成功設定密碼
  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 flex items-center justify-center p-4">
        {/* Language Switcher */}
        <div className="absolute top-4 right-4">
          <LanguageSwitcher />
        </div>

        <div className="w-full max-w-md">
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <CardTitle className="text-2xl">
                {t("teacherSetupPassword.success.title")}
              </CardTitle>
              <CardDescription>
                {userInfo?.organization_name && (
                  <div className="mt-3 p-3 bg-purple-50 rounded-lg border border-purple-200">
                    <div className="flex items-center justify-center gap-2 text-purple-700">
                      <Building2 className="h-4 w-4" />
                      <span className="font-medium">
                        {userInfo.organization_name}
                      </span>
                    </div>
                  </div>
                )}
                <p className="mt-4 text-gray-600">
                  {t("teacherSetupPassword.success.canLoginNow")}
                </p>
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  {t("teacherSetupPassword.success.accountActivated")}
                </AlertDescription>
              </Alert>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                <p className="font-semibold mb-2">
                  {t("teacherSetupPassword.success.youCanNow")}
                </p>
                <ul className="space-y-1 ml-4">
                  <li>{t("teacherSetupPassword.success.loginPlatform")}</li>
                  <li>{t("teacherSetupPassword.success.manageClasses")}</li>
                  <li>{t("teacherSetupPassword.success.assignHomework")}</li>
                  <li>{t("teacherSetupPassword.success.trackProgress")}</li>
                </ul>
              </div>

              <Button
                className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                onClick={() => navigate("/teacher/login")}
              >
                {t("teacherSetupPassword.success.goToLogin")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Token 無效
  if (!tokenValid) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 flex items-center justify-center p-4">
        {/* Language Switcher */}
        <div className="absolute top-4 right-4">
          <LanguageSwitcher />
        </div>

        <div className="w-full max-w-md">
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <XCircle className="h-8 w-8 text-red-600" />
              </div>
              <CardTitle className="text-2xl">
                {t("teacherSetupPassword.invalid.title")}
              </CardTitle>
              <CardDescription>
                {t("teacherSetupPassword.invalid.description")}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <Alert className="bg-red-50 border-red-200">
                <XCircle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800">
                  {error || t("teacherSetupPassword.invalid.defaultError")}
                </AlertDescription>
              </Alert>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
                <p className="font-semibold mb-2">
                  {t("teacherSetupPassword.invalid.notes")}
                </p>
                <ul className="space-y-1 ml-4">
                  <li>{t("teacherSetupPassword.invalid.validFor48h")}</li>
                  <li>{t("teacherSetupPassword.invalid.singleUse")}</li>
                  <li>{t("teacherSetupPassword.invalid.contactAdmin")}</li>
                </ul>
              </div>

              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => navigate("/teacher/login")}
                >
                  {t("teacherSetupPassword.invalid.backToLogin")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // 設定密碼表單
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 flex items-center justify-center p-4">
      {/* Language Switcher */}
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>

      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent mb-2">
            Duotopia
          </h1>
          <p className="text-gray-600">
            {t("teacherSetupPassword.form.pageSubtitle")}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-purple-600" />
              {t("teacherSetupPassword.form.title")}
            </CardTitle>
            <CardDescription>
              {userInfo && (
                <div className="mt-3 space-y-2">
                  {userInfo.organization_name && (
                    <div className="flex items-center gap-2 p-3 bg-purple-50 rounded-lg border border-purple-200">
                      <Building2 className="h-4 w-4 text-purple-600" />
                      <div className="text-sm">
                        <span className="text-gray-600">
                          {t("teacherSetupPassword.form.organization")}
                        </span>
                        <span className="font-medium text-purple-700 ml-1">
                          {userInfo.organization_name}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="text-sm text-gray-600">
                    <p className="font-medium">
                      {t("teacherSetupPassword.form.account")}
                      {userInfo.email}
                    </p>
                    <p>
                      {t("teacherSetupPassword.form.name")}
                      {userInfo.name}
                    </p>
                  </div>
                </div>
              )}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">
                  {t("teacherSetupPassword.form.newPassword")}
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="newPassword"
                    type={showPassword ? "text" : "password"}
                    placeholder={t(
                      "teacherSetupPassword.form.newPasswordPlaceholder",
                    )}
                    value={formData.newPassword}
                    onChange={(e) =>
                      setFormData({ ...formData, newPassword: e.target.value })
                    }
                    className="pl-10 pr-10"
                    required
                    disabled={isLoading}
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">
                  {t("teacherSetupPassword.form.confirmPassword")}
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder={t(
                      "teacherSetupPassword.form.confirmPasswordPlaceholder",
                    )}
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
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
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

              <div className="text-sm text-gray-500 bg-gray-50 p-3 rounded-lg">
                <p className="font-medium mb-1">
                  {t("teacherSetupPassword.form.requirements")}
                </p>
                <p>{t("teacherSetupPassword.form.requirementHint")}</p>
              </div>

              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("teacherSetupPassword.form.submitting")}
                  </>
                ) : (
                  t("teacherSetupPassword.form.submit")
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="mt-6 text-center text-sm text-gray-600">
          <p>{t("teacherSetupPassword.footer.willActivate")}</p>
          <p className="mt-1">
            {t("teacherSetupPassword.footer.useAllFeatures")}
          </p>
        </div>
      </div>
    </div>
  );
}
