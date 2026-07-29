/**
 * Group-buy open page — 3-step wizard (issue #768 Phase 5-2 + comment #3).
 *
 * Route: /teacher/group-buy/open
 * Auth: any authenticated teacher.
 *
 * Flow:
 *   Step 1 — Plan selection.
 *     Lists active group-buy plans from GET /api/credit-packages/group-buy-plans
 *     (now public so /pricing can share the same endpoint).
 *
 *   Step 2 — Team roster.
 *     N email rows where N = plan.teacher_seats. Row 1 is the leader (the
 *     current teacher); rows 2..N are members.
 *     - Each row validates on blur via POST /validate-team-emails.
 *     - For "not_registered" / "not_verified" emails the row exposes a
 *       "share invite link" button — the URL embeds the leader's personal
 *       promo code (issue #637) so the registrant ends up bound to them.
 *     - "CSV import" populates rows 2..N from a one-column English CSV.
 *     - Roster + leader email persist to localStorage so navigating
 *       away or refreshing during the back-and-forth invite phase
 *       doesn't lose state.
 *     - The "下一步：付款" button stays disabled until every row is "ok".
 *
 *   Step 3 — Payment.
 *     TapPay component fires POST /group-buy-open with the validated
 *     roster as `member_emails`. Backend re-validates inside the same
 *     transaction (倍安全 per design decision); any failure refunds
 *     instead of partially provisioning.
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
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
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

type RowStatus =
  | "idle"
  | "checking"
  | "ok"
  | "not_registered"
  | "not_verified"
  | "in_group_buy_team"
  | "invalid_format"
  | "duplicate";

interface RosterRow {
  email: string;
  status: RowStatus;
  // Stable per-row id so React keys survive status changes / dedupe runs.
  id: string;
}

const STATUS_LABEL: Record<RowStatus, string> = {
  idle: "",
  checking: "驗證中…",
  ok: "✓ 已驗證",
  not_registered: "✗ 未註冊",
  not_verified: "✗ 信箱未驗證",
  in_group_buy_team: "✗ 已在其他團購團",
  invalid_format: "✗ Email 格式錯誤",
  duplicate: "✗ 與其他列重複",
};

const STATUS_COLOR: Record<RowStatus, string> = {
  idle: "text-gray-400",
  checking: "text-gray-500",
  ok: "text-green-700",
  not_registered: "text-red-600",
  not_verified: "text-red-600",
  in_group_buy_team: "text-red-600",
  invalid_format: "text-red-600",
  duplicate: "text-red-600",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Single source of truth for the "leader is allowed to open multiple
// teams" exception. Both the per-row blur handler and the batch
// revalidate path need to apply this rule consistently — extracting it
// here eliminates the prior code-duplication and keeps the two paths
// from drifting if the rule changes (e.g. add "OR leader is admin").
function resolveLeaderStatus(
  idx: number,
  normalizedEmail: string,
  leaderEmail: string | undefined,
  status: RowStatus,
): RowStatus {
  const leader = leaderEmail?.trim().toLowerCase();
  if (
    idx === 0 &&
    status === "in_group_buy_team" &&
    leader &&
    normalizedEmail === leader
  ) {
    return "ok";
  }
  return status;
}

function lsKey(teacherId: number | string | undefined, planName: string) {
  return `gb-open-roster:${teacherId ?? "anon"}:${planName}`;
}

function makeRowId() {
  return Math.random().toString(36).slice(2);
}

function emptyRoster(seats: number, leaderEmail: string): RosterRow[] {
  const rows: RosterRow[] = [
    { email: leaderEmail, status: "idle", id: makeRowId() },
  ];
  for (let i = 1; i < seats; i++) {
    rows.push({ email: "", status: "idle", id: makeRowId() });
  }
  return rows;
}

function dedupeStatuses(rows: RosterRow[]): RosterRow[] {
  // Mark any row whose normalised, non-empty email also appears earlier in
  // the list as "duplicate". Earlier rows keep their original status (the
  // first occurrence wins), so editing the duplicate clears the flag cleanly.
  const seen = new Set<string>();
  return rows.map((r) => {
    const norm = r.email.trim().toLowerCase();
    if (!norm) return r;
    if (seen.has(norm)) {
      return { ...r, status: "duplicate" as RowStatus };
    }
    seen.add(norm);
    if (r.status === "duplicate") {
      // The duplicate condition cleared but the flag is stale — reset to
      // idle so the next blur revalidates.
      return { ...r, status: "idle" as RowStatus };
    }
    return r;
  });
}

export default function GroupBuyOpenPage() {
  const navigate = useNavigate();
  const teacher = useTeacherAuthStore((s) => s.user);
  const [plans, setPlans] = React.useState<GroupBuyPlan[]>([]);
  const [plansLoading, setPlansLoading] = React.useState(true);
  const [plansError, setPlansError] = React.useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = React.useState<GroupBuyPlan | null>(
    null,
  );
  const [roster, setRoster] = React.useState<RosterRow[]>([]);
  const [step, setStep] = React.useState<"plan" | "roster" | "payment">("plan");
  const [csvOpen, setCsvOpen] = React.useState(false);
  const [shareTarget, setShareTarget] = React.useState<string | null>(null);
  const [promoCode, setPromoCode] = React.useState<string | null>(null);
  // Issue #768 comment 4638082532 item 2 — leader's contact phone is a
  // required field on the roster step. We persist it via localStorage
  // alongside the roster so it survives navigation, and ship it to
  // backend in the open-team payload (audit log captures it for
  // support to reach the buyer). Intentionally not cleared on plan
  // change: phone belongs to the leader (constant across plan picks)
  // rather than to the plan; clearing on swap would just force the
  // user to re-type the same number.
  const [leaderPhone, setLeaderPhone] = React.useState("");
  const csvInputRef = React.useRef<HTMLInputElement>(null);

  // ----- plan list (Step 1) -----
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiClient.listGroupBuyPlans();
        if (!cancelled) setPlans(data);
      } catch (e) {
        if (!cancelled) {
          const msg =
            e instanceof ApiError
              ? typeof e.detail === "string"
                ? e.detail
                : e.message
              : "載入團購方案失敗";
          setPlansError(msg);
          toast.error(msg);
        }
      } finally {
        if (!cancelled) setPlansLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ----- personal promo code (for share-invite button) -----
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await apiClient.getMyPersonalPromoCode();
        if (!cancelled) setPromoCode(r.code);
      } catch {
        // Non-fatal — share button degrades to "register without promo".
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ----- when a plan is selected: rehydrate roster or seed -----
  React.useEffect(() => {
    if (!selectedPlan || !teacher) return;
    const key = lsKey(teacher.id, selectedPlan.name);
    let initial: RosterRow[] | null = null;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored) as {
          rows?: RosterRow[];
          leaderPhone?: string;
        };
        if (parsed.rows && parsed.rows.length === selectedPlan.teacher_seats) {
          // Any "checking" left over from a prior session is stale — reset
          // so the next blur runs a fresh validation request.
          initial = parsed.rows.map((r) => ({
            ...r,
            status: r.status === "checking" ? "idle" : r.status,
            id: r.id || makeRowId(),
          }));
        }
        if (typeof parsed.leaderPhone === "string") {
          setLeaderPhone(parsed.leaderPhone);
        }
      }
    } catch {
      // Corrupt localStorage — fall through to seeded roster.
    }
    if (!initial) {
      initial = emptyRoster(selectedPlan.teacher_seats, teacher.email || "");
    }
    setRoster(initial);
    setStep("roster");

    // Leader-prefill rule (comment #3): if leader is already in a group-buy
    // team, blank their email so they can intentionally open the new team
    // for someone else (allowed — they can open multiple teams).
    if (teacher.email) {
      apiClient
        .validateTeamEmails([teacher.email])
        .then((r) => {
          const row = r.results[0];
          if (!row) return;
          if (row.status === "in_group_buy_team") {
            setRoster((prev) =>
              prev.map((p, i) =>
                i === 0 ? { ...p, email: "", status: "idle" } : p,
              ),
            );
          } else if (row.status === "ok") {
            setRoster((prev) =>
              prev.map((p, i) => (i === 0 ? { ...p, status: "ok" } : p)),
            );
          }
        })
        .catch(() => {
          // Non-fatal: row stays idle, on-blur will retry.
        });
    }
  }, [selectedPlan, teacher]);

  // ----- localStorage write-through -----
  React.useEffect(() => {
    if (!selectedPlan || !teacher || roster.length === 0) return;
    const key = lsKey(teacher.id, selectedPlan.name);
    try {
      window.localStorage.setItem(
        key,
        JSON.stringify({ rows: roster, leaderPhone }),
      );
    } catch {
      // Storage full / private mode — degrade silently.
    }
  }, [roster, leaderPhone, selectedPlan, teacher]);

  // ----- per-row validation on blur -----
  // Row 0 (leader) is also validated here so that if the leader edits their
  // own field — e.g. to open the team for another teacher — the status
  // re-resolves to "ok" / "in_group_buy_team" / etc. The earlier short-
  // circuit on idx===0 left the payment button permanently disabled after
  // any manual edit because nothing else would set status back to "ok".
  // Reads row state via a ref instead of `roster` to keep the closure
  // identity stable across keystrokes. With `roster` in the dep array,
  // a 50-row table recreated all 50 onBlur closures on every character —
  // visible jank when typing fast. The ref tracks the latest roster
  // snapshot synchronously (updated below in a write-through effect),
  // so the function still sees fresh values without re-binding deps.
  const rosterRef = React.useRef<RosterRow[]>(roster);
  React.useEffect(() => {
    rosterRef.current = roster;
  }, [roster]);

  // Per-row AbortController so a fast blur→edit→blur sequence on the
  // same row aborts the in-flight request. Without this, a slow first
  // response could land after a fresher one and overwrite the correct
  // status (e.g. user fixes a typo, gets "ok", then the stale "not_
  // registered" arrives and flips the badge red).
  const inFlightRef = React.useRef<Map<number, AbortController>>(new Map());

  const validateRow = React.useCallback(
    async (idx: number) => {
      const current = rosterRef.current;
      const value = current[idx]?.email?.trim().toLowerCase() || "";
      if (!value) {
        setRoster((prev) =>
          prev.map((r, i) => (i === idx ? { ...r, status: "idle" } : r)),
        );
        return;
      }
      if (!EMAIL_REGEX.test(value)) {
        setRoster((prev) =>
          prev.map((r, i) =>
            i === idx ? { ...r, status: "invalid_format" } : r,
          ),
        );
        return;
      }
      const dupIdx = current.findIndex(
        (r, j) =>
          j !== idx && r.email.trim().toLowerCase() === value && value !== "",
      );
      if (dupIdx !== -1 && dupIdx < idx) {
        setRoster((prev) =>
          prev.map((r, i) => (i === idx ? { ...r, status: "duplicate" } : r)),
        );
        return;
      }
      // Abort any in-flight request for this same row before firing a
      // new one — stale-response-overwrites-fresh is the worst kind of
      // validation bug because the badge ends up wrong on a row the
      // user thinks they just fixed.
      const prior = inFlightRef.current.get(idx);
      if (prior) prior.abort();
      const controller = new AbortController();
      inFlightRef.current.set(idx, controller);
      setRoster((prev) =>
        prev.map((r, i) => (i === idx ? { ...r, status: "checking" } : r)),
      );
      try {
        const res = await apiClient.validateTeamEmails(
          [value],
          controller.signal,
        );
        // Defence in depth: if a newer request superseded us between
        // the await and here, drop the response on the floor.
        if (inFlightRef.current.get(idx) !== controller) return;
        const row = res.results[0];
        const raw: RowStatus = row?.status ?? "not_registered";
        const status = resolveLeaderStatus(idx, value, teacher?.email, raw);
        setRoster((prev) =>
          prev.map((r, i) => (i === idx ? { ...r, status } : r)),
        );
      } catch (e) {
        // AbortError from the supersession path is intentional — quiet
        // exit, no toast, leave the newer request's status alone.
        if (
          (e as { name?: string })?.name === "AbortError" ||
          inFlightRef.current.get(idx) !== controller
        ) {
          return;
        }
        const msg =
          e instanceof ApiError
            ? typeof e.detail === "string"
              ? e.detail
              : e.message
            : "驗證失敗";
        toast.error(msg);
        setRoster((prev) =>
          prev.map((r, i) => (i === idx ? { ...r, status: "idle" } : r)),
        );
      } finally {
        // Clean up the map entry only if it's still ours, so a later
        // delete doesn't clobber a newer controller.
        if (inFlightRef.current.get(idx) === controller) {
          inFlightRef.current.delete(idx);
        }
      }
    },
    [teacher],
  );

  // Pure helper: takes a roster snapshot, fires the batch endpoint, and
  // returns a new roster with statuses applied. Decoupled from React state
  // so callers can pass the freshly-computed roster (CSV import) instead of
  // depending on stale-closure timing via setTimeout.
  // Row 0 is included in the batch so 「重新檢查」 also refreshes the leader
  // after a manual edit — otherwise the leader could land on a stale
  // "idle" badge and wonder why the payment button stays disabled.
  const applyBatchStatusesTo = React.useCallback(
    async (src: RosterRow[]): Promise<RosterRow[]> => {
      // Format-check up front so an invalid-format row from CSV import
      // doesn't reach Pydantic and surface a generic 422 — those rows
      // already carry their own "invalid_format" badge from the CSV
      // handler and stay flagged via the per-row map below.
      const candidates = src
        .map((r, idx) => ({ idx, email: r.email.trim().toLowerCase() }))
        .filter(({ email }) => Boolean(email) && EMAIL_REGEX.test(email));
      if (candidates.length === 0) return src;
      try {
        const res = await apiClient.validateTeamEmails(
          candidates.map((x) => x.email),
        );
        const byEmail = new Map(res.results.map((r) => [r.email, r]));
        return src.map((r, i) => {
          const v = r.email.trim().toLowerCase();
          if (!v) return r;
          const raw: RowStatus = byEmail.get(v)?.status ?? "idle";
          const status = resolveLeaderStatus(i, v, teacher?.email, raw);
          return { ...r, status };
        });
      } catch (e) {
        const msg =
          e instanceof ApiError
            ? typeof e.detail === "string"
              ? e.detail
              : e.message
            : "批次驗證失敗";
        toast.error(msg);
        // Reset any in-flight "checking" so users can re-trigger.
        return src.map((r) =>
          r.status === "checking" ? { ...r, status: "idle" } : r,
        );
      }
    },
    [teacher],
  );

  // ----- batch revalidate (after CSV import or "重新檢查") -----
  // Uses rosterRef so this handler's identity is stable across roster
  // edits — matches the validateRow optimisation above.
  const revalidateAll = React.useCallback(async () => {
    const current = rosterRef.current;
    const hasAny = current.some((r) => r.email.trim().length > 0);
    if (!hasAny) return;
    const inFlight = current.map((r) =>
      r.email.trim() ? { ...r, status: "checking" as RowStatus } : r,
    );
    setRoster(inFlight);
    const next = await applyBatchStatusesTo(inFlight);
    setRoster(next);
  }, [applyBatchStatusesTo]);

  // ----- CSV import -----
  const handleCsvFile = async (file: File) => {
    if (!selectedPlan) return;
    const text = await file.text();
    const emails = text
      .split(/\r?\n/)
      .map((line) => line.split(",")[0].trim())
      .filter((line) => line && line.toLowerCase() !== "email")
      .slice(0, selectedPlan.teacher_seats - 1);
    // Build the post-import roster up-front so we can hand it to the batch
    // validator directly — no setTimeout or closure-over-roster needed.
    // Pre-flight email format check per row: matches what `validateRow`
    // does on blur, so a malformed CSV row gets an "invalid_format"
    // badge immediately instead of vanishing into a 422 from the
    // backend (the catch block resets to "idle" and leaves the user
    // with no per-row clue what went wrong).
    const newRoster: RosterRow[] = roster.map((r, i) => {
      if (i === 0) return r;
      const incoming = emails[i - 1];
      if (incoming === undefined) return { ...r, email: "", status: "idle" };
      if (!EMAIL_REGEX.test(incoming)) {
        return { ...r, email: incoming, status: "invalid_format" };
      }
      return { ...r, email: incoming, status: "checking" };
    });
    setRoster(newRoster);
    setCsvOpen(false);
    const validated = await applyBatchStatusesTo(newRoster);
    setRoster(validated);
  };

  const downloadCsvTemplate = () => {
    // Dynamic row count keyed off the chosen plan so a 50-seat purchaser
    // sees the actual expected length (49 member rows) instead of a
    // hardcoded 2 — caught by review and worth the explicitness.
    const seats = selectedPlan?.teacher_seats ?? 2;
    const rows = Array.from(
      { length: Math.max(1, seats - 1) },
      (_, i) => `teacher${i + 2}@example.com`,
    );
    const blob = new Blob([`Email\n${rows.join("\n")}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "team-roster-template.csv";
    // Spec doesn't guarantee a detached <a>.click() works; some browsers
    // (older Safari, embedded webviews) only honour the synthesised click
    // once the anchor is in the document.
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ----- derived: row counters with deduped statuses -----
  const dedupedRoster = React.useMemo(() => dedupeStatuses(roster), [roster]);
  const okCount = dedupedRoster.filter((r) => r.status === "ok").length;
  // Issue #768 comment 4638082532 item 2 — phone is part of the
  // payment gate. Trim guard so whitespace-only doesn't satisfy.
  const phoneOk = leaderPhone.trim().length > 0;
  const allOk =
    selectedPlan !== null &&
    dedupedRoster.length === selectedPlan.teacher_seats &&
    okCount === selectedPlan.teacher_seats &&
    phoneOk;

  // ----- payment handlers -----
  const handlePaymentSuccess = (transactionId: string) => {
    toast.success(`開團成功！交易編號 ${transactionId}`);
    if (selectedPlan && teacher) {
      try {
        window.localStorage.removeItem(lsKey(teacher.id, selectedPlan.name));
      } catch {
        // ignore
      }
    }
    navigate("/teacher/dashboard");
  };

  const handlePaymentError = (errMsg: string) => {
    toast.error(`開團失敗：${errMsg}`);
  };

  // ============ render ============

  if (plansLoading) {
    return <div className="p-6">載入中…</div>;
  }
  if (plansError) {
    return <div className="p-6 text-red-600">{plansError}</div>;
  }
  if (plans.length === 0) {
    return (
      <div className="p-6">目前沒有可用的團購方案。請聯絡 Duotopia 客服。</div>
    );
  }

  // ----- Step 1: plan selection -----
  if (step === "plan" || !selectedPlan) {
    return (
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold">開設教師團購方案</h1>
        <p className="text-sm text-gray-600">
          選擇方案後，先填寫所有成員 email
          並完成驗證，最後才會進行刷卡。月費贈點將於每月 1
          號自動發放給團內所有教師。
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

  // ----- Step 2: roster -----
  if (step === "roster") {
    // Pin the invitee's email into the share link as well as the promo
    // code. Without it the invitee can register with any address, leave
    // the roster slot stale, and the leader has no way to recover. The
    // register page reads ?email= and pre-fills the field (changes-only-
    // if-empty so the invitee can still override if needed).
    const shareUrl = shareTarget
      ? `${window.location.origin}/teacher/register?` +
        new URLSearchParams({
          ...(promoCode ? { promo: promoCode } : {}),
          email: shareTarget,
        }).toString()
      : "";

    return (
      <div className="p-6 space-y-4 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{selectedPlan.name} · 填寫團員</h1>
          <Button
            variant="ghost"
            onClick={() => {
              setSelectedPlan(null);
              setStep("plan");
            }}
          >
            ← 重選方案
          </Button>
        </div>
        <p className="text-sm text-gray-600">
          共需 {selectedPlan.teacher_seats} 位老師（含發起人）。所有 email
          必須是 <strong>已註冊 + 已驗證信箱</strong> 的 Duotopia
          帳號，付款按鈕在全部 ✓ 後才會啟用。
        </p>

        {/* Issue #768 comment 4638082532 item 2 — 連絡電話(必填) for
            the team leader. Required to enable the payment button so
            support can reach the buyer if there's a refund / dispute. */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="text-sm font-semibold">團主資訊</div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="w-20 text-gray-600">Email</span>
              <span className="text-gray-900">
                {teacher?.email || "（尚未登入）"}
              </span>
              <span className="text-xs text-gray-500">（不可修改）</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="w-20 text-gray-600" htmlFor="gb-leader-phone">
                連絡電話 <span className="text-red-600">*</span>
              </label>
              <Input
                id="gb-leader-phone"
                type="tel"
                className="flex-1 max-w-xs"
                placeholder="如 0912345678"
                value={leaderPhone}
                onChange={(e) => setLeaderPhone(e.target.value)}
              />
              {!phoneOk && (
                <span className="text-xs text-red-600">必填欄位</span>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setCsvOpen(true)}>
            📂 從 CSV 匯入
          </Button>
          <Button variant="ghost" onClick={revalidateAll}>
            🔄 重新檢查
          </Button>
          <span className="text-sm text-gray-500 ml-auto">
            進度：{okCount}/{selectedPlan.teacher_seats} ✓
          </span>
        </div>

        <Card>
          <CardContent className="p-4 space-y-2">
            {dedupedRoster.map((row, idx) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center gap-2 border-b border-gray-100 pb-2"
              >
                <span className="w-8 text-sm text-gray-500">{idx + 1}.</span>
                <span className="w-20 text-xs text-gray-600">團員</span>
                <Input
                  type="email"
                  // issue #983-2：每個 input 給唯一 name + autoComplete off，
                  // 避免瀏覽器 email 自動填入時把所有欄位一起填滿。
                  name={`gb-roster-email-${idx}`}
                  autoComplete="off"
                  className="flex-1 min-w-[200px]"
                  placeholder={
                    idx === 0
                      ? "預設帶入你自己，可改填團員 email"
                      : `team-member-${idx}@example.com`
                  }
                  value={row.email}
                  onChange={(e) =>
                    // Apply dedupe to the resulting roster (not just the
                    // rendered view) so other rows that were "duplicate"
                    // because of the edited row immediately reset to
                    // "idle". Otherwise revalidateAll / rosterRef would
                    // still see stale "duplicate" statuses on those rows
                    // and skip them on the next "重新檢查" press.
                    setRoster((prev) =>
                      dedupeStatuses(
                        prev.map((r, i) =>
                          i === idx
                            ? { ...r, email: e.target.value, status: "idle" }
                            : r,
                        ),
                      ),
                    )
                  }
                  onBlur={() => validateRow(idx)}
                />
                <span
                  className={`text-sm w-28 text-right ${STATUS_COLOR[row.status]}`}
                >
                  {STATUS_LABEL[row.status]}
                </span>
                {(row.status === "not_registered" ||
                  row.status === "not_verified") && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setShareTarget(row.email)}
                  >
                    📎 分享註冊連結
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between mt-4">
          <div className="text-sm">
            共需付款：
            <span className="text-lg font-bold text-blue-600">
              NT$ {selectedPlan.total_amount.toLocaleString()} / 年
            </span>
          </div>
          <Button
            disabled={!allOk}
            onClick={() => setStep("payment")}
            title={
              allOk
                ? ""
                : !phoneOk
                  ? "請填寫連絡電話"
                  : `${selectedPlan.teacher_seats - okCount} 位老師尚未通過驗證`
            }
          >
            下一步：付款 →
          </Button>
        </div>

        {/* CSV import dialog */}
        <Dialog open={csvOpen} onOpenChange={setCsvOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>從 CSV 匯入 email</DialogTitle>
              <DialogDescription>
                檔案格式：第一列為英文欄位名 <code>Email</code>，下方每列一個
                email。最多會匯入 {selectedPlan.teacher_seats - 1} 筆，覆蓋第 2
                ~ 第 {selectedPlan.teacher_seats} 列；第 1
                列（預設帶你自己）不會被動到。
                <br />
                <span className="text-xs text-gray-500">
                  ⚠ 請使用 <strong>UTF-8</strong> 編碼存檔（Excel
                  匯出時請選「CSV UTF-8」，避免 BIG5 造成中文亂碼或讀檔失敗）。
                </span>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <Button variant="outline" onClick={downloadCsvTemplate}>
                ⬇ 下載範本.csv
              </Button>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleCsvFile(file);
                  e.target.value = "";
                }}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCsvOpen(false)}>
                取消
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Share-invite dialog */}
        <Dialog
          open={shareTarget !== null}
          onOpenChange={(o) => !o && setShareTarget(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>分享註冊連結</DialogTitle>
              <DialogDescription>
                把這個連結傳給 {shareTarget}。對方註冊並驗證信箱後，
                回到本頁點「🔄 重新檢查」即可看到 ✓ 已驗證。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Input readOnly value={shareUrl} />
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(shareUrl);
                    toast.success("已複製連結");
                  } catch {
                    toast.error("複製失敗，請手動選取連結");
                  }
                }}
              >
                📋 複製連結
              </Button>
              {!promoCode && (
                <p className="text-xs text-gray-500">
                  尚未取得個人推薦碼 — 連結仍可使用，但不會帶入推薦關係。
                </p>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => setShareTarget(null)}>關閉</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ----- Step 3: payment -----
  // Source roster is `dedupedRoster` — the payment gate (`allOk`)
  // already uses it, so deriving the payload from the same view keeps
  // the two consistent. A user who reaches Step 3 with duplicate rows
  // via browser history would otherwise send a payload guaranteed to
  // 400 at the backend's distinct check.
  const memberEmails = dedupedRoster
    .slice(1)
    .map((r) => r.email.trim().toLowerCase())
    .filter((e) => e !== "");

  return (
    <div className="p-6 space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">開團刷卡 — {selectedPlan.name}</h1>
        <Button variant="ghost" onClick={() => setStep("roster")}>
          ← 返回填寫名單
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>付款資訊</CardTitle>
          <CardDescription>
            {selectedPlan.teacher_seats} 席 × 每席 NT${" "}
            {selectedPlan.annual_fee.toLocaleString()} = 共 NT${" "}
            {selectedPlan.total_amount.toLocaleString()} / 年
            <br />
            團員：{memberEmails.length + 1} 位（全部已驗證 ✓）
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TapPayPayment
            amount={selectedPlan.total_amount}
            planName={selectedPlan.name}
            apiEndpoint="/api/credit-packages/group-buy-open"
            customPayload={{
              plan_name: selectedPlan.name,
              member_emails: memberEmails,
              leader_phone: leaderPhone.trim(),
            }}
            onPaymentSuccess={handlePaymentSuccess}
            onPaymentError={handlePaymentError}
            onCancel={() => setStep("roster")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
