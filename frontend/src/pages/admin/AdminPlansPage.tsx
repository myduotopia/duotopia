import { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Crown, Pencil, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface Plan {
  id: number;
  name: string;
  price: number | null;
  quota: number | null;
  display_order: number;
  is_active: boolean;
  updated_at: string | null;
  updated_by_admin_id: number | null;
  // issue #768: group-buy economic levers. teacher_seats not-null marks
  // a group-buy plan; for those `price` is unused (group buys the team
  // upfront via annual_fee × teacher_seats) and `quota` is per-teacher.
  teacher_seats: number | null;
  annual_fee: number | null; // PER teacher
  topup_discount: number | null;
}

// Helper: a plan is group-buy iff teacher_seats is set. Detection by
// column (not name pattern) matches backend `_guard_group_buy`.
const isGroupBuyPlan = (p: Plan) => p.teacher_seats != null;

interface FormState {
  price: string;
  quota: string;
  is_active: boolean;
  // group-buy only — empty string when not editing a group-buy plan
  annual_fee: string;
  topup_discount: string;
}

const initialFormState: FormState = {
  price: "",
  quota: "",
  is_active: true,
  annual_fee: "",
  topup_discount: "",
};

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<FormState>(initialFormState);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.listAdminPlans();
      setPlans(data);
    } catch (err) {
      console.error("Failed to fetch plans:", err);
      setError(err instanceof Error ? err.message : "Failed to load plans");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const openEditDialog = (plan: Plan) => {
    setSelectedPlan(plan);
    setFormData({
      price: plan.price?.toString() ?? "",
      quota: plan.quota?.toString() ?? "",
      is_active: plan.is_active,
      annual_fee: plan.annual_fee?.toString() ?? "",
      topup_discount: plan.topup_discount?.toString() ?? "",
    });
    setFormErrors({});
    setIsEditDialogOpen(true);
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (formData.price !== "") {
      const n = Number(formData.price);
      if (Number.isNaN(n) || n < 0 || !Number.isInteger(n)) {
        errors.price = "價格必須是 0 或正整數";
      }
    }
    if (formData.quota !== "") {
      const n = Number(formData.quota);
      if (Number.isNaN(n) || n < 0 || !Number.isInteger(n)) {
        errors.quota = "配額必須是 0 或正整數";
      }
    }
    // Group-buy fields
    if (formData.annual_fee !== "") {
      const n = Number(formData.annual_fee);
      if (Number.isNaN(n) || n <= 0 || !Number.isInteger(n)) {
        errors.annual_fee = "每席年費必須是正整數";
      }
    }
    if (formData.topup_discount !== "") {
      const n = Number(formData.topup_discount);
      if (Number.isNaN(n) || n <= 0 || n > 1) {
        errors.topup_discount = "加購折扣必須在 0~1 之間（例：0.90 = 9 折）";
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!selectedPlan || !validateForm()) return;

    const isGroupBuy = isGroupBuyPlan(selectedPlan);
    setIsSaving(true);
    try {
      const payload: {
        price?: number;
        quota?: number;
        is_active?: boolean;
        annual_fee?: number;
        topup_discount?: number;
      } = {};
      if (formData.price !== "") payload.price = Number(formData.price);
      if (formData.quota !== "") payload.quota = Number(formData.quota);
      if (formData.is_active !== selectedPlan.is_active) {
        payload.is_active = formData.is_active;
      }
      // Only send group-buy levers when editing a group-buy plan; backend
      // would otherwise reject with 400.
      if (isGroupBuy) {
        if (formData.annual_fee !== "") {
          payload.annual_fee = Number(formData.annual_fee);
        }
        if (formData.topup_discount !== "") {
          payload.topup_discount = Number(formData.topup_discount);
        }
      }

      if (Object.keys(payload).length === 0) {
        toast.info("沒有變更，已關閉編輯");
        setIsEditDialogOpen(false);
        return;
      }

      await apiClient.updateAdminPlan(selectedPlan.name, payload);
      toast.success(`已更新「${selectedPlan.name}」`);
      setIsEditDialogOpen(false);
      await fetchPlans();
    } catch (err) {
      console.error("Failed to update plan:", err);
      toast.error(err instanceof Error ? err.message : "更新失敗");
    } finally {
      setIsSaving(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Crown className="h-5 w-5 text-amber-600" />
          方案管理
        </CardTitle>
        <p className="text-sm text-gray-500 mt-1">
          可調整既有方案的價格與配額；方案名稱由程式碼定義，無法新增或刪除。
        </p>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="py-8 text-center text-gray-500">載入中...</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>方案名稱</TableHead>
                <TableHead>價格（TWD/月）</TableHead>
                <TableHead>每月配額（點數）</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead>最後更新</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell className="font-medium">{plan.name}</TableCell>
                  <TableCell>{plan.price ?? "-"}</TableCell>
                  <TableCell>{plan.quota ?? "-"}</TableCell>
                  <TableCell>
                    {plan.is_active ? (
                      <Badge variant="default">啟用中</Badge>
                    ) : (
                      <Badge variant="secondary">已停用</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-gray-500">
                    {formatDate(plan.updated_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEditDialog(plan)}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1.5" />
                      編輯
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>編輯方案：{selectedPlan?.name}</DialogTitle>
            <DialogDescription>
              {selectedPlan && isGroupBuyPlan(selectedPlan)
                ? `團購方案（${selectedPlan.teacher_seats} 席）。團隊年費 = 每席年費 × 席次；月配點為「每位教師」的數量。空白表示不變更該欄位。`
                : "個人訂閱方案。價格為月費、配額為每月點數。空白表示不變更該欄位。"}
            </DialogDescription>
          </DialogHeader>

          {/* Scrollable middle so DialogHeader + DialogFooter stay pinned
              when the dialog hits viewport height on small screens. */}
          <div className="flex-1 overflow-y-auto min-h-0 space-y-3">
            {/* Group-buy context banner — read-only summary */}
            {selectedPlan && isGroupBuyPlan(selectedPlan) && (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs space-y-1">
                <div className="font-semibold text-blue-900">團購方案計算</div>
                <div className="text-blue-800">
                  席次：
                  <span className="font-semibold">
                    {selectedPlan.teacher_seats}
                  </span>{" "}
                  位教師
                </div>
                <div className="text-blue-800">
                  每席年費（編輯下方）× 席次 ={" "}
                  <span className="font-semibold">
                    NT$
                    {(
                      Number(
                        // `||` on string "0" falls through (0 is falsy);
                        // use empty-string check so the typed value wins.
                        formData.annual_fee !== ""
                          ? formData.annual_fee
                          : (selectedPlan.annual_fee ?? 0),
                      ) * (selectedPlan.teacher_seats ?? 0)
                    ).toLocaleString()}
                  </span>{" "}
                  / 年（團隊總價）
                </div>
                <div className="text-blue-800">
                  月配點 = 下方「每月配額」×
                  席次（系統每月為每位教師個別建立週期）
                </div>
              </div>
            )}

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="plan-price">
                  {selectedPlan && isGroupBuyPlan(selectedPlan)
                    ? "訂閱月費（不適用 — 團購方案以每席年費計價）"
                    : "訂閱月費（NT$/教師/月）"}
                </Label>
                <Input
                  id="plan-price"
                  type="number"
                  min={0}
                  value={formData.price}
                  disabled={selectedPlan ? isGroupBuyPlan(selectedPlan) : false}
                  onChange={(e) =>
                    setFormData({ ...formData, price: e.target.value })
                  }
                  placeholder={
                    selectedPlan && isGroupBuyPlan(selectedPlan)
                      ? "不適用 — 團購用每席年費計價"
                      : "例：299"
                  }
                />
                {formErrors.price && (
                  <p className="text-xs text-red-600">{formErrors.price}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="plan-quota">
                  {selectedPlan && isGroupBuyPlan(selectedPlan)
                    ? "每月配額（點數 / 每位教師）"
                    : "每月配額（點數 / 教師）"}
                </Label>
                <Input
                  id="plan-quota"
                  type="number"
                  min={0}
                  value={formData.quota}
                  onChange={(e) =>
                    setFormData({ ...formData, quota: e.target.value })
                  }
                />
                <p className="text-xs text-gray-500">
                  {selectedPlan &&
                    isGroupBuyPlan(selectedPlan) &&
                    (() => {
                      // `||` on string "0" would fall through; use
                      // empty-string check so admin typing 0 reflects.
                      const quotaStr =
                        formData.quota !== ""
                          ? formData.quota
                          : String(selectedPlan.quota ?? 0);
                      const seats = selectedPlan.teacher_seats ?? 0;
                      const total = Number(quotaStr) * seats;
                      return `每月 1 號 cron 會為團隊中每位教師建立一筆「${quotaStr} 點」的週期。團隊總配點 = ${quotaStr} × ${seats} = ${total.toLocaleString()} 點 / 月`;
                    })()}
                  {selectedPlan &&
                    !isGroupBuyPlan(selectedPlan) &&
                    "個人方案：每月為訂閱教師建立一筆此數量的週期"}
                </p>
                {formErrors.quota && (
                  <p className="text-xs text-red-600">{formErrors.quota}</p>
                )}
              </div>

              {/* Group-buy-only economic levers */}
              {selectedPlan && isGroupBuyPlan(selectedPlan) && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="plan-annual-fee">
                      每席年費（NT$ / 教師 / 年）
                    </Label>
                    <Input
                      id="plan-annual-fee"
                      type="number"
                      min={1}
                      value={formData.annual_fee}
                      onChange={(e) =>
                        setFormData({ ...formData, annual_fee: e.target.value })
                      }
                    />
                    <p className="text-xs text-gray-500">
                      這是「每一席」的價格，不是團隊總價。團隊總價 = 此值 ×{" "}
                      {selectedPlan.teacher_seats} 席。
                    </p>
                    {formErrors.annual_fee && (
                      <p className="text-xs text-red-600">
                        {formErrors.annual_fee}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="plan-topup-discount">
                      加購點數包折扣（0~1，例：0.90 = 9 折）
                    </Label>
                    <Input
                      id="plan-topup-discount"
                      type="number"
                      step="0.01"
                      min={0}
                      max={1}
                      value={formData.topup_discount}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          topup_discount: e.target.value,
                        })
                      }
                    />
                    <p className="text-xs text-gray-500">
                      團內教師加購點數時的價格倍率（例：0.85 = 85 折，0.90 = 9
                      折，0.95 = 95 折）。
                    </p>
                    {formErrors.topup_discount && (
                      <p className="text-xs text-red-600">
                        {formErrors.topup_discount}
                      </p>
                    )}
                  </div>

                  <p className="text-xs text-gray-500 italic">
                    席次（teacher_seats）在此處不可改 —
                    變更席次會與既有團隊綁定衝突；如需新席次方案，請在 DB
                    直接新增 plans row。
                  </p>
                </>
              )}

              <div className="flex items-center justify-between border-t pt-3">
                <div>
                  <Label htmlFor="plan-active">啟用此方案</Label>
                  <p className="text-xs text-gray-500">
                    停用後不影響既有訂閱，僅控制是否能新訂。
                  </p>
                </div>
                <Switch
                  id="plan-active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_active: checked })
                  }
                />
              </div>
            </div>
          </div>
          {/* /flex-1 overflow-y-auto */}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
              disabled={isSaving}
            >
              取消
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "儲存中..." : "儲存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
