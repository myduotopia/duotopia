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
import { Loader2, Lock, CheckCircle, XCircle, Eye, EyeOff } from "lucide-react";
import { apiClient } from "../lib/api";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTranslation } from "react-i18next";

export default function TeacherResetPassword() {
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
      setError(t("passwordReset.errors.invalidLink"));
      setIsVerifying(false);
      return;
    }

    // 驗證 token 是否有效
    const verifyToken = async () => {
      try {
        const response = await apiClient.get(
          `/api/auth/teacher/verify-reset-token?token=${token}`,
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
            });
          }
        }
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message || t("passwordReset.errors.linkExpired"));
        } else {
          setError(t("passwordReset.errors.linkExpired"));
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
      setError(t("passwordReset.errors.passwordMismatch"));
      return;
    }

    if (formData.newPassword.length < 6) {
      setError(t("passwordReset.errors.passwordTooShort"));
      return;
    }

    setIsLoading(true);

    try {
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
        setError(err.message || t("passwordReset.errors.resetFailed"));
      } else {
        setError(t("passwordReset.errors.resetFailed"));
      }
    } finally {
      setIsLoading(false);
    }
  };

  // 載入中
  if (isVerifying) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        {/* Language Switcher */}
        <div className="absolute top-4 right-4">
          <LanguageSwitcher />
        </div>

        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-4" />
            <p className="text-gray-600">
              {t("passwordReset.status.verifying")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 成功重設密碼
  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
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
                {t("passwordReset.status.resetSuccess")}
              </CardTitle>
              <CardDescription>
                {t("passwordReset.status.successDescription")}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  {t("passwordReset.status.canLoginNow")}
                </AlertDescription>
              </Alert>

              <Button
                className="w-full"
                onClick={() => navigate("/teacher/login")}
              >
                {t("passwordReset.buttons.goToLogin")}
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
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
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
                {t("passwordReset.status.linkInvalidTitle")}
              </CardTitle>
              <CardDescription>
                {t("passwordReset.status.linkInvalidDescription")}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <Alert className="bg-red-50 border-red-200">
                <XCircle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800">
                  {error || t("passwordReset.messages.linkExpiredDetail")}
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <Button
                  className="w-full"
                  onClick={() => navigate("/teacher/forgot-password")}
                >
                  {t("passwordReset.buttons.requestNew")}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => navigate("/teacher/login")}
                >
                  {t("passwordReset.buttons.backToLogin")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // 重設密碼表單
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      {/* Language Switcher */}
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>

      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Duotopia</h1>
          <p className="text-gray-600">{t("passwordReset.subtitle")}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("passwordReset.title")}</CardTitle>
            <CardDescription>
              {userInfo && (
                <div className="mt-2">
                  <p>
                    {t("passwordReset.labels.account", {
                      email: userInfo.email,
                    })}
                  </p>
                  <p>
                    {t("passwordReset.labels.name", { name: userInfo.name })}
                  </p>
                </div>
              )}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">
                  {t("passwordReset.labels.newPassword")}
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="newPassword"
                    type={showPassword ? "text" : "password"}
                    placeholder={t("passwordReset.placeholders.newPassword")}
                    value={formData.newPassword}
                    onChange={(e) =>
                      setFormData({ ...formData, newPassword: e.target.value })
                    }
                    className="pl-10 pr-10"
                    required
                    disabled={isLoading}
                    minLength={6}
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
                  {t("passwordReset.labels.confirmPassword")}
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder={t(
                      "passwordReset.placeholders.confirmPassword",
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
                    minLength={6}
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

              <div className="text-sm text-gray-500">
                {t("passwordReset.hints.minLength")}
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("passwordReset.buttons.resetting")}
                  </>
                ) : (
                  t("passwordReset.buttons.resetPassword")
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
