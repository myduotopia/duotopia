import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PLAN_NAMES } from "@/constants/plans";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CreditCard,
  Calendar,
  CheckCircle,
  XCircle,
  RefreshCw,
  ArrowRight,
  TrendingUp,
  Gauge,
  Package,
  Settings,
  Users,
  FileText,
  Gift,
  ShoppingCart,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import TapPayPayment from "@/components/payment/TapPayPayment";
import { SubscriptionCardManagement } from "@/components/payment/SubscriptionCardManagement";
import TeacherLoginModal from "@/components/TeacherLoginModal";
import {
  SubscriptionPlanCard,
  type SubscriptionPlan,
} from "@/components/pricing/SubscriptionPlanCard";
import {
  PointPackageCard,
  type PointPackage,
} from "@/components/pricing/PointPackageCard";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { apiClient } from "@/lib/api";
import { GroupBuyPlanCards } from "@/components/pricing/GroupBuyPlanCards";

interface CreditPackageInfo {
  id: number;
  package_id: string;
  points_total: number;
  points_used: number;
  points_remaining: number;
  price_paid: number;
  purchased_at: string | null;
  expires_at: string | null;
  status: string;
  source: string;
  is_expired: boolean;
}

// Backend-supplied flag (issue #768 comment 4638082532 item 4) so the
// UI can pick the right quota label, expiry date (annual vs monthly),
// and hide the "auto-renew" banner for group-buy members whose points
// come from the team leader's annual fee rather than a personal
// recurring charge.
type SubscriptionPlanType =
  | "individual"
  | "group_buy_member"
  | "group_buy_owner";

interface SubscriptionInfo {
  status: string;
  plan: string | null;
  plan_type?: SubscriptionPlanType;
  end_date: string | null;
  days_remaining: number;
  is_active: boolean;
  auto_renew: boolean;
  cancelled_at: string | null;
  quota_used?: number;
  quota_total?: number;
  quota_remaining?: number;
  subscription_total?: number;
  subscription_used?: number;
  subscription_remaining?: number;
  credit_packages_total?: number;
  credit_packages_remaining?: number;
  credit_packages?: CreditPackageInfo[];
}

interface SavedCardInfo {
  has_card: boolean;
  card: {
    last_four: string;
    card_type: string;
    issuer: string;
  } | null;
}

interface QuotaUsageAnalytics {
  summary: {
    total_used: number;
    total_quota: number;
    percentage: number;
  };
  daily_usage: Array<{ date: string; seconds: number }>;
  top_students: Array<{
    student_id: number;
    name: string;
    seconds: number;
    count: number;
  }>;
  top_assignments: Array<{
    assignment_id: number;
    title: string;
    seconds: number;
    students: number;
  }>;
  feature_breakdown: Record<string, number>;
}

function getSubscriptionPlans(t: (key: string) => string): SubscriptionPlan[] {
  return [
    {
      id: "free",
      name: t("pricing.plans.free.name"),
      description: t("pricing.plans.free.description"),
      monthlyPrice: 0,
      pointsPerMonth: 2000,
      pointsLabel: t("pricing.plans.free.pointsLabel"),
      studentCapacity: t("pricing.plans.free.studentCapacity"),
      features: [
        t("pricing.plans.free.features.assignments"),
        t("pricing.plans.free.features.aiUntilDepleted"),
        t("pricing.plans.free.features.semiAutoGrading"),
      ],
    },
    {
      id: "tutor",
      name: t("pricing.plans.tutor.name"),
      description: t("pricing.plans.tutor.description"),
      monthlyPrice: 299,
      pointsPerMonth: 2000,
      studentCapacity: t("pricing.plans.tutor.studentCapacity"),
      features: [
        t("pricing.plans.tutor.features.assignments"),
        t("pricing.plans.tutor.features.aiEvaluation"),
        t("pricing.plans.tutor.features.workshop"),
      ],
    },
    {
      id: "school",
      name: t("pricing.plans.school.name"),
      description: t("pricing.plans.school.description"),
      monthlyPrice: 599,
      pointsPerMonth: 6000,
      studentCapacity: t("pricing.plans.school.studentCapacity"),
      features: [
        t("pricing.plans.school.features.allTutor"),
        t("pricing.plans.school.features.report"),
      ],
      popular: true,
    },
  ];
}

