/**
 * Quota source breakdown helper (issue #637 design v3).
 *
 * Given the response of /api/subscription/status, group it into a small,
 * ordered list of "sources" the user can recognise — subscription plan,
 * trial bonus, referral bonus, purchased packs, admin grant — each with its
 * own colour and used/total so the UI can render a stacked bar + legend.
 */

export type QuotaSourceKind =
  | "subscription"
  | "trial"
  | "referral"
  | "pack"
  | "admin";

export interface QuotaSourceItem {
  kind: QuotaSourceKind;
  label: string;
  fill: string; // strong colour for the REMAINING portion (inner bar / legend dot)
  bg: string; // light colour for the USED/background portion
  total: number;
  used: number;
}

const META: Record<
  QuotaSourceKind,
  { label: string; fill: string; bg: string }
> = {
  subscription: { label: "訂閱配額", fill: "#6366F1", bg: "#E0E7FF" },
  trial: { label: "試用點數", fill: "#3B82F6", bg: "#DBEAFE" },
  referral: { label: "推薦獎勵", fill: "#059669", bg: "#A7F3D0" },
  pack: { label: "點數包", fill: "#D97706", bg: "#FED7AA" },
  admin: { label: "管理員配發", fill: "#7C3AED", bg: "#DDD6FE" },
};

const ORDER: QuotaSourceKind[] = [
  "subscription",
  "trial",
  "referral",
  "pack",
  "admin",
];

/**
 * Convert a #RRGGBB hex string to a CSS `rgba(...)` with the given alpha.
 * Falls back to the original colour if the input isn't a 6-digit hex (safer
 * than string-concatenating "55" onto an unknown format).
 */
export function hexAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function mapPackageSource(source: string): QuotaSourceKind {
  switch (source) {
    case "trial_bonus":
      return "trial";
    case "referral_reward":
      return "referral";
    case "purchase":
    case "org_purchase":
      return "pack";
    case "admin_grant":
      return "admin";
    default:
      return "pack";
  }
}

interface SubscriptionStatusLike {
  plan?: string | null;
  subscription_total?: number;
  subscription_used?: number;
  credit_packages?: Array<{
    source: string;
    points_total: number;
    points_used: number;
    is_expired: boolean;
    status: string;
  }>;
}

export function buildQuotaSources(
  res: SubscriptionStatusLike,
): QuotaSourceItem[] {
  const acc = new Map<
    QuotaSourceKind,
    { label: string; fill: string; bg: string; used: number; total: number }
  >();

  if ((res.subscription_total ?? 0) > 0) {
    acc.set("subscription", {
      label: res.plan ? `${res.plan} 配額` : META.subscription.label,
      fill: META.subscription.fill,
      bg: META.subscription.bg,
      total: res.subscription_total ?? 0,
      used: res.subscription_used ?? 0,
    });
  }

  for (const pkg of res.credit_packages ?? []) {
    // Skip refunded / expired / migrated packages — they don't contribute
    // to the visible balance. The DB column has no CHECK constraint, so guard
    // against an empty / falsy status by treating anything other than the
    // literal "active" as inactive (not just "non-empty and not active").
    if (pkg.is_expired) continue;
    if (pkg.status !== "active") continue;
    const kind = mapPackageSource(pkg.source);
    const existing = acc.get(kind);
    if (existing) {
      existing.used += pkg.points_used;
      existing.total += pkg.points_total;
    } else {
      acc.set(kind, {
        label: META[kind].label,
        fill: META[kind].fill,
        bg: META[kind].bg,
        used: pkg.points_used,
        total: pkg.points_total,
      });
    }
  }

  return ORDER.filter((k) => acc.has(k)).map((k) => ({
    kind: k,
    ...acc.get(k)!,
  }));
}
