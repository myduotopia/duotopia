/**
 * Group-buy plan cards (issue #768 comment 4638082532 item 3).
 *
 * Extracted from `PricingPage` so the same 3-card grid + identical
 * fallback semantics can be re-used on `/teacher/subscription` (the
 * subscription-management page also needs to surface group-buy plans
 * to teachers who already have an individual subscription).
 *
 * Data flow:
 *   - fetch `/api/credit-packages/group-buy-plans` (public endpoint,
 *     no auth required).
 *   - on success, render the live values.
 *   - on failure, fall back to the seed snapshot below so anonymous /
 *     transient-error visitors still see something useful instead of
 *     an empty card grid.
 *
 * IMPORTANT: the fallback values mirror the DB seed as of 2026-06-15.
 * Admin action path: after editing any 團購 plan at `/admin/plans`
 * (quota, annual_fee, topup_discount, teacher_seats), ALSO update the
 * corresponding entry in `GROUP_BUY_FALLBACK` below. Live PricingPage /
 * TeacherSubscription will reflect the new values as long as the API
 * request succeeds; the fallback only fires on network failure / 5xx,
 * and at that point will silently show stale data unless kept in sync.
 */
import React from "react";
import { apiClient } from "@/lib/api";

export interface GroupBuyMarketingPlan {
  name: string;
  teacher_seats: number;
  annual_fee: number;
  total_amount: number;
  topup_discount: number;
  monthly_quota: number;
  display_order: number;
}

export const GROUP_BUY_FALLBACK: GroupBuyMarketingPlan[] = [
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

interface Props {
  /**
   * Optional click handler for each card's body. When provided,
   * clicking the card fires the callback with the plan name; useful
   * for callers that want to chain into the open-team flow. When
   * omitted, cards are inert (PricingPage uses a single CTA button
   * outside the grid, so per-card click would be misleading).
   */
  onSelectPlan?: (planName: string) => void;
}

export function GroupBuyPlanCards({ onSelectPlan }: Props) {
  const [plans, setPlans] =
    React.useState<GroupBuyMarketingPlan[]>(GROUP_BUY_FALLBACK);
  React.useEffect(() => {
    let cancelled = false;
    apiClient
      .listGroupBuyPlans()
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data) && data.length > 0) setPlans(data);
      })
      .catch(() => {
        // Keep fallback; the page already renders something useful.
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
        {plans.map((p) => {
          const clickable = Boolean(onSelectPlan);
          return (
            <div
              key={p.name}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => onSelectPlan?.(p.name) : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectPlan?.(p.name);
                      }
                    }
                  : undefined
              }
              className={
                "rounded-xl border border-gray-200 bg-white p-6 flex flex-col" +
                (clickable
                  ? " cursor-pointer hover:border-blue-400 hover:shadow-md transition"
                  : "")
              }
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
          );
        })}
      </div>
    </>
  );
}
