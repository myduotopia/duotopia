import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
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
import { Loader2, Mail, ArrowLeft, CheckCircle } from "lucide-react";
import { apiClient } from "../lib/api";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTranslation } from "react-i18next";

export default function StudentForgotPassword() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [email, setEmail] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setSuccess(false);

    try {
      const response = await apiClient.post(
        "/api/auth/student/forgot-password",
        {
          email,
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
        if (err.message.includes("429")) {
          setError(t("studentForgotPassword.errors.tooFrequent"));
        } else if (
          err.message.includes("尚未驗證") ||
          err.message.includes("not verified")
        ) {
          setError(t("studentForgotPassword.errors.notVerified"));
        } else {
          setError(err.message || t("studentForgotPassword.errors.sendFailed"));
        }
      } else {
        setError(t("studentForgotPassword.errors.sendFailed"));
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-100 flex items-center justify-center p-4">
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
                {t("studentForgotPassword.success.title")}
              </CardTitle>
              <CardDescription>
                {t("studentForgotPassword.success.description")}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <Alert className="bg-blue-50 border-blue-200">
                <Mail className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-blue-800">
                  {t("studentForgotPassword.success.checkInbox", { email })}
                </AlertDescription>
              </Alert>

              <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                <p className="text-sm text-gray-600">
                  <strong>
                    {t("studentForgotPassword.success.nextStepsTitle")}
                  </strong>
                </p>
                <ol className="text-sm text-gray-600 list-decimal list-inside space-y-1">
                  <li>{t("studentForgotPassword.success.step1")}</li>
                  <li>{t("studentForgotPassword.success.step2")}</li>
                  <li>{t("studentForgotPassword.success.step3")}</li>
                </ol>
              </div>

              <div className="pt-4 space-y-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => navigate("/student/login")}
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  {t("studentForgotPassword.buttons.backToLogin")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-100 flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>

      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Duotopia</h1>
          <p className="text-gray-600">{t("studentForgotPassword.subtitle")}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("studentForgotPassword.title")}</CardTitle>
            <CardDescription>
              {t("studentForgotPassword.description")}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="email"
                    type="email"
                    placeholder={t("studentForgotPassword.placeholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
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

              <div className="text-sm text-gray-500">
                {t("studentForgotPassword.verifiedOnly")}
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("studentForgotPassword.buttons.sending")}
                  </>
                ) : (
                  t("studentForgotPassword.buttons.send")
                )}
              </Button>

              <div className="pt-4 text-center">
                <Link
                  to="/student/login"
                  className="text-sm text-emerald-600 hover:underline inline-flex items-center"
                >
                  <ArrowLeft className="h-3 w-3 mr-1" />
                  {t("studentForgotPassword.buttons.backToLogin")}
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="mt-4 text-center text-xs text-gray-500">
          {t("studentForgotPassword.linkExpiry")}
        </div>
      </div>
    </div>
  );
}
