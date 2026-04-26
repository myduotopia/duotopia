/**
 * Post-login redirect target persistence (Issue #571).
 *
 * Captures the URL a user originally tried to visit before being bounced to
 * a login page, so we can return them there after they authenticate.
 *
 * Stored in sessionStorage (not React Router state alone) so the value
 * survives:
 *  - Multi-step login flows (StudentLogin's 4 steps)
 *  - External SSO round-trips (1Campus → external → /auth/1campus/callback)
 *  - Hard navigations (api.ts 401 auto-logout via window.location.href)
 *  - Login-page reloads
 */

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
