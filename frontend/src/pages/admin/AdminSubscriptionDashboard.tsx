import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users,
  Search,
  TrendingUp,
  DollarSign,
  CheckCircle,
  XCircle,
  Edit,
  Loader2,
  ChevronRight,
  ChevronDown,
  Receipt,
  Gift,
  GraduationCap,
  Download,
  RefreshCcw,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import {
  exportToCSV,
  formatDate as csvFormatDate,
  formatAmount,
} from "@/lib/csvExport";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// Types
interface TeacherSubscriptionInfo {
  teacher_id: number;
  teacher_name: string;
  teacher_email: string;
  email_verified: boolean;
  current_subscription: {
    period_id: number;
    plan_name: string;
    quota_total: number;
    quota_used: number;
    end_date: string;
    status: string;
  } | null;
  credit_points_total: number;
  credit_points_used: number;
  credit_points_remaining: number;
  has_trial_bonus: boolean;
}

interface SubscriptionPeriod {
  id: number;
  plan_name: string;
  quota_total: number;
  quota_used: number;
  start_date: string;
  end_date: string;
  status: string;
  payment_method: string;
  payment_id?: string;
  payment_status: string;
  amount_paid?: number;
}

interface CreditPackageInfo {
  id: number;
  package_id: string;
  source: string; // "trial_bonus" | "admin_grant" | "purchase" | "org_purchase"
  points_total: number;
  points_used: number;
  points_remaining: number;
  price_paid: number;
  purchased_at: string;
  expires_at: string;
  status: string;
  payment_id?: string;
}

interface EditHistoryRecord {
  action: string;
  admin_email: string;
  admin_name: string;
  admin_id: number;
  timestamp: string;
  reason: string;
  changes: {
    // For create action: direct values
    plan_name?: string | { from: string; to: string };
    quota_total?: number | { from: number; to: number };
    end_date?: string | { from: string; to: string };
    status?: string | { from: string; to: string };
    payment_status?: { from: string; to: string };
  };
  // Refund-specific fields
  amount?: number;
  refund_id?: string;
  notes?: string;
}

interface AdminStats {
  total_teachers: number;
  active_subscriptions: number;
  monthly_revenue: number;
  quota_usage_percentage: number;
}

interface ApiError {
  response?: {
    status?: number;
    data?: {
      detail?: string;
    };
  };
  message?: string;
}

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    ("response" in error || "message" in error)
  );
}

// Transaction Analytics Types
interface Transaction {
  id: number;
  teacher_id: number;
  teacher_name: string;
  teacher_email: string;
  amount: number;
  plan_name: string;
  payment_method: string;
  status: string;
  created_at: string;
  rec_trade_id: string;
}

interface MonthlyTransactionStats {
  month: string;
  total: number;
  by_teacher: Record<string, number>;
}

interface TransactionAnalytics {
  transactions: Transaction[];
  total_count: number;
  total_revenue: number;
  monthly_stats: MonthlyTransactionStats[];
}

// Learning Analytics Types
interface TeacherStats {
  teacher_id: number;
  teacher_name: string;
  teacher_email: string;
  classrooms_count: number;
  students_count: number;
  assignments_count: number;
  total_points_used: number;
}

interface MonthlyPointsUsage {
  month: string;
  teacher_name: string;
  total_points: number;
  by_classroom: Record<string, number>;
}

interface LearningAnalytics {
  teacher_stats: TeacherStats[];
  monthly_points_usage: MonthlyPointsUsage[];
  total_teachers: number;
  total_points_used: number;
}

