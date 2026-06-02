/**
 * Group-buy open page (issue #768 Phase 5-2).
 *
 * Route: /teacher/group-buy/open
 * Auth: any authenticated teacher.
 *
 * Flow:
 *   1. List active group-buy plans (10/30/50 seats) from
 *      GET /api/credit-packages/group-buy-plans
 *   2. Teacher picks a plan — total = annual_fee × teacher_seats (server-
 *      authoritative; we only display it)
 *   3. Reuse <TapPayPayment> component with apiEndpoint pointing at
 *      /api/credit-packages/group-buy-open and customPayload supplying
 *      plan_name. The backend computes amount from the Plan row regardless
 *      of what we send.
 *   4. On success, navigate the teacher to /teacher/dashboard.
 */
import React from "react";
import { useNavigate } from "react-router-dom";
import { apiClient, ApiError } from "@/lib/api";
import TapPayPayment from "@/components/payment/TapPayPayment";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface GroupBuyPlan {
  name: string;
  teacher_seats: number;
  annual_fee: number;
  total_amount: number;
  topup_discount: number;
  monthly_quota: number;
  display_order: number;
}

export default function GroupBuyOpenPage() {
  const navigate = useNavigate();
  const [plans, setPlans] = React.useState<GroupBuyPlan[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = React.useState<GroupBuyPlan | null>(
    null,
  );

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiClient.listGroupBuyPlans();
        if (!cancelled) {
          setPlans(data);
        }
      } catch (e) {
        if (!cancelled) {
          const msg =
            e instanceof ApiError
              ? typeof e.detail === "string"
                ? e.detail
                : e.message
              : "載入團購方案失敗";
          setError(msg);
          toast.error(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePaymentSuccess = (transactionId: string) => {
    toast.success(`開團成功！交易編號 ${transactionId}`);
    // Frontend redirect — backend response carries org_id/school_id but
    // we route to the teacher dashboard for simplicity. Manage-team page
    // can be added later.
    navigate("/teacher/dashboard");
  };

  const handlePaymentError = (errMsg: string) => {
    toast.error(`開團失敗：${errMsg}`);
  };

  if (loading) {
    return <div className="p-6">載入中…</div>;
  }
  if (error) {
    return <div className="p-6 text-red-600">{error}</div>;
  }
  if (plans.length === 0) {
    return (
      <div className="p-6">目前沒有可用的團購方案。請聯絡 Duotopia 客服。</div>
    );
  }

  // Plan selection screen
  if (!selectedPlan) {
    return (
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold">開設教師團購方案</h1>
        <p className="text-sm text-gray-600">
          選擇方案後，刷卡完成即建立團隊。年費 = 每席年費 × 席次。月費贈點
          將於每月 1 號自動發放給團內所有教師。
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {plans.map((p) => (
            <Card key={p.name} className="flex flex-col">
              <CardHeader>
                <CardTitle className="text-xl">{p.name}</CardTitle>
                <CardDescription>{p.teacher_seats} 位教師席次</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 space-y-2 text-sm">
                <div>
                  每席年費：
                  <span className="font-semibold">
                    NT$ {p.annual_fee.toLocaleString()}
                  </span>
                </div>
                <div>
                  月配點：
                  <span className="font-semibold">
                    {p.monthly_quota.toLocaleString()} 點 / 教師
                  </span>
                </div>
                <div>
                  加購折扣：
                  <span className="font-semibold">
                    {Math.round((1 - p.topup_discount) * 100)}% off
                  </span>
                </div>
                <div className="pt-2 border-t border-gray-200">
                  總計：
                  <span className="text-lg font-bold text-blue-600">
                    NT$ {p.total_amount.toLocaleString()} / 年
                  </span>
                </div>
                <Button
                  className="w-full mt-3"
                  onClick={() => setSelectedPlan(p)}
                >
                  選擇此方案
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Payment screen
  return (
    <div className="p-6 space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">開團刷卡 — {selectedPlan.name}</h1>
        <Button variant="ghost" onClick={() => setSelectedPlan(null)}>
          ← 重新選擇方案
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>付款資訊</CardTitle>
          <CardDescription>
            {selectedPlan.teacher_seats} 席 × 每席 NT${" "}
            {selectedPlan.annual_fee.toLocaleString()} = 共 NT${" "}
            {selectedPlan.total_amount.toLocaleString()} / 年
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TapPayPayment
            amount={selectedPlan.total_amount}
            planName={selectedPlan.name}
            apiEndpoint="/api/credit-packages/group-buy-open"
            customPayload={{ plan_name: selectedPlan.name }}
            onPaymentSuccess={handlePaymentSuccess}
            onPaymentError={handlePaymentError}
            onCancel={() => setSelectedPlan(null)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
