/**
 * GoogleCallback — 老師端 Google 登入的 OAuth 回導頁（Issue #740）
 *
 * Google 授權完成後（develop / staging / per-issue 會先經過後端 relay 轉回）
 * 帶著 code + state 回到本頁；本頁以 XHR 呼叫後端 /api/auth/google/callback，
 * 由後端驗 state、換 token、解析帳號並回傳 JWT，再寫進 teacherAuthStore。
 *
 * 只有 loading / error 兩種狀態 —— Google 沒有 1Campus 的 merge / bind 分支。
 */
import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2, AlertCircle, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { consumeRedirectTarget } from "@/utils/redirectAfterLogin";
import { getTeacherDashboardRoute } from "@/utils/authNavigation";
import api from "@/services/api";

interface GoogleCallbackData {
  access_token: string;
  user: {
    id: number;
    name: string;
    email: string;
    role: string;
    organization_id: string | null;
    school_id: string | null;
    is_demo: boolean;
    is_admin: boolean;
  };
  action: string;
}

/** 後端錯誤 detail 可能是字串，也可能是 { code, message } */
function extractErrorMessage(err: unknown): string | null {
  if (
    err &&
    typeof err === "object" &&
    "response" in err &&
    err.response &&
    typeof err.response === "object" &&
    "data" in err.response
  ) {
    const data = (err.response as { data?: { detail?: unknown } }).data;
    const detail = data?.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object" && "message" in detail) {
      const message = (detail as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
  }
  return null;
}

export default function GoogleCallback() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login: teacherLogin } = useTeacherAuthStore();

  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const oauthError = searchParams.get("error");

    if (oauthError) {
      setStatus("error");
      setErrorMessage(
        t(
          "google.errors.denied",
          "Google sign-in was cancelled. Please try again.",
        ),
      );
      return;
    }

    if (!code || !state) {
      setStatus("error");
      setErrorMessage(
        t(
          "google.errors.missingParams",
          "Missing required parameters. Please try logging in again.",
        ),
      );
      return;
    }

    handleCallback(code, state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function handleCallback(code: string, state: string) {
    try {
      const { data } = await api.get<GoogleCallbackData>(
        "/api/auth/google/callback",
        { params: { code, state } },
      );

      teacherLogin(data.access_token, {
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        role: data.user.role,
        organization_id: data.user.organization_id,
        school_id: data.user.school_id,
        is_demo: data.user.is_demo,
        is_admin: data.user.is_admin,
      });

      navigate(
        consumeRedirectTarget(getTeacherDashboardRoute(), [
          "/teacher/",
          "/organization/",
          "/dashboard",
        ]),
        { replace: true },
      );
    } catch (err: unknown) {
      setStatus("error");
      setErrorMessage(
        extractErrorMessage(err) ||
          t(
            "google.errors.generic",
            "Google sign-in failed. Please try again.",
          ),
      );
    }
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">
            {t("google.signingIn", "Signing you in with Google...")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <AlertCircle className="h-10 w-10 text-red-500 mx-auto mb-2" />
          <CardTitle>{t("google.errors.title", "Sign-in failed")}</CardTitle>
          <CardDescription>{errorMessage}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button
            className="w-full"
            onClick={() => navigate("/teacher/login", { replace: true })}
          >
            {t("google.backToLogin", "Back to teacher login")}
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => navigate("/", { replace: true })}
          >
            <Home className="mr-2 h-4 w-4" />
            {t("google.backToHome", "Back to home")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
