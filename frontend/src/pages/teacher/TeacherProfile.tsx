import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import OneCampusBindSection from "@/components/settings/OneCampusBindSection";
import PromoCodeCard from "@/components/PromoCodeCard";
import {
  User,
  Mail,
  Phone,
  Shield,
  Loader2,
  Edit2,
  Save,
  X,
  Lock,
  Gauge,
  Eye,
  EyeOff,
  Share2,
  ArrowRight,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { validatePasswordStrength } from "@/utils/passwordValidation";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import {
  buildQuotaSources,
  hexAlpha,
  type QuotaSourceItem,
} from "@/lib/quotaSources";

interface TeacherInfo {
  id: number;
  name: string;
  email: string;
  phone?: string;
  is_demo: boolean;
  is_active: boolean;
  is_admin?: boolean;
}

interface QuotaInfo {
  quota_total: number;
  quota_used: number;
  quota_remaining: number;
  plan_name: string;
  source: "personal" | "organization";
  sources: QuotaSourceItem[];
}

// 配額卡片獨立元件（必須在 TeacherLayout/WorkspaceProvider 內才能使用 useWorkspace）
function QuotaCard() {
  const { mode, selectedOrganization } = useWorkspace();
  const [quotaInfo, setQuotaInfo] = useState<QuotaInfo | null>(null);

  useEffect(() => {
    loadQuotaInfo();
  }, [mode, selectedOrganization?.id]);

  const loadQuotaInfo = async () => {
    try {
      // Aggregated view: subscription period + every active credit package
      // (trial, referral bonus, purchased packs). Mirrors what admins see in
      // the per-teacher list, so the user sees their FULL available balance.
      // Org mode is read from the org's points balance instead.
      if (mode === "organization" && selectedOrganization) {
        const res = await apiClient.get<{
          total_points: number;
          used_points: number;
        }>(`/api/organizations/${selectedOrganization.id}/points`);
        if (typeof res.total_points === "number" && res.total_points > 0) {
          setQuotaInfo({
            quota_total: res.total_points,
            quota_used: res.used_points ?? 0,
            quota_remaining: Math.max(
              0,
              res.total_points - (res.used_points ?? 0),
            ),
            plan_name: selectedOrganization.name,
            source: "organization",
            sources: [], // org mode has no per-source breakdown
          });
        } else {
          setQuotaInfo(null);
        }
        return;
      }

      const res = await apiClient.getSubscriptionStatus();
      if (typeof res.quota_total === "number" && res.quota_total > 0) {
        setQuotaInfo({
          quota_total: res.quota_total,
          quota_used: res.quota_used ?? 0,
          quota_remaining: Math.max(
            0,
            (res.quota_total ?? 0) - (res.quota_used ?? 0),
          ),
          plan_name: res.plan ?? "",
          source: "personal",
          sources: buildQuotaSources(res),
        });
      } else {
        setQuotaInfo(null);
      }
    } catch (error) {
      console.error("Failed to load quota info:", error);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="h-5 w-5" />
          {quotaInfo?.source === "organization"
            ? `${quotaInfo.plan_name} 配額`
            : "個人配額"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {quotaInfo ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              目前工作區：
              <span className="font-medium text-gray-700">
                {mode === "organization" && selectedOrganization
                  ? selectedOrganization.name
                  : "個人模式"}
              </span>
            </p>

            <div className="flex items-end justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-3xl font-bold ${
                    quotaInfo.quota_remaining > quotaInfo.quota_total * 0.3
                      ? "text-green-600"
                      : quotaInfo.quota_remaining > quotaInfo.quota_total * 0.1
                        ? "text-orange-600"
                        : "text-red-600"
                  }`}
                >
                  {quotaInfo.quota_remaining.toLocaleString()}
                </span>
                <span className="text-gray-500">
                  / {quotaInfo.quota_total.toLocaleString()} 秒
                </span>
              </div>
              <span className="text-xs text-gray-500">
                已用 {quotaInfo.quota_used.toLocaleString()} 秒
              </span>
            </div>

            {/* Stacked-by-source bar (personal). Each segment's dark inner
                fill = REMAINING of that source (matches "remaining" headline);
                light outer = used. */}
            {quotaInfo.sources.length > 0 ? (
              <div className="flex h-3.5 w-full overflow-hidden rounded-full border border-gray-200 bg-white">
                {quotaInfo.sources.map((s) => {
                  const segPct =
                    (s.total / Math.max(1, quotaInfo.quota_total)) * 100;
                  const remainingPct =
                    (Math.max(0, s.total - s.used) / Math.max(1, s.total)) *
                    100;
                  return (
                    <div
                      key={s.kind}
                      style={{
                        width: `${segPct}%`,
                        backgroundColor: s.bg,
                      }}
                    >
                      <div
                        className="h-full"
                        style={{
                          width: `${remainingPct}%`,
                          backgroundColor: s.fill,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              // Fallback single bar: width = REMAINING / total, colour by
              // remaining ratio so the visual matches the headline number.
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full ${
                    quotaInfo.quota_remaining > quotaInfo.quota_total * 0.3
                      ? "bg-green-500"
                      : quotaInfo.quota_remaining > quotaInfo.quota_total * 0.1
                        ? "bg-orange-500"
                        : "bg-red-500"
                  }`}
                  style={{
                    width: `${Math.max(0, Math.min(100, (quotaInfo.quota_remaining / Math.max(1, quotaInfo.quota_total)) * 100))}%`,
                  }}
                />
              </div>
            )}

            {/* Per-source rows (personal mode only) */}
            {quotaInfo.sources.length > 0 && (
              <div className="space-y-2 pt-1">
                <div className="text-sm font-semibold text-gray-900">
                  點數來源
                </div>
                <ul className="space-y-2">
                  {quotaInfo.sources.map((s) => {
                    // Fill = REMAINING share, so a near-empty source draws as
                    // an almost-empty bar (matches the headline metaphor).
                    const remainingPct =
                      s.total > 0
                        ? Math.round(
                            (Math.max(0, s.total - s.used) / s.total) * 100,
                          )
                        : 0;
                    const isReferral = s.kind === "referral";
                    return (
                      <li
                        key={s.kind}
                        className="rounded-md border bg-gray-50 px-3 py-2"
                        style={
                          isReferral
                            ? {
                                borderColor: s.fill,
                                backgroundColor: hexAlpha(s.bg, 0.33),
                              }
                            : { borderColor: "#E5E7EB" }
                        }
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block h-3 w-3 rounded-sm"
                              style={{ backgroundColor: s.fill }}
                            />
                            <span className="text-sm font-medium text-gray-900">
                              {s.label}
                            </span>
                            {isReferral && (
                              <span
                                className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[10px] font-semibold"
                                style={{
                                  color: s.fill,
                                  border: `1px solid ${s.fill}`,
                                }}
                              >
                                <Zap className="h-2.5 w-2.5" /> 推薦獎勵點數
                              </span>
                            )}
                          </div>
                          <div className="flex flex-col items-end">
                            <span
                              className="text-sm font-bold"
                              style={{ color: s.fill }}
                            >
                              {Math.max(0, s.total - s.used).toLocaleString()} /{" "}
                              {s.total.toLocaleString()}
                            </span>
                            <span className="text-[10px] text-gray-500">
                              已用 {s.used.toLocaleString()}
                            </span>
                          </div>
                        </div>
                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white border border-gray-200">
                          <div
                            className="h-full"
                            style={{
                              width: `${remainingPct}%`,
                              backgroundColor: s.fill,
                            }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* CTA to the promo-code card on the same page */}
            {quotaInfo.source === "personal" && (
              <a
                href="#my-promo-code"
                className="flex items-center justify-between gap-2 rounded-md border border-violet-200 bg-violet-50 px-4 py-3 transition hover:bg-violet-100"
              >
                <div className="flex items-center gap-3">
                  <Share2 className="h-4 w-4 text-violet-600" />
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-violet-800">
                      想要更多點數？
                    </span>
                    <span className="text-xs text-violet-700">
                      分享你的推薦碼，每邀請一人最高拿 2,000 點。
                    </span>
                  </div>
                </div>
                <span className="flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white">
                  前往推薦碼
                  <ArrowRight className="h-3 w-3" />
                </span>
              </a>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            {mode === "organization" ? "此機構尚無配額資訊" : "尚無有效訂閱"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function TeacherProfile() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [teacherInfo, setTeacherInfo] = useState<TeacherInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // Name update states
  const [showNameEdit, setShowNameEdit] = useState(false);
  const [newName, setNewName] = useState("");
  const [isUpdatingName, setIsUpdatingName] = useState(false);

  // Phone update states
  const [showPhoneEdit, setShowPhoneEdit] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [isUpdatingPhone, setIsUpdatingPhone] = useState(false);

  // Password update states
  const [showPasswordEdit, setShowPasswordEdit] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  useEffect(() => {
    loadTeacherInfo();
  }, []);

  const loadTeacherInfo = async () => {
    try {
      const data = (await apiClient.getTeacherDashboard()) as {
        teacher: TeacherInfo;
      };
      setTeacherInfo(data.teacher);
      setNewPhone(data.teacher.phone || "");
    } catch (err) {
      console.error("Failed to fetch teacher profile:", err);
      toast.error(t("teacherProfile.errors.loadFailed"));
      if (err instanceof Error && err.message.includes("401")) {
        navigate("/teacher/login");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateName = async () => {
    if (!newName || newName.trim().length === 0) {
      toast.error(t("teacherProfile.errors.nameEmpty"));
      return;
    }

    setIsUpdatingName(true);
    try {
      await apiClient.updateTeacherProfile({ name: newName });
      toast.success(t("teacherProfile.success.nameUpdated"));
      setShowNameEdit(false);
      loadTeacherInfo();
    } catch (err) {
      console.error("Failed to update name:", err);
      toast.error(t("teacherProfile.errors.updateFailed"));
    } finally {
      setIsUpdatingName(false);
    }
  };

  const handleUpdatePhone = async () => {
    setIsUpdatingPhone(true);
    try {
      await apiClient.updateTeacherProfile({ phone: newPhone || undefined });
      toast.success(t("teacherProfile.success.phoneUpdated"));
      setShowPhoneEdit(false);
      loadTeacherInfo();
    } catch (err) {
      console.error("Failed to update phone:", err);
      toast.error(t("teacherProfile.errors.updateFailed"));
    } finally {
      setIsUpdatingPhone(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error(t("teacherProfile.password.errors.allFieldsRequired"));
      return;
    }

    // Bug3 Fix: Check if new password is same as current password FIRST
    // This prevents confusing UX where user thinks they should enter same password
    if (currentPassword === newPassword) {
      toast.error(t("teacherProfile.password.errors.passwordSameAsCurrent"));
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error(t("teacherProfile.password.errors.passwordMismatch"));
      return;
    }

    // Validate password strength (comprehensive check)
    const validation = validatePasswordStrength(newPassword);
    if (!validation.valid && validation.errorKey) {
      toast.error(t(`teacherProfile.password.errors.${validation.errorKey}`));
      return;
    }

    setIsUpdatingPassword(true);
    try {
      await apiClient.updateTeacherPassword({
        current_password: currentPassword.trim(),
        new_password: newPassword.trim(),
      });
      toast.success(t("teacherProfile.password.success.passwordUpdated"));
      setShowPasswordEdit(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      console.error("Failed to update password:", err);
      toast.error(t("teacherProfile.password.errors.updateFailed"));
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <Card>
          <CardContent className="p-6 sm:p-8 text-center dark:bg-gray-800">
            {t("teacherProfile.loading")}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!teacherInfo) {
    return (
      <div className="max-w-4xl mx-auto">
        <Card>
          <CardContent className="p-6 sm:p-8 text-center dark:bg-gray-800">
            {t("teacherProfile.errors.loadFailed")}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
          {t("teacherProfile.header.title")}
        </h1>
      </div>

      {/* Basic Info Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {t("teacherProfile.basicInfo.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-500">
                {t("teacherProfile.basicInfo.name")}
              </label>
              {!showNameEdit ? (
                <div className="flex items-center gap-2">
                  <p className="font-medium">{teacherInfo.name}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setNewName(teacherInfo.name);
                      setShowNameEdit(true);
                    }}
                    className="h-6 px-2"
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="h-9"
                    placeholder={t("teacherProfile.basicInfo.namePlaceholder")}
                  />
                  <Button
                    size="sm"
                    onClick={handleUpdateName}
                    disabled={isUpdatingName || !newName.trim()}
                    className="h-9 px-3"
                  >
                    {isUpdatingName ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowNameEdit(false);
                      setNewName("");
                    }}
                    disabled={isUpdatingName}
                    className="h-9 px-3"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
            <div>
              <label className="text-sm text-gray-500">
                {t("teacherProfile.basicInfo.email")}
              </label>
              <p className="font-medium flex items-center gap-2">
                <Mail className="h-4 w-4 text-gray-400" />
                {teacherInfo.email}
              </p>
            </div>
            <div>
              <label className="text-sm text-gray-500">
                {t("teacherProfile.basicInfo.phone")}
              </label>
              {!showPhoneEdit ? (
                <div className="flex items-center gap-2">
                  <p className="font-medium flex items-center gap-2">
                    <Phone className="h-4 w-4 text-gray-400" />
                    {teacherInfo.phone ||
                      t("teacherProfile.basicInfo.phoneNone")}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setNewPhone(teacherInfo.phone || "");
                      setShowPhoneEdit(true);
                    }}
                    className="h-6 px-2"
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="h-9"
                    placeholder={t("teacherProfile.basicInfo.phonePlaceholder")}
                  />
                  <Button
                    size="sm"
                    onClick={handleUpdatePhone}
                    disabled={isUpdatingPhone}
                    className="h-9 px-3"
                  >
                    {isUpdatingPhone ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowPhoneEdit(false);
                      setNewPhone(teacherInfo.phone || "");
                    }}
                    disabled={isUpdatingPhone}
                    className="h-9 px-3"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
            <div>
              <label className="text-sm text-gray-500">
                {t("teacherProfile.basicInfo.accountType")}
              </label>
              <p className="font-medium flex items-center gap-2">
                <Shield className="h-4 w-4 text-gray-400" />
                {teacherInfo.is_admin
                  ? t("teacherProfile.basicInfo.admin")
                  : t("teacherProfile.basicInfo.teacher")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 1Campus Binding Card */}
      <OneCampusBindSection userType="teacher" />

      {/* Quota Info Card */}
      <QuotaCard />

      {/* Promo Code Card (issue #637) */}
      <div id="my-promo-code" className="scroll-mt-20">
        <PromoCodeCard />
      </div>

      {/* Password Settings Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            {t("teacherProfile.password.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!showPasswordEdit ? (
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                {t("teacherProfile.password.description")}
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowPasswordEdit(true)}
                className="hover:bg-gray-200 transition-colors"
              >
                <Lock className="h-4 w-4 mr-2" />
                {t("teacherProfile.password.changeButton")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Password Requirements */}
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  {t("teacherProfile.password.requirements")}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t("teacherProfile.password.currentPassword")}
                </label>
                <div className="relative">
                  <Input
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder={t(
                      "teacherProfile.password.currentPasswordPlaceholder",
                    )}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    aria-label={
                      showCurrentPassword ? "Hide password" : "Show password"
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showCurrentPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t("teacherProfile.password.newPassword")}
                </label>
                <div className="relative">
                  <Input
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t(
                      "teacherProfile.password.newPasswordPlaceholder",
                    )}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    aria-label={
                      showNewPassword ? "Hide password" : "Show password"
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showNewPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t("teacherProfile.password.confirmPassword")}
                </label>
                <div className="relative">
                  <Input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t(
                      "teacherProfile.password.confirmPasswordPlaceholder",
                    )}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={
                      showConfirmPassword ? "Hide password" : "Show password"
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleUpdatePassword}
                  disabled={
                    isUpdatingPassword ||
                    !currentPassword ||
                    !newPassword ||
                    !confirmPassword
                  }
                  className="min-w-[100px]"
                >
                  {isUpdatingPassword ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t("teacherProfile.password.updating")}
                    </>
                  ) : (
                    t("teacherProfile.password.updateButton")
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowPasswordEdit(false);
                    setCurrentPassword("");
                    setNewPassword("");
                    setConfirmPassword("");
                  }}
                  disabled={isUpdatingPassword}
                >
                  {t("teacherProfile.password.cancel")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