const pointPackages: PointPackage[] = [
  {
    id: "pkg-1000",
    points: 1000,
    price: 180,
    bonusPoints: 0,
    unitCost: 0.18,
  },
  {
    id: "pkg-2000",
    points: 2000,
    price: 320,
    bonusPoints: 0,
    unitCost: 0.16,
  },
  {
    id: "pkg-5000",
    points: 5000,
    price: 700,
    bonusPoints: 200,
    unitCost: 0.1346,
  },
  {
    id: "pkg-10000",
    points: 10000,
    price: 1200,
    bonusPoints: 500,
    unitCost: 0.1143,
  },
  {
    id: "pkg-20000",
    points: 20000,
    price: 2000,
    bonusPoints: 800,
    unitCost: 0.0962,
    bestValue: true,
  },
];

const BASE_UNIT_COST = 0.18;
const PLAN_RANK: Record<string, number> = { free: 0, tutor: 1, school: 2 };

export default function TeacherSubscription() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(
    null,
  );
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showUsageDetailDialog, setShowUsageDetailDialog] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(
    null,
  );
  const [selectedPointPackage, setSelectedPointPackage] =
    useState<PointPackage | null>(null);
  const [savedCardInfo, setSavedCardInfo] = useState<SavedCardInfo | null>(
    null,
  );
  const [analytics, setAnalytics] = useState<QuotaUsageAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeTab, setActiveTab] = useState("plans");

  const { isAuthenticated } = useTeacherAuthStore();
  const subscriptionPlans = useMemo(() => getSubscriptionPlans(t), [t]);

  // Determine current plan ID from subscription data
  const getCurrentPlanId = (): string | null => {
    if (!subscription || !subscription.is_active) return null;
    const plan = subscription.plan;
    if (!plan) return null;
    if (plan === PLAN_NAMES.FREE_TRIAL) return "free";
    if (plan.toLowerCase().includes("tutor")) return "tutor";
    if (plan.toLowerCase().includes("school")) return "school";
    return "free";
  };

  const currentPlanId = getCurrentPlanId();

  useEffect(() => {
    fetchSubscriptionData();

    const handleSubscriptionChanged = () => {
      fetchSubscriptionData();
    };

    window.addEventListener(
      "subscriptionStatusChanged",
      handleSubscriptionChanged,
    );

    return () => {
      window.removeEventListener(
        "subscriptionStatusChanged",
        handleSubscriptionChanged,
      );
    };
  }, []);

  const fetchSubscriptionData = async () => {
    try {
      setLoading(true);

      try {
        const subData = await apiClient.get<SubscriptionInfo>(
          "/api/subscription/status",
        );
        setSubscription(subData);
      } catch (error) {
        console.error("Failed to fetch subscription:", error);
        if (error && typeof error === "object" && "status" in error) {
          if (error.status === 401) {
            toast.error(t("teacherSubscription.messages.pleaseLogin"));
          } else if (error.status === 403) {
            toast.error(t("teacherSubscription.messages.permissionDenied"));
          } else {
            toast.error(
              t("teacherSubscription.messages.loadSubscriptionFailed"),
            );
          }
        } else {
          toast.error(t("teacherSubscription.messages.loadSubscriptionFailed"));
        }
      }

      try {
        const cardData = await apiClient.get<SavedCardInfo>(
          "/api/payment/saved-card",
        );
        setSavedCardInfo(cardData);
      } catch (error) {
        console.error("Failed to fetch card info:", error);
        setSavedCardInfo(null);
      }
    } catch (error) {
      console.error("Failed to fetch subscription data:", error);
      toast.error(t("teacherSubscription.messages.loadSubscriptionFailed"));
    } finally {
      setLoading(false);
    }
  };

  const fetchAnalytics = async () => {
    try {
      setAnalyticsLoading(true);
      const data = await apiClient.get<QuotaUsageAnalytics>(
        "/api/teachers/quota-usage",
      );
      setAnalytics(data);
    } catch (error) {
      console.error("Failed to fetch analytics:", error);
      toast.error(t("teacherSubscription.messages.loadAnalyticsFailed"));
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const handleOpenUsageDetail = () => {
    setShowUsageDetailDialog(true);
    if (!analytics) {
      fetchAnalytics();
    }
  };

  const handleSelectPlan = (plan: SubscriptionPlan) => {
    setSelectedPlan(plan);
    setShowPaymentDialog(true);
  };

  const handleSelectPointPackage = (pkg: PointPackage) => {
    setSelectedPointPackage(pkg);
    setSelectedPlan(null);
    setShowPaymentDialog(true);
  };

  const handlePaymentSuccess = async (transactionId: string) => {
    if (selectedPointPackage) {
      toast.success(
        t("pricing.pointPackages.purchaseSuccess", {
          points: selectedPointPackage.points.toLocaleString(),
          transactionId,
        }),
      );
    } else {
      toast.success(
        t("teacherSubscription.messages.subscriptionSuccess", {
          transactionId,
        }),
      );
    }
    setShowPaymentDialog(false);
    setSelectedPlan(null);
    setSelectedPointPackage(null);
    await fetchSubscriptionData();
  };

  const handlePaymentError = (error: string) => {
    toast.error(
      t("teacherSubscription.messages.subscriptionFailed", { error }),
    );
  };

  const handleCancelSubscription = async () => {
    try {
      await apiClient.post("/api/teachers/subscription/cancel");
      toast.success(t("teacherSubscription.messages.cancelSuccess"));
      setShowCancelDialog(false);
      await fetchSubscriptionData();
    } catch (error) {
      if (error && typeof error === "object" && "detail" in error) {
        toast.error(
          (error as { detail: string }).detail ||
            t("teacherSubscription.messages.cancelFailed"),
        );
      } else {
        toast.error(t("teacherSubscription.messages.cancelFailed"));
      }
    }
  };

  const handleReactivateSubscription = async () => {
    try {
      await apiClient.post("/api/teachers/subscription/reactivate");
      toast.success(t("teacherSubscription.messages.reactivateSuccess"));
      await fetchSubscriptionData();
    } catch (error) {
      if (error && typeof error === "object" && "detail" in error) {
        toast.error(
          (error as { detail: string }).detail ||
            t("teacherSubscription.messages.reactivateFailed"),
        );
      } else {
        toast.error(t("teacherSubscription.messages.reactivateFailed"));
      }
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div>
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">
            {t("teacherSubscription.title")}
          </h1>
          <p className="text-gray-600 mt-2">
            {t("teacherSubscription.description")}
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6 h-auto p-1 bg-gray-100">
            <TabsTrigger
              value="plans"
              className="flex items-center gap-2 py-3 text-base font-medium text-gray-600 data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm"
            >
              <CreditCard className="w-5 h-5" />
              {t("teacherSubscription.tabs.plans")}
            </TabsTrigger>
            <TabsTrigger
              value="pointPackages"
              className="flex items-center gap-2 py-3 text-base font-medium text-gray-600 data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm"
            >
              <Package className="w-5 h-5" />
              {t("teacherSubscription.tabs.pointPackages")}
            </TabsTrigger>
            <TabsTrigger
              value="management"
              className="flex items-center gap-2 py-3 text-base font-medium text-gray-600 data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm"
            >
              <Settings className="w-5 h-5" />
              {t("teacherSubscription.tabs.management")}
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Plans */}
          <TabsContent value="plans">
            <div className="space-y-10">
              <div className="grid md:grid-cols-3 gap-6">
                {subscriptionPlans.map((plan) => {
                  const isCurrentPlan = currentPlanId === plan.id;
                  const currentRank = currentPlanId
                    ? (PLAN_RANK[currentPlanId] ?? -1)
                    : -1;
                  const thisRank = PLAN_RANK[plan.id] ?? 0;

                  let ctaText: string;
                  let disabled = false;
                  let onSelect: ((plan: SubscriptionPlan) => void) | undefined =
                    handleSelectPlan;

                  if (!isAuthenticated) {
                    // Not logged in
                    if (plan.id === "free") {
                      ctaText = t("pricing.actions.freeRegister");
                      onSelect = () => setShowLoginModal(true);
                    } else {
                      ctaText = t("pricing.actions.subscribe");
                    }
                  } else if (isCurrentPlan) {
                    ctaText = t("pricing.actions.currentPlan");
                    disabled = true;
                  } else if (currentRank >= 0 && thisRank > currentRank) {
                    ctaText = t("pricing.actions.upgradePlan");
                  } else if (plan.id === "free") {
                    // Logged in user viewing free plan (they have a higher plan)
                    ctaText = t("pricing.actions.currentPlan");
                    disabled = true;
                    // If user is on a paid plan, free card just shows disabled
                    if (currentRank > 0) {
                      ctaText = t("pricing.plans.free.name");
                      disabled = true;
                    }
                  } else {
                    ctaText = t("pricing.actions.subscribe");
                  }

                  return (
                    <SubscriptionPlanCard
                      key={plan.id}
                      plan={plan}
                      onSelect={onSelect}
                      disabled={disabled}
                      disabledText={ctaText}
                      ctaText={ctaText}
                      isCurrent={isCurrentPlan}
                    />
                  );
                })}
              </div>

              {/* Issue #768 comment 4638082532 item 3 — surface the 3
                  group-buy plans directly in the subscription page so
                  teachers don't have to navigate to /pricing to learn
                  about them. Cards are clickable: any click jumps
                  straight into the open-team flow. Hidden for teachers
                  who are already on a group-buy plan (R2-F2 single-org
                  guard would 409 their open attempt anyway). */}
              {subscription?.plan_type !== "group_buy_member" &&
                subscription?.plan_type !== "group_buy_owner" && (
                  <div className="space-y-4">
                    <GroupBuyPlanCards
                      onSelectPlan={() => navigate("/teacher/group-buy/open")}
                    />
                    <div className="text-center">
                      <Button
                        variant="outline"
                        onClick={() => navigate("/teacher/group-buy/open")}
                      >
                        立即開設團購方案 →
                      </Button>
                    </div>
                  </div>
                )}
            </div>
          </TabsContent>

          {/* Tab 2: Point Packages */}
          <TabsContent value="pointPackages">
            <div className="text-center mb-6">
              <p className="text-gray-600">
                {t("pricing.pointPackages.description")}
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {pointPackages.map((pkg) => (
                <PointPackageCard
                  key={pkg.id}
                  pkg={pkg}
                  onSelect={handleSelectPointPackage}
                  ctaText={t("pricing.pointPackages.buy")}
                  baseUnitCost={BASE_UNIT_COST}
                />
              ))}
            </div>
          </TabsContent>

          {/* Tab 3: Subscription Management */}
          <TabsContent value="management" className="space-y-6">
            {/* Phase 5-2 follow-up (#768): group-buy upsell CTA for
                existing individual subscribers. Hide for teachers already
                on a group-buy plan — clicking through would hit R2-F2
                single-org guard and 409.
                TODO: replace prefix check with a backend-supplied flag
                when SubscriptionInfo exposes teacher_seats or org_type. */}
            {!subscription?.plan?.startsWith("團購") && (
              <Card className="mb-6 border-blue-200 bg-gradient-to-br from-blue-50 to-white">
                <CardContent className="py-5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex-1">
                      <div className="font-semibold text-gray-900">
                        👥 想為團隊一起採購？
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
                        開設 10 / 30 / 50 席教師團購方案，享更低每席費用 +
                        加購點數包折扣。團主刷卡一次即可開團。
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      className="border-blue-300 text-blue-700 hover:bg-blue-100 shrink-0"
                      onClick={() => navigate("/teacher/group-buy/open")}
                    >
                      了解團購方案 →
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5" />
                  {t("teacherSubscription.subscription.currentStatus")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {subscription && subscription.is_active ? (
                  <div className="space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <h3 className="text-xl font-semibold">
                            {subscription.plan ||
                              t("teacherSubscription.subscription.unknownPlan")}
                          </h3>
                          <Badge
                            className={
                              subscription.plan === PLAN_NAMES.FREE_TRIAL
                                ? "bg-blue-500"
                                : "bg-green-500"
                            }
                          >
                            <CheckCircle className="w-3 h-3 mr-1" />
                            {subscription.plan === PLAN_NAMES.FREE_TRIAL
                              ? t("teacherSubscription.subscription.trial")
                              : t("teacherSubscription.subscription.active")}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">
                          {subscription.plan === PLAN_NAMES.FREE_TRIAL
                            ? t(
                                "teacherSubscription.subscription.trialDescription",
                              )
                            : t("teacherSubscription.subscription.statusGood")}
                        </p>
                        <p className="text-sm text-blue-600 mt-1 font-medium">
                          {subscription.plan_type === "group_buy_member" ||
                          subscription.plan_type === "group_buy_owner" ? (
                            // Group-buy: backend ships the per-teacher
                            // monthly quota in quota_total. Showing that
                            // directly avoids the prior bug where the
                            // generic "tutor" template said 2000 點/月
                            // for a 1000-點 group-buy plan.
                            <>
                              {(
                                subscription.subscription_total ||
                                subscription.quota_total ||
                                0
                              ).toLocaleString()}{" "}
                              點 AI 配額 / 月（團購配給）
                            </>
                          ) : subscription.plan === "School Teachers" ? (
                            t("teacherSubscription.subscription.quotaSchool")
                          ) : subscription.plan === PLAN_NAMES.FREE_TRIAL ? (
                            t("teacherSubscription.subscription.quotaTrial")
                          ) : (
                            t("teacherSubscription.subscription.quotaTutor")
                          )}
                        </p>
                      </div>
                      {subscription.plan === PLAN_NAMES.FREE_TRIAL && (
                        <div className="flex-shrink-0">
                          <Button
                            onClick={() => {
                              setActiveTab("plans");
                            }}
                            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white"
                          >
                            <TrendingUp className="w-4 h-4 mr-2" />
                            {t("teacherSubscription.buttons.upgradeToPaid")}
                          </Button>
                        </div>
                      )}
                    </div>

                    <Separator />

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="flex items-start gap-3">
                        <Calendar className="w-5 h-5 text-blue-600 mt-1" />
                        <div className="flex-1">
                          <p className="text-sm text-gray-600 mb-1">
                            {t("teacherSubscription.labels.expiryDate")}
                          </p>
                          <p className="font-semibold text-sm">
                            {subscription.end_date
                              ? formatDate(subscription.end_date)
                              : "N/A"}
                          </p>
                          <div className="mt-2">
                            <div className="flex items-center gap-3">
                              <div className="flex-1 bg-gray-200 rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full transition-all ${
                                    subscription.days_remaining <= 7
                                      ? "bg-red-500"
                                      : subscription.days_remaining <= 14
                                        ? "bg-yellow-500"
                                        : "bg-green-500"
                                  }`}
                                  style={{
                                    width: `${Math.min(100, (subscription.days_remaining / 30) * 100)}%`,
                                  }}
                                />
                              </div>
                              <p className="font-semibold text-sm whitespace-nowrap">
                                {t("teacherSubscription.labels.daysRemaining", {
                                  days: subscription.days_remaining,
                                })}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-3">
                        <Gauge className="w-5 h-5 text-blue-600 mt-1" />
                        <div className="flex-1">
                          <p className="text-sm text-gray-600 mb-2">
                            {t("teacherSubscription.labels.quotaUsage")}
                          </p>
                          <div className="flex items-center gap-3">
                            <div className="flex-1 bg-gray-200 rounded-full h-2">
                              <div
                                className="h-2 rounded-full transition-all bg-blue-500"
                                style={{
                                  width: `${Math.min(100, ((subscription.quota_used || 0) / (subscription.quota_total || 10000)) * 100)}%`,
                                }}
                              />
                            </div>
                            <p className="font-semibold text-sm whitespace-nowrap">
                              {Math.min(
                                100,
                                Math.round(
                                  ((subscription.quota_used || 0) /
                                    (subscription.quota_total || 10000)) *
                                    100,
                                ),
                              )}
                              %
                            </p>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {subscription.quota_used || 0} /{" "}
                            {(subscription.quota_total || 0).toLocaleString()}{" "}
                            {t("teacherSubscription.labels.points")}
                          </p>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-blue-600 hover:text-blue-700 h-auto px-0 py-1 text-xs"
                            onClick={handleOpenUsageDetail}
                          >
                            {t("teacherSubscription.buttons.viewUsageDetail")}
                            <ArrowRight className="w-3 h-3 ml-1" />
                          </Button>
                        </div>
                      </div>

                      <div className="flex items-start gap-3">
                        <RefreshCw className="w-5 h-5 text-blue-600 mt-1" />
                        <div className="flex-1">
                          <p className="text-sm text-gray-600 mb-2">
                            {t("teacherSubscription.labels.autoRenew")}
                          </p>
                          {subscription.plan_type === "group_buy_member" ||
                          subscription.plan_type === "group_buy_owner" ? (
                            // Group-buy members get points from the team
                            // leader's annual fee — no per-teacher
                            // auto-renew. Surface this explicitly so the
                            // teacher doesn't go hunting for a button
                            // that wouldn't apply to them.
                            <p className="text-sm text-gray-600">
                              {subscription.plan_type === "group_buy_owner"
                                ? "團主：團隊年費於到期時手動續訂；不適用個人自動續訂。"
                                : "團員：配額由團主年費自動配給，不需個人續訂。"}
                            </p>
                          ) : subscription.auto_renew ? (
                            <div className="flex items-center gap-3">
                              <p className="font-semibold text-green-600">
                                {t("teacherSubscription.labels.enabled")}
                              </p>
                              <Button
                                onClick={() => setShowCancelDialog(true)}
                                size="sm"
                                variant="outline"
                                className="text-red-600 hover:text-red-700 hover:border-red-300"
                              >
                                <XCircle className="w-4 h-4 mr-2" />
                                {t("teacherSubscription.buttons.cancelRenewal")}
                              </Button>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center gap-3">
                                <p className="font-semibold text-orange-600">
                                  {t("teacherSubscription.labels.cancelled")}
                                </p>
                                <Button
                                  onClick={handleReactivateSubscription}
                                  size="sm"
                                  variant="outline"
                                  className="text-blue-600 hover:text-blue-700 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                  disabled={!savedCardInfo?.has_card}
                                  title={
                                    !savedCardInfo?.has_card
                                      ? t(
                                          "teacherSubscription.messages.pleaseBindCard",
                                        )
                                      : ""
                                  }
                                >
                                  <RefreshCw className="w-4 h-4 mr-2" />
                                  {t(
                                    "teacherSubscription.buttons.enableRenewal",
                                  )}
                                </Button>
                              </div>
                              {!savedCardInfo?.has_card && (
                                <p className="text-xs text-gray-500">
                                  {t(
                                    "teacherSubscription.messages.pleaseBindCardIcon",
                                  )}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {!subscription.auto_renew &&
                      subscription.plan_type !== "group_buy_member" &&
                      subscription.plan_type !== "group_buy_owner" && (
                        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                          <p className="text-orange-800 text-sm">
                            {t(
                              "teacherSubscription.warnings.renewalCancelled",
                              {
                                date: subscription.end_date
                                  ? formatDate(subscription.end_date)
                                  : t("teacherSubscription.labels.expiryDate"),
                              },
                            )}
                          </p>
                        </div>
                      )}

                    {subscription.days_remaining <= 7 && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                        <p className="text-yellow-800 text-sm">
                          {t(
                            "teacherSubscription.warnings.subscriptionExpiring",
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                ) : subscription &&
                  (subscription.credit_packages_total ?? 0) > 0 ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <h3 className="text-xl font-semibold">
                        {t("teacherSubscription.creditPackages.creditOnly")}
                      </h3>
                      <Badge className="bg-blue-100 text-blue-700">
                        <Package className="w-3 h-3 mr-1" />
                        {t("teacherSubscription.creditPackages.active")}
                      </Badge>
                    </div>
                    <Separator />
                    <div className="flex items-start gap-3">
                      <Gauge className="w-5 h-5 text-blue-600 mt-1" />
                      <div className="flex-1">
                        <p className="text-sm text-gray-600 mb-2">
                          {t("teacherSubscription.labels.quotaUsage")}
                        </p>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 bg-gray-200 rounded-full h-2">
                            <div
                              className="h-2 rounded-full transition-all bg-blue-500"
                              style={{
                                width: `${Math.min(100, ((subscription.quota_used || 0) / (subscription.quota_total || 1)) * 100)}%`,
                              }}
                            />
                          </div>
                          <p className="font-semibold text-sm whitespace-nowrap">
                            {Math.min(
                              100,
                              Math.round(
                                ((subscription.quota_used || 0) /
                                  (subscription.quota_total || 1)) *
                                  100,
                              ),
                            )}
                            %
                          </p>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {subscription.quota_used || 0} /{" "}
                          {(subscription.quota_total || 0).toLocaleString()}{" "}
                          {t("teacherSubscription.labels.points")}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <XCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      {t("teacherSubscription.subscription.noSubscription")}
                    </h3>
                    <p className="text-gray-600 mb-4">
                      {t("teacherSubscription.subscription.choosePlan")}
                    </p>
                    <Button
                      onClick={() => {
                        const tabsTrigger = document.querySelector(
                          '[value="plans"]',
                        ) as HTMLElement;
                        tabsTrigger?.click();
                      }}
                    >
                      {t("teacherSubscription.buttons.viewPlans")}
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Credit Package Details */}
            {subscription?.credit_packages &&
              subscription.credit_packages.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Package className="w-5 h-5" />
                      {t("teacherSubscription.creditPackages.title")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {subscription.credit_packages.map((pkg) => {
                        const usagePercent =
                          pkg.points_total > 0
                            ? Math.round(
                                (pkg.points_used / pkg.points_total) * 100,
                              )
                            : 0;
                        const isExpired =
                          pkg.is_expired || pkg.status === "expired";

                        return (
                          <div
                            key={pkg.id}
                            className={`border rounded-lg p-4 ${isExpired ? "opacity-50 bg-gray-50" : "bg-white"}`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                {pkg.source === "trial_bonus" ? (
                                  <Gift className="w-4 h-4 text-purple-500" />
                                ) : (
                                  <ShoppingCart className="w-4 h-4 text-blue-500" />
                                )}
                                <span className="font-medium text-sm">
                                  {pkg.source === "trial_bonus"
                                    ? t(
                                        "teacherSubscription.creditPackages.trialBonus",
                                      )
                                    : t(
                                        "teacherSubscription.creditPackages.purchased",
                                        {
                                          points:
                                            pkg.points_total.toLocaleString(),
                                        },
                                      )}
                                </span>
                              </div>
                              <Badge
                                variant={isExpired ? "secondary" : "default"}
                                className={
                                  isExpired
                                    ? "bg-gray-200"
                                    : "bg-green-100 text-green-700"
                                }
                              >
                                {isExpired
                                  ? t(
                                      "teacherSubscription.creditPackages.expired",
                                    )
                                  : t(
                                      "teacherSubscription.creditPackages.active",
                                    )}
                              </Badge>
                            </div>

                            <div className="flex items-center gap-3 mb-1">
                              <div className="flex-1 bg-gray-200 rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full transition-all ${isExpired ? "bg-gray-400" : "bg-blue-500"}`}
                                  style={{
                                    width: `${Math.min(100, usagePercent)}%`,
                                  }}
                                />
                              </div>
                              <span className="text-sm font-medium whitespace-nowrap">
                                {pkg.points_used.toLocaleString()} /{" "}
                                {pkg.points_total.toLocaleString()}{" "}
                                {t("teacherSubscription.labels.points")}
                              </span>
                            </div>

                            <div className="flex items-center gap-1 text-xs text-gray-500">
                              <Clock className="w-3 h-3" />
                              <span>
                                {pkg.expires_at
                                  ? t(
                                      "teacherSubscription.creditPackages.expiresAt",
                                      {
                                        date: new Date(
                                          pkg.expires_at,
                                        ).toLocaleDateString("zh-TW"),
                                      },
                                    )
                                  : ""}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

            <div data-card-management>
              <SubscriptionCardManagement />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Cancel Renewal Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("teacherSubscription.dialogs.cancelTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("teacherSubscription.dialogs.cancelDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
              <h4 className="font-semibold mb-2">
                {t("teacherSubscription.dialogs.whatHappens")}
              </h4>
              <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <span>
                    {t("teacherSubscription.dialogs.remainsValidUntil", {
                      date: subscription?.end_date
                        ? formatDate(subscription.end_date)
                        : t("teacherSubscription.labels.expiryDate"),
                    })}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <XCircle className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />
                  <span>{t("teacherSubscription.dialogs.loseAccess")}</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <span>{t("teacherSubscription.dialogs.canReactivate")}</span>
                </li>
              </ul>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => setShowCancelDialog(false)}
                variant="outline"
                className="flex-1"
              >
                {t("teacherSubscription.buttons.goBack")}
              </Button>
              <Button
                onClick={handleCancelSubscription}
                variant="destructive"
                className="flex-1"
              >
                {t("teacherSubscription.buttons.confirmCancel")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Payment Dialog */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{t("pricing.payment.title")}</DialogTitle>
            <DialogDescription>
              {selectedPointPackage
                ? t("pricing.pointPackages.purchaseTitle", {
                    points: selectedPointPackage.points.toLocaleString(),
                  })
                : t("pricing.payment.selectedPlan", {
                    planName: selectedPlan?.name,
                  })}
            </DialogDescription>
          </DialogHeader>

          {selectedPointPackage ? (
            <TapPayPayment
              amount={selectedPointPackage.price}
              planName={`${selectedPointPackage.points.toLocaleString()} ${t("pricing.pointPackages.points")}`}
              apiEndpoint="/api/credit-packages/purchase"
              customPayload={{ package_id: selectedPointPackage.id }}
              onPaymentSuccess={handlePaymentSuccess}
              onPaymentError={handlePaymentError}
              onCancel={() => {
                setShowPaymentDialog(false);
                setSelectedPointPackage(null);
              }}
            />
          ) : selectedPlan ? (
            <TapPayPayment
              amount={selectedPlan.monthlyPrice}
              planName={selectedPlan.name}
              onPaymentSuccess={handlePaymentSuccess}
              onPaymentError={handlePaymentError}
              onCancel={() => setShowPaymentDialog(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Login / Register Modal */}
      <TeacherLoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onLoginSuccess={() => {
          setShowLoginModal(false);
          fetchSubscriptionData();
        }}
      />

      {/* Usage Detail Dialog */}
      <Dialog
        open={showUsageDetailDialog}
        onOpenChange={setShowUsageDetailDialog}
      >
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t("teacherSubscription.usageDetail.title")}
            </DialogTitle>
            <DialogDescription>
              {t("teacherSubscription.usageDetail.description")}
            </DialogDescription>
          </DialogHeader>

          {analyticsLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : analytics ? (
            <Tabs defaultValue="summary" className="w-full">
              <TabsList className="grid w-full grid-cols-3 h-auto p-1">
                <TabsTrigger value="summary" className="text-sm py-2">
                  <Gauge className="w-4 h-4 mr-1.5" />
                  {t("teacherSubscription.usageDetail.tabs.summary")}
                </TabsTrigger>
                <TabsTrigger value="students" className="text-sm py-2">
                  <Users className="w-4 h-4 mr-1.5" />
                  {t("teacherSubscription.usageDetail.tabs.students")}
                </TabsTrigger>
                <TabsTrigger value="assignments" className="text-sm py-2">
                  <FileText className="w-4 h-4 mr-1.5" />
                  {t("teacherSubscription.usageDetail.tabs.assignments")}
                </TabsTrigger>
              </TabsList>

              {/* Summary Tab */}
              <TabsContent value="summary" className="space-y-4 mt-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-3 bg-blue-50 rounded-lg">
                    <p className="text-xs text-gray-600 mb-1">
                      {t("teacherSubscription.usageDetail.totalQuota")}
                    </p>
                    <p className="text-2xl font-bold text-blue-600">
                      {analytics.summary.total_quota.toLocaleString()}
                    </p>
                    <p className="text-xs text-gray-500">
                      {t("teacherSubscription.labels.points")}
                    </p>
                  </div>
                  <div className="text-center p-3 bg-orange-50 rounded-lg">
                    <p className="text-xs text-gray-600 mb-1">
                      {t("teacherSubscription.usageDetail.used")}
                    </p>
                    <p className="text-2xl font-bold text-orange-600">
                      {analytics.summary.total_used.toLocaleString()}
                    </p>
                    <p className="text-xs text-gray-500">
                      {t("teacherSubscription.labels.points")}
                    </p>
                  </div>
                  <div className="text-center p-3 bg-green-50 rounded-lg">
                    <p className="text-xs text-gray-600 mb-1">
                      {t("teacherSubscription.usageDetail.usageRate")}
                    </p>
                    <p className="text-2xl font-bold text-green-600">
                      {analytics.summary.percentage}%
                    </p>
                    <p className="text-xs text-gray-500">
                      {t("teacherSubscription.usageDetail.remaining", {
                        points:
                          analytics.summary.total_quota -
                          analytics.summary.total_used,
                      })}
                    </p>
                  </div>
                </div>

                {analytics.daily_usage.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">
                      {t("teacherSubscription.usageDetail.dailyTrend")}
                    </h4>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={analytics.daily_usage}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <RechartsTooltip />
                        <Line
                          type="monotone"
                          dataKey="seconds"
                          stroke="#3b82f6"
                          name={t("teacherSubscription.usageDetail.pointsUsed")}
                          strokeWidth={2}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="text-center py-6 text-gray-400 text-sm">
                    {t("teacherSubscription.usageDetail.noData")}
                  </div>
                )}
              </TabsContent>

              {/* Students Tab */}
              <TabsContent value="students" className="mt-4">
                {analytics.top_students.length > 0 ? (
                  <div>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={analytics.top_students} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis
                          dataKey="name"
                          type="category"
                          width={80}
                          tick={{ fontSize: 11 }}
                        />
                        <RechartsTooltip />
                        <Bar
                          dataKey="seconds"
                          fill="#10b981"
                          name={t("teacherSubscription.usageDetail.pointsUsed")}
                          radius={[0, 4, 4, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-400 text-sm">
                    <Users className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                    {t("teacherSubscription.usageDetail.noData")}
                  </div>
                )}
              </TabsContent>

              {/* Assignments Tab */}
              <TabsContent value="assignments" className="mt-4">
                {analytics.top_assignments.length > 0 ? (
                  <div>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart
                        data={analytics.top_assignments}
                        layout="vertical"
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis
                          dataKey="title"
                          type="category"
                          width={100}
                          tick={{ fontSize: 11 }}
                        />
                        <RechartsTooltip />
                        <Bar
                          dataKey="seconds"
                          fill="#f59e0b"
                          name={t("teacherSubscription.usageDetail.pointsUsed")}
                          radius={[0, 4, 4, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-400 text-sm">
                    <FileText className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                    {t("teacherSubscription.usageDetail.noData")}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          ) : (
            <div className="py-8 text-center text-gray-500">
              <Gauge className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>{t("teacherSubscription.usageDetail.noData")}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