export default function AdminSubscriptionDashboard() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [teachers, setTeachers] = useState<TeacherSubscriptionInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [expandedTeacherId, setExpandedTeacherId] = useState<number | null>(
    null,
  );
  const [expandedPeriodId, setExpandedPeriodId] = useState<number | null>(null);
  const [teacherPeriods, setTeacherPeriods] = useState<
    Record<number, SubscriptionPeriod[]>
  >({});
  const [teacherCreditPackages, setTeacherCreditPackages] = useState<
    Record<number, CreditPackageInfo[]>
  >({});
  const [periodHistory, setPeriodHistory] = useState<
    Record<number, EditHistoryRecord[]>
  >({});

  // Analytics data
  const [transactionAnalytics, setTransactionAnalytics] =
    useState<TransactionAnalytics | null>(null);
  const [learningAnalytics, setLearningAnalytics] =
    useState<LearningAnalytics | null>(null);
  const [activeTab, setActiveTab] = useState("subscriptions");

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedTeacher, setSelectedTeacher] =
    useState<TeacherSubscriptionInfo | null>(null);
  const [editForm, setEditForm] = useState({
    action: "extend", // extend, cancel, edit
    plan_name: "",
    end_date: "",
    quota_total: undefined as number | undefined,
    reason: "",
  });

  // Refund modal state
  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [selectedPeriod, setSelectedPeriod] =
    useState<SubscriptionPeriod | null>(null);
  const [refundForm, setRefundForm] = useState({
    amount: undefined as number | undefined,
    reason: "",
    notes: "",
  });

  // Grant points modal state
  const [grantModalOpen, setGrantModalOpen] = useState(false);
  const [grantForm, setGrantForm] = useState({
    points: undefined as number | undefined,
    reason: "",
    expires_days: 365,
  });

  // Credit package instance edit/cancel modal state
  const [creditPackageEditOpen, setCreditPackageEditOpen] = useState(false);
  const [creditPackageCancelOpen, setCreditPackageCancelOpen] = useState(false);
  const [selectedCreditPackage, setSelectedCreditPackage] = useState<{
    teacherId: number;
    pkg: CreditPackageInfo;
  } | null>(null);
  const [creditPackageEditForm, setCreditPackageEditForm] = useState({
    points_total: "",
    expires_at: "", // YYYY-MM-DD
    reason: "",
  });
  const [creditPackageCancelReason, setCreditPackageCancelReason] =
    useState("");
  const [creditPackageSubmitting, setCreditPackageSubmitting] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, []);

  useEffect(() => {
    if (activeTab === "transactions") {
      loadTransactionAnalytics();
    } else if (activeTab === "learning") {
      loadLearningAnalytics();
    }
  }, [activeTab]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const [statsRes, teachersRes] = await Promise.all([
        apiClient.get("/api/admin/subscription/stats"),
        apiClient.get("/api/admin/subscription/all-teachers"),
      ]);

      setStats(statsRes as AdminStats);
      setTeachers(
        (teachersRes as { teachers: TeacherSubscriptionInfo[] }).teachers,
      );
    } catch (error: unknown) {
      console.error("Failed to load dashboard data:", error);
      if (isApiError(error) && error.response?.status === 403) {
        setErrorMessage(t("adminSubscription.errors.noPermission"));
        setTimeout(() => navigate("/teacher/dashboard"), 2000);
      } else if (isApiError(error)) {
        setErrorMessage(
          t("adminSubscription.errors.loadFailed", {
            detail:
              error.response?.data?.detail ||
              error.message ||
              t("adminSubscription.errors.unknown"),
          }),
        );
      } else {
        setErrorMessage(
          t("adminSubscription.errors.loadFailed", {
            detail: t("adminSubscription.errors.unknown"),
          }),
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const loadTransactionAnalytics = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get(
        "/api/admin/subscription/analytics/transactions",
      );
      setTransactionAnalytics(response as TransactionAnalytics);
    } catch (error: unknown) {
      console.error("Failed to load transaction analytics:", error);
      setErrorMessage(t("adminSubscription.errors.transactionAnalyticsFailed"));
    } finally {
      setLoading(false);
    }
  };

  const loadLearningAnalytics = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get(
        "/api/admin/subscription/analytics/learning",
      );
      setLearningAnalytics(response as LearningAnalytics);
    } catch (error: unknown) {
      console.error("Failed to load learning analytics:", error);
      setErrorMessage(t("adminSubscription.errors.learningAnalyticsFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleOpenEditModal = (teacher: TeacherSubscriptionInfo) => {
    setSelectedTeacher(teacher);
    const hasSubscription = !!teacher.current_subscription;
    setEditForm({
      action: hasSubscription ? "edit" : "create",
      plan_name: teacher.current_subscription?.plan_name || "",
      end_date: teacher.current_subscription?.end_date
        ? teacher.current_subscription.end_date.split("T")[0]
        : "",
      quota_total: undefined,
      reason: "",
    });
    setEditModalOpen(true);
  };

  const handleOpenGrantModal = (teacher: TeacherSubscriptionInfo) => {
    setSelectedTeacher(teacher);
    setGrantForm({
      points: undefined,
      reason: "",
      expires_days: 365,
    });
    setGrantModalOpen(true);
  };

  const handleSubmitGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeacher || !grantForm.points || !grantForm.reason) return;

    try {
      setLoading(true);
      await apiClient.post("/api/admin/credit-packages/grant", {
        teacher_email: selectedTeacher.teacher_email,
        points: grantForm.points,
        reason: grantForm.reason,
        expires_days: grantForm.expires_days,
      });

      setSuccessMessage(
        t("adminSubscription.messages.grantSuccess", {
          points: grantForm.points,
          name: selectedTeacher.teacher_name,
          defaultValue: `Successfully granted ${grantForm.points} points to ${selectedTeacher.teacher_name}`,
        }),
      );
      setGrantModalOpen(false);
      loadDashboardData();
    } catch (error: unknown) {
      if (isApiError(error)) {
        setErrorMessage(
          error.response?.data?.detail ||
            error.message ||
            t("adminSubscription.errors.grantFailed", "Failed to grant points"),
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const openEditCreditPackageDialog = (
    teacherId: number,
    pkg: CreditPackageInfo,
  ) => {
    setSelectedCreditPackage({ teacherId, pkg });
    setCreditPackageEditForm({
      points_total: pkg.points_total.toString(),
      expires_at: pkg.expires_at ? pkg.expires_at.split("T")[0] : "",
      reason: "",
    });
    setCreditPackageEditOpen(true);
  };

  const openCancelCreditPackageDialog = (
    teacherId: number,
    pkg: CreditPackageInfo,
  ) => {
    setSelectedCreditPackage({ teacherId, pkg });
    setCreditPackageCancelReason("");
    setCreditPackageCancelOpen(true);
  };

  const handleSubmitEditCreditPackage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCreditPackage) return;
    const { teacherId, pkg } = selectedCreditPackage;
    const reason = creditPackageEditForm.reason.trim();
    if (!reason) return;

    const newTotal = Number(creditPackageEditForm.points_total);
    if (!Number.isInteger(newTotal) || newTotal < 0) {
      setErrorMessage("總點數必須是 0 或正整數");
      return;
    }
    if (newTotal < pkg.points_used) {
      setErrorMessage(
        `總點數 (${newTotal}) 不可小於已使用點數 (${pkg.points_used})`,
      );
      return;
    }

    const payload: {
      points_total?: number;
      expires_at?: string;
      reason: string;
    } = { reason };
    if (newTotal !== pkg.points_total) payload.points_total = newTotal;
    if (
      creditPackageEditForm.expires_at &&
      (!pkg.expires_at ||
        creditPackageEditForm.expires_at !== pkg.expires_at.split("T")[0])
    ) {
      payload.expires_at = creditPackageEditForm.expires_at;
    }

    if (
      payload.points_total === undefined &&
      payload.expires_at === undefined
    ) {
      setErrorMessage("沒有變更欄位");
      return;
    }

    try {
      setCreditPackageSubmitting(true);
      const updated = await apiClient.adminEditCreditPackage(pkg.id, payload);
      setTeacherCreditPackages((prev) => ({
        ...prev,
        [teacherId]: (prev[teacherId] || []).map((p) =>
          p.id === pkg.id
            ? {
                ...p,
                points_total: updated.points_total,
                points_remaining: updated.points_remaining,
                expires_at: updated.expires_at,
                status: updated.status,
              }
            : p,
        ),
      }));
      setSuccessMessage(`已更新點數包 ${pkg.package_id}`);
      setCreditPackageEditOpen(false);
    } catch (error) {
      const err = error as { response?: { data?: { detail?: string } } };
      setErrorMessage(err.response?.data?.detail || "更新點數包失敗");
    } finally {
      setCreditPackageSubmitting(false);
    }
  };

  const handleSubmitCancelCreditPackage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCreditPackage) return;
    const reason = creditPackageCancelReason.trim();
    if (!reason) return;
    const { teacherId, pkg } = selectedCreditPackage;

    try {
      setCreditPackageSubmitting(true);
      await apiClient.adminCancelCreditPackage(pkg.id, { reason });
      // Soft-deleted: remove from local list (backend now filters status='refunded')
      setTeacherCreditPackages((prev) => ({
        ...prev,
        [teacherId]: (prev[teacherId] || []).filter((p) => p.id !== pkg.id),
      }));
      setSuccessMessage(`已刪除點數包 ${pkg.package_id}`);
      setCreditPackageCancelOpen(false);
    } catch (error) {
      const err = error as { response?: { data?: { detail?: string } } };
      setErrorMessage(err.response?.data?.detail || "刪除點數包失敗");
    } finally {
      setCreditPackageSubmitting(false);
    }
  };

  const handleOpenRefundModal = (period: SubscriptionPeriod) => {
    setSelectedPeriod(period);
    setRefundForm({
      amount: undefined, // undefined = 全額退款
      reason: "",
      notes: "",
    });
    setRefundModalOpen(true);
  };

  const handleSubmitRefund = async (e: React.FormEvent) => {
    e.preventDefault();

    // 詳細驗證
    if (!selectedPeriod) {
      setErrorMessage("未選擇訂閱期間");
      return;
    }

    if (!selectedPeriod.payment_id) {
      setErrorMessage(
        "此訂閱沒有 TapPay 交易記錄（payment_id 為空），無法退款",
      );
      console.error("Period data:", selectedPeriod);
      return;
    }

    if (!refundForm.reason) {
      setErrorMessage("請填寫退款原因");
      return;
    }

    try {
      setLoading(true);
      await apiClient.post("/api/admin/refund", {
        rec_trade_id: selectedPeriod.payment_id,
        amount: refundForm.amount,
        reason: refundForm.reason,
        notes: refundForm.notes,
      });

      setSuccessMessage(
        `退款成功：${selectedPeriod.plan_name} - ${refundForm.amount ? `NT$ ${refundForm.amount}` : "全額退款"}`,
      );

      // Clear cached periods and history to force refresh
      setTeacherPeriods({});
      setPeriodHistory({});
      setExpandedTeacherId(null);
      setExpandedPeriodId(null);

      await loadDashboardData();
      setRefundModalOpen(false);
      setRefundForm({ amount: undefined, reason: "", notes: "" });
    } catch (error: unknown) {
      console.error("Refund failed:", error);
      setErrorMessage(
        isApiError(error)
          ? error.response?.data?.detail ||
              error.message ||
              "退款失敗，請稍後再試"
          : "退款失敗，請稍後再試",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeacher || !editForm.reason) {
      setErrorMessage(t("adminSubscription.errors.fillRequired"));
      return;
    }

    // Validation for create action
    if (editForm.action === "create" && !editForm.plan_name) {
      setErrorMessage(t("adminSubscription.errors.selectPlan"));
      return;
    }

    try {
      setLoading(true);
      let response: unknown;

      if (editForm.action === "cancel") {
        response = await apiClient.post("/api/admin/subscription/cancel", {
          teacher_email: selectedTeacher.teacher_email,
          reason: editForm.reason,
        });
      } else if (editForm.action === "create") {
        response = await apiClient.post("/api/admin/subscription/create", {
          teacher_email: selectedTeacher.teacher_email,
          plan_name: editForm.plan_name,
          end_date: editForm.end_date,
          quota_total: editForm.quota_total,
          reason: editForm.reason,
        });
      } else {
        response = await apiClient.post("/api/admin/subscription/edit", {
          teacher_email: selectedTeacher.teacher_email,
          plan_name: editForm.plan_name,
          end_date: editForm.end_date,
          quota_total: editForm.quota_total,
          reason: editForm.reason,
        });
      }

      setSuccessMessage(
        t("adminSubscription.messages.operationSuccess", {
          teacherName: selectedTeacher.teacher_name,
          message:
            (response as { message?: string })?.message ||
            t("adminSubscription.messages.completed"),
        }),
      );

      // Clear cached periods and history to force refresh
      setTeacherPeriods({});
      setPeriodHistory({});
      setExpandedTeacherId(null);
      setExpandedPeriodId(null);

      await loadDashboardData();
      setEditModalOpen(false);
      setEditForm({
        action: "edit",
        plan_name: "",
        end_date: "",
        quota_total: undefined,
        reason: "",
      });
    } catch (error: unknown) {
      console.error("Failed to process subscription:", error);
      setErrorMessage(
        t("adminSubscription.errors.operationFailed", {
          detail: isApiError(error)
            ? error.message || t("adminSubscription.errors.unknown")
            : t("adminSubscription.errors.unknown"),
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      // If search is empty, reload all teachers
      await loadDashboardData();
      return;
    }

    try {
      setLoading(true);
      const response = await apiClient.get(
        "/api/admin/subscription/all-teachers",
      );
      const allTeachers = (response as { teachers: TeacherSubscriptionInfo[] })
        .teachers;

      // Filter teachers by email or name
      const filtered = allTeachers.filter(
        (teacher) =>
          teacher.teacher_email
            .toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          teacher.teacher_name
            .toLowerCase()
            .includes(searchQuery.toLowerCase()),
      );

      setTeachers(filtered);
    } catch (error: unknown) {
      console.error("Search failed:", error);
      if (isApiError(error)) {
        setErrorMessage(
          t("adminSubscription.errors.searchFailed", {
            detail:
              error.response?.data?.detail ||
              error.message ||
              t("adminSubscription.errors.unknown"),
          }),
        );
      } else {
        setErrorMessage(
          t("adminSubscription.errors.searchFailed", {
            detail: t("adminSubscription.errors.unknown"),
          }),
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleTeacherExpand = async (teacherId: number) => {
    if (expandedTeacherId === teacherId) {
      setExpandedTeacherId(null);
      setExpandedPeriodId(null);
    } else {
      setExpandedTeacherId(teacherId);
      setExpandedPeriodId(null);

      // Fetch periods + credit_packages if not already loaded
      if (!teacherPeriods[teacherId]) {
        try {
          const response = await apiClient.get(
            `/api/admin/subscription/teacher/${teacherId}/periods`,
          );
          const data = response as {
            periods: SubscriptionPeriod[];
            credit_packages?: CreditPackageInfo[];
          };

          setTeacherPeriods((prev) => ({
            ...prev,
            [teacherId]: data.periods,
          }));
          setTeacherCreditPackages((prev) => ({
            ...prev,
            [teacherId]: data.credit_packages || [],
          }));
        } catch (error) {
          console.error("Failed to load periods:", error);
          setErrorMessage(t("adminSubscription.errors.loadPeriodsFailed"));
        }
      }
    }
  };

  const togglePeriodExpand = async (periodId: number | undefined) => {
    if (!periodId) {
      console.error("Period ID is undefined");
      return;
    }

    if (expandedPeriodId === periodId) {
      setExpandedPeriodId(null);
    } else {
      setExpandedPeriodId(periodId);

      // Fetch history if not already loaded
      if (!periodHistory[periodId]) {
        try {
          const response = await apiClient.get(
            `/api/admin/subscription/period/${periodId}/history`,
          );
          const history = (response as { edit_history: EditHistoryRecord[] })
            .edit_history;
          // Reverse to show newest first
          setPeriodHistory((prev) => ({
            ...prev,
            [periodId]: [...history].reverse(),
          }));
        } catch (error) {
          console.error("Failed to load period history:", error);
          setErrorMessage(t("adminSubscription.errors.loadHistoryFailed"));
        }
      }
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    return date.toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "Asia/Taipei",
    });
  };

  // CSV Download Handlers
  const handleDownloadSubscriptions = () => {
    exportToCSV(
      teachers,
      [
        { header: "Email", accessor: "teacher_email" },
        { header: "Name", accessor: "teacher_name" },
        {
          header: "Plan",
          accessor: (row) =>
            row.current_subscription?.plan_name || "No Subscription",
        },
        {
          header: "End Date",
          accessor: (row) =>
            row.current_subscription
              ? csvFormatDate(row.current_subscription.end_date)
              : "-",
        },
        {
          header: "Quota Used",
          accessor: (row) => row.current_subscription?.quota_used || 0,
        },
        {
          header: "Quota Total",
          accessor: (row) => row.current_subscription?.quota_total || 0,
        },
        {
          header: "Status",
          accessor: (row) => row.current_subscription?.status || "None",
        },
      ],
      `subscriptions_${new Date().toISOString().split("T")[0]}`,
    );
  };

  const handleDownloadTransactions = () => {
    if (!transactionAnalytics) return;
    exportToCSV(
      transactionAnalytics.transactions,
      [
        {
          header: "Date",
          accessor: (row) => csvFormatDate(row.created_at),
        },
        { header: "Teacher Name", accessor: "teacher_name" },
        { header: "Teacher Email", accessor: "teacher_email" },
        { header: "Plan", accessor: "plan_name" },
        {
          header: "Amount",
          accessor: (row) => formatAmount(row.amount),
        },
        { header: "Payment Method", accessor: "payment_method" },
        { header: "Trade ID", accessor: "rec_trade_id" },
        { header: "Status", accessor: "status" },
      ],
      `transactions_${new Date().toISOString().split("T")[0]}`,
    );
  };

  const handleDownloadLearning = () => {
    if (!learningAnalytics) return;
    exportToCSV(
      learningAnalytics.teacher_stats,
      [
        { header: "Teacher Name", accessor: "teacher_name" },
        { header: "Teacher Email", accessor: "teacher_email" },
        { header: "Classrooms", accessor: "classrooms_count" },
        { header: "Students", accessor: "students_count" },
        { header: "Assignments", accessor: "assignments_count" },
        { header: "Total Points Used", accessor: "total_points_used" },
      ],
      `learning_analytics_${new Date().toISOString().split("T")[0]}`,
    );
  };

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p>{t("adminSubscription.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          {t("adminSubscription.title")}
        </h2>
        <p className="text-muted-foreground">
          {t("adminSubscription.description")}
        </p>
      </div>

      {successMessage && (
        <Alert className="mb-4 bg-green-50 border-green-200">
          <CheckCircle className="w-4 h-4 text-green-600" />
          <AlertDescription className="text-green-800">
            {successMessage}
          </AlertDescription>
        </Alert>
      )}

      {errorMessage && (
        <Alert className="mb-4 bg-red-50 border-red-200">
          <XCircle className="w-4 h-4 text-red-600" />
          <AlertDescription className="text-red-800">
            {errorMessage}
          </AlertDescription>
        </Alert>
      )}

      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-8">
          <Card>
            <CardHeader className="pb-2 md:pb-3">
              <CardTitle className="text-xs md:text-sm font-medium text-gray-600">
                {t("adminSubscription.stats.totalTeachers")}
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-3 md:pb-4">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 md:w-5 md:h-5 text-blue-500" />
                <span className="text-xl md:text-2xl font-bold">
                  {stats.total_teachers}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 md:pb-3">
              <CardTitle className="text-xs md:text-sm font-medium text-gray-600">
                {t("adminSubscription.stats.activeSubs")}
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-3 md:pb-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 md:w-5 md:h-5 text-green-500" />
                <span className="text-xl md:text-2xl font-bold">
                  {stats.active_subscriptions}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 md:pb-3">
              <CardTitle className="text-xs md:text-sm font-medium text-gray-600">
                {t("adminSubscription.stats.monthlyRevenue")}
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-3 md:pb-4">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 md:w-5 md:h-5 text-yellow-500" />
                <span className="text-xl md:text-2xl font-bold">
                  ${stats.monthly_revenue.toLocaleString()}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 md:pb-3">
              <CardTitle className="text-xs md:text-sm font-medium text-gray-600">
                {t("adminSubscription.stats.quotaUsage")}
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-3 md:pb-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-purple-500" />
                <span className="text-xl md:text-2xl font-bold">
                  {stats.quota_usage_percentage.toFixed(1)}%
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex w-full justify-start gap-1 mb-4 md:mb-6 h-auto bg-transparent border-b border-gray-200 rounded-none p-0">
          <TabsTrigger
            value="subscriptions"
            className="flex items-center gap-2 px-4 py-3 text-sm md:text-base font-medium text-gray-500 bg-transparent border-b-2 border-transparent rounded-none data-[state=active]:bg-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 data-[state=active]:font-semibold data-[state=active]:shadow-none hover:text-gray-700 transition-colors"
          >
            <Users className="w-4 h-4 md:w-5 md:h-5 flex-shrink-0" />
            <span className="hidden sm:inline">
              {t("adminSubscription.tabs.subscriptions")}
            </span>
            <span className="sm:hidden">訂閱</span>
          </TabsTrigger>
          <TabsTrigger
            value="transactions"
            className="flex items-center gap-2 px-4 py-3 text-sm md:text-base font-medium text-gray-500 bg-transparent border-b-2 border-transparent rounded-none data-[state=active]:bg-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 data-[state=active]:font-semibold data-[state=active]:shadow-none hover:text-gray-700 transition-colors"
          >
            <Receipt className="w-4 h-4 md:w-5 md:h-5 flex-shrink-0" />
            <span className="hidden sm:inline">
              {t("adminSubscription.tabs.transactions")}
            </span>
            <span className="sm:hidden">交易</span>
          </TabsTrigger>
          <TabsTrigger
            value="learning"
            className="flex items-center gap-2 px-4 py-3 text-sm md:text-base font-medium text-gray-500 bg-transparent border-b-2 border-transparent rounded-none data-[state=active]:bg-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 data-[state=active]:font-semibold data-[state=active]:shadow-none hover:text-gray-700 transition-colors"
          >
            <GraduationCap className="w-4 h-4 md:w-5 md:h-5 flex-shrink-0" />
            <span className="hidden sm:inline">
              {t("adminSubscription.tabs.learning")}
            </span>
            <span className="sm:hidden">學習</span>
          </TabsTrigger>
        </TabsList>

        {/* Subscriptions Tab */}
        <TabsContent value="subscriptions">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    {t("adminSubscription.subscriptionsTab.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("adminSubscription.subscriptionsTab.description")}
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadSubscriptions}
                  disabled={teachers.length === 0}
                >
                  <Download className="w-4 h-4 mr-2" />
                  {t("adminSubscription.buttons.downloadCsv")}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-4">
                <div className="flex-1">
                  <Input
                    placeholder={t(
                      "adminSubscription.subscriptionsTab.searchPlaceholder",
                    )}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && handleSearch()}
                  />
                </div>
                <Button onClick={handleSearch} disabled={loading}>
                  <Search className="w-4 h-4 mr-2" />
                  {t("adminSubscription.buttons.search")}
                </Button>
              </div>

              <div className="border rounded-lg overflow-x-auto">
                <Table className="min-w-[800px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs md:text-sm w-[260px]">
                        {t("adminSubscription.table.email")}
                      </TableHead>
                      <TableHead className="text-xs md:text-sm">
                        {t("adminSubscription.table.name")}
                      </TableHead>
                      <TableHead className="text-xs md:text-sm">
                        {t("adminSubscription.table.plan")}
                      </TableHead>
                      <TableHead className="text-xs md:text-sm">
                        {t("adminSubscription.table.endDate")}
                      </TableHead>
                      <TableHead className="text-xs md:text-sm">
                        {t("adminSubscription.table.periods")}
                      </TableHead>
                      <TableHead className="text-xs md:text-sm">
                        {t("adminSubscription.table.quota")}
                      </TableHead>
                      <TableHead className="text-xs md:text-sm w-24">
                        {t("adminSubscription.table.status")}
                      </TableHead>
                      <TableHead className="text-xs md:text-sm">
                        {t("adminSubscription.table.actions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teachers.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="text-center text-gray-500"
                        >
                          {t("adminSubscription.table.noData")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      teachers.map((teacher) => (
                        <React.Fragment key={teacher.teacher_email}>
                          <TableRow
                            className="cursor-pointer hover:bg-gray-50"
                            onClick={() =>
                              toggleTeacherExpand(teacher.teacher_id)
                            }
                          >
                            <TableCell className="font-mono text-sm w-[260px] max-w-[260px]">
                              <div className="flex items-center gap-2">
                                {expandedTeacherId === teacher.teacher_id ? (
                                  <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                )}
                                <span
                                  className="truncate"
                                  title={teacher.teacher_email}
                                >
                                  {teacher.teacher_email}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>{teacher.teacher_name}</TableCell>
                            <TableCell>
                              {teacher.current_subscription?.plan_name || "-"}
                            </TableCell>
                            <TableCell>
                              {teacher.current_subscription
                                ? formatDate(
                                    teacher.current_subscription.end_date,
                                  )
                                : "-"}
                            </TableCell>
                            <TableCell>
                              <span className="text-sm text-gray-600">
                                {teacherPeriods[teacher.teacher_id]?.length ||
                                  "-"}
                              </span>
                            </TableCell>
                            <TableCell>
                              {teacher.current_subscription ? (
                                <div className="space-y-1">
                                  <div className="text-sm">
                                    {teacher.current_subscription.quota_used.toLocaleString()}{" "}
                                    /{" "}
                                    {teacher.current_subscription.quota_total.toLocaleString()}
                                  </div>
                                  <div className="w-full bg-gray-200 rounded-full h-2">
                                    <div
                                      className="bg-blue-500 h-2 rounded-full"
                                      style={{
                                        width: `${Math.min((teacher.current_subscription.quota_used / teacher.current_subscription.quota_total) * 100 || 0, 100)}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              ) : teacher.credit_points_total > 0 ? (
                                <div className="space-y-1">
                                  <div className="text-sm text-purple-700">
                                    {teacher.credit_points_used.toLocaleString()}{" "}
                                    /{" "}
                                    {teacher.credit_points_total.toLocaleString()}
                                  </div>
                                  <div className="w-full bg-gray-200 rounded-full h-2">
                                    <div
                                      className="bg-purple-500 h-2 rounded-full"
                                      style={{
                                        width: `${Math.min((teacher.credit_points_used / teacher.credit_points_total) * 100 || 0, 100)}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              ) : (
                                "-"
                              )}
                            </TableCell>
                            <TableCell>
                              {teacher.current_subscription?.status ===
                              "active" ? (
                                <span className="inline-block whitespace-nowrap px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                                  {t("adminSubscription.status.active")}
                                </span>
                              ) : teacher.has_trial_bonus ? (
                                <span className="inline-block whitespace-nowrap px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs">
                                  {t(
                                    "adminSubscription.status.trial",
                                    "Free Trial",
                                  )}
                                </span>
                              ) : !teacher.email_verified ? (
                                <span className="inline-block whitespace-nowrap px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs">
                                  {t(
                                    "adminSubscription.status.unverified",
                                    "Unverified",
                                  )}
                                </span>
                              ) : (
                                <span className="inline-block whitespace-nowrap px-2 py-1 bg-gray-100 text-gray-800 rounded text-xs">
                                  {t("adminSubscription.status.none")}
                                </span>
                              )}
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleOpenEditModal(teacher)}
                                  className="h-8"
                                >
                                  <Edit className="w-3 h-3 mr-1" />
                                  {t("adminSubscription.buttons.edit")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleOpenGrantModal(teacher)}
                                  className="h-8 text-purple-600 border-purple-300 hover:bg-purple-50"
                                >
                                  <Gift className="w-3 h-3 mr-1" />
                                  {t(
                                    "adminSubscription.buttons.grantPoints",
                                    "Grant",
                                  )}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>

                          {/* Layer 2: Subscription Periods */}
                          {expandedTeacherId === teacher.teacher_id &&
                            teacherPeriods[teacher.teacher_id] && (
                              <TableRow
                                key={`${teacher.teacher_email}-periods`}
                              >
                                <TableCell
                                  colSpan={8}
                                  className="bg-gray-50 p-0"
                                >
                                  <div className="p-4">
                                    <div className="mb-3 text-sm text-gray-600 font-mono break-all">
                                      Email:{" "}
                                      <span className="text-gray-900">
                                        {teacher.teacher_email}
                                      </span>
                                    </div>
                                    <h4 className="font-semibold mb-3 text-sm">
                                      {t("adminSubscription.periodTable.title")}
                                    </h4>
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead className="w-12"></TableHead>
                                          <TableHead>
                                            {t(
                                              "adminSubscription.periodTable.plan",
                                            )}
                                          </TableHead>
                                          <TableHead>
                                            {t(
                                              "adminSubscription.periodTable.startDate",
                                            )}
                                          </TableHead>
                                          <TableHead>
                                            {t(
                                              "adminSubscription.periodTable.endDate",
                                            )}
                                          </TableHead>
                                          <TableHead>
                                            {t(
                                              "adminSubscription.periodTable.quota",
                                            )}
                                          </TableHead>
                                          <TableHead>
                                            {t(
                                              "adminSubscription.periodTable.payment",
                                            )}
                                          </TableHead>
                                          <TableHead>
                                            {t(
                                              "adminSubscription.periodTable.status",
                                            )}
                                          </TableHead>
                                          <TableHead>Actions</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {teacherPeriods[teacher.teacher_id].map(
                                          (period) => (
                                            <React.Fragment key={period.id}>
                                              <TableRow
                                                key={period.id}
                                                className="cursor-pointer hover:bg-gray-100"
                                                onClick={() =>
                                                  togglePeriodExpand(period.id)
                                                }
                                              >
                                                <TableCell>
                                                  {expandedPeriodId ===
                                                  period.id ? (
                                                    <ChevronDown className="w-4 h-4 text-gray-500" />
                                                  ) : (
                                                    <ChevronRight className="w-4 h-4 text-gray-500" />
                                                  )}
                                                </TableCell>
                                                <TableCell>
                                                  {period.plan_name}
                                                </TableCell>
                                                <TableCell>
                                                  {formatDate(
                                                    period.start_date,
                                                  )}
                                                </TableCell>
                                                <TableCell>
                                                  {formatDate(period.end_date)}
                                                </TableCell>
                                                <TableCell>
                                                  {period.quota_used.toLocaleString()}{" "}
                                                  /{" "}
                                                  {period.quota_total.toLocaleString()}
                                                </TableCell>
                                                <TableCell>
                                                  <div className="text-sm">
                                                    <div>
                                                      {period.payment_method}
                                                    </div>
                                                    <div className="text-xs text-gray-500">
                                                      $
                                                      {period.amount_paid?.toLocaleString() ||
                                                        "0"}
                                                    </div>
                                                  </div>
                                                </TableCell>
                                                <TableCell>
                                                  <span
                                                    className={`px-2 py-1 rounded text-xs ${
                                                      period.status === "active"
                                                        ? "bg-green-100 text-green-800"
                                                        : "bg-gray-100 text-gray-800"
                                                    }`}
                                                  >
                                                    {period.status}
                                                  </span>
                                                </TableCell>
                                                <TableCell
                                                  onClick={(e) =>
                                                    e.stopPropagation()
                                                  }
                                                >
                                                  {period.payment_id &&
                                                    period.payment_status ===
                                                      "paid" &&
                                                    period.status ===
                                                      "active" && (
                                                      <Button
                                                        size="sm"
                                                        variant="destructive"
                                                        onClick={() =>
                                                          handleOpenRefundModal(
                                                            period,
                                                          )
                                                        }
                                                        className="h-8"
                                                      >
                                                        <RefreshCcw className="w-3 h-3 mr-1" />
                                                        Refund
                                                      </Button>
                                                    )}
                                                </TableCell>
                                              </TableRow>

                                              {/* Layer 3: Edit History */}
                                              {expandedPeriodId === period.id &&
                                                periodHistory[period.id] && (
                                                  <TableRow
                                                    key={`${period.id}-history`}
                                                  >
                                                    <TableCell
                                                      colSpan={7}
                                                      className="bg-blue-50 p-0"
                                                    >
                                                      <div className="p-4">
                                                        <h5 className="font-semibold mb-3 text-sm">
                                                          {t(
                                                            "adminSubscription.history.title",
                                                          )}
                                                        </h5>
                                                        {periodHistory[
                                                          period.id
                                                        ].length === 0 ? (
                                                          <p className="text-sm text-gray-500">
                                                            {t(
                                                              "adminSubscription.history.noHistory",
                                                            )}
                                                          </p>
                                                        ) : (
                                                          <div className="space-y-2">
                                                            {periodHistory[
                                                              period.id
                                                            ].map(
                                                              (record, idx) => (
                                                                <div
                                                                  key={idx}
                                                                  className="bg-white p-3 rounded border text-sm"
                                                                >
                                                                  <div className="flex justify-between mb-2">
                                                                    <span
                                                                      className={`font-semibold capitalize ${
                                                                        record.action ===
                                                                        "create"
                                                                          ? "text-green-700"
                                                                          : record.action ===
                                                                              "cancel"
                                                                            ? "text-red-700"
                                                                            : "text-blue-700"
                                                                      }`}
                                                                    >
                                                                      {
                                                                        record.action
                                                                      }
                                                                    </span>
                                                                    <span className="text-xs text-gray-500">
                                                                      {new Date(
                                                                        record.timestamp,
                                                                      ).toLocaleString(
                                                                        "zh-TW",
                                                                      )}
                                                                    </span>
                                                                  </div>
                                                                  <div className="text-xs text-gray-600 mb-2">
                                                                    {t(
                                                                      "adminSubscription.history.admin",
                                                                    )}
                                                                    :{" "}
                                                                    {
                                                                      record.admin_name
                                                                    }{" "}
                                                                    (
                                                                    {
                                                                      record.admin_email
                                                                    }
                                                                    )
                                                                  </div>
                                                                  {Object.keys(
                                                                    record.changes,
                                                                  ).length >
                                                                    0 && (
                                                                    <div className="text-xs bg-gray-50 p-2 rounded mb-2 space-y-1">
                                                                      <div className="font-semibold">
                                                                        {record.action ===
                                                                        "create"
                                                                          ? t(
                                                                              "adminSubscription.history.initialValues",
                                                                            )
                                                                          : t(
                                                                              "adminSubscription.history.changes",
                                                                            )}
                                                                      </div>
                                                                      {record.action ===
                                                                      "create" ? (
                                                                        <>
                                                                          {typeof record
                                                                            .changes
                                                                            .plan_name ===
                                                                            "string" && (
                                                                            <div>
                                                                              Plan:{" "}
                                                                              {
                                                                                record
                                                                                  .changes
                                                                                  .plan_name
                                                                              }
                                                                            </div>
                                                                          )}
                                                                          {typeof record
                                                                            .changes
                                                                            .quota_total ===
                                                                            "number" && (
                                                                            <div>
                                                                              Quota:{" "}
                                                                              {record.changes.quota_total.toLocaleString()}
                                                                            </div>
                                                                          )}
                                                                          {typeof record
                                                                            .changes
                                                                            .end_date ===
                                                                            "string" && (
                                                                            <div>
                                                                              End
                                                                              Date:{" "}
                                                                              {formatDate(
                                                                                record
                                                                                  .changes
                                                                                  .end_date,
                                                                              )}
                                                                            </div>
                                                                          )}
                                                                          {typeof record
                                                                            .changes
                                                                            .status ===
                                                                            "string" && (
                                                                            <div>
                                                                              Status:{" "}
                                                                              {
                                                                                record
                                                                                  .changes
                                                                                  .status
                                                                              }
                                                                            </div>
                                                                          )}
                                                                        </>
                                                                      ) : (
                                                                        <>
                                                                          {record
                                                                            .changes
                                                                            .plan_name &&
                                                                            typeof record
                                                                              .changes
                                                                              .plan_name ===
                                                                              "object" && (
                                                                              <div>
                                                                                Plan:{" "}
                                                                                {
                                                                                  record
                                                                                    .changes
                                                                                    .plan_name
                                                                                    .from
                                                                                }{" "}
                                                                                →{" "}
                                                                                {
                                                                                  record
                                                                                    .changes
                                                                                    .plan_name
                                                                                    .to
                                                                                }
                                                                              </div>
                                                                            )}
                                                                          {record
                                                                            .changes
                                                                            .quota_total &&
                                                                            typeof record
                                                                              .changes
                                                                              .quota_total ===
                                                                              "object" && (
                                                                              <div>
                                                                                Quota:{" "}
                                                                                {record.changes.quota_total.from.toLocaleString()}{" "}
                                                                                →{" "}
                                                                                {record.changes.quota_total.to.toLocaleString()}
                                                                              </div>
                                                                            )}
                                                                          {record
                                                                            .changes
                                                                            .end_date &&
                                                                            typeof record
                                                                              .changes
                                                                              .end_date ===
                                                                              "object" && (
                                                                              <div>
                                                                                End
                                                                                Date:{" "}
                                                                                {formatDate(
                                                                                  record
                                                                                    .changes
                                                                                    .end_date
                                                                                    .from,
                                                                                )}{" "}
                                                                                →{" "}
                                                                                {formatDate(
                                                                                  record
                                                                                    .changes
                                                                                    .end_date
                                                                                    .to,
                                                                                )}
                                                                              </div>
                                                                            )}
                                                                          {record
                                                                            .changes
                                                                            .status &&
                                                                            typeof record
                                                                              .changes
                                                                              .status ===
                                                                              "object" && (
                                                                              <div>
                                                                                Status:{" "}
                                                                                {
                                                                                  record
                                                                                    .changes
                                                                                    .status
                                                                                    .from
                                                                                }{" "}
                                                                                →{" "}
                                                                                {
                                                                                  record
                                                                                    .changes
                                                                                    .status
                                                                                    .to
                                                                                }
                                                                              </div>
                                                                            )}
                                                                          {record
                                                                            .changes
                                                                            .payment_status &&
                                                                            typeof record
                                                                              .changes
                                                                              .payment_status ===
                                                                              "object" && (
                                                                              <div>
                                                                                Payment
                                                                                Status:{" "}
                                                                                {
                                                                                  record
                                                                                    .changes
                                                                                    .payment_status
                                                                                    .from
                                                                                }{" "}
                                                                                →{" "}
                                                                                {
                                                                                  record
                                                                                    .changes
                                                                                    .payment_status
                                                                                    .to
                                                                                }
                                                                              </div>
                                                                            )}
                                                                        </>
                                                                      )}
                                                                    </div>
                                                                  )}

                                                                  {/* 🆕 退款詳細資訊 */}
                                                                  {record.action ===
                                                                    "refund" && (
                                                                    <div className="text-xs bg-red-50 p-2 rounded mb-2 space-y-1 border border-red-200">
                                                                      <div className="font-semibold text-red-700 mb-1">
                                                                        💰
                                                                        退款詳情
                                                                      </div>
                                                                      {typeof record.amount ===
                                                                        "number" && (
                                                                        <div>
                                                                          <span className="font-semibold">
                                                                            退款金額:
                                                                          </span>{" "}
                                                                          <span className="text-red-600 font-bold">
                                                                            $
                                                                            {record.amount.toLocaleString()}
                                                                          </span>
                                                                        </div>
                                                                      )}
                                                                      {record.refund_id && (
                                                                        <div>
                                                                          <span className="font-semibold">
                                                                            TapPay
                                                                            退款編號:
                                                                          </span>{" "}
                                                                          <code className="text-xs bg-white px-1 py-0.5 rounded">
                                                                            {record.refund_id ||
                                                                              "N/A"}
                                                                          </code>
                                                                        </div>
                                                                      )}
                                                                      {record.notes && (
                                                                        <div>
                                                                          <span className="font-semibold">
                                                                            備註:
                                                                          </span>{" "}
                                                                          {
                                                                            record.notes
                                                                          }
                                                                        </div>
                                                                      )}
                                                                    </div>
                                                                  )}

                                                                  <div className="text-xs text-gray-700 bg-yellow-50 p-2 rounded">
                                                                    <span className="font-semibold">
                                                                      {t(
                                                                        "adminSubscription.history.reason",
                                                                      )}
                                                                      :
                                                                    </span>{" "}
                                                                    {
                                                                      record.reason
                                                                    }
                                                                  </div>
                                                                </div>
                                                              ),
                                                            )}
                                                          </div>
                                                        )}
                                                      </div>
                                                    </TableCell>
                                                  </TableRow>
                                                )}
                                            </React.Fragment>
                                          ),
                                        )}
                                      </TableBody>
                                    </Table>
                                  </div>

                                  {/* Layer 2b: Credit Packages (trial / admin_grant / purchase) */}
                                  {teacherCreditPackages[teacher.teacher_id] &&
                                    teacherCreditPackages[teacher.teacher_id]
                                      .length > 0 && (
                                      <div className="p-4 pt-0">
                                        <h4 className="font-semibold mb-3 text-sm">
                                          {t(
                                            "adminSubscription.creditPackageTable.title",
                                            "點數包紀錄",
                                          )}
                                        </h4>
                                        <Table>
                                          <TableHeader>
                                            <TableRow>
                                              <TableHead>
                                                {t(
                                                  "adminSubscription.creditPackageTable.source",
                                                  "來源",
                                                )}
                                              </TableHead>
                                              <TableHead>
                                                {t(
                                                  "adminSubscription.creditPackageTable.package",
                                                  "套餐",
                                                )}
                                              </TableHead>
                                              <TableHead>
                                                {t(
                                                  "adminSubscription.creditPackageTable.dates",
                                                  "購買 / 到期",
                                                )}
                                              </TableHead>
                                              <TableHead>
                                                {t(
                                                  "adminSubscription.creditPackageTable.points",
                                                  "已使用 / 總計",
                                                )}
                                              </TableHead>
                                              <TableHead>
                                                {t(
                                                  "adminSubscription.creditPackageTable.payment",
                                                  "付款",
                                                )}
                                              </TableHead>
                                              <TableHead>
                                                {t(
                                                  "adminSubscription.creditPackageTable.status",
                                                  "狀態",
                                                )}
                                              </TableHead>
                                              <TableHead className="text-right">
                                                {t(
                                                  "adminSubscription.creditPackageTable.actions",
                                                  "操作",
                                                )}
                                              </TableHead>
                                            </TableRow>
                                          </TableHeader>
                                          <TableBody>
                                            {teacherCreditPackages[
                                              teacher.teacher_id
                                            ].map((pkg) => {
                                              const sourceBadge = {
                                                trial_bonus: {
                                                  label: t(
                                                    "adminSubscription.creditPackageTable.sourceTrial",
                                                    "試用",
                                                  ),
                                                  className:
                                                    "bg-purple-100 text-purple-700",
                                                },
                                                admin_grant: {
                                                  label: t(
                                                    "adminSubscription.creditPackageTable.sourceGrant",
                                                    "贈送",
                                                  ),
                                                  className:
                                                    "bg-orange-100 text-orange-700",
                                                },
                                                purchase: {
                                                  label: t(
                                                    "adminSubscription.creditPackageTable.sourcePurchase",
                                                    "加購",
                                                  ),
                                                  className:
                                                    "bg-green-100 text-green-700",
                                                },
                                                org_purchase: {
                                                  label: t(
                                                    "adminSubscription.creditPackageTable.sourceOrgPurchase",
                                                    "機構購買",
                                                  ),
                                                  className:
                                                    "bg-green-100 text-green-700",
                                                },
                                              }[pkg.source] || {
                                                label: pkg.source,
                                                className:
                                                  "bg-gray-100 text-gray-700",
                                              };

                                              return (
                                                <TableRow key={`pkg-${pkg.id}`}>
                                                  <TableCell>
                                                    <span
                                                      className={`px-2 py-1 rounded text-xs font-semibold ${sourceBadge.className}`}
                                                    >
                                                      {sourceBadge.label}
                                                    </span>
                                                  </TableCell>
                                                  <TableCell className="font-mono text-xs text-gray-600">
                                                    {pkg.package_id}
                                                  </TableCell>
                                                  <TableCell className="text-sm text-gray-600">
                                                    {formatDate(
                                                      pkg.purchased_at,
                                                    )}{" "}
                                                    →{" "}
                                                    {formatDate(pkg.expires_at)}
                                                  </TableCell>
                                                  <TableCell>
                                                    <div className="space-y-1">
                                                      <div className="text-sm">
                                                        {pkg.points_used.toLocaleString()}{" "}
                                                        /{" "}
                                                        {pkg.points_total.toLocaleString()}
                                                      </div>
                                                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                                                        <div
                                                          className="bg-purple-500 h-1.5 rounded-full"
                                                          style={{
                                                            width: `${Math.min((pkg.points_used / pkg.points_total) * 100 || 0, 100)}%`,
                                                          }}
                                                        />
                                                      </div>
                                                    </div>
                                                  </TableCell>
                                                  <TableCell className="text-sm">
                                                    {pkg.price_paid > 0
                                                      ? `NT$ ${pkg.price_paid.toLocaleString()}`
                                                      : "-"}
                                                  </TableCell>
                                                  <TableCell>
                                                    <span
                                                      className={`px-2 py-1 rounded text-xs font-semibold ${
                                                        pkg.status === "active"
                                                          ? "bg-green-100 text-green-700"
                                                          : "bg-gray-100 text-gray-600"
                                                      }`}
                                                    >
                                                      {pkg.status}
                                                    </span>
                                                  </TableCell>
                                                  <TableCell
                                                    onClick={(e) =>
                                                      e.stopPropagation()
                                                    }
                                                  >
                                                    <div className="flex justify-end gap-1">
                                                      <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-7 px-2 text-xs"
                                                        onClick={() =>
                                                          openEditCreditPackageDialog(
                                                            teacher.teacher_id,
                                                            pkg,
                                                          )
                                                        }
                                                      >
                                                        <Edit className="w-3 h-3 mr-1" />
                                                        編輯
                                                      </Button>
                                                      <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-7 px-2 text-xs text-red-600 border-red-300 hover:bg-red-50"
                                                        onClick={() =>
                                                          openCancelCreditPackageDialog(
                                                            teacher.teacher_id,
                                                            pkg,
                                                          )
                                                        }
                                                      >
                                                        刪除
                                                      </Button>
                                                    </div>
                                                  </TableCell>
                                                </TableRow>
                                              );
                                            })}
                                          </TableBody>
                                        </Table>
                                      </div>
                                    )}
                                </TableCell>
                              </TableRow>
                            )}
                        </React.Fragment>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Transactions Tab */}
        <TabsContent value="transactions">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Receipt className="w-5 h-5" />
                    {t("adminSubscription.transactionsTab.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("adminSubscription.transactionsTab.description")}
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadTransactions}
                  disabled={
                    !transactionAnalytics ||
                    transactionAnalytics.transactions.length === 0
                  }
                >
                  <Download className="w-4 h-4 mr-2" />
                  {t("adminSubscription.buttons.downloadCsv")}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loading && !transactionAnalytics ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin" />
                </div>
              ) : transactionAnalytics ? (
                <div className="space-y-6">
                  {/* Summary Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                    <Card>
                      <CardContent className="pt-4 md:pt-6">
                        <div className="text-xl md:text-2xl font-bold">
                          ${transactionAnalytics.total_revenue.toLocaleString()}
                        </div>
                        <p className="text-xs text-gray-600 mt-1">
                          {t("adminSubscription.transactionsTab.totalRevenue")}
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4 md:pt-6">
                        <div className="text-xl md:text-2xl font-bold">
                          {transactionAnalytics.total_count}
                        </div>
                        <p className="text-xs text-gray-600 mt-1">
                          {t(
                            "adminSubscription.transactionsTab.totalTransactions",
                          )}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Monthly Revenue Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        {t(
                          "adminSubscription.transactionsTab.monthlyRevenueTrend",
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="w-full overflow-x-auto">
                        <div className="min-w-[300px]">
                          <ResponsiveContainer
                            width="100%"
                            height={250}
                            className="md:!h-[300px]"
                          >
                            <LineChart
                              data={transactionAnalytics.monthly_stats}
                            >
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} />
                              <Tooltip />
                              <Legend wrapperStyle={{ fontSize: "12px" }} />
                              <Line
                                type="monotone"
                                dataKey="total"
                                stroke="#8884d8"
                                name="Total Revenue"
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Transaction Table */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        {t("adminSubscription.transactionsTab.allTransactions")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="border rounded-lg overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>
                                {t("adminSubscription.transactionsTab.date")}
                              </TableHead>
                              <TableHead>
                                {t("adminSubscription.transactionsTab.teacher")}
                              </TableHead>
                              <TableHead>
                                {t("adminSubscription.transactionsTab.email")}
                              </TableHead>
                              <TableHead>
                                {t("adminSubscription.transactionsTab.plan")}
                              </TableHead>
                              <TableHead>
                                {t("adminSubscription.transactionsTab.amount")}
                              </TableHead>
                              <TableHead>
                                {t("adminSubscription.transactionsTab.method")}
                              </TableHead>
                              <TableHead>
                                {t("adminSubscription.transactionsTab.tradeId")}
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {transactionAnalytics.transactions.map((txn) => (
                              <TableRow key={txn.id}>
                                <TableCell>
                                  {new Date(txn.created_at).toLocaleDateString(
                                    "zh-TW",
                                  )}
                                </TableCell>
                                <TableCell>{txn.teacher_name}</TableCell>
                                <TableCell className="text-sm">
                                  {txn.teacher_email}
                                </TableCell>
                                <TableCell>{txn.plan_name}</TableCell>
                                <TableCell className="font-semibold">
                                  ${txn.amount.toLocaleString()}
                                </TableCell>
                                <TableCell>{txn.payment_method}</TableCell>
                                <TableCell className="text-xs text-gray-500">
                                  {txn.rec_trade_id}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  {t("adminSubscription.transactionsTab.noData")}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Learning Tab */}
        <TabsContent value="learning">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <GraduationCap className="w-5 h-5" />
                    {t("adminSubscription.learningTab.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("adminSubscription.learningTab.description")}
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadLearning}
                  disabled={
                    !learningAnalytics ||
                    learningAnalytics.teacher_stats.length === 0
                  }
                >
                  <Download className="w-4 h-4 mr-2" />
                  {t("adminSubscription.buttons.downloadCsv")}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loading && !learningAnalytics ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin" />
                </div>
              ) : learningAnalytics ? (
                <div className="space-y-6">
                  {/* Summary Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                    <Card>
                      <CardContent className="pt-4 md:pt-6">
                        <div className="text-xl md:text-2xl font-bold">
                          {learningAnalytics.total_points_used.toLocaleString()}
                        </div>
                        <p className="text-xs text-gray-600 mt-1">
                          {t("adminSubscription.learningTab.totalPointsUsed")}
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4 md:pt-6">
                        <div className="text-xl md:text-2xl font-bold">
                          {learningAnalytics.total_teachers}
                        </div>
                        <p className="text-xs text-gray-600 mt-1">
                          {t("adminSubscription.learningTab.activeTeachers")}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Monthly Points Usage Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        {t("adminSubscription.learningTab.monthlyPointsUsage")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="w-full overflow-x-auto">
                        <div className="min-w-[300px]">
                          <ResponsiveContainer
                            width="100%"
                            height={250}
                            className="md:!h-[300px]"
                          >
                            <BarChart
                              data={learningAnalytics.monthly_points_usage.reduce(
                                (acc, item) => {
                                  const existing = acc.find(
                                    (x) => x.month === item.month,
                                  );
                                  if (existing) {
                                    existing[item.teacher_name] =
                                      item.total_points;
                                  } else {
                                    acc.push({
                                      month: item.month,
                                      [item.teacher_name]: item.total_points,
                                    });
                                  }
                                  return acc;
                                },
                                [] as Record<string, string | number>[],
                              )}
                            >
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} />
                              <Tooltip />
                              <Legend wrapperStyle={{ fontSize: "12px" }} />
                              {/* Generate bars for each teacher dynamically */}
                              {Array.from(
                                new Set(
                                  learningAnalytics.monthly_points_usage.map(
                                    (x) => x.teacher_name,
                                  ),
                                ),
                              ).map((teacher, idx) => (
                                <Bar
                                  key={teacher}
                                  dataKey={teacher}
                                  fill={
                                    [
                                      "#8884d8",
                                      "#82ca9d",
                                      "#ffc658",
                                      "#ff8042",
                                      "#a4de6c",
                                    ][idx % 5]
                                  }
                                />
                              ))}
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Teacher Stats Table */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        {t("adminSubscription.learningTab.teacherStatistics")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="border rounded-lg overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>
                                {t("adminSubscription.learningTab.teacher")}
                              </TableHead>
                              <TableHead>
                                {t("adminSubscription.learningTab.email")}
                              </TableHead>
                              <TableHead>
                                {t("adminSubscription.learningTab.classes")}
                              </TableHead>
                              <TableHead>
                                {t("adminSubscription.learningTab.students")}
                              </TableHead>
                              <TableHead>
                                {t("adminSubscription.learningTab.assignments")}
                              </TableHead>
                              <TableHead>
                                {t("adminSubscription.learningTab.pointsUsed")}
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {learningAnalytics.teacher_stats.map((teacher) => (
                              <TableRow key={teacher.teacher_id}>
                                <TableCell>{teacher.teacher_name}</TableCell>
                                <TableCell className="text-sm">
                                  {teacher.teacher_email}
                                </TableCell>
                                <TableCell>
                                  {teacher.classrooms_count}
                                </TableCell>
                                <TableCell>{teacher.students_count}</TableCell>
                                <TableCell>
                                  {teacher.assignments_count}
                                </TableCell>
                                <TableCell className="font-semibold">
                                  {teacher.total_points_used.toLocaleString()}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  {t("adminSubscription.learningTab.noData")}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Subscription Modal */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editForm.action === "create"
                ? t("adminSubscription.modal.createTitle")
                : editForm.action === "cancel"
                  ? t("adminSubscription.modal.cancelTitle")
                  : t("adminSubscription.modal.editTitle")}
            </DialogTitle>
            <DialogDescription>
              {selectedTeacher &&
                `${selectedTeacher.teacher_name} (${selectedTeacher.teacher_email})`}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitEdit} className="space-y-4 mt-4">
            {/* Action Selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("adminSubscription.modal.action")}
              </label>
              <Select
                value={editForm.action}
                onValueChange={(value) =>
                  setEditForm({ ...editForm, action: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!selectedTeacher?.current_subscription && (
                    <SelectItem value="create">
                      {t("adminSubscription.modal.createSubscription")}
                    </SelectItem>
                  )}
                  {selectedTeacher?.current_subscription && (
                    <>
                      <SelectItem value="edit">
                        {t("adminSubscription.modal.editSubscription")}
                      </SelectItem>
                      <SelectItem value="cancel">
                        {t("adminSubscription.modal.cancelSubscription")}
                      </SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Plan Name (for create and edit) */}
            {(editForm.action === "create" || editForm.action === "edit") && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {t("adminSubscription.modal.planName")}{" "}
                  {editForm.action === "create" && (
                    <span className="text-red-500">*</span>
                  )}
                  {editForm.action === "edit" &&
                    selectedTeacher?.current_subscription?.plan_name && (
                      <span className="text-xs text-gray-500 ml-2">
                        ({t("adminSubscription.modal.current")}:{" "}
                        {selectedTeacher.current_subscription.plan_name})
                      </span>
                    )}
                </label>
                <Select
                  value={
                    editForm.plan_name ||
                    (editForm.action === "create" ? "" : "NO_CHANGE")
                  }
                  onValueChange={(value) =>
                    setEditForm({
                      ...editForm,
                      plan_name: value === "NO_CHANGE" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        editForm.action === "create"
                          ? t("adminSubscription.modal.selectPlan")
                          : t("adminSubscription.modal.noChange")
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {editForm.action === "edit" && (
                      <SelectItem value="NO_CHANGE">
                        {t("adminSubscription.modal.noChange")}
                      </SelectItem>
                    )}
                    <SelectItem value="Free Trial">Free Trial</SelectItem>
                    <SelectItem value="Tutor Teachers">
                      Tutor Teachers
                    </SelectItem>
                    <SelectItem value="School Teachers">
                      School Teachers
                    </SelectItem>
                    <SelectItem value="Demo Unlimited Plan">
                      Demo Unlimited Plan
                    </SelectItem>
                    <SelectItem value="VIP">VIP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* End Date (for create and edit) */}
            {(editForm.action === "create" || editForm.action === "edit") && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {t("adminSubscription.modal.endDate")}{" "}
                  {editForm.action === "create" ? (
                    <span className="text-xs text-gray-500">
                      {t("adminSubscription.modal.endDateOptionalCreate")}
                    </span>
                  ) : (
                    t("adminSubscription.modal.optional")
                  )}
                </label>
                <Input
                  type="date"
                  value={editForm.end_date}
                  onChange={(e) =>
                    setEditForm({ ...editForm, end_date: e.target.value })
                  }
                  placeholder="YYYY-MM-DD"
                />
                <p className="text-xs text-gray-500">
                  {editForm.action === "create"
                    ? t("adminSubscription.modal.endDateHintCreate")
                    : t("adminSubscription.modal.endDateHintEdit")}
                </p>
              </div>
            )}

            {/* Custom Quota (for VIP plan in create and edit) */}
            {(editForm.action === "create" || editForm.action === "edit") &&
              editForm.plan_name === "VIP" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {t("adminSubscription.modal.customQuota")}
                  </label>
                  <Input
                    type="number"
                    value={editForm.quota_total || ""}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        quota_total: e.target.value
                          ? parseInt(e.target.value)
                          : undefined,
                      })
                    }
                    placeholder={t("adminSubscription.modal.quotaPlaceholder")}
                    min="1"
                  />
                  <p className="text-xs text-gray-500">
                    {t("adminSubscription.modal.quotaHint")}
                  </p>
                </div>
              )}

            {/* Reason (always required) */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("adminSubscription.modal.reason")} *
              </label>
              <Textarea
                value={editForm.reason}
                onChange={(e) =>
                  setEditForm({ ...editForm, reason: e.target.value })
                }
                placeholder={t("adminSubscription.modal.reasonPlaceholder")}
                required
                rows={3}
              />
            </div>

            {/* Buttons */}
            <div className="flex gap-2 justify-end pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditModalOpen(false)}
                disabled={loading}
              >
                {t("adminSubscription.buttons.cancel")}
              </Button>
              <Button type="submit" disabled={loading || !editForm.reason}>
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t("adminSubscription.buttons.processing")}
                  </>
                ) : editForm.action === "cancel" ? (
                  t("adminSubscription.buttons.cancelSubscription")
                ) : (
                  t("adminSubscription.buttons.updateSubscription")
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Refund Modal */}
      <Dialog open={refundModalOpen} onOpenChange={setRefundModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Refund Subscription</DialogTitle>
            <DialogDescription>
              {selectedPeriod &&
                `${selectedPeriod.plan_name} - NT$ ${selectedPeriod.amount_paid?.toLocaleString() || "0"}`}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitRefund} className="space-y-4 mt-4">
            {/* Amount (optional - full refund if not specified) */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Refund Amount (optional)
              </label>
              <Input
                type="number"
                value={refundForm.amount || ""}
                onChange={(e) =>
                  setRefundForm({
                    ...refundForm,
                    amount: e.target.value
                      ? parseInt(e.target.value)
                      : undefined,
                  })
                }
                placeholder={`Full refund: NT$ ${selectedPeriod?.amount_paid?.toLocaleString() || "0"}`}
                min="1"
                max={selectedPeriod?.amount_paid || undefined}
              />
              <p className="text-xs text-gray-500">
                Leave empty for full refund, or enter partial amount
              </p>
            </div>

            {/* Reason (required) */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Refund Reason <span className="text-red-500">*</span>
              </label>
              <Textarea
                value={refundForm.reason}
                onChange={(e) =>
                  setRefundForm({ ...refundForm, reason: e.target.value })
                }
                placeholder="Why is this refund being issued?"
                required
                rows={3}
              />
            </div>

            {/* Notes (optional) */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Notes (optional)</label>
              <Textarea
                value={refundForm.notes}
                onChange={(e) =>
                  setRefundForm({ ...refundForm, notes: e.target.value })
                }
                placeholder="Additional notes or context"
                rows={2}
              />
            </div>

            {/* Warning */}
            <Alert className="bg-yellow-50 border-yellow-200">
              <AlertDescription className="text-yellow-800 text-sm">
                ⚠️ This action will process a refund via TapPay and cannot be
                undone. The subscription period will be cancelled.
              </AlertDescription>
            </Alert>

            {/* Buttons */}
            <div className="flex gap-2 justify-end pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRefundModalOpen(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={loading || !refundForm.reason}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing Refund...
                  </>
                ) : (
                  <>
                    <RefreshCcw className="w-4 h-4 mr-2" />
                    Confirm Refund
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Grant Points Modal */}
      <Dialog open={grantModalOpen} onOpenChange={setGrantModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {t("adminSubscription.grant.title", "Grant Points")}
            </DialogTitle>
            <DialogDescription>
              {selectedTeacher &&
                `${selectedTeacher.teacher_name} (${selectedTeacher.teacher_email})`}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitGrant} className="space-y-4 mt-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("adminSubscription.grant.points", "Points")}{" "}
                <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                value={grantForm.points || ""}
                onChange={(e) =>
                  setGrantForm({
                    ...grantForm,
                    points: e.target.value
                      ? parseInt(e.target.value)
                      : undefined,
                  })
                }
                placeholder={t(
                  "adminSubscription.grant.pointsPlaceholder",
                  "e.g. 2000",
                )}
                min="1"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t(
                  "adminSubscription.grant.expiresDays",
                  "Valid for (days)",
                )}{" "}
              </label>
              <Input
                type="number"
                value={grantForm.expires_days}
                onChange={(e) =>
                  setGrantForm({
                    ...grantForm,
                    expires_days: parseInt(e.target.value) || 365,
                  })
                }
                min="1"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("adminSubscription.grant.reason", "Reason")}{" "}
                <span className="text-red-500">*</span>
              </label>
              <Textarea
                value={grantForm.reason}
                onChange={(e) =>
                  setGrantForm({ ...grantForm, reason: e.target.value })
                }
                placeholder={t(
                  "adminSubscription.grant.reasonPlaceholder",
                  "Why are these points being granted?",
                )}
                required
                rows={3}
              />
            </div>

            <div className="flex gap-2 justify-end pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setGrantModalOpen(false)}
                disabled={loading}
              >
                {t("common.cancel", "Cancel")}
              </Button>
              <Button
                type="submit"
                className="bg-purple-600 hover:bg-purple-700 text-white"
                disabled={loading || !grantForm.points || !grantForm.reason}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t("adminSubscription.grant.granting", "Granting...")}
                  </>
                ) : (
                  <>
                    <Gift className="w-4 h-4 mr-2" />
                    {t("adminSubscription.grant.confirm", "Confirm Grant")}
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Credit Package — Edit */}
      <Dialog
        open={creditPackageEditOpen}
        onOpenChange={setCreditPackageEditOpen}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>編輯點數包</DialogTitle>
            <DialogDescription>
              {selectedCreditPackage &&
                `${selectedCreditPackage.pkg.package_id} · 已使用 ${selectedCreditPackage.pkg.points_used.toLocaleString()} 點`}
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={handleSubmitEditCreditPackage}
            className="space-y-4 mt-4"
          >
            <div className="space-y-2">
              <label className="text-sm font-medium">
                總點數 <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                value={creditPackageEditForm.points_total}
                onChange={(e) =>
                  setCreditPackageEditForm({
                    ...creditPackageEditForm,
                    points_total: e.target.value,
                  })
                }
                min={selectedCreditPackage?.pkg.points_used ?? 0}
                required
              />
              <p className="text-xs text-gray-500">
                最低為已使用點數 (
                {selectedCreditPackage?.pkg.points_used.toLocaleString() ?? 0})
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">到期日</label>
              <Input
                type="date"
                value={creditPackageEditForm.expires_at}
                onChange={(e) =>
                  setCreditPackageEditForm({
                    ...creditPackageEditForm,
                    expires_at: e.target.value,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                變更原因 <span className="text-red-500">*</span>
              </label>
              <Textarea
                value={creditPackageEditForm.reason}
                onChange={(e) =>
                  setCreditPackageEditForm({
                    ...creditPackageEditForm,
                    reason: e.target.value,
                  })
                }
                placeholder="請說明此次編輯的原因"
                required
                rows={3}
              />
            </div>

            <div className="flex gap-2 justify-end pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreditPackageEditOpen(false)}
                disabled={creditPackageSubmitting}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={
                  creditPackageSubmitting ||
                  !creditPackageEditForm.reason.trim() ||
                  !creditPackageEditForm.points_total
                }
              >
                {creditPackageSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    儲存中
                  </>
                ) : (
                  "儲存"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Credit Package — Cancel (soft delete) */}
      <Dialog
        open={creditPackageCancelOpen}
        onOpenChange={setCreditPackageCancelOpen}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>刪除點數包</DialogTitle>
            <DialogDescription>
              {selectedCreditPackage &&
                `${selectedCreditPackage.pkg.package_id} · 總點數 ${selectedCreditPackage.pkg.points_total.toLocaleString()} / 已使用 ${selectedCreditPackage.pkg.points_used.toLocaleString()}`}
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={handleSubmitCancelCreditPackage}
            className="space-y-4 mt-4"
          >
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">
              點數包將標記為 refunded
              並從清單中隱藏。已使用的點數紀錄會保留作為稽核，請填寫刪除原因。
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                刪除原因 <span className="text-red-500">*</span>
              </label>
              <Textarea
                value={creditPackageCancelReason}
                onChange={(e) => setCreditPackageCancelReason(e.target.value)}
                placeholder="請說明此次刪除的原因（例如：使用者要求退費）"
                required
                rows={3}
              />
            </div>

            <div className="flex gap-2 justify-end pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreditPackageCancelOpen(false)}
                disabled={creditPackageSubmitting}
              >
                取消
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={
                  creditPackageSubmitting || !creditPackageCancelReason.trim()
                }
              >
                {creditPackageSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    處理中
                  </>
                ) : (
                  "確認刪除"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
