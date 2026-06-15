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
        const parsed = JSON.parse(stored) as { rows?: RosterRow[] };
        if (parsed.rows && parsed.rows.length === selectedPlan.teacher_seats) {
          // Any "checking" left over from a prior session is stale — reset
          // so the next blur runs a fresh validation request.
          initial = parsed.rows.map((r) => ({
            ...r,
            status: r.status === "checking" ? "idle" : r.status,
            id: r.id || makeRowId(),
          }));
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
      window.localStorage.setItem(key, JSON.stringify({ rows: roster }));
    } catch {
      // Storage full / private mode — degrade silently.
    }
  }, [roster, selectedPlan, teacher]);

  // ----- per-row validation on blur -----
  // Row 0 (leader) is also validated here so that if the leader edits their
  // own field — e.g. to open the team for another teacher — the status
  // re-resolves to "ok" / "in_group_buy_team" / etc. The earlier short-
  // circuit on idx===0 left the payment button permanently disabled after
  // any manual edit because nothing else would set status back to "ok".
  // useCallback + roster/teacher deps: every onBlur handler closes over
  // these values, and the roster ranges from 10 to 50 rows — recreating
  // all closures on every keystroke was wasteful. The deps still cover
  // every value the function reads.
  const validateRow = React.useCallback(
    async (idx: number) => {
      const value = roster[idx]?.email?.trim().toLowerCase() || "";
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
      const dupIdx = roster.findIndex(
        (r, j) =>
          j !== idx && r.email.trim().toLowerCase() === value && value !== "",
      );
      if (dupIdx !== -1 && dupIdx < idx) {
        setRoster((prev) =>
          prev.map((r, i) => (i === idx ? { ...r, status: "duplicate" } : r)),
        );
        return;
      }
      setRoster((prev) =>
        prev.map((r, i) => (i === idx ? { ...r, status: "checking" } : r)),
      );
      try {
        const res = await apiClient.validateTeamEmails([value]);
        const row = res.results[0];
        let status: RowStatus = row?.status ?? "not_registered";
        // Row 0 = the leader slot. Backend always uses current_teacher as the
        // org_owner regardless of the row 0 value, AND the leader is allowed
        // to open multiple teams (design Q2). So if the leader types their
        // own email and the API says "already in another group-buy team",
        // we still let the payment gate open — backend wouldn't block.
        if (
          idx === 0 &&
          status === "in_group_buy_team" &&
          teacher?.email &&
          value === teacher.email.trim().toLowerCase()
        ) {
          status = "ok";
        }
        setRoster((prev) =>
          prev.map((r, i) => (i === idx ? { ...r, status } : r)),
        );
      } catch (e) {
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
      }
    },
    [roster, teacher],
  );

  // Pure helper: takes a roster snapshot, fires the batch endpoint, and
  // returns a new roster with statuses applied. Decoupled from React state
  // so callers can pass the freshly-computed roster (CSV import) instead of
  // depending on stale-closure timing via setTimeout.
  // Stateless — no deps needed; memoizing it just keeps the identity
  // stable across re-renders so consumers don't need their own deps.
  const applyBatchStatusesTo = React.useCallback(
    async (src: RosterRow[]): Promise<RosterRow[]> => {
      const candidates = src
        .map((r, idx) => ({ idx, email: r.email.trim().toLowerCase() }))
        .filter(({ idx, email }) => idx > 0 && email);
      if (candidates.length === 0) return src;
      try {
        const res = await apiClient.validateTeamEmails(
          candidates.map((x) => x.email),
        );
        const byEmail = new Map(res.results.map((r) => [r.email, r]));
        return src.map((r, i) => {
          if (i === 0) return r;
          const v = r.email.trim().toLowerCase();
          if (!v) return r;
          const status: RowStatus = byEmail.get(v)?.status ?? "idle";
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
        return src.map((r, i) =>
          i > 0 && r.status === "checking" ? { ...r, status: "idle" } : r,
        );
      }
    },
    [],
  );

  // ----- batch revalidate (after CSV import or "重新檢查") -----
  const revalidateAll = async () => {
    const hasAny = roster.some((r, i) => i > 0 && r.email.trim().length > 0);
    if (!hasAny) return;
    const inFlight = roster.map((r, i) =>
      i > 0 && r.email.trim() ? { ...r, status: "checking" as RowStatus } : r,
    );
    setRoster(inFlight);
    const next = await applyBatchStatusesTo(inFlight);
    setRoster(next);
  };

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
    const newRoster: RosterRow[] = roster.map((r, i) => {
      if (i === 0) return r;
      const incoming = emails[i - 1];
      if (incoming === undefined) return { ...r, email: "", status: "idle" };
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
  const allOk =
    selectedPlan !== null &&
    dedupedRoster.length === selectedPlan.teacher_seats &&
    okCount === selectedPlan.teacher_seats;

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
    const shareUrl =
      shareTarget && promoCode
        ? `${window.location.origin}/teacher/register?promo=${encodeURIComponent(promoCode)}`
        : shareTarget
          ? `${window.location.origin}/teacher/register`
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
                <span className="w-20 text-xs text-gray-600">
                  {idx === 0 ? "發起人" : "團員"}
                </span>
                <Input
                  type="email"
                  className="flex-1 min-w-[200px]"
                  placeholder={
                    idx === 0
                      ? "發起人 email（可改填別人）"
                      : `team-member-${idx}@example.com`
                  }
                  value={row.email}
                  onChange={(e) =>
                    setRoster((prev) =>
                      prev.map((r, i) =>
                        i === idx
                          ? { ...r, email: e.target.value, status: "idle" }
                          : r,
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
                ~ 第 {selectedPlan.teacher_seats} 列；發起人那一列不會被動到。
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
  const memberEmails = roster
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
