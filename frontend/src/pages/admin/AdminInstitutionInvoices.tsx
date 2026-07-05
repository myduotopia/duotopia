/**
 * Admin page: institution accounts-receivable dashboard (issue #838 Phase D).
 *
 * Route: /admin/billing/institutions
 * Auth: requires admin (ProtectedRoute requireAdmin).
 *
 * Lists institution_invoices with status filtering + "標記已收款" / "作廢"
 * actions. The overdue status is set by the daily cron; here admins mark
 * payment received or cancel an invoice.
 */
import React from "react";
import { useNavigate } from "react-router-dom";
import { apiClient, ApiError, InstitutionInvoiceDto } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const STATUS_FILTERS = [
  { value: "", label: "全部" },
  { value: "pending", label: "待收款" },
  { value: "overdue", label: "逾期" },
  { value: "paid", label: "已收款" },
  { value: "cancelled", label: "已作廢" },
];

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: "待收款", className: "bg-yellow-100 text-yellow-800" },
  overdue: { label: "逾期", className: "bg-red-100 text-red-800" },
  paid: { label: "已收款", className: "bg-green-100 text-green-800" },
  cancelled: { label: "已作廢", className: "bg-gray-100 text-gray-500" },
};

export default function AdminInstitutionInvoices() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = React.useState<InstitutionInvoiceDto[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [busyId, setBusyId] = React.useState<number | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiClient.listInstitutionInvoices(
        status ? { status } : {},
      );
      setInvoices(rows);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? typeof e.detail === "string"
            ? e.detail
            : e.message
          : "載入應收帳款失敗";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [status]);

  React.useEffect(() => {
    load();
  }, [load]);

  const update = async (
    inv: InstitutionInvoiceDto,
    next: "paid" | "cancelled",
  ) => {
    const verb = next === "paid" ? "標記已收款" : "作廢";
    if (!window.confirm(`確定要將此帳款${verb}嗎？`)) return;
    const note =
      window.prompt(`備註（選填）：`, inv.payment_note ?? "") ?? undefined;
    setBusyId(inv.id);
    try {
      await apiClient.updateInstitutionInvoice(inv.id, next, note || undefined);
      toast.success(`已${verb}`);
      await load();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? typeof e.detail === "string"
            ? e.detail
            : e.message
          : `${verb}失敗`;
      toast.error(msg);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">機構應收帳款</h1>
        <Button variant="ghost" onClick={() => navigate("/admin")}>
          ← 返回
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f.value || "all"}
            size="sm"
            variant={status === f.value ? "default" : "outline"}
            onClick={() => setStatus(f.value)}
          >
            {f.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          {loading ? "載入中…" : "重新整理"}
        </Button>
      </div>

      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-3 py-2 text-left">機構</th>
              <th className="px-3 py-2 text-left">期間</th>
              <th className="px-3 py-2 text-right">金額</th>
              <th className="px-3 py-2 text-left">狀態</th>
              <th className="px-3 py-2 text-left">到期日</th>
              <th className="px-3 py-2 text-left">收款時間</th>
              <th className="px-3 py-2 text-left">動作</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                  {loading ? "載入中…" : "沒有符合條件的應收帳款"}
                </td>
              </tr>
            )}
            {invoices.map((inv) => {
              const badge = STATUS_BADGE[inv.status] ?? {
                label: inv.status,
                className: "bg-gray-100 text-gray-700",
              };
              const actionable =
                inv.status === "pending" || inv.status === "overdue";
              return (
                <tr key={inv.id} className="border-t border-gray-200">
                  <td className="px-3 py-2">
                    {inv.organization_name ?? inv.organization_id}
                  </td>
                  <td className="px-3 py-2">
                    {inv.year} 年 {inv.month} 月
                  </td>
                  <td className="px-3 py-2 text-right">
                    {inv.amount.toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-3 py-2">{inv.due_date ?? "—"}</td>
                  <td className="px-3 py-2">
                    {inv.paid_at
                      ? new Date(inv.paid_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {actionable ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={busyId === inv.id}
                          onClick={() => update(inv, "paid")}
                        >
                          標記已收款
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === inv.id}
                          onClick={() => update(inv, "cancelled")}
                        >
                          作廢
                        </Button>
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
