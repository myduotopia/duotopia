// sessionStorage-backed so the target survives multi-step flows, SSO round-trips, and 401 hard navigations.

/** @internal — exported only so tests can read raw storage; do not use directly. */
export const REDIRECT_STORAGE_KEY = "auth_redirect_after_login";

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
  try {
    sessionStorage.setItem(REDIRECT_STORAGE_KEY, path);
  } catch {
    // sessionStorage may be unavailable (private mode, SSR); silently ignore.
  }
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
  let target: string | null = null;
  try {
    target = sessionStorage.getItem(REDIRECT_STORAGE_KEY);
    sessionStorage.removeItem(REDIRECT_STORAGE_KEY);
  } catch {
    // ignore
  }
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
