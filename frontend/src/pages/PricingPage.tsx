import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Shield,
  LogOut,
  Sparkles,
  CreditCard,
  Package,
  HelpCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import TapPayPayment from "@/components/payment/TapPayPayment";
import TeacherLoginSheet from "@/components/TeacherLoginSheet";
import TeacherRegisterSheet from "@/components/TeacherRegisterSheet";
import {
  SubscriptionPlanCard,
  type SubscriptionPlan,
} from "@/components/pricing/SubscriptionPlanCard";
import {
  PointPackageCard,
  type PointPackage,
} from "@/components/pricing/PointPackageCard";
import { PricingFAQ } from "@/components/pricing/PricingFAQ";
import { toast } from "sonner";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import LineContactButton, {
  LINE_FRIEND_URL,
} from "@/components/LineContactButton";
import { apiClient } from "@/lib/api";

function getSubscriptionPlans(t: (key: string) => string): SubscriptionPlan[] {
  return [
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

const BASE_UNIT_COST = 0.18; // highest unit cost for discount calculation

// Issue #768 comment #3 part 2 — group-buy marketing cards. Fetched from
// the (now public) /api/credit-packages/group-buy-plans endpoint so admin
// edits to the Plan table propagate live. Hardcoded seed used as fallback
// only if the request fails — keeps anonymous visitors from seeing an
// empty card grid on transient API hiccups.
interface GroupBuyMarketingPlan {
  name: string;
  teacher_seats: number;
  annual_fee: number;
  total_amount: number;
  topup_discount: number;
  monthly_quota: number;
  display_order: number;
}

// IMPORTANT: these values mirror the DB seed as of 2026-06-15.
// Admin action path: after editing any 團購 plan at `/admin/plans`
// (quota, annual_fee, topup_discount, teacher_seats), ALSO update the
// corresponding entry in this `GROUP_BUY_FALLBACK` constant. Live
// PricingPage will reflect the new values as long as the API request
// succeeds; this fallback only fires on network failure / 5xx, and at
// that point will silently show stale data unless kept in sync. There
// is no automated enforcement — this comment is the only safety net.
const GROUP_BUY_FALLBACK: GroupBuyMarketingPlan[] = [
  {
    name: "團購-10席",
    teacher_seats: 10,
    annual_fee: 1500,
    total_amount: 15000,
    topup_discount: 0.95,
    monthly_quota: 1000,
    display_order: 10,
  },
  {
    name: "團購-30席",
    teacher_seats: 30,
    annual_fee: 1300,
    total_amount: 39000,
    topup_discount: 0.9,
    monthly_quota: 1000,
    display_order: 11,
  },
  {
    name: "團購-50席",
    teacher_seats: 50,
    annual_fee: 1000,
    total_amount: 50000,
    topup_discount: 0.85,
    monthly_quota: 1000,
    display_order: 12,
  },
];

function GroupBuyCards() {
  const [plans, setPlans] =
    useState<GroupBuyMarketingPlan[]>(GROUP_BUY_FALLBACK);
  useEffect(() => {
    let cancelled = false;
    apiClient
      .listGroupBuyPlans()
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data) && data.length > 0) setPlans(data);
      })
      .catch(() => {
        // Keep the fallback; the page already renders something useful.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <>
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900">👥 教師團購方案</h2>
        <p className="text-sm text-gray-600 mt-2 max-w-2xl mx-auto">
          為您的教師團隊一次採購年費方案，享更低的每席費用 +
          加購點數包折扣。團主刷卡一次即可開團，月配點自動發放給團內每位教師。
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((p) => (
          <div
            key={p.name}
            className="rounded-xl border border-gray-200 bg-white p-6 flex flex-col"
          >
            <div className="text-lg font-bold text-gray-900">{p.name}</div>
            <div className="text-sm text-gray-500">
              {p.teacher_seats} 位教師席次
            </div>
            <div className="my-4 space-y-1 text-sm">
              <div>
                每席年費{" "}
                <span className="font-semibold">
                  NT$ {p.annual_fee.toLocaleString()}
                </span>
              </div>
              <div>
                月配點{" "}
                <span className="font-semibold">
                  {p.monthly_quota.toLocaleString()} 點 / 教師
                </span>
              </div>
              <div>
                加購折扣{" "}
                <span className="font-semibold">
                  {Math.round((1 - p.topup_discount) * 100)}% off
                </span>
              </div>
            </div>
            <div className="mt-auto pt-3 border-t border-gray-200">
              <div className="text-xs text-gray-500">團隊總價</div>
              <div className="text-xl font-bold text-blue-600">
                NT$ {p.total_amount.toLocaleString()} / 年
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export default function PricingPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const subscriptionPlans = useMemo(() => getSubscriptionPlans(t), [t]);
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(
    null,
  );
  const [selectedPointPackage, setSelectedPointPackage] =
    useState<PointPackage | null>(null);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [userInfo, setUserInfo] = useState<{
    isLoggedIn: boolean;
    name?: string;
    email?: string;
    role?: string;
  } | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showRegisterSheet, setShowRegisterSheet] = useState(false);
  const [activeTab, setActiveTab] = useState("subscription");
  const faqRef = useRef<HTMLDivElement>(null);

  const handleSelectPlan = (plan: SubscriptionPlan) => {
    const teacherAuth = useTeacherAuthStore.getState();
    const studentAuth = useStudentAuthStore.getState();

    if (!teacherAuth.isAuthenticated) {
      setShowLoginModal(true);
      toast.info(t("pricing.actions.loginRequired"));
      return;
    }

    if (studentAuth.isAuthenticated) {
      toast.error(t("pricing.actions.studentAccountWarning"));
      return;
    }

    setSelectedPlan(plan);
    setShowPaymentDialog(true);
  };

  const handleSelectPointPackage = (pkg: PointPackage) => {
    const teacherAuth = useTeacherAuthStore.getState();

    if (!teacherAuth.isAuthenticated) {
      setShowLoginModal(true);
      toast.info(t("pricing.actions.loginRequired"));
      return;
    }

    setSelectedPointPackage(pkg);
    setSelectedPlan(null);
    setShowPaymentDialog(true);
  };

  const handlePaymentSuccess = (_transactionId: string) => {
    try {
      if (selectedPointPackage) {
        toast.success(
          t("pricing.pointPackages.purchaseSuccess", {
            points: selectedPointPackage.points.toLocaleString(),
          }),
        );
      } else {
        toast.success(
          t("pricing.payment.success", { planName: selectedPlan?.name }),
        );
      }
      setShowPaymentDialog(false);
      setSelectedPlan(null);
      setSelectedPointPackage(null);
      setTimeout(() => {
        navigate("/teacher/dashboard");
      }, 2000);
    } catch (error) {
      console.error("Payment error:", error);
      toast.error(t("pricing.payment.error"));
    }
  };

  const handlePaymentError = (error: string) => {
    toast.error(t("pricing.payment.failed", { error }));
  };

  useEffect(() => {
    window.scrollTo(0, 0);
    checkUserStatus();
    checkSubscriptionStatus();
  }, []);

  const checkUserStatus = () => {
    const teacherAuth = useTeacherAuthStore.getState();
    const studentAuth = useStudentAuthStore.getState();

    if (teacherAuth.isAuthenticated && teacherAuth.user) {
      setUserInfo({
        isLoggedIn: true,
        name:
          teacherAuth.user.name ||
          teacherAuth.user.email?.split("@")[0] ||
          t("pricing.fallback.teacher"),
        email: teacherAuth.user.email,
        role: "teacher",
      });
    } else if (studentAuth.isAuthenticated && studentAuth.user) {
      setUserInfo({
        isLoggedIn: true,
        name:
          studentAuth.user.name ||
          t("pricing.fallback.student", { id: studentAuth.user.id }),
        email: studentAuth.user.email,
        role: "student",
      });
    } else {
      setUserInfo({ isLoggedIn: false });
    }
  };

  const checkSubscriptionStatus = async () => {
    const teacherAuth = useTeacherAuthStore.getState();
    if (!teacherAuth.isAuthenticated || !teacherAuth.token) return;

    try {
      const data = await apiClient.get<{ is_active: boolean }>(
        "/api/subscription/status",
      );
      if (data.is_active) {
        toast.info(t("pricing.payment.hasSubscription"));
        setTimeout(() => {
          navigate("/teacher/subscription");
        }, 1000);
      }
    } catch (error) {
      console.error("Error checking subscription:", error);
    }
  };

  const handleLogout = () => {
    const teacherLogout = useTeacherAuthStore.getState().logout;
    const studentLogout = useStudentAuthStore.getState().logout;

    teacherLogout();
    studentLogout();

    localStorage.removeItem("selectedPlan");

    setUserInfo({ isLoggedIn: false });
    toast.success(t("common.success"));
  };

  useEffect(() => {
    const savedPlan = localStorage.getItem("selectedPlan");

    if (savedPlan && userInfo?.isLoggedIn && userInfo?.role === "teacher") {
      try {
        const planData = JSON.parse(savedPlan);
        const plan = subscriptionPlans.find((p) => p.id === planData.id);
        if (plan) {
          setSelectedPlan(plan);
          setShowPaymentDialog(true);
          localStorage.removeItem("selectedPlan");
          toast.success(t("pricing.payment.redirecting"));
        }
      } catch (error) {
        console.error("Error parsing saved plan:", error);
      }
    }
  }, [userInfo, subscriptionPlans, t]);

  const isStudent = userInfo?.role === "student";

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Header - same style as Home page, no gap to hero */}
      <header className="bg-white py-2 px-3 sm:py-3 sm:px-6 flex items-center justify-between">
        <Link to="/">
          <img
            src="https://storage.googleapis.com/duotopia-social-media-videos/website/logo/logo_row_nobg.png"
            alt="Duotopia"
            className="h-8 sm:h-10"
          />
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-3">
          {userInfo?.isLoggedIn ? (
            <>
              {userInfo.role === "teacher" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("/teacher/dashboard")}
                  className="text-xs sm:text-sm px-2 sm:px-3 h-8 sm:h-9"
                >
                  {t("pricing.header.backToDashboard")}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("/student/dashboard")}
                  className="text-xs sm:text-sm px-2 sm:px-3 h-8 sm:h-9"
                >
                  {t("pricing.header.backToStudentArea")}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                className="text-xs sm:text-sm px-2 sm:px-3 h-8 sm:h-9"
              >
                <LogOut className="w-4 h-4 mr-1" />
                {t("nav.logout")}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLoginModal(true)}
              className="text-xs sm:text-sm px-2 sm:px-3 h-8 sm:h-9"
            >
              {t("pricing.header.teacherLogin")}
            </Button>
          )}
          <LanguageSwitcher />
        </div>
      </header>

      {/* Hero Section - same style as Home page */}
      <section className="bg-gradient-to-b from-[#204dc0] to-[#101f6b] text-white py-8">
        <div className="container mx-auto px-4 sm:px-8 lg:px-16">
          <div className="max-w-3xl mx-auto">
            <div className="text-center py-2">
              <p className="text-yellow-400 mb-1 text-base lg:text-lg font-medium">
                {t("home.hero.tagline")}
              </p>
              <p className="text-yellow-400 text-base lg:text-lg font-medium mb-4">
                <span className="bg-white/20 text-white font-bold px-1.5 py-0.5 rounded">
                  {t("home.hero.preClass")}
                </span>
                {t("home.hero.preClassDesc")}
                <span className="bg-white/20 text-white font-bold px-1.5 py-0.5 rounded">
                  {t("home.hero.inClass")}
                </span>
                {t("home.hero.inClassDesc")}
                <span className="bg-white/20 text-white font-bold px-1.5 py-0.5 rounded">
                  {t("home.hero.postClass")}
                </span>
                {t("home.hero.postClassDesc")}
              </p>

              <h1 className="text-3xl lg:text-4xl min-[1440px]:text-5xl font-bold mb-3">
                {t("pricing.subtitle")}
              </h1>

              {/* Trial Points Highlight */}
              <div className="flex items-center justify-center gap-2 mb-5">
                <Sparkles className="w-5 h-5 text-yellow-400" />
                <p className="text-yellow-400 font-bold text-xl lg:text-2xl">
                  {t("pricing.trialBanner.title")}
                </p>
              </div>

              {/* CTA Buttons */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto">
                <Button
                  size="lg"
                  className="w-full bg-white text-gray-900 hover:bg-gray-100 border-2 border-white py-[22px] text-lg font-semibold shadow-xl"
                  onClick={() => setShowRegisterSheet(true)}
                >
                  {t("home.hero.freeTrialBtn")}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full border-2 border-white text-white hover:bg-white hover:text-blue-700 py-[22px] text-lg font-semibold transition-colors"
                  onClick={() => setActiveTab("subscription")}
                >
                  <CreditCard className="w-5 h-5 mr-2" />
                  {t("pricing.tabs.subscription")}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full border-2 border-white text-white hover:bg-white hover:text-blue-700 py-[22px] text-lg font-semibold transition-colors"
                  onClick={() => setActiveTab("pointPackages")}
                >
                  <Package className="w-5 h-5 mr-2" />
                  {t("pricing.tabs.pointPackages")}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full border-2 border-white text-white hover:bg-white hover:text-blue-700 py-[22px] text-lg font-semibold transition-colors"
                  onClick={() =>
                    faqRef.current?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  <HelpCircle className="w-5 h-5 mr-2" />
                  FAQ
                </Button>
              </div>

              {isStudent && (
                <div className="mt-4 bg-yellow-400/20 border border-yellow-400/40 rounded-lg px-4 py-3 max-w-md mx-auto">
                  <p className="text-sm text-yellow-100">
                    {t("pricing.actions.studentAccountWarning")}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 py-12">
        {/* Tabs: Monthly Subscription | Point Packages */}
        <div className="max-w-5xl mx-auto">
          {activeTab === "subscription" && (
            <div className="max-w-4xl mx-auto space-y-12">
              <div className="grid md:grid-cols-2 gap-8">
                {subscriptionPlans.map((plan) => (
                  <SubscriptionPlanCard
                    key={plan.id}
                    plan={plan}
                    onSelect={handleSelectPlan}
                    disabled={isStudent}
                    disabledText={
                      isStudent ? t("pricing.actions.logoutFirst") : undefined
                    }
                    ctaText={t("pricing.actions.subscribe")}
                  />
                ))}
              </div>

              {/* Phase 5-2 follow-up (#768 comment #3 part 2): group-buy
                  cards fetched from /api/credit-packages/group-buy-plans
                  (made public in the same PR) so admin /admin/plans edits
                  propagate to the marketing site without a code change.
                  Hardcoded seed values stay as a fallback for the (rare)
                  case the API request fails so anonymous visitors still
                  see something useful. */}
              <div className="space-y-4">
                <GroupBuyCards />
                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => navigate("/teacher/group-buy/open")}
                    disabled={isStudent}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    立即開設團購方案 →
                  </button>
                  <p className="text-xs text-gray-500 mt-2">
                    {isStudent
                      ? "請先登出學生帳號"
                      : "需教師帳號登入；尚未登入會引導至教師登入頁。"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "pointPackages" && (
            <>
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
                    disabled={isStudent}
                    ctaText={t("pricing.pointPackages.buy")}
                    baseUnitCost={BASE_UNIT_COST}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* FAQ Section */}
        <div ref={faqRef} className="max-w-2xl mx-auto mt-16">
          <PricingFAQ />
        </div>
      </div>

      {/* Footer - same as Home page */}
      <footer className="bg-gray-900 text-gray-300 py-12">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <div className="grid md:grid-cols-4 gap-8">
              <div>
                <h3 className="text-white text-lg font-bold mb-4">
                  {t("home.hero.brand")}
                </h3>
                <p className="text-sm mb-4">{t("home.footer.description")}</p>
                <div className="text-sm">
                  <p className="text-gray-400 mb-1">
                    {t("home.footer.contact")}
                  </p>
                  <a
                    href="mailto:contact@duotopia.co"
                    className="text-blue-400 hover:text-blue-300"
                  >
                    contact@duotopia.co
                  </a>
                </div>
              </div>
              <div>
                <h4 className="text-white font-semibold mb-4">
                  {t("home.footer.product")}
                </h4>
                <ul className="space-y-2 text-sm">
                  <li>
                    <a href="#features" className="hover:text-white">
                      {t("home.footer.features")}
                    </a>
                  </li>
                  <li>
                    <Link to="/pricing" className="hover:text-white">
                      {t("home.footer.pricing")}
                    </Link>
                  </li>
                  <li>
                    <a
                      href="https://forms.gle/azFtAQCW13afA8ab6"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-white"
                    >
                      {t("home.footer.eduPlan")}
                    </a>
                  </li>
                </ul>
              </div>
              <div>
                <h4 className="text-white font-semibold mb-4">
                  {t("home.footer.support")}
                </h4>
                <ul className="space-y-2 text-sm">
                  <li>
                    <a
                      href={LINE_FRIEND_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-white"
                    >
                      {t("home.footer.tutorial")}
                    </a>
                  </li>
                </ul>
              </div>
              <div>
                <h4 className="text-white font-semibold mb-4">
                  {t("home.footer.company")}
                </h4>
                <ul className="space-y-2 text-sm">
                  <li>
                    <a href="#" className="hover:text-white">
                      {t("home.footer.about")}
                    </a>
                  </li>
                  <li>
                    <Link to="/privacy" className="hover:text-white">
                      {t("home.footer.privacy")}
                    </Link>
                  </li>
                  <li>
                    <Link to="/terms" className="hover:text-white">
                      {t("home.footer.terms")}
                    </Link>
                  </li>
                </ul>
              </div>
            </div>
            <div className="mt-8 pt-8 border-t border-gray-800 text-center text-sm">
              <p>{t("home.footer.copyright")}</p>
            </div>
          </div>
        </div>
      </footer>

      {/* Payment Dialog */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("pricing.payment.title")}</DialogTitle>
            <DialogDescription className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-green-600" />
              {t("pricing.payment.securePayment")} -{" "}
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

      {/* LINE 客服浮動按鈕 */}
      <LineContactButton />

      {/* Meta Messenger 浮動按鈕 */}
      <a
        href="https://m.me/duotopia"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-6 right-6 z-40 w-14 h-14 bg-[#0084FF] hover:bg-[#0073E6] rounded-full flex items-center justify-center shadow-lg hover:shadow-xl transition-all hover:scale-110"
        aria-label="Meta Messenger 客服"
      >
        <svg viewBox="0 0 36 36" fill="white" className="w-7 h-7">
          <path d="M18 2.1C9.1 2.1 2 8.6 2 16.6c0 4.6 2.3 8.6 5.8 11.2V34l5.7-3.1c1.5.4 3 .6 4.5.6 8.9 0 16-6.5 16-14.5S26.9 2.1 18 2.1zm1.6 19.5l-4.1-4.3-7.9 4.3 8.7-9.2 4.2 4.3 7.8-4.3-8.7 9.2z" />
        </svg>
      </a>

      {/* Login Sheet - slides in from right, same as Home page */}
      <TeacherLoginSheet
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
      />

      {/* Register Sheet - slides in from right, same style */}
      <TeacherRegisterSheet
        isOpen={showRegisterSheet}
        onClose={() => setShowRegisterSheet(false)}
        onSwitchToLogin={() => {
          setShowRegisterSheet(false);
          setShowLoginModal(true);
        }}
      />
    </div>
  );
}
