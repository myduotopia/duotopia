import { describe, it, expect, beforeEach } from "vitest";
import {
  isSafeRedirectPath,
  saveRedirectTarget,
  consumeRedirectTarget,
  REDIRECT_STORAGE_KEY,
} from "../redirectAfterLogin";

const STORAGE_KEY = REDIRECT_STORAGE_KEY;

/** Read the path out of the stored JSON envelope (#989). */
function storedPath(): string | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as { path: string }).path : null;
}

describe("isSafeRedirectPath", () => {
  it("accepts normal absolute paths", () => {
    expect(isSafeRedirectPath("/student/dashboard")).toBe(true);
    expect(isSafeRedirectPath("/teacher/classroom/42?tab=overview")).toBe(true);
    expect(isSafeRedirectPath("/path#fragment")).toBe(true);
  });

  it("rejects non-string and empty values", () => {
    expect(isSafeRedirectPath(null)).toBe(false);
    expect(isSafeRedirectPath(undefined)).toBe(false);
    expect(isSafeRedirectPath(42)).toBe(false);
    expect(isSafeRedirectPath("")).toBe(false);
  });

  it("rejects paths that don't start with /", () => {
    expect(isSafeRedirectPath("dashboard")).toBe(false);
    expect(isSafeRedirectPath("https://evil.com")).toBe(false);
  });

  it("rejects protocol-relative URLs (//evil.com)", () => {
    expect(isSafeRedirectPath("//evil.com")).toBe(false);
    expect(isSafeRedirectPath("//evil.com/student/dashboard")).toBe(false);
  });

  it("rejects backslash-normalized paths", () => {
    expect(isSafeRedirectPath("/\\evil.com")).toBe(false);
    expect(isSafeRedirectPath("\\\\evil.com")).toBe(false);
    expect(isSafeRedirectPath("/path\\with\\backslash")).toBe(false);
  });

  it("rejects percent-encoded variants that decode to //", () => {
    expect(isSafeRedirectPath("/%2Fevil.com")).toBe(false);
    expect(isSafeRedirectPath("/%2fevil.com")).toBe(false);
  });

  it("rejects malformed percent-encoding", () => {
    expect(isSafeRedirectPath("/%E0%A4%A")).toBe(false);
    expect(isSafeRedirectPath("/%ZZ")).toBe(false);
  });
});

