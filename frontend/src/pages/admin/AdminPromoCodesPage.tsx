import { useState, useEffect, useCallback } from "react";
import {
  apiClient,
  type PromoCodeRow,
  type RewardConfigRow,
  type ReferralReportRow,
} from "@/lib/api";
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
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Ticket, Gift, BarChart3, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const formatDate = (s: string | null) => {
  if (!s) return "永久";
  // A bare "YYYY-MM-DD" parses as UTC midnight, rendering one day early in
  // UTC+8; pin it to local midnight so the displayed date matches the input.
  const normalized = s.includes("T") ? s : `${s}T00:00:00`;
  return new Date(normalized).toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

export default function AdminPromoCodesPage() {
  const [codes, setCodes] = useState<PromoCodeRow[]>([]);
  const [configs, setConfigs] = useState<RewardConfigRow[]>([]);
  const [report, setReport] = useState<ReferralReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Local edit buffer for reward-config points, keyed by reward_key.
  const [pointDrafts, setPointDrafts] = useState<Record<string, string>>({});

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, rc, rep] = await Promise.all([
        apiClient.listPromoCodes(),
        apiClient.listRewardConfigs(),
        apiClient.getReferralReport(),
      ]);
      setCodes(c);
      setConfigs(rc);
      setReport(rep);
      // Preserve any unsaved point edits across refetch (a toggle elsewhere
      // triggers fetchAll); only seed keys we don't already have a draft for.
      setPointDrafts((prev) =>
        Object.fromEntries(
          rc.map((r) => [r.reward_key, prev[r.reward_key] ?? String(r.points)]),
        ),
      );
    } catch (err) {
      console.error("Failed to load promo data:", err);
      setError(err instanceof Error ? err.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const toggleCodeActive = async (row: PromoCodeRow) => {
    try {
      await apiClient.updatePromoCode(row.id, { is_active: !row.is_active });
      toast.success(`已${row.is_active ? "停用" : "啟用"}推薦碼 ${row.code}`);
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失敗");
    }
  };

  const saveRewardPoints = async (cfg: RewardConfigRow) => {
    const draft = pointDrafts[cfg.reward_key];
    if (draft === undefined) return; // row not yet loaded into drafts
    const n = Number(draft);
    if (draft === "" || Number.isNaN(n) || n < 0 || !Number.isInteger(n)) {
      toast.error("點數必須是 0 或正整數");
      return;
    }
    if (n === cfg.points) {
      toast.info("沒有變更");
      return;
    }
    try {
      await apiClient.updateRewardConfig(cfg.reward_key, { points: n });
      toast.success(`已更新 ${cfg.reward_key} 為 ${n} 點`);
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失敗");
    }
  };

  const toggleRewardActive = async (cfg: RewardConfigRow) => {
    try {
      await apiClient.updateRewardConfig(cfg.reward_key, {
        is_active: !cfg.is_active,
      });
      toast.success(`已${cfg.is_active ? "停用" : "啟用"} ${cfg.reward_key}`);
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失敗");
    }
  };

  if (loading) {
    return <div className="py-8 text-center text-gray-500">載入中...</div>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Reward config editor */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-pink-600" />
            獎勵點數設定
          </CardTitle>
          <p className="text-sm text-gray-500 mt-1">
            調整各事件發放給推薦人／被推薦人的點數。修改後立即生效。
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>事件</TableHead>
                <TableHead>對象</TableHead>
                <TableHead>點數</TableHead>
                <TableHead>啟用</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {configs.map((cfg) => (
                <TableRow key={cfg.reward_key}>
                  <TableCell className="font-medium">{cfg.reward_key}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {cfg.recipient === "referred" ? "被推薦人" : "推薦人"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      className="w-28"
                      value={pointDrafts[cfg.reward_key] ?? ""}
                      onChange={(e) =>
                        setPointDrafts({
                          ...pointDrafts,
                          [cfg.reward_key]: e.target.value,
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={cfg.is_active}
                      onCheckedChange={() => toggleRewardActive(cfg)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => saveRewardPoints(cfg)}
                    >
                      儲存
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Promo codes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-blue-600" />
            推薦碼
          </CardTitle>
          <p className="text-sm text-gray-500 mt-1">
            每位老師註冊時自動取得個人碼；可在此停用／啟用。
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>推薦碼</TableHead>
                <TableHead>老師 ID</TableHead>
                <TableHead>類型</TableHead>
                <TableHead>到期</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {codes.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-gray-500 py-6"
                  >
                    尚無推薦碼
                  </TableCell>
                </TableRow>
              ) : (
                codes.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono">{row.code}</TableCell>
                    <TableCell>{row.teacher_id}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {row.kind === "affiliate" ? "特約" : "個人"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {formatDate(row.expires_at)}
                    </TableCell>
                    <TableCell>
                      {row.is_active ? (
                        <Badge variant="default">啟用中</Badge>
                      ) : (
                        <Badge variant="secondary">已停用</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleCodeActive(row)}
                      >
                        {row.is_active ? "停用" : "啟用"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Referral report */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-green-600" />
            推薦成效報表
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>推薦人 ID</TableHead>
                <TableHead>推薦人數</TableHead>
                <TableHead>已驗證</TableHead>
                <TableHead>已付費轉換</TableHead>
                <TableHead>累積獲得點數</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-gray-500 py-6"
                  >
                    尚無推薦資料
                  </TableCell>
                </TableRow>
              ) : (
                report.map((r) => (
                  <TableRow key={r.referrer_teacher_id}>
                    <TableCell className="font-medium">
                      {r.referrer_teacher_id}
                    </TableCell>
                    <TableCell>{r.referral_count}</TableCell>
                    <TableCell>{r.verified_count}</TableCell>
                    <TableCell>{r.paid_count}</TableCell>
                    <TableCell>{r.total_points_awarded}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
