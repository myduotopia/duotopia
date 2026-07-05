/**
 * Institution monthly billing query panel (issue #768 Phase 5-2).
 *
 * Year/month picker → calls GET /api/organizations/{orgId}/billing/monthly,
 * renders aggregate + per-student breakdown.
 *
 * Auth at the API layer: admin can query any org, org_owner only their own.
 * The UI itself is render-neutral — the caller passes orgId.
 */
import React from "react";
import { apiClient, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface MonthlyBilling {
  org_id: string;
  year: number;
  month: number;
  per_student_price: number;
  billable_student_count: number;
  total_amount: number;
  currency: string;
  students: Array<{
    student_id: number;
    name: string;
    billable: boolean;
  }>;
}

interface Props {
  orgId: string;
  defaultYear?: number;
  defaultMonth?: number;
}

export default function OrgMonthlyBillingPanel({
  orgId,
  defaultYear,
  defaultMonth,
}: Props) {
  const today = new Date();
  const [year, setYear] = React.useState<number>(
    defaultYear ?? today.getFullYear(),
  );
  const [month, setMonth] = React.useState<number>(
    defaultMonth ?? today.getMonth() + 1,
  );
  const [loading, setLoading] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  const [result, setResult] = React.useState<MonthlyBilling | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const fetchBilling = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getOrganizationMonthlyBilling(
        orgId,
        year,
        month,
      );
      setResult(data);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? typeof e.detail === "string"
            ? e.detail
            : e.message
          : "查詢計費失敗";
      setError(msg);
      setResult(null);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const { blob, filename } =
        await apiClient.downloadOrganizationMonthlyInvoicePdf(
          orgId,
          year,
          month,
        );
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? typeof e.detail === "string"
            ? e.detail
            : e.message
          : "下載 PDF 請款單失敗";
      toast.error(msg);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card className="w-full max-w-3xl">
      <CardHeader>
        <CardTitle>機構月度計費查詢</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="billing-year">年份</Label>
            <Input
              id="billing-year"
              type="number"
              min={1}
              max={9998}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-28"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="billing-month">月份</Label>
            <Input
              id="billing-month"
              type="number"
              min={1}
              max={12}
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="w-24"
            />
          </div>
          <Button onClick={fetchBilling} disabled={loading}>
            {loading ? "查詢中…" : "查詢"}
          </Button>
          <Button
            onClick={downloadPdf}
            disabled={downloading}
            variant="outline"
          >
            {downloading ? "產生中…" : "下載 PDF 請款單"}
          </Button>
        </div>

        {error && (
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <div className="rounded border border-gray-200 bg-gray-50 p-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-gray-500">查詢期間</div>
                  <div className="font-medium">
                    {result.year} 年 {result.month} 月
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">單位學生月費</div>
                  <div className="font-medium">
                    NT$ {result.per_student_price.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">當月活躍學生</div>
                  <div className="font-medium">
                    {result.billable_student_count} 位
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">應收總額</div>
                  <div className="text-lg font-bold text-blue-600">
                    {result.currency} {result.total_amount.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left">學生 ID</th>
                    <th className="px-3 py-2 text-left">姓名</th>
                    <th className="px-3 py-2 text-left">本月計費</th>
                  </tr>
                </thead>
                <tbody>
                  {result.students.length === 0 && (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-3 py-4 text-center text-gray-500"
                      >
                        此機構目前沒有任何學生
                      </td>
                    </tr>
                  )}
                  {result.students.map((s) => (
                    <tr key={s.student_id} className="border-t border-gray-200">
                      <td className="px-3 py-2">{s.student_id}</td>
                      <td className="px-3 py-2">{s.name}</td>
                      <td className="px-3 py-2">
                        {s.billable ? (
                          <span className="text-green-700">✓ 計費</span>
                        ) : (
                          <span className="text-gray-400">— 不計費</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