describe("saveRedirectTarget / consumeRedirectTarget", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("round-trips a safe path", () => {
    saveRedirectTarget("/student/dashboard");
    expect(storedPath()).toBe("/student/dashboard");
    expect(consumeRedirectTarget("/fallback")).toBe("/student/dashboard");
  });

  it("does not save unsafe paths", () => {
    saveRedirectTarget("//evil.com");
    saveRedirectTarget("/%2Fevil.com");
    saveRedirectTarget("/back\\slash");
    saveRedirectTarget("not-absolute");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("does not save login-page prefixes", () => {
    saveRedirectTarget("/teacher/login");
    saveRedirectTarget("/student/login?from=foo");
    saveRedirectTarget("/teacher/reset-password/abc123");
    saveRedirectTarget("/auth/1campus/callback?code=xyz");
    saveRedirectTarget("/verify-email?token=abc");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("consumeRedirectTarget returns fallback when storage is empty", () => {
    expect(consumeRedirectTarget("/student/dashboard")).toBe(
      "/student/dashboard",
    );
  });

  it("consumeRedirectTarget atomically clears the stored value", () => {
    saveRedirectTarget("/teacher/programs/5");
    expect(consumeRedirectTarget("/fallback")).toBe("/teacher/programs/5");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    // Second call returns fallback because the value was consumed.
    expect(consumeRedirectTarget("/fallback")).toBe("/fallback");
  });

  it("consumeRedirectTarget returns fallback if stored value is unsafe", () => {
    localStorage.setItem(STORAGE_KEY, "//evil.com");
    expect(consumeRedirectTarget("/safe-fallback")).toBe("/safe-fallback");
  });
});

describe("consumeRedirectTarget allowedPrefixes (role isolation)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("returns fallback when stored target does not match any allowed prefix", () => {
    saveRedirectTarget("/teacher/dashboard");
    expect(consumeRedirectTarget("/student/dashboard", ["/student/"])).toBe(
      "/student/dashboard",
    );
  });

  it("returns stored target when it matches an allowed prefix", () => {
    saveRedirectTarget("/student/assignment/42/activity");
    expect(consumeRedirectTarget("/student/dashboard", ["/student/"])).toBe(
      "/student/assignment/42/activity",
    );
  });

  it("returns stored target when any allowed prefix matches", () => {
    saveRedirectTarget("/organization/123/members");
    expect(
      consumeRedirectTarget("/teacher/dashboard", [
        "/teacher/",
        "/organization/",
        "/dashboard",
      ]),
    ).toBe("/organization/123/members");
  });

  it("teacher target leaks to student login → falls back", () => {
    saveRedirectTarget("/teacher/programs/5");
    expect(consumeRedirectTarget("/student/dashboard", ["/student/"])).toBe(
      "/student/dashboard",
    );
  });

  it("student target leaks to teacher login → falls back", () => {
    saveRedirectTarget("/student/dashboard");
    expect(
      consumeRedirectTarget("/teacher/dashboard", [
        "/teacher/",
        "/organization/",
        "/dashboard",
      ]),
    ).toBe("/teacher/dashboard");
  });

  it("still consumes (clears storage) when prefix mismatch causes fallback", () => {
    saveRedirectTarget("/teacher/dashboard");
    consumeRedirectTarget("/student/dashboard", ["/student/"]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("backwards compatible: omitting allowedPrefixes returns stored target", () => {
    saveRedirectTarget("/anything/at/all");
    expect(consumeRedirectTarget("/fallback")).toBe("/anything/at/all");
  });

  it("matches bare /dashboard exactly", () => {
    saveRedirectTarget("/dashboard");
    expect(
      consumeRedirectTarget("/teacher/dashboard", [
        "/teacher/",
        "/organization/",
        "/dashboard",
      ]),
    ).toBe("/dashboard");
  });

  it("matches /dashboard sub-paths via bare prefix", () => {
    saveRedirectTarget("/dashboard/teacher");
    expect(
      consumeRedirectTarget("/teacher/dashboard", [
        "/teacher/",
        "/organization/",
        "/dashboard",
      ]),
    ).toBe("/dashboard/teacher");
  });

  it("bare prefix /dashboard does not over-match /dashboard-admin", () => {
    saveRedirectTarget("/dashboard-admin/foo");
    expect(
      consumeRedirectTarget("/teacher/dashboard", [
        "/teacher/",
        "/organization/",
        "/dashboard",
      ]),
    ).toBe("/teacher/dashboard");
  });

  it("does not match a different role despite shared substring", () => {
    saveRedirectTarget("/teacher/students/100");
    // "/student/" prefix should NOT match "/teacher/students/..."
    expect(consumeRedirectTarget("/student/dashboard", ["/student/"])).toBe(
      "/student/dashboard",
    );
  });

  it("empty string in allowedPrefixes does not silently allow every path", () => {
    saveRedirectTarget("/teacher/dashboard");
    expect(consumeRedirectTarget("/student/dashboard", [""])).toBe(
      "/student/dashboard",
    );
  });

  it("bare '/' in allowedPrefixes does not silently allow every path", () => {
    saveRedirectTarget("/teacher/dashboard");
    expect(consumeRedirectTarget("/student/dashboard", ["/"])).toBe(
      "/student/dashboard",
    );
  });
});

// #989: registration can finish in a different tab (verification link opened
// from a mail client), so the target must live in localStorage, not
// sessionStorage — otherwise the "copy this demo material" intent is lost.
describe("cross-tab persistence and TTL (#989)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("survives a tab that has no sessionStorage entry", () => {
    saveRedirectTarget("/teacher/programs?demoCopyProgram=63");
    // Simulate the new tab: sessionStorage is empty there.
    sessionStorage.clear();
    expect(consumeRedirectTarget("/fallback", ["/teacher/"])).toBe(
      "/teacher/programs?demoCopyProgram=63",
    );
  });

  it("ignores an expired target", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        path: "/teacher/programs",
        expiresAt: Date.now() - 1000,
      }),
    );
    expect(consumeRedirectTarget("/fallback")).toBe("/fallback");
  });

  it("clears an expired target instead of leaving it around", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ path: "/teacher/programs", expiresAt: Date.now() - 1 }),
    );
    consumeRedirectTarget("/fallback");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("still honours a legacy sessionStorage value written before this change", () => {
    sessionStorage.setItem(STORAGE_KEY, "/teacher/dashboard");
    expect(consumeRedirectTarget("/fallback", ["/teacher/"])).toBe(
      "/teacher/dashboard",
    );
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
