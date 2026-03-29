import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DollarSign,
  TrendingUp,
  AlertTriangle,
  RefreshCcw,
  Loader2,
  Database,
  Clock,
  BarChart3,
  Edit,
} from "lucide-react";
import { apiClient } from "@/lib/api";
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
interface BillingSummary {
  total_cost: number;
  period: { start: string; end: string };
  top_services: Array<{ service: string; cost: number }>;
  daily_costs: Array<{ date: string; cost: number }>;
  data_available: boolean;
  message?: string;
  error?: string;
}

// interface ServiceBreakdown {
//   service: string;
//   total_cost: number;
//   period: { start: string; end: string };
//   daily_breakdown: Array<{ date: string; cost: number }>;
//   sku_breakdown: Array<{ sku: string; cost: number }>;
//   data_available: boolean;
// }

interface AnomalyCheck {
  has_anomaly: boolean;
  current_period: { cost: number; period: { start: string; end: string } };
  previous_period: { cost: number; period: { start: string; end: string } };
  increase_percent: number;
  anomalies: Array<{
    service: string;
    current_cost: number;
    previous_cost: number;
    increase_percent: number;
  }>;
  data_available: boolean;
  message?: string;
}

interface BillingHealth {
  status: string;
  bigquery_connected: boolean;
  tables_available?: boolean;
  dataset?: string;
  message?: string;
  error?: string;
}

