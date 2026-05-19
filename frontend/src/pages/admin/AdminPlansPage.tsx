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
}

interface FormState {
  price: string;
  quota: string;
  is_active: boolean;
}

const initialFormState: FormState = {
  price: "",
  quota: "",
  is_active: true,
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

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!selectedPlan || !validateForm()) return;

    setIsSaving(true);
    try {
      const payload: {
        price?: number;
        quota?: number;
        is_active?: boolean;
      } = {};
      if (formData.price !== "") payload.price = Number(formData.price);
      if (formData.quota !== "") payload.quota = Number(formData.quota);
      if (formData.is_active !== selectedPlan.is_active) {
        payload.is_active = formData.is_active;
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>編輯方案：{selectedPlan?.name}</DialogTitle>
            <DialogDescription>
              調整價格與配額。空白表示不變更該欄位。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="plan-price">價格（TWD/月）</Label>
              <Input
                id="plan-price"
                type="number"
                min={0}
                value={formData.price}
                onChange={(e) =>
                  setFormData({ ...formData, price: e.target.value })
                }
              />
              {formErrors.price && (
                <p className="text-xs text-red-600">{formErrors.price}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="plan-quota">每月配額（點數）</Label>
              <Input
                id="plan-quota"
                type="number"
                min={0}
                value={formData.quota}
                onChange={(e) =>
                  setFormData({ ...formData, quota: e.target.value })
                }
              />
              {formErrors.quota && (
                <p className="text-xs text-red-600">{formErrors.quota}</p>
              )}
            </div>

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
