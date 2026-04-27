// sessionStorage-backed so the target survives multi-step flows, SSO round-trips, and 401 hard navigations.

const STORAGE_KEY = "auth_redirect_after_login";

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
    sessionStorage.setItem(STORAGE_KEY, path);
  } catch {
    // sessionStorage may be unavailable (private mode, SSR); silently ignore.
  }
}

export function consumeRedirectTarget(fallback: string): string {
  let target: string | null = null;
  try {
    target = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  return isSafeRedirectPath(target) ? target : fallback;
}
