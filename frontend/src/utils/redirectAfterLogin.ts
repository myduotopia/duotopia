// Storage-backed so the target survives multi-step flows, SSO round-trips, and 401 hard navigations.
//
// #989: localStorage rather than sessionStorage, because the registration flow
// can continue in a *different tab* — the visitor clicks the verification link
// in their mail client, which opens a fresh tab with an empty sessionStorage,
// and the demo's "copy this material after you log in" intent would be lost.
// localStorage is shared across tabs, so it survives. A TTL keeps a forgotten
// target from hijacking an unrelated login days later, and the old
// sessionStorage value is still read once for anyone mid-flow across the deploy.

/** @internal — exported only so tests can read raw storage; do not use directly. */
export const REDIRECT_STORAGE_KEY = "auth_redirect_after_login";

/** How long a saved target stays valid. Long enough for register → verify email
 * → log in, short enough that it never surprises a later session. */
export const REDIRECT_TTL_MS = 24 * 60 * 60 * 1000;

interface StoredRedirect {
  path: string;
  expiresAt: number;
}

const LOGIN_PAGE_PREFIXES = [
  "/teacher/login",
  "/teacher/register",
  "/teacher/forgot-password",
  "/teacher/reset-password",
  "/teacher/setup-password",
  "/teacher/verify-email",
  "/student/login",
  "/student/forgot-password",
  "/student/reset-password",
  "/auth/1campus/callback",
  "/auth/google/callback",
  "/verify-email",
];

export function isSafeRedirectPath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0) return false;
  if (!path.startsWith("/")) return false;
  // Reject protocol-relative URLs ("//evil.com") — open redirect guard
  if (path.startsWith("//")) return false;
  if (path.includes("\\")) return false;
  // Reject percent-encoded variants (e.g. /%2Fevil.com decodes to //evil.com)
  try {
    const decoded = decodeURIComponent(path);
    if (decoded.startsWith("//")) return false;
  } catch {
    return false; // malformed encoding
  }
  return true;
}

export function saveRedirectTarget(path: unknown): void {
  if (!isSafeRedirectPath(path)) return;
  if (LOGIN_PAGE_PREFIXES.some((p) => path.startsWith(p))) return;
  const entry: StoredRedirect = {
    path,
    expiresAt: Date.now() + REDIRECT_TTL_MS,
  };
  try {
    localStorage.setItem(REDIRECT_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage may be unavailable (private mode, SSR); silently ignore.
  }
}

/** Read and clear the stored target from both storages, honouring the TTL. */
function takeStoredTarget(): string | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(REDIRECT_STORAGE_KEY);
    localStorage.removeItem(REDIRECT_STORAGE_KEY);
  } catch {
    // ignore
  }

  // Legacy plain-string value written by the pre-#989 sessionStorage version.
  let legacy: string | null = null;
  try {
    legacy = sessionStorage.getItem(REDIRECT_STORAGE_KEY);
    sessionStorage.removeItem(REDIRECT_STORAGE_KEY);
  } catch {
    // ignore
  }

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as StoredRedirect;
      if (
        parsed &&
        typeof parsed.path === "string" &&
        typeof parsed.expiresAt === "number" &&
        parsed.expiresAt > Date.now()
      ) {
        return parsed.path;
      }
      return legacy;
    } catch {
      // Not JSON — a plain path written before this change.
      return raw;
    }
  }

  return legacy;
}

/**
 * Consume the saved redirect target. Role-sensitive callers MUST pass
 * `allowedPrefixes` to prevent a path saved by a different role from being
 * honored (e.g., a `/teacher/*` target hijacking a student login flow).
 * Prefix matching: trailing-slash prefix matches any sub-path; bare prefix
 * matches exact-or-sub-path (so `/dashboard` does not match `/dashboard-admin`).
 */
export function consumeRedirectTarget(
  fallback: string,
  allowedPrefixes?: string[],
): string {
  const target = takeStoredTarget();
  if (!isSafeRedirectPath(target)) return fallback;
  if (
    allowedPrefixes &&
    !allowedPrefixes.some((p) => matchesPrefix(target, p))
  ) {
    return fallback;
  }
  return target;
}

function matchesPrefix(target: string, prefix: string): boolean {
  // Reject empty and bare "/" — both would silently allow every absolute path.
  if (!prefix || prefix === "/") return false;
  if (prefix.endsWith("/")) return target.startsWith(prefix);
  return target === prefix || target.startsWith(prefix + "/");
}
