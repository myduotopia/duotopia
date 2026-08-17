/**
 * GoogleLoginButton — 老師端「以 Google 登入」按鈕（Issue #740）
 *
 * 點擊後向後端要 Google 同意畫面網址（後端負責產生含簽章 state 的 URL），
 * 再整頁導向 Google。授權完成後回到 /auth/google/callback（見 GoogleCallback）。
 *
 * 共用於 TeacherLogin 頁與 TeacherLoginSheet，兩處外觀與行為必須一致。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";

interface GoogleLoginButtonProps {
  /** 失敗時把錯誤訊息交給外層的共用 error 區塊顯示 */
  onError: (message: string) => void;
  /** 點擊時清掉外層既有錯誤 */
  onBeforeRedirect?: () => void;
  className?: string;
}

function GoogleIcon() {
  return (
    <svg className="mr-2 h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function GoogleLoginButton({
  onError,
  onBeforeRedirect,
  className = "",
}: GoogleLoginButtonProps) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      disabled={isLoading}
      className={`w-full py-4 bg-white hover:bg-gray-50 border-gray-300 text-gray-700 font-medium ${className}`}
      onClick={async () => {
        onBeforeRedirect?.();
        setIsLoading(true);
        try {
          const res = await apiClient.get<{ url: string }>(
            "/api/auth/google/login-url",
          );
          window.location.href = res.url;
          // 成功時不重設 loading — 頁面即將整頁導走
        } catch {
          onError(
            t(
              "teacherLogin.google.error",
              "Failed to connect to Google. Please try again.",
            ),
          );
          setIsLoading(false);
        }
      }}
    >
      {isLoading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t("teacherLogin.google.loading", "Redirecting to Google...")}
        </>
      ) : (
        <>
          <GoogleIcon />
          {t("teacherLogin.google.button", "Sign in with Google")}
        </>
      )}
    </Button>
  );
}
