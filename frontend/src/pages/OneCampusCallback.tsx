import { useEffect, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2, AlertCircle, Home, MergeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import api from "@/services/api";

export default function OneCampusCallback() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useStudentAuthStore();

  const [status, setStatus] = useState<"loading" | "error" | "merge_prompt">(
    "loading",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [mergeInfo, setMergeInfo] = useState<{
    existing_identity_id: number;
    existing_student_name: string | null;
    new_one_campus_student_id: string;
    new_one_campus_account: string;
    new_student_name: string;
    message: string;
  } | null>(null);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    const code = searchParams.get("code");
    const schoolDsns = searchParams.get("schoolDsns");

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
  }, []);

  async function handleCallback(code: string, schoolDsns: string) {
    try {
      const response = await api.get("/api/auth/1campus/callback", {
        params: { code, schoolDsns, role: "student" },
      });
      const data = response.data;

      if (data.action === "merge_prompt") {
        setMergeInfo(data.merge_info);
        setStatus("merge_prompt");
        return;
      }

      // Login success
      if (data.access_token && data.student) {
        login(data.access_token, {
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
        navigate("/student/dashboard", { replace: true });
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
        source_identity_id: mergeInfo.existing_identity_id,
        target_identity_id: mergeInfo.existing_identity_id,
        one_campus_student_id: mergeInfo.new_one_campus_student_id,
        one_campus_account: mergeInfo.new_one_campus_account,
      });
      const data = response.data;

      if (data.access_token && data.student) {
        login(data.access_token, {
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
        navigate("/student/dashboard", { replace: true });
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
