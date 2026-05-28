import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Ticket,
  Copy,
  Share2,
  ChevronDown,
  ChevronUp,
  Gift,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";

interface MyPromoCode {
  code: string;
  expires_at: string | null;
  is_active: boolean;
  referral_count: number;
  verified_count: number;
  paid_count: number;
  total_points_awarded: number;
}

const REWARD_TIERS: { label: string; points: string }[] = [
  { label: "驗證 Email", points: "+10" },
  { label: "訂閱 Tutor Teachers", points: "+1,000" },
  { label: "訂閱 School Teachers", points: "+2,000" },
  { label: "購買 5,000 點點數包", points: "+200" },
  { label: "購買 10,000 點點數包", points: "+500" },
  { label: "購買 20,000 點點數包", points: "+800" },
];

export default function PromoCodeCard() {
  const [data, setData] = useState<MyPromoCode | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    apiClient
      .getMyPromoCode()
      .then((res) => {
        if (mounted) {
          setData(res);
          setError(null);
        }
      })
      .catch((err) => {
        console.error("Failed to load promo code:", err);
        if (mounted)
          setError(err instanceof Error ? err.message : "無法載入推薦碼");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Always render the card frame so the section is visible. Show a skeleton
  // while loading and a friendly message on error rather than disappearing.
  if (loading) {
    return (
      <Card className="mb-6 border-indigo-200 dark:border-indigo-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-indigo-600" />
            我的推薦碼
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-16 animate-pulse rounded-lg bg-indigo-50 dark:bg-indigo-950" />
        </CardContent>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card className="mb-6 border-indigo-200 dark:border-indigo-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-indigo-600" />
            我的推薦碼
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">
            {error ? `無法載入推薦碼：${error}` : "尚未產生推薦碼，稍後再試。"}
          </p>
        </CardContent>
      </Card>
    );
  }

  const referralLink = `${window.location.origin}/teacher/register?promo=${data.code}`;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`已複製${label}`);
    } catch {
      toast.error("複製失敗");
    }
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Duotopia 推薦邀請",
          text: `用我的推薦碼 ${data.code} 註冊 Duotopia`,
          url: referralLink,
        });
        return;
      } catch {
        // user cancelled or share unavailable; fall through to copy.
      }
    }
    copy(referralLink, "推薦連結");
  };

  return (
    <Card className="mb-6 border-indigo-200 dark:border-indigo-800">
      <CardHeader>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between"
          aria-expanded={expanded}
        >
          <CardTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-indigo-600" />
            我的推薦碼
          </CardTitle>
          <span className="flex items-center gap-1 text-xs text-gray-500">
            {expanded ? "收合" : "展開"}
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </span>
        </button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Code row — always visible */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-indigo-50 dark:bg-indigo-950 px-5 py-4">
          <span className="font-mono text-2xl font-bold tracking-widest text-indigo-700 dark:text-indigo-300">
            {data.code}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => copy(data.code, "推薦碼")}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              <Copy className="h-4 w-4 mr-1.5" />
              複製
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={share}
              className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
            >
              <Share2 className="h-4 w-4 mr-1.5" />
              分享
            </Button>
          </div>
        </div>

        {!expanded ? (
          <p className="text-sm text-gray-500">
            分享你的推薦碼給朋友，每邀請一位老師完成註冊即可獲得獎勵點數。
          </p>
        ) : (
          <>
            {/* Referral link + QR (stacked: link first, QR below) */}
            <div>
              <label className="text-xs text-gray-500">推薦連結</label>
              <div className="mt-1 flex items-center gap-2 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2">
                <code className="flex-1 truncate text-xs text-gray-700 dark:text-gray-200">
                  {referralLink}
                </code>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copy(referralLink, "推薦連結")}
                  className="h-7 px-2"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                朋友點開時會自動帶入你的推薦碼。
              </p>
              <div className="mt-3 flex flex-col items-center gap-1">
                <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white p-2">
                  <QRCodeSVG value={referralLink} size={128} level="M" />
                </div>
                <span className="text-xs text-gray-500">掃 QR 直接註冊</span>
              </div>
            </div>

            {/* Stats grid */}
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                推薦成效
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="已邀請" value={data.referral_count} unit="人" />
                <Stat label="已驗證" value={data.verified_count} unit="人" />
                <Stat label="已付費" value={data.paid_count} unit="人" />
                <Stat
                  label="累積獲得"
                  value={data.total_points_awarded}
                  unit="點"
                  highlight
                />
              </div>
            </div>

            {/* Reward explainer */}
            <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                <Gift className="h-4 w-4 text-indigo-600" />
                獎勵說明
              </div>
              <ul className="space-y-2">
                {REWARD_TIERS.map((tier) => (
                  <li
                    key={tier.label}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-gray-700 dark:text-gray-300">
                      {tier.label}
                    </span>
                    <span className="rounded-md bg-indigo-100 dark:bg-indigo-900 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                      {tier.points} 點
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: number;
  unit: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="flex items-baseline gap-1">
        <span
          className={
            "text-2xl font-bold " +
            (highlight ? "text-indigo-600" : "text-gray-900 dark:text-gray-100")
          }
        >
          {value.toLocaleString()}
        </span>
        <span className="text-xs text-gray-500">{unit}</span>
      </div>
    </div>
  );
}