export default function AdminBillingDashboard() {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [health, setHealth] = useState<BillingHealth | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState(30);
  const [showCustomDays, setShowCustomDays] = useState(false);
  const [customDaysInput, setCustomDaysInput] = useState("");

  useEffect(() => {
    fetchAllData();
  }, [days]);

  const fetchAllData = async () => {
    try {
      setLoading(true);

      // Fetch health status
      const healthResponse = await apiClient.get<BillingHealth>(
        "/api/admin/billing/health",
      );
      setHealth(healthResponse);

      // Fetch billing summary
      const summaryResponse = await apiClient.get<BillingSummary>(
        `/api/admin/billing/summary?days=${days}`,
      );
      setSummary(summaryResponse);

      // Fetch anomaly check
      const anomalyResponse = await apiClient.get<AnomalyCheck>(
        `/api/admin/billing/anomaly-check?threshold_percent=50&days=${Math.min(
          days,
          30,
        )}`,
      );
      setAnomalies(anomalyResponse);
    } catch (error) {
      console.error("Failed to fetch billing data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchAllData();
    setRefreshing(false);
  };

  const handleCustomDays = () => {
    const customDays = parseInt(customDaysInput);
    if (customDays && customDays > 0 && customDays <= 365) {
      setDays(customDays);
      setShowCustomDays(false);
      setCustomDaysInput("");
    } else {
      alert("請輸入 1-365 之間的天數");
    }
  };

  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const dataAvailable = summary?.data_available && health?.bigquery_connected;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">GCP 費用監控</h2>
        <p className="text-muted-foreground">
          即時追蹤 Google Cloud Platform 費用
        </p>
      </div>

      {/* System Status */}
      {health && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <Database className="h-4 w-4 md:h-5 md:w-5" />
              系統狀態
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
              <div className="flex items-center gap-3">
                <div
                  className={`h-3 w-3 flex-shrink-0 rounded-full ${
                    health.bigquery_connected
                      ? "bg-green-500 animate-pulse"
                      : "bg-red-500"
                  }`}
                />
                <div>
                  <p className="text-xs md:text-sm font-medium">
                    BigQuery 連線
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {health.bigquery_connected ? "已連線" : "未連線"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className={`h-3 w-3 flex-shrink-0 rounded-full ${
                    health.tables_available
                      ? "bg-green-500 animate-pulse"
                      : "bg-yellow-500"
                  }`}
                />
                <div>
                  <p className="text-xs md:text-sm font-medium">資料可用性</p>
                  <p className="text-xs text-muted-foreground">
                    {health.tables_available ? "資料已匯入" : "等待匯入"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 md:h-5 md:w-5 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="text-xs md:text-sm font-medium">更新頻率</p>
                  <p className="text-xs text-muted-foreground">每小時更新</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Availability Alert - Only show if no data */}
      {!dataAvailable && (
        <Alert>
          <AlertDescription className="text-sm">
            {summary?.message ||
              health?.message ||
              "等待 GCP 匯出資料（啟用後需 24 小時）"}
          </AlertDescription>
        </Alert>
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setDays(7)}
            variant={days === 7 ? "default" : "ghost"}
            size="sm"
          >
            過去 7 天
          </Button>
          <Button
            onClick={() => setDays(30)}
            variant={days === 30 ? "default" : "ghost"}
            size="sm"
          >
            過去 30 天
          </Button>
          <Button
            onClick={() => setDays(60)}
            variant={days === 60 ? "default" : "ghost"}
            size="sm"
          >
            過去 60 天
          </Button>
          <Button
            onClick={() => setDays(90)}
            variant={days === 90 ? "default" : "ghost"}
            size="sm"
          >
            過去三個月
          </Button>
          {!showCustomDays ? (
            <div className="flex items-center gap-1">
              <Button
                onClick={() => setShowCustomDays(true)}
                variant={![7, 30, 60, 90].includes(days) ? "default" : "ghost"}
                size="sm"
              >
                {![7, 30, 60, 90].includes(days)
                  ? `過去 ${days} 天`
                  : "自訂天數"}
              </Button>
              {![7, 30, 60, 90].includes(days) && (
                <Button
                  onClick={() => setShowCustomDays(true)}
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  title="修改天數"
                >
                  <Edit className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Input
                type="number"
                placeholder="天數"
                value={customDaysInput}
                onChange={(e) => setCustomDaysInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCustomDays();
                  if (e.key === "Escape") {
                    setShowCustomDays(false);
                    setCustomDaysInput("");
                  }
                }}
                className="w-20 h-8 text-sm"
                autoFocus
                min="1"
                max="365"
              />
              <Button
                onClick={handleCustomDays}
                size="sm"
                variant="ghost"
                className="h-8 px-2"
              >
                ✓
              </Button>
              <Button
                onClick={() => {
                  setShowCustomDays(false);
                  setCustomDaysInput("");
                }}
                size="sm"
                variant="ghost"
                className="h-8 px-2"
              >
                ✕
              </Button>
            </div>
          )}
        </div>
        <Button
          onClick={handleRefresh}
          disabled={refreshing}
          variant="outline"
          size="sm"
        >
          <RefreshCcw
            className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`}
          />
          刷新
        </Button>
      </div>

      {/* Summary Cards - Compact */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-2 md:pt-3">
            <CardTitle className="text-xs font-medium text-gray-600 dark:text-gray-400">
              總費用
            </CardTitle>
            <DollarSign className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
          </CardHeader>
          <CardContent className="pb-2 md:pb-3">
            <div className="text-lg md:text-xl font-bold">
              {formatCurrency(summary?.total_cost || 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {summary?.period.start} ~ {summary?.period.end}
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-2 md:pt-3">
            <CardTitle className="text-xs font-medium text-gray-600 dark:text-gray-400">
              Top 服務
            </CardTitle>
            <BarChart3 className="h-3.5 w-3.5 text-purple-500 flex-shrink-0" />
          </CardHeader>
          <CardContent className="pb-2 md:pb-3">
            <div className="text-lg md:text-xl font-bold truncate">
              {summary?.top_services?.[0]?.service || "N/A"}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatCurrency(summary?.top_services?.[0]?.cost || 0)}
            </p>
          </CardContent>
        </Card>

        <Card
          className={`border-l-4 ${
            anomalies?.increase_percent && anomalies.increase_percent > 50
              ? "border-l-red-500"
              : anomalies?.increase_percent && anomalies.increase_percent > 0
                ? "border-l-orange-500"
                : "border-l-green-500"
          }`}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-2 md:pt-3">
            <CardTitle className="text-xs font-medium text-gray-600 dark:text-gray-400">
              費用增長
            </CardTitle>
            <TrendingUp
              className={`h-3.5 w-3.5 flex-shrink-0 ${
                anomalies?.increase_percent && anomalies.increase_percent > 50
                  ? "text-red-500"
                  : anomalies?.increase_percent &&
                      anomalies.increase_percent > 0
                    ? "text-orange-500"
                    : "text-green-500"
              }`}
            />
          </CardHeader>
          <CardContent className="pb-2 md:pb-3">
            <div className="text-lg md:text-xl font-bold">
              {anomalies?.increase_percent !== undefined
                ? `${anomalies.increase_percent > 0 ? "+" : ""}${anomalies.increase_percent.toFixed(1)}%`
                : "N/A"}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              相較前期 {days} 天
            </p>
          </CardContent>
        </Card>

        <Card
          className={`border-l-4 ${
            anomalies?.has_anomaly
              ? "border-l-red-500 bg-red-50"
              : "border-l-green-500"
          }`}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-2 md:pt-3">
            <CardTitle className="text-xs font-medium text-gray-600 dark:text-gray-400">
              異常警報
            </CardTitle>
            <AlertTriangle
              className={`h-3.5 w-3.5 flex-shrink-0 ${
                anomalies?.has_anomaly
                  ? "text-red-500 animate-pulse"
                  : "text-green-500"
              }`}
            />
          </CardHeader>
          <CardContent className="pb-2 md:pb-3">
            <div className="text-lg md:text-xl font-bold">
              {anomalies?.anomalies?.length || 0}
            </div>
            <p
              className={`text-xs mt-0.5 font-medium ${
                anomalies?.has_anomaly ? "text-red-700" : "text-green-700"
              }`}
            >
              {anomalies?.has_anomaly ? "⚠️ 偵測到異常" : "✓ 正常"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Anomaly Alerts */}
      {anomalies?.has_anomaly && anomalies.anomalies.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="font-semibold mb-2">
              偵測到 {anomalies.anomalies.length} 個費用異常
            </div>
            <ul className="list-disc list-inside space-y-1">
              {anomalies.anomalies.map((anomaly, idx) => (
                <li key={idx} className="text-sm">
                  <strong>{anomaly.service}</strong>: $
                  {anomaly.previous_cost.toFixed(2)} → $
                  {anomaly.current_cost.toFixed(2)} (
                  {anomaly.increase_percent > 0 ? "+" : ""}
                  {anomaly.increase_percent.toFixed(1)}%)
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Charts */}
      {dataAvailable && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Daily Cost Trend */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                每日費用趨勢
              </CardTitle>
              <CardDescription>過去 {days} 天的 GCP 費用變化</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="w-full overflow-x-auto">
                <div className="min-w-[300px]">
                  <ResponsiveContainer
                    width="100%"
                    height={250}
                    className="md:!h-[300px]"
                  >
                    <LineChart data={summary?.daily_costs || []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatDate}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value) => formatCurrency(Number(value))}
                        labelFormatter={(label) => `日期: ${label}`}
                      />
                      <Legend wrapperStyle={{ fontSize: "12px" }} />
                      <Line
                        type="monotone"
                        dataKey="cost"
                        stroke="#8884d8"
                        name="費用 (USD)"
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Top Services */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                服務費用排行
              </CardTitle>
              <CardDescription>過去 {days} 天的 Top 10 服務</CardDescription>
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
                      data={summary?.top_services?.slice(0, 10) || []}
                      layout="vertical"
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis
                        dataKey="service"
                        type="category"
                        width={120}
                        tick={{ fontSize: 10 }}
                      />
                      <Tooltip
                        formatter={(value) => formatCurrency(Number(value))}
                      />
                      <Legend wrapperStyle={{ fontSize: "12px" }} />
                      <Bar dataKey="cost" fill="#82ca9d" name="費用 (USD)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {!dataAvailable && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-12">
              <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">等待資料匯入</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                BigQuery Billing Export 已啟用，資料將在 24
                小時內開始匯入。請稍後再回來查看費用資料。
              </p>
              <div className="mt-6">
                <Button onClick={handleRefresh} variant="outline">
                  <RefreshCcw className="h-4 w-4 mr-2" />
                  檢查資料狀態
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
