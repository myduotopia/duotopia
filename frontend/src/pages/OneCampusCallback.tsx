import { useEffect, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  AlertCircle,
  Home,
  MergeIcon,
  Link2,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { consumeRedirectTarget } from "@/utils/redirectAfterLogin";
import api from "@/services/api";

export default function OneCampusCallback() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login: studentLogin } = useStudentAuthStore();
  const { login: teacherLogin } = useTeacherAuthStore();

  const [status, setStatus] = useState<
    "loading" | "error" | "merge_prompt" | "bind_prompt" | "bind_sent"
  >("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [mergeInfo, setMergeInfo] = useState<{
    merge_token: string;
    existing_student_name: string | null;
    new_one_campus_account: string;
    new_student_name: string;
    message: string;
  } | null>(null);
  const [merging, setMerging] = useState(false);
  const [bindEmail, setBindEmail] = useState("");
  const [bindLoading, setBindLoading] = useState(false);
  const [bindRoleType, setBindRoleType] = useState<"student" | "teacher">(
    "student",
  );

  useEffect(() => {
    const code = searchParams.get("code");
    const schoolDsns =
      searchParams.get("schoolDsns") || searchParams.get("dsns");

    if (!code || !schoolDsns) {
      setStatus("error");
      setErrorMessage(
        t(
          "oneCampus.errors.missingParams",
          "Missing required parameters. Please try logging in again.",
        ),
      );
      return;
    }

    handleCallback(code, schoolDsns);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function handleCallback(code: string, schoolDsns: string) {
    try {
      const response = await api.get("/api/auth/1campus/callback", {
        params: { code, schoolDsns },
      });
      const data = response.data;

      if (data.action === "merge_prompt") {
        setMergeInfo(data.merge_info);
        setStatus("merge_prompt");
        return;
      }

      // Login success
      if (data.access_token) {
        if (data.role_type === "teacher" && data.user) {
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
          if (data.action === "created") {
            setBindRoleType("teacher");
            setStatus("bind_prompt");
            return;
          }
          navigate(consumeRedirectTarget("/teacher/dashboard"), {
            replace: true,
          });
        } else if (data.student) {
          studentLogin(data.access_token, {
            id: data.student.id,
            name: data.student.name,
            email: data.student.email || "",
            student_number: data.student.student_number || "",
            classroom_id: data.student.classroom_id,
            classroom_name: data.student.classroom_name,
            school_id: data.student.school_id,
            school_name: data.student.school_name,
            organization_id: data.student.organization_id,
            organization_name: data.student.organization_name,
            has_linked_accounts: data.student.has_linked_accounts,
            linked_accounts_count: data.student.linked_accounts_count,
            classrooms: data.student.classrooms,
            classrooms_count: data.student.classrooms_count,
          });
          if (data.action === "created") {
            setBindRoleType("student");
            setStatus("bind_prompt");
            return;
          }
          navigate(consumeRedirectTarget("/student/dashboard"), {
            replace: true,
          });
        }
      }
    } catch (err: unknown) {
      setStatus("error");
      if (
        err &&
        typeof err === "object" &&
        "response" in err &&
        err.response &&
        typeof err.response === "object" &&
        "data" in err.response
      ) {
        const resp = err.response as { data: { detail?: string } };
        setErrorMessage(
          resp.data.detail ||
            t("oneCampus.errors.generic", "Login failed. Please try again."),
        );
      } else {
        setErrorMessage(
          t("oneCampus.errors.generic", "Login failed. Please try again."),
        );
      }
    }
  }

  async function handleMergeConfirm() {
    if (!mergeInfo) return;
    setMerging(true);
    try {
      const response = await api.post("/api/auth/1campus/merge-confirm", {
        merge_token: mergeInfo.merge_token,
      });
      const data = response.data;

      if (data.access_token && data.student) {
        studentLogin(data.access_token, {
          id: data.student.id,
          name: data.student.name,
          email: data.student.email || "",
          student_number: data.student.student_number || "",
          classroom_id: data.student.classroom_id,
          classroom_name: data.student.classroom_name,
          school_id: data.student.school_id,
          school_name: data.student.school_name,
          organization_id: data.student.organization_id,
          organization_name: data.student.organization_name,
          has_linked_accounts: data.student.has_linked_accounts,
          linked_accounts_count: data.student.linked_accounts_count,
          classrooms: data.student.classrooms,
          classrooms_count: data.student.classrooms_count,
        });
        navigate(consumeRedirectTarget("/student/dashboard"), {
          replace: true,
        });
      }
    } catch {
      setErrorMessage(
        t(
          "oneCampus.errors.mergeFailed",
          "Account merge failed. Please try again.",
        ),
      );
      setStatus("error");
    } finally {
      setMerging(false);
    }
  }

  function handleMergeSkip() {
    // Go back to login page
    navigate("/student/login", { replace: true });
  }

  async function handleBindSubmit() {
    if (!bindEmail.trim()) return;
    setBindLoading(true);
    try {
      await api.post("/api/auth/1campus/bind-account", {
        email: bindEmail.trim(),
      });
      setStatus("bind_sent");
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "response" in err &&
        err.response &&
        typeof err.response === "object" &&
        "data" in err.response
      ) {
        const resp = err.response as { data: { detail?: string } };
        setErrorMessage(
          resp.data.detail ||
            t(
              "oneCampus.errors.generic",
              "Operation failed. Please try again.",
            ),
        );
      } else {
        setErrorMessage(
          t("oneCampus.errors.generic", "Operation failed. Please try again."),
        );
      }
      setStatus("error");
    } finally {
      setBindLoading(false);
    }
  }

  function handleBindSkip() {
    const fallback =
      bindRoleType === "teacher" ? "/teacher/dashboard" : "/student/dashboard";
    navigate(consumeRedirectTarget(fallback), { replace: true });
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
      <Link
        to="/"
        className="absolute top-4 left-4 text-gray-500 hover:text-gray-700 flex items-center gap-1"
      >
        <Home className="h-4 w-4" />
      </Link>

      {status === "loading" && (
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-600">
            {t("oneCampus.loading", "Logging in with school account...")}
          </p>
        </div>
      )}

      {status === "error" && (
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-2" />
            <CardTitle className="text-red-600">
              {t("oneCampus.errors.title", "Login Failed")}
            </CardTitle>
            <CardDescription>{errorMessage}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button
              onClick={() => navigate("/student/login", { replace: true })}
              className="w-full"
            >
              {t("oneCampus.errors.backToLogin", "Back to Login")}
            </Button>
          </CardContent>
        </Card>
      )}

      {status === "bind_prompt" && (
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <Link2 className="h-12 w-12 text-blue-500 mx-auto mb-2" />
            <CardTitle>
              {t("oneCampus.bind.title", "Bind Duotopia Account")}
            </CardTitle>
            <CardDescription>
              {t(
                "oneCampus.bind.description",
                "If you already have a Duotopia account, enter your email to link it with your school account.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Input
                type="email"
                placeholder={t(
                  "oneCampus.bind.emailPlaceholder",
                  "your-email@example.com",
                )}
                value={bindEmail}
                onChange={(e) => setBindEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleBindSubmit();
                }}
              />
            </div>

            <Button
              onClick={handleBindSubmit}
              disabled={bindLoading || !bindEmail.trim()}
              className="w-full"
            >
              {bindLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Mail className="h-4 w-4 mr-2" />
              )}
              {t("oneCampus.bind.sendVerification", "Send Verification Email")}
            </Button>

            <Button
              variant="outline"
              onClick={handleBindSkip}
              className="w-full"
            >
              {t("oneCampus.bind.skip", "Skip for now")}
            </Button>
          </CardContent>
        </Card>
      )}

      {status === "bind_sent" && (
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <Mail className="h-12 w-12 text-green-500 mx-auto mb-2" />
            <CardTitle>
              {t("oneCampus.bind.sentTitle", "Verification Email Sent")}
            </CardTitle>
            <CardDescription>
              {t(
                "oneCampus.bind.sentDescription",
                "We've sent a verification email to {{email}}. Please check your inbox and click the verification link.",
                { email: bindEmail },
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={handleBindSkip} className="w-full">
              {t("oneCampus.bind.continue", "Continue to Dashboard")}
            </Button>
          </CardContent>
        </Card>
      )}

      {status === "merge_prompt" && mergeInfo && (
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <MergeIcon className="h-12 w-12 text-amber-500 mx-auto mb-2" />
            <CardTitle>{t("oneCampus.merge.title", "Account Found")}</CardTitle>
            <CardDescription>{mergeInfo.message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
              <p className="font-medium text-amber-800">
                {t("oneCampus.merge.existingAccount", "Existing account")}:{" "}
                {mergeInfo.existing_student_name}
              </p>
              <p className="text-amber-700 mt-1">
                {t("oneCampus.merge.newAccount", "School account")}:{" "}
                {mergeInfo.new_student_name} ({mergeInfo.new_one_campus_account}
                )
              </p>
            </div>

            <Button
              onClick={handleMergeConfirm}
              disabled={merging}
              className="w-full bg-amber-500 hover:bg-amber-600"
            >
              {merging ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <MergeIcon className="h-4 w-4 mr-2" />
              )}
              {t("oneCampus.merge.confirm", "Merge Accounts")}
            </Button>

            <Button
              variant="outline"
              onClick={handleMergeSkip}
              className="w-full"
            >
              {t("oneCampus.merge.skip", "Skip for now")}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
