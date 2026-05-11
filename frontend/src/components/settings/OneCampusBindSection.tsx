/**
 * OneCampusBindSection
 *
 * Displays 1Campus binding status and Duotopia email verification status,
 * with action buttons for bind / resend verification.
 *
 * Shared between TeacherProfile and StudentProfile settings pages.
 *
 * Scope: Issue #719 Phase 1 — bind/merge marker (no data migration).
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Link2,
  CheckCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import api from "@/services/api";

interface BindingStatus {
  user_id: number;
  has_1campus_binding: boolean;
  one_campus_account: string | null;
  email: string | null;
  email_verified: boolean;
  user_type: string;
}

interface ResendVerificationResponse {
  message: string;
}

export interface OneCampusBindSectionProps {
  /**
   * Called after a successful OAuth redirect is initiated (merge flow).
   * Parent should navigate to the 1Campus OAuth URL.
   */
  onMergeFlowStart?: (url: string) => void;
  /**
   * userType override — if not provided, fetched from API.
   */
  userType?: "teacher" | "student";
}

export default function OneCampusBindSection({
  onMergeFlowStart,
  userType,
}: OneCampusBindSectionProps) {
  const [status, setStatus] = useState<BindingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const resp = await api.get<BindingStatus>(
        "/api/auth/1campus/binding-status",
      );
      setStatus(resp.data);
    } catch (err) {
      console.error("Failed to load 1Campus binding status:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function handleBind1Campus() {
    setMergeLoading(true);
    try {
      const resp = await api.get<{ url: string }>(
        "/api/auth/1campus/login-url-for-merge",
      );
      const url = resp.data.url;
      if (onMergeFlowStart) {
        onMergeFlowStart(url);
      } else {
        // Default: redirect in same window
        window.location.href = url;
      }
    } catch (err: unknown) {
      console.error("Failed to get 1Campus merge URL:", err);
      // Parse the structured backend response to surface actionable messages.
      const detail = (
        err as {
          response?: {
            data?: { detail?: { code?: string; message?: string } };
          };
        }
      )?.response?.data?.detail;
      if (detail?.code === "EMAIL_NOT_VERIFIED") {
        toast.error(
          detail.message ||
            "Please verify your email before binding a 1Campus account.",
        );
      } else if (detail?.code === "ALREADY_BOUND") {
        toast.error(
          detail.message ||
            "This account is already linked to a 1Campus account.",
        );
      } else {
        toast.error("Failed to initiate 1Campus binding. Please try again.");
      }
    } finally {
      setMergeLoading(false);
    }
  }

  async function handleResendVerification() {
    if (!status?.email) return;
    setResendLoading(true);
    try {
      if (userType === "teacher" || status.user_type === "teacher") {
        await api.post<ResendVerificationResponse>(
          "/api/auth/resend-verification",
          { email: status.email },
        );
      } else {
        // Student resend — dedicated endpoint that re-sends the existing
        // pending verification (does NOT change the email or reset state).
        await api.post<ResendVerificationResponse>(
          `/api/students/${status.user_id}/email/resend-verification`,
        );
      }
      toast.success("Verification email sent. Please check your inbox.");
    } catch (err: unknown) {
      console.error("Failed to resend verification email:", err);
      toast.error("Failed to send verification email. Please try again later.");
    } finally {
      setResendLoading(false);
    }
  }

  if (loading) {
    return (
      <Card className="mb-6">
        <CardContent className="p-6 text-center">
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-gray-400" />
        </CardContent>
      </Card>
    );
  }

  if (!status) return null;

  const isBound = status.has_1campus_binding;
  const emailVerified = status.email_verified;
  const hasEmail = !!status.email;

  // Determine what action to show
  // - If not bound and email verified → show "Bind 1Campus account" (merge flow)
  // - If not bound and email NOT verified → show disabled button + resend verification
  // - If bound → show bound status, no action needed

  return (
    <Card className="mb-6 border-l-4 border-l-green-400 overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-green-600" />
          1Campus Account Binding
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {/* 1Campus status */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">1Campus Account</p>
            {isBound ? (
              <div className="flex items-center gap-2 mt-1">
                <p className="font-medium">{status.one_campus_account}</p>
                <Badge className="bg-green-100 text-green-700 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" />
                  Bound
                </Badge>
              </div>
            ) : (
              <p className="font-medium text-gray-400">Not bound</p>
            )}
          </div>
        </div>

        {/* Duotopia email status */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">Duotopia Email</p>
            <div className="flex items-center gap-2 mt-1">
              <p className="font-medium">
                {hasEmail ? status.email : "Not set"}
              </p>
              {hasEmail && (
                <div>
                  {emailVerified ? (
                    <Badge className="bg-green-100 text-green-700 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      Verified
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-orange-600 border-orange-300 flex items-center gap-1"
                    >
                      <AlertCircle className="h-3 w-3" />
                      Unverified
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action area */}
        <div className="pt-2 space-y-2">
          {/* Show bind button only if: not already bound, email verified */}
          {!isBound && emailVerified && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleBind1Campus}
              disabled={mergeLoading}
              className="hover:bg-gray-200 transition-colors"
            >
              {mergeLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Link2 className="h-4 w-4 mr-2" />
              )}
              Bind 1Campus Account
            </Button>
          )}

          {/* Show disabled bind button + resend if email not verified */}
          {!isBound && hasEmail && !emailVerified && (
            <div className="space-y-2">
              <Button
                size="sm"
                variant="secondary"
                disabled
                className="cursor-not-allowed opacity-60"
                title="Please verify your email first before binding a 1Campus account"
              >
                <Link2 className="h-4 w-4 mr-2" />
                Bind 1Campus Account (verify email first)
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleResendVerification}
                disabled={resendLoading}
                className="hover:bg-blue-50 text-blue-600 border-blue-300"
              >
                {resendLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Resend Verification Email
              </Button>
            </div>
          )}

          {/* Already bound — no action needed */}
          {isBound && (
            <p className="text-sm text-gray-500">
              Your account is linked to a 1Campus school account.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
