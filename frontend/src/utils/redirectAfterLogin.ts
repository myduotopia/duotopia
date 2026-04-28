// sessionStorage-backed so the target survives multi-step flows, SSO round-trips, and 401 hard navigations.

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
  // Role isolation: caller restricts which paths it'll honor so a teacher
  // target saved in sessionStorage can't redirect a student-login flow into
  // /teacher/*, which would bounce back to /teacher/login.
  // Trailing-slash prefixes ("/teacher/") match any sub-path; bare paths
  // ("/dashboard") match exact-or-sub-path so they don't over-match a future
  // /dashboard-admin route.
  if (
    allowedPrefixes &&
    !allowedPrefixes.some((p) => matchesPrefix(target, p))
  ) {
    return fallback;
  }
  return target;
}

function matchesPrefix(target: string, prefix: string): boolean {
  if (!prefix) return false; // empty prefix would match every absolute path
  if (prefix.endsWith("/")) return target.startsWith(prefix);
  return target === prefix || target.startsWith(prefix + "/");
}
